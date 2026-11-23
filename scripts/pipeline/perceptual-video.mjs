// Perceptual (near-duplicate) video fingerprints: 64-bit dHash per sampled frame. Hex text, never JS numbers.
// Detects re-encodes, rescales and trimmed copies. NOT robust to flips, heavy crops/rotation, overlays or colour grading.
import {spawnSync} from 'node:child_process';
export const FLAT_HASHES=new Set(['0000000000000000','ffffffffffffffff']);
export const isFlat=h=>FLAT_HASHES.has(h);
export function dhash(gray) {
  if(!gray || gray.length!==72)throw new Error('dHash needs a 9x8 grayscale frame (72 bytes)');
  let bits=0n;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits=(bits<<1n)|(gray[y*9+x]>gray[y*9+x+1]?1n:0n);
  return bits.toString(16).padStart(16,'0');
}
export function hamming(a,b) {
  let x=BigInt('0x'+a)^BigInt('0x'+b),n=0;
  while(x){x&=x-1n;n++;}
  return n;
}
export const informativeCount=frames=>new Set(frames.filter(h=>!isFlat(h))).size;
// Fraction of informative frames of `a` that have a frame in `b` within maxDistance bits (mirrors SQL perceptual_overlap).
export function overlap(a,b,maxDistance=10) {
  const A=[...new Set(a.filter(h=>!isFlat(h)))],B=[...new Set(b.filter(h=>!isFlat(h)))];
  if(!A.length || !B.length)return 0;
  return A.filter(x=>B.some(y=>hamming(x,y)<=maxDistance)).length/A.length;
}
export function isPerceptualDuplicate(a,b,{maxDistance=10,minOverlap=.6}={}) {
  return Math.max(overlap(a,b,maxDistance),overlap(b,a,maxDistance))>=minOverlap;
}
export function extractFrameHashes(file,{fps=2,maxFrames=120,run=spawnSync}={}) {
  const r=run('ffmpeg',['-v','error','-i',file,'-vf',`fps=${fps},scale=9:8:flags=area,format=gray`,'-frames:v',String(maxFrames),'-f','rawvideo','-'],{maxBuffer:72*maxFrames+65536,timeout:120000});
  if(r.status!==0 || !r.stdout)throw new Error('Frame fingerprint extraction failed');
  const buf=r.stdout;
  if(buf.length<72*3 || buf.length%72)throw new Error('Too few frames for a perceptual fingerprint');
  const frames=[];
  for(let o=0;o<buf.length;o+=72)frames.push(dhash(buf.subarray(o,o+72)));
  return frames;
}
export async function reservePerceptual(db,{jobId,claimToken,sha256,sourceUrl,frames,maxDistance=10,minOverlap=.6}) {
  const {error}=await db.rpc('reserve_video_perceptual',{p_job_id:jobId,p_claim_token:claimToken,p_sha256:sha256,p_source_url:sourceUrl,p_frames:frames,p_max_distance:maxDistance,p_min_overlap:minOverlap});
  if(error) {
    if(/perceptual_duplicate/.test(String(error.message)))throw new Error('Visually near-duplicate clip already used by another video');
    throw new Error('Perceptual reservation failed: '+String(error.message || 'unknown').slice(0,200));
  }
  return true;
}

const UNAVAILABLE=/(Could not find the function|does not exist|schema cache|PGRST20\d)/i;
/**
 * Gate one downloaded B-roll VIDEO clip. Throws on a near-duplicate (the caller skips that candidate) or on a lost
 * claim. Modes (BVAI_PERCEPTUAL_DEDUP): auto (default) = enforce, but continue with exact-hash dedup only when the
 * phase-2 migration is not applied yet (logged); required = fail closed; off = skip. Clips with too little visual
 * information cannot be fingerprinted: skipped unless BVAI_PERCEPTUAL_LOW_INFO=allow.
 */
export async function guardVideoClip({db,claim,file,sha256,sourceUrl,env=process.env,log=()=>{},extract=extractFrameHashes,reserve=reservePerceptual}) {
  const mode=(env.BVAI_PERCEPTUAL_DEDUP||'auto').toLowerCase();
  if(mode==='off')return {status:'off'};
  try {
    const frames=extract(file);
    await reserve(db,{jobId:claim.job_id,claimToken:claim.claim_token,sha256,sourceUrl,frames});
    return {status:'reserved',frames:frames.length};
  } catch(error) {
    const message=String(error?.message||'');
    if(/insufficient_visual_information|Too few frames/.test(message)) {
      if((env.BVAI_PERCEPTUAL_LOW_INFO||'skip')==='allow'){log('[bvai_perceptual] {"status":"low_information_allowed"}');return {status:'low_information_allowed'};}
      throw new Error('perceptual_low_information: clip cannot be fingerprinted');
    }
    if(UNAVAILABLE.test(message) && mode!=='required'){log('[bvai_perceptual] {"status":"unavailable_exact_hash_only"}');return {status:'unavailable'};}
    if(/near-duplicate/.test(message))log('[bvai_perceptual] {"status":"duplicate_skipped"}');
    throw error;
  }
}
