import {createHash} from 'node:crypto';
const hex=/^[a-f0-9]{64}$/;
const date=x=>typeof x==='string' && Number.isFinite(Date.parse(x));
export const digest=x=>createHash('sha256').update(x).digest('hex');
export function assertReview(r,{now=Date.now(),maxAgeMs=86400000}={}) {
  if(r?.version===2) {
    if(!hex.test(r.video_sha256||'')||!hex.test(r.script_sha256||'')||!Number.isFinite(r.duration_sec)||r.duration_sec<40||r.duration_sec>120)throw Error('Asset/script binding and master duration required');
    if(!date(r.reviewed_at)||Date.parse(r.reviewed_at)>now||now-Date.parse(r.reviewed_at)>maxAgeMs||!r.reviewer_id?.trim())throw Error('Fresh named human review required');
    if(r.editorial_authorized!==true||typeof r.editorial_note!=='string'||r.editorial_note.trim().length<10||r.editorial_note.length>4000)throw Error('Explicit editorial authorization and note required');
    for(const gate of ['names_numbers_dates','pronunciation','scene_relevance','caption_spelling','safe_zones','rights','human_perceptual_qc'])if(r.qc?.[gate]!==true)throw Error('Human QC missing: '+gate);
    if(r.facebook_edit)throw Error('Separate platform edit requires its own reviewed job');
    return true;
  }
  if(!r || r.version!==1 || !hex.test(r.video_sha256||'') || !hex.test(r.script_sha256||''))throw Error('Asset/script binding required');
  if(!Number.isFinite(r.duration_sec)||r.duration_sec<40||r.duration_sec>120)throw Error('Master duration 40–120 required');
  if(!date(r.reviewed_at)||Date.parse(r.reviewed_at)>now||now-Date.parse(r.reviewed_at)>maxAgeMs||!r.reviewer_id?.trim())throw Error('Fresh named human review required');
  for(const gate of ['names_numbers_dates','pronunciation','scene_relevance','caption_spelling','safe_zones','rights','human_perceptual_qc'])if(r.qc?.[gate]!==true)throw Error('Human QC missing: '+gate);
  if(!Array.isArray(r.claims)||!r.claims.length)throw Error('Claim evidence required');
  if(!Array.isArray(r.sources))throw Error('Sources required');
  const sources=new Map();
  for(const s of r.sources){
    if(typeof s.id!=='string'||!s.id||sources.has(s.id))throw Error('Unique source IDs required');
    let u;try{u=new URL(s.url);}catch{throw Error('Source URL invalid');}
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Source URL must be public canonical HTTPS without credentials/query/fragment');
    // No fetch occurs here. SSRF protection remains the existing boundedFetch responsibility.
    const host=u.hostname.toLowerCase();
    const wikimedia=/(^|\.)(wikipedia\.org|wikimedia\.org|wikidata\.org)$/.test(host);
    if(wikimedia && ['primary','independent_news'].includes(s.role))throw Error('Wikimedia cannot substitute for news verification');
    if(!['primary','independent_news','context','media_metadata'].includes(s.role))throw Error('Unknown source role');
    if(!s.owner_id?.trim()||s.ownership_reviewed!==true||!s.ownership_note?.trim())throw Error('Source ownership review required');
    if(!date(s.published_at)||!date(s.fetched_at)||Date.parse(s.published_at)>now||Date.parse(s.fetched_at)>now||now-Date.parse(s.fetched_at)>maxAgeMs||!hex.test(s.content_sha256||''))throw Error('Fresh captured source required');
    sources.set(s.id,s);
  }
  const ids=new Set();
  for(const c of r.claims){
    if(!c.id||ids.has(c.id)||!c.text?.trim())throw Error('Unique nonempty claims required');ids.add(c.id);
    if(c.status!=='verified'||c.disputed!==false||!c.review_note?.trim())throw Error('Disputed/unreviewed claim blocked');
    if(!Array.isArray(c.evidence))throw Error('Per-claim evidence required');
    const primary=new Set(),independent=new Set();
    for(const e of c.evidence){
      const s=sources.get(e.source_id);
      if(!s||!e.quote?.trim()||e.quote_verified!==true||!e.locator?.trim())throw Error('Verified exact quote and locator required');
      if(s.role==='primary')primary.add(s.owner_id);
      if(s.role==='independent_news')independent.add(s.owner_id);
    }
    if(primary.size<1||independent.size<2||[...primary].some(x=>independent.has(x)))throw Error('Each claim needs primary plus two independently owned news sources');
  }
  if(r.facebook_edit){const e=r.facebook_edit;
    if(!hex.test(e.sha256||'')||!hex.test(e.script_sha256||'')||e.source_sha256!==r.video_sha256||!Number.isFinite(e.duration_sec)||e.duration_sec<40||e.duration_sec>90||e.semantic_reviewed!==true||!e.reviewer_id?.trim()||!date(e.reviewed_at)||Date.parse(e.reviewed_at)>now||now-Date.parse(e.reviewed_at)>maxAgeMs||!Array.isArray(e.retained_claim_ids)||!e.retained_claim_ids.length||e.retained_claim_ids.some(id=>!ids.has(id)))throw Error('Facebook edit requires fresh explicit semantic review and asset/script binding');
  }
  return true;
}
export function assertBoundReview(review,videoBytes,spokenScript,options){
  assertReview(review,options);
  if(digest(videoBytes)!==review.video_sha256||digest(spokenScript)!==review.script_sha256)throw Error('Review invalidated by changed media/script');
  return true;
}
// This is a validation contract, not authentication or permission to publish.
// Accept reviewer identity only from the existing authenticated server session.
