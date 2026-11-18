// Explainable metadata ranking, not a claim of computer-vision/event verification.
import {topicQueries} from '../media-sources.mjs';
const words = text => new Set(String(text || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu,' ').split(/\s+/).filter(x=>x.length>2));
export function rankVisuals(scene, assets, {context=''}={}) {
  const target=words(scene.spoken_text+' '+topicQueries(scene.spoken_text).join(' ')+' '+context+' '+topicQueries(context).join(' '));
  return assets.map((asset,index)=>{
    const tokens=words([asset.title,asset.query,...(asset.tags || [])].join(' '));
    const matched=[...tokens].filter(t=>target.has(t));
    const rights=!!(asset.author && asset.license && /^https:\/\//.test(asset.source_url || '') && /^https:\/\//.test(asset.license_url || ''));
    return {index,score:rights?matched.length:0,matched,rights,classification:'symbolic',method:'metadata_token_overlap_v1'};
  }).sort((a,b)=>b.score-a.score||a.index-b.index);
}
export function assignVisuals(scenes, assets, {context=''}={}) {
  const used=new Set();
  return scenes.map(scene=>{
    const ranking=rankVisuals(scene,assets,{context});
    const best=ranking.find(r=>r.rights && r.score>0 && !used.has(r.index));
    if(best){used.add(best.index);return {asset:assets[best.index],selection:best};}
    // Own branded graphics are safer than unrelated or falsely illustrative footage.
    return {asset:null,selection:{method:'owned_graphic_fallback',reason:'no_unused_rights_complete_metadata_match',classification:'symbolic'}};
  });
}
