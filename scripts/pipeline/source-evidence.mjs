import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

export function publicAddress(ip) {
  if (isIP(ip) === 4) {
    const [a,b] = ip.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));
  }
  // Only globally routable unicast IPv6; reject mapped IPv4, link/local multicast.
  return isIP(ip) === 6 && /^[23][0-9a-f]{3}:/i.test(ip);
}
export async function safeUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || isIP(u.hostname) || /(^|\.)(localhost|local|internal|invalid)$/.test(u.hostname)) throw new Error('Unsafe source URL');
  const addresses = await lookup(u.hostname,{all:true});
  if (!addresses.length || addresses.some(({address}) => !publicAddress(address))) throw new Error('Non-public source address');
  return u;
}
export async function boundedFetch(raw, { maxBytes=2000000, headers={}, redirects=3 }={}) {
  // HTTPS + DNS vetting + revalidate every redirect. Not a complete DNS-rebinding firewall;
  // production workers should also have an outbound egress policy.
  const u = await safeUrl(raw);
  const response = await fetch(u,{headers:{'User-Agent':process.env.BVAI_USER_AGENT || 'BVAI/2.0 newsroom source verification',...headers},redirect:'manual',signal:AbortSignal.timeout(30000)});
  if ([301,302,303,307,308].includes(response.status)) {
    await response.body?.cancel();
    if (!redirects) throw new Error('Too many source redirects');
    return boundedFetch(new URL(response.headers.get('location'),u).href,{maxBytes,headers,redirects:redirects-1});
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Source HTTP ${response.status}`); }
  if (Number(response.headers.get('content-length')) > maxBytes) {await response.body?.cancel();throw new Error('Source too large');}
  const chunks=[]; let size=0;
  const reader=response.body.getReader();
  try { while (true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error('Source body too large');chunks.push(value);} }
  finally {await reader.cancel();}
  return { bytes:Buffer.concat(chunks),url:u.href,headers:response.headers };
}
export function sourceUrls(article) {
  const items = Array.isArray(article.fact_sources) ? article.fact_sources : [];
  return [...new Set([article.source_url,...items.map(s=>typeof s==='string'?s:s?.url || s?.source_url)].filter(Boolean))];
}
export function isNewsUrl(raw) {
  try {const h=new URL(raw).hostname;return !/(^|\.)(wikipedia\.org|wikimedia\.org|wikidata\.org)$/.test(h);}catch{return false;}
}
/**
 * JS mirror of public.video_gate_basis(): which policy lets this article reach public video?
 *   'editorial'      - reporter/manual/original content explicitly approved by an editor.
 *   'trusted_source' - curated aggregated news with a credited source and a source timestamp, auto-verified.
 *   null             - reporter/field/manual/original or incomplete content: human approval REQUIRED.
 * This is only a fast pre-check. The database function is authoritative: it additionally requires the
 * source row to be enabled and not kill-switched, and it is re-checked at claim and at finalize.
 */
export function videoGateBasis(article) {
  if (!article || article.status !== 'published') return null;
  if (article.field_report_id || article.origin !== 'aggregated') return article.human_verified === true && article.verification_status === 'verified' ? 'editorial' : null;
  const credited = String(article.source_name || '').trim() !== '';
  const urlOk = /^https?:\/\/[^ ]+$/i.test(String(article.source_url || ''));
  const verified = article.verification_status === 'auto_verified' || article.verification_status === 'verified';
  if (article.source_id && credited && urlOk && verified && article.source_published_at) return 'trusted_source';
  return null;
}
export function assertEditorial(article, mode) {
  if (article.status !== 'published') throw new Error('Article not published');
  const bn=String(article.content_bn || '').match(/[\u0980-\u09ff]/g)?.length || 0;
  if (bn < 40) throw new Error('Bengali source content required, not an English article in content_bn');
  if (mode !== 'review') {
    const basis=videoGateBasis(article);
    if (!basis) throw new Error('Human verification and verified status required before public delivery (reporter/field/original content), or a credited trusted aggregated source');
    const hosts=new Set(sourceUrls(article).filter(isNewsUrl).map(s=>new URL(s).hostname.replace(/^www\./,'')));
    const need=basis==='trusted_source'?1:0;
    if (hosts.size<need) throw new Error(need===1?'At least one news source domain required':'At least two source domains required; editor must separately confirm independent ownership and claims');
    const published=Date.parse(article.source_published_at || '');
    if (basis==='trusted_source' && (!Number.isFinite(published) || published>Date.now()+300000 || Date.now()-published>24*3600000)) throw new Error('Missing/stale primary source publication timestamp; review required');
  }
}
export async function refreshEvidence(article, mode, { feedUrl = null, fetcher = boundedFetch } = {}) {
  const sources=[];
  for (const url of sourceUrls(article).filter(isNewsUrl).slice(0,6)) {
    try {
      const result=await fetcher(url);
      sources.push({url,resolved_url:result.url,fetched_at:new Date().toISOString(),http_status:200,etag:result.headers.get('etag'),last_modified:result.headers.get('last-modified'),sha256:createHash('sha256').update(result.bytes).digest('hex'),role:'news_source',claim_verification:videoGateBasis(article)==='trusted_source'?'automated_article_gate':'editorial_article_gate'});
    } catch(e) { sources.push({url,error:e.message,role:'news_source'}); }
  }
  // Many publishers block bots on article pages. For credited trusted-source news only, a live fetch of the publisher's OWN
  // feed that still lists this exact item (link or title) is accepted as fresh evidence. It is recorded as such, never as a page fetch.
  const need=videoGateBasis(article)==='trusted_source'?1:0;
  const fetchedHosts=()=>new Set(sources.filter(x=>x.sha256).map(x=>new URL(x.url).hostname.replace(/^www\./,'')));
  if (mode !== 'review' && need===1 && !fetchedHosts().size && feedUrl && /^https:\/\//.test(feedUrl)) {
    try {
      const feed=await fetcher(feedUrl,{maxBytes:6000000});
      const body=feed.bytes.toString('utf8');
      const listed=(article.source_url && body.includes(article.source_url));
      if (listed) sources.push({url:article.source_url,feed_url:feed.url,fetched_at:new Date().toISOString(),http_status:200,etag:feed.headers.get('etag'),last_modified:feed.headers.get('last-modified'),sha256:createHash('sha256').update(feed.bytes).digest('hex'),role:'news_source',evidence_kind:'publisher_feed_listing',claim_verification:'human_required'});
    } catch(e) { sources.push({url:feedUrl,error:e.message,role:'news_source',evidence_kind:'publisher_feed_listing'}); }
  }
  if (mode !== 'review' && fetchedHosts().size<need) throw new Error(`Fewer than ${need} news sources freshly fetched (article page or the publisher's own feed listing); fail closed`);
  // Wikipedia is context ONLY. Revision freshness is not independent breaking-news corroboration.
  for (const title of (article.context_blocks || []).filter(x=>x?.wikipedia_title).map(x=>x.wikipedia_title).slice(0,2)) {
    const url=new URL('https://bn.wikipedia.org/w/api.php');
    url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',prop:'revisions',rvprop:'ids|timestamp',titles:title,maxlag:'5'});
    try { const r=await boundedFetch(url.href);const data=JSON.parse(r.bytes);if(data.error)throw new Error(data.error.code);sources.push({role:'context_only',provider:'wikipedia',title,fetched_at:new Date().toISOString(),pages:data.query?.pages}); }
    catch(e){sources.push({role:'context_only',title,error:e.message});}
  }
  return sources;
}
export function nearDuplicate(a,b,threshold=.9) {
  const tokens=s=>new Set(String(s).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu,' ').split(/\s+/).filter(Boolean));
  const x=tokens(a),y=tokens(b);if(x.size<15 || y.size<15)return false;
  const intersection=[...x].filter(t=>y.has(t)).length;
  return intersection/(x.size+y.size-intersection)>=threshold;
}
