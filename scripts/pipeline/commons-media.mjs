import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { boundedFetch } from './source-evidence.mjs';
const API='https://commons.wikimedia.org/w/api.php';
const clean=s=>String(s || '').replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim();
/** Conservative automated subset: no NC, ND, GFDL or ShareAlike without a separate compliance plan. */
export function allowedLicense(meta) {
  const name=clean(meta.LicenseShortName?.value);
  const url=String(meta.LicenseUrl?.value || '');
  if (/^CC0(?: 1\.0)?$/i.test(name) && /^https?:\/\/creativecommons.org\/publicdomain\/zero\/1\.0\/?$/.test(url)) return {license:name,license_url:url.replace(/^http:/,'https:')};
  if (/^CC BY (?:2\.0|2\.5|3\.0|4\.0)$/i.test(name) && /^https?:\/\/creativecommons.org\/licenses\/by\/(?:2\.0|2\.5|3\.0|4\.0)\/?$/.test(url)) return {license:name,license_url:url.replace(/^http:/,'https:')};
  return null;
}
export async function collectCommonsVideo(article,{folder,db,jobId,claimToken,fetcher=boundedFetch,maxBytes=12*1024*1024}={}) {
  // Search text is retrieval context only, never evidence of the depicted event.
  const query=clean(article.media_search_query || article.title_en || article.title_bn).slice(0,160);
  if(!query)throw new Error('Media query missing');
  const url=new URL(API);
  url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrnamespace:'6',gsrsearch:`${query} filetype:video`,gsrlimit:'15',prop:'imageinfo',iiprop:'url|size|extmetadata',maxlag:'5'});
  const result=JSON.parse((await fetcher(url.href)).bytes);
  if(result.error)throw new Error('Commons API unavailable');
  const media=[];
  for(const page of result.query?.pages || []) {
    const info=page.imageinfo?.[0],meta=info?.extmetadata || {},rights=allowedLicense(meta);
    if(!rights || !info?.url || !Number.isFinite(info.size) || info.size>maxBytes || info.size<1024)continue;
    const raw=new URL(info.url);
    if(raw.protocol!=='https:' || raw.hostname!=='upload.wikimedia.org' || !/\.(webm|ogv|mp4)$/i.test(raw.pathname))continue;
    const author=clean(meta.Artist?.value);
    if(!author || author.length>240 || meta.NonFree?.value==='true')continue;
    let filename;
    try {
      const download=await fetcher(raw.href,{maxBytes});
      const hash=createHash('sha256').update(download.bytes).digest('hex');
      const sourceUrl=info.descriptionurl;
      if(!sourceUrl || new URL(sourceUrl).hostname!=='commons.wikimedia.org')continue;
      const reservation=await db.rpc('reserve_video_broll',{p_job_id:jobId,p_claim_token:claimToken,p_sha256:hash,p_source_url:sourceUrl});
      if(reservation.error)continue; // Another story already owns these bytes, or our lease is lost.
      filename=path.join(folder,`broll-${media.length}${path.extname(raw.pathname)}`);
      fs.writeFileSync(filename,download.bytes,{mode:0o600});
      media.push({path:filename,sha256:hash,source_url:sourceUrl,download_url:raw.href,source_asset_id:page.pageid,author,...rights,rights_verified:true,type:'symbolic_video',context:'প্রতীকী ভিডিও',attribution:`${author} | ${rights.license} | ${sourceUrl}`,modifications:'Cropped, looped; Bengali captions and narration added',downloaded_at:new Date().toISOString()});
      if(media.length===2)break;
    } catch {if(filename)fs.rmSync(filename,{force:true});}
  }
  if(!media.length)throw new Error('No small licensed unique Commons video; no copyrighted-thumbnail fallback');
  return media;
}
