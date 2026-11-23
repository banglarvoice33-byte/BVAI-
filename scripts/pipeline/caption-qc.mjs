// Grapheme-safe, safe-zone-aware verification of the generated ASS captions (pure; no ffmpeg/fonts needed).
const seg=typeof Intl!=='undefined' && Intl.Segmenter?new Intl.Segmenter('bn',{granularity:'grapheme'}):null;
export const graphemes=s=>seg?[...seg.segment(String(s))].map(x=>x.segment):[...String(s)];
// Meta Reels safe-zone guidance used in the brief: 14% top, 35% bottom, 6% sides left free of important text.
export const SAFE={top:.14,bottom:.35,side:.06};
export function parseAss(text) {
  const info={PlayResX:1080,PlayResY:1920},styles={},events=[];
  let section='',styleFormat=[],eventFormat=[];
  for(const raw of String(text).split(/\r?\n/)) {
    const line=raw.trim();
    const sec=line.match(/^\[(.+)\]$/);if(sec){section=sec[1];continue;}
    if(section==='Script Info'){const m=line.match(/^(\w+):\s*(.+)$/);if(m && /^\d+$/.test(m[2]))info[m[1]]=Number(m[2]);}
    else if(section==='V4+ Styles') {
      if(line.startsWith('Format:'))styleFormat=line.slice(7).split(',').map(x=>x.trim());
      else if(line.startsWith('Style:')){const v=line.slice(6).split(',').map(x=>x.trim());styles[v[0]]=Object.fromEntries(styleFormat.map((k,i)=>[k,v[i]]));}
    } else if(section==='Events') {
      if(line.startsWith('Format:'))eventFormat=line.slice(7).split(',').map(x=>x.trim());
      else if(line.startsWith('Dialogue:')) {
        const parts=line.slice(9).trim().split(','),n=eventFormat.length||10;
        const fields=parts.slice(0,n-1);fields.push(parts.slice(n-1).join(','));
        events.push(Object.fromEntries(eventFormat.map((k,i)=>[k,fields[i]])));
      }
    }
  }
  return {info,styles,events};
}
export const visibleText=t=>String(t).replace(/\{[^}]*\}/g,'').replace(/\\h/g,' ').replace(/\\N/g,'\n');
export function checkSafeBox({x,y,w,h},W=1080,H=1920) {
  const problems=[];
  if(y<H*SAFE.top)problems.push('inside top 14% UI zone');
  if(y+h>H*(1-SAFE.bottom))problems.push('inside bottom 35% UI zone');
  if(x<W*SAFE.side || x+w>W*(1-SAFE.side))problems.push('inside 6% side margin');
  return problems;
}
export function checkCaptions(assText,{maxLineGraphemes=30}={}) {
  const {info,styles,events}=parseAss(assText),problems=[];
  if(!events.length)problems.push('no caption events');
  const W=info.PlayResX,H=info.PlayResY;
  for(const [name,st] of Object.entries(styles)) {
    const align=Number(st.Alignment),mv=Number(st.MarginV),ml=Number(st.MarginL),mr=Number(st.MarginR),fs=Number(st.Fontsize);
    if([align,mv,ml,mr,fs].some(v=>!Number.isFinite(v))){problems.push(`style ${name}: unreadable geometry`);continue;}
    if(align<=3 && H-mv>H*(1-SAFE.bottom))problems.push(`style ${name}: caption baseline ${H-mv}px is inside the bottom 35% UI zone`);
    if(align>=7 && mv<H*SAFE.top)problems.push(`style ${name}: caption starts inside the top 14% UI zone`);
    if(ml<W*SAFE.side || mr<W*SAFE.side)problems.push(`style ${name}: side margin below 6%`);
  }
  events.forEach((e,i)=>{
    const t=visibleText(e.Text);
    if(t!==t.normalize('NFC'))problems.push(`event ${i}: text is not NFC-normalised`);
    if(/�/.test(t))problems.push(`event ${i}: replacement character`);
    for(const tok of t.split(/\s+/).filter(Boolean)) {
      if(/^[\p{M}‌‍]/u.test(tok))problems.push(`event ${i}: token starts with a combining mark/joiner (split grapheme): ${tok}`);
      if(/্$/.test(tok))problems.push(`event ${i}: token ends with a dangling hasanta (split conjunct): ${tok}`);
    }
    for(const part of t.split('\n'))if(graphemes(part).length>maxLineGraphemes)problems.push(`event ${i}: line longer than ${maxLineGraphemes} graphemes`);
  });
  return problems;
}
export function assertCaptionSafe(assText,opts) {
  const problems=checkCaptions(assText,opts);
  if(problems.length)throw new Error('Caption QC failed: '+problems.slice(0,5).join('; ')+(problems.length>5?` (+${problems.length-5} more)`:''));
}

/** BVAI_CAPTION_QC: shadow (default) logs problems and records the count; enforce throws; off skips. */
export function captionGuard(assText,{env=process.env,log=()=>{}}={}) {
  const mode=(env.BVAI_CAPTION_QC||'shadow').toLowerCase();
  if(mode==='off')return {mode,problems:0};
  let problems;
  try{problems=checkCaptions(assText);}
  catch(e){if(mode==='enforce')throw e;log('[bvai_caption_qc] {"status":"checker_error"}');return {mode,problems:-1};}
  log('[bvai_caption_qc] '+JSON.stringify({mode,problems:problems.length,sample:problems.slice(0,3)}));
  if(problems.length && mode==='enforce')throw new Error('Caption QC failed: '+problems.slice(0,5).join('; '));
  return {mode,problems:problems.length};
}
