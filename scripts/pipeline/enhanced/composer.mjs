/**
 * Visual ranking for symbolic B-roll.
 *
 * Rules:
 * - Rank only independent provider metadata; never treat the article title echo as proof.
 * - Curated search queries we emitted (e.g. "cricket stadium") ARE allowed as weak evidence
 *   only for thin-title stock APIs (Pexels/Pixabay) — never for Wikimedia alone.
 * - Sports dominate: wrong-sport footage is ineligible even if rain tags match.
 * - Sensitive / crime scenes get no stock faces.
 */
import { findTopics, findPrimaryTopics, financialOrSensitive, TOPIC_QUERIES } from '../visual-topics.mjs';

const words = (text) =>
  new Set(
    String(text || '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((x) => x.length > 2),
  );

const https = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
};

/** Map a curated search query back to topic ids (exact TOPIC_QUERIES or strong token). */
function topicsForQuery(query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const ids = [];
  for (const [id, phrases] of Object.entries(TOPIC_QUERIES || {})) {
    if ((phrases || []).some((p) => String(p).toLowerCase() === q)) ids.push(id);
  }
  // Sport + rain compound queries we emit beyond the static lexicon.
  if (/\bcricket\b/.test(q)) ids.push('cricket');
  if (/\bfootball\b|\bsoccer\b/.test(q)) ids.push('football');
  if (/\brain\b|\bmonsoon\b|\bwet\b/.test(q)) ids.push('rain');
  if (/\bflood/.test(q) || /waterlog/.test(q)) ids.push('flood');
  return [...new Set(ids)];
}

export function rankVisuals(scene, assets, { context = '', sensitive = false } = {}) {
  const spoken = scene.spoken_text || '';
  // Primary ranking target: sport first, rain as modifier, flood only with inundation words.
  const sceneTopics = findPrimaryTopics(spoken);
  const contextTopics = findPrimaryTopics(context);
  const target = sceneTopics.length ? sceneTopics : contextTopics;

  const sceneSports = target.filter((t) => t[4]);
  const leadSports = contextTopics.filter((t) => t[4]);
  const topics = sceneSports.length ? sceneSports : leadSports.length ? leadSports : target;
  const targetIds = new Set(topics.map((t) => t[0]));
  const tokens = words(spoken);

  return assets
    .map((asset, index) => {
      const description = [
        asset.title,
        asset.description,
        ...(Array.isArray(asset.tags) ? asset.tags : []),
      ].join(' ');
      // Metadata taxonomy on title/tags (Wikimedia-style).
      const metadata = findTopics(description);
      const rights = Boolean(
        asset.author?.trim() &&
          asset.license?.trim() &&
          https(asset.source_url) &&
          https(asset.license_url || asset.source_url),
      );
      const matched = metadata.filter((t) => targetIds.has(t[0])).map((t) => t[0]);
      const hasOtherSport = metadata.some((t) => t[4] && !targetIds.has(t[0]));

      // Curated query credit (Pexels/Pixabay often lack topical titles).
      const queryTopicIds = topicsForQuery(asset.query).filter((id) => targetIds.has(id));
      const queryAligned = queryTopicIds.length > 0;

      const lexical = [...words(description)].filter(
        (t) => tokens.has(t) && /[\u0980-\u09ff]/u.test(t),
      );

      // No stock media on sensitive stories.
      const baseOk =
        rights &&
        !sensitive &&
        !financialOrSensitive(spoken) &&
        !hasOtherSport;

      // Stock APIs often return photographer names as titles — curated query is the only topical signal.
      // Wikimedia / generic sources must corroborate via title/tags (never query echo alone).
      const stockThinTitle = /^(pexels|pixabay)$/i.test(String(asset.provider || ''));
      let score = 0;
      if (baseOk) {
        if (topics.length) {
          if (matched.length) score = 10 * matched.length + Number(asset.kind === 'video');
          else if (queryAligned && stockThinTitle) score = 6 + Number(asset.kind === 'video');
          else if (lexical.length) score = 4 * lexical.length;
        } else if (lexical.length) {
          score = 4 * lexical.length;
        }
      }

      return {
        index,
        score,
        matched: matched.length ? matched : queryTopicIds,
        rights,
        classification: 'symbolic',
        method: matched.length
          ? 'provider_metadata_taxonomy_v3'
          : queryAligned && stockThinTitle
            ? 'curated_query_alignment_v3'
            : 'lexical_bn_v3',
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

export function assignVisuals(scenes, assets, options = {}) {
  // Assign scarce scenes first so flexible scenes do not consume all eligible assets.
  const ordered = scenes
    .map((scene, index) => ({
      index,
      choices: rankVisuals(scene, assets, options).filter((r) => r.score > 0),
    }))
    .sort((a, b) => a.choices.length - b.choices.length || a.index - b.index);

  const used = new Set();
  const byScene = new Map();
  for (const row of ordered) {
    const pick = row.choices.find((c) => !used.has(c.index));
    if (pick) {
      used.add(pick.index);
      byScene.set(row.index, { asset: assets[pick.index], rank: pick });
    } else {
      byScene.set(row.index, { asset: null, rank: null });
    }
  }
  return scenes.map((_, index) => byScene.get(index));
}
