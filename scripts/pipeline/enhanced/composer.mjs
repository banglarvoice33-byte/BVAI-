// Rank only independent provider metadata. Echoing the search query is not corroboration.
import { findTopics, financialOrSensitive } from '../visual-topics.mjs';
const words = text => new Set(String(text || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').split(/\s+/).filter(x => x.length > 2));
const https = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
export function rankVisuals(scene, assets, { context = '', sensitive = false } = {}) {
  const spoken = scene.spoken_text || '';
  const sceneTopics = findTopics(spoken);
  const target = sceneTopics.length ? sceneTopics : findTopics(context);
  // Sports dominates a sports scene; an incidental weather tag cannot admit footage of the wrong sport.
  const sceneSports = target.filter(t => t[4]);
  const leadSports = findTopics(context).filter(t => t[4]);
  const topics = sceneSports.length ? sceneSports : leadSports.length ? leadSports : target;
  const targetIds = new Set(topics.map(t => t[0]));
  const tokens = words(spoken);
  return assets.map((asset, index) => {
    const description = [asset.title, asset.description, ...(Array.isArray(asset.tags) ? asset.tags : [])].join(' ');
    const metadata = findTopics(description);
    const rights = Boolean(asset.author?.trim() && asset.license?.trim() && https(asset.source_url) && https(asset.license_url));
    const matched = metadata.filter(t => targetIds.has(t[0])).map(t => t[0]);
    const hasOtherSport = metadata.some(t => t[4] && !targetIds.has(t[0]));
    const lexical = [...words(description)].filter(t => tokens.has(t) && /[\u0980-\u09ff]/u.test(t));
    // No stock media on sensitive stories: even a labelled unrelated person can imply culpability.
    const eligible = rights && !sensitive && !financialOrSensitive(spoken) && !hasOtherSport && (topics.length ? matched.length : lexical.length);
    return { index, score: eligible ? 10 * (matched.length || lexical.length) + Number(asset.kind === 'video') : 0, matched, rights, classification: 'symbolic', method: 'provider_metadata_taxonomy_v2' };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
}
export function assignVisuals(scenes, assets, options = {}) {
  // Assign scarce scenes first so flexible scenes do not consume all eligible assets.
  const ordered = scenes.map((scene, index) => ({ index, choices: rankVisuals(scene, assets, options).filter(r => r.score > 0) }))
    .sort((a, b) => a.choices.length - b.choices.length || a.index - b.index);
  const used = new Set();
  const result = [];
  for (const { index, choices } of ordered) {
    const best = choices.find(r => !used.has(r.index));
    if (best) { used.add(best.index); result[index] = { asset: assets[best.index], selection: best }; }
    else result[index] = { asset: null, selection: { method: 'owned_graphic_fallback', reason: 'no_unused_rights_complete_metadata_match', classification: 'symbolic' } };
  }
  return result;
}
