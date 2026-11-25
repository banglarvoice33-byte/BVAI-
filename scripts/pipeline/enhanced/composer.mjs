/**
 * Visual ranking for symbolic B-roll (v4).
 *
 * Rules:
 * - Never treat the article title echo as proof.
 * - Curated search queries are weak evidence only for thin-title stock APIs
 *   (Pexels/Pixabay) — and only when tags do not contradict the target sport.
 * - Wrong-sport tags (baseball when target is cricket, etc.) are hard rejects.
 * - Off-topic tags (music stand, instrument) with no sport corroboration are rejects.
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

/** Map a curated search query back to topic ids. */
function topicsForQuery(query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const ids = [];
  for (const [id, phrases] of Object.entries(TOPIC_QUERIES || {})) {
    if ((phrases || []).some((p) => String(p).toLowerCase() === q)) ids.push(id);
  }
  if (/\bcricket\b/.test(q)) ids.push('cricket');
  if (/\bfootball\b|\bsoccer\b/.test(q)) ids.push('football');
  if (/\brain\b|\bmonsoon\b|\bwet\b/.test(q)) ids.push('rain');
  if (/\bflood/.test(q) || /waterlog/.test(q)) ids.push('flood');
  return [...new Set(ids)];
}

/**
 * Competing sport tokens that must not appear when a different sport is the target.
 * Keys are target topic ids; values are forbidden token patterns (case-insensitive).
 */
const SPORT_NEGATIVES = {
  cricket: [
    /\bbaseball\b/,
    /\bsoftball\b/,
    /\bfootball\b/,
    /\bsoccer\b/,
    /\bbasketball\b/,
    /\bhockey\b/,
    /\brugby\b/,
    /\btennis\b/,
    /\bgolf\b/,
    /\bvolleyball\b/,
    /\bamerican football\b/,
  ],
  football: [
    /\bcricket\b/,
    /\bbaseball\b/,
    /\bsoftball\b/,
    /\bbasketball\b/,
    /\bhockey\b/,
    /\brugby\b/,
    /\btennis\b/,
    /\bgolf\b/,
  ],
};

/** Tags that prove the clip is not sports B-roll at all. */
const OFFTOPIC_NEGATIVES = [
  /\bmusic stand\b/,
  /\binstrument\b/,
  /\bmusical\b/,
  /\bpiano\b/,
  /\bviolin\b/,
  /\borchestra\b/,
  /\bcooking\b/,
  /\brecipe\b/,
  /\bkitchen\b/,
  /\bwedding\b/,
  /\bfuneral\b/,
  /\breal estate\b/,
  /\bfashion show\b/,
];

/** Positive corroboration tokens per sport (for stock thin-title boost). */
const SPORT_POSITIVES = {
  cricket: [/\bcricket\b/, /\bwicket\b/, /\bbatsman\b/, /\bbowler\b/, /\bpitch\b/, /\bstumps\b/],
  football: [/\bfootball\b/, /\bsoccer\b/, /\bgoalkeeper\b/, /\bstadium\b/],
};

function hasWrongSport(text, targetIds) {
  const t = String(text || '').toLowerCase();
  for (const id of targetIds) {
    for (const re of SPORT_NEGATIVES[id] || []) {
      if (re.test(t)) return true;
    }
  }
  return false;
}

function hasOfftopic(text) {
  const t = String(text || '').toLowerCase();
  return OFFTOPIC_NEGATIVES.some((re) => re.test(t));
}

function hasPositiveSport(text, targetIds) {
  const t = String(text || '').toLowerCase();
  for (const id of targetIds) {
    for (const re of SPORT_POSITIVES[id] || []) {
      if (re.test(t)) return true;
    }
  }
  return false;
}

export function rankVisuals(scene, assets, { context = '', sensitive = false } = {}) {
  const spoken = scene.spoken_text || '';
  const sceneTopics = findPrimaryTopics(spoken);
  const contextTopics = findPrimaryTopics(context);
  const target = sceneTopics.length ? sceneTopics : contextTopics;

  const sceneSports = target.filter((t) => t[4]);
  const leadSports = contextTopics.filter((t) => t[4]);
  const topics = sceneSports.length ? sceneSports : leadSports.length ? leadSports : target;
  const targetIds = new Set(topics.map((t) => t[0]));
  const sportTargetIds = [...targetIds].filter((id) => SPORT_NEGATIVES[id] || SPORT_POSITIVES[id]);
  const tokens = words(spoken);

  return assets
    .map((asset, index) => {
      const description = [
        asset.title,
        asset.description,
        ...(Array.isArray(asset.tags) ? asset.tags : []),
      ].join(' ');
      const metadata = findTopics(description);
      const rights = Boolean(
        asset.author?.trim() &&
          asset.license?.trim() &&
          https(asset.source_url) &&
          https(asset.license_url || asset.source_url),
      );
      const matched = metadata.filter((t) => targetIds.has(t[0])).map((t) => t[0]);
      const hasOtherSportMeta = metadata.some((t) => t[4] && !targetIds.has(t[0]));

      const queryTopicIds = topicsForQuery(asset.query).filter((id) => targetIds.has(id));
      const queryAligned = queryTopicIds.length > 0;

      const lexical = [...words(description)].filter(
        (t) => tokens.has(t) && /[\u0980-\u09ff]/u.test(t),
      );

      const stockThinTitle = /^(pexels|pixabay)$/i.test(String(asset.provider || ''));
      const descWrongSport = sportTargetIds.length > 0 && hasWrongSport(description, sportTargetIds);
      const descOfftopic = hasOfftopic(description);
      const descPositive = sportTargetIds.length === 0 || hasPositiveSport(description, sportTargetIds);

      // Hard rejects before scoring.
      if (!rights) {
        return { index, score: 0, matched: [], rights: false, classification: 'symbolic', method: 'no_rights' };
      }
      if (sensitive || financialOrSensitive(spoken)) {
        return { index, score: 0, matched: [], rights, classification: 'symbolic', method: 'sensitive_block' };
      }
      if (hasOtherSportMeta || descWrongSport) {
        return {
          index,
          score: 0,
          matched: [],
          rights,
          classification: 'symbolic',
          method: 'wrong_sport_reject',
        };
      }
      if (descOfftopic && !descPositive) {
        return {
          index,
          score: 0,
          matched: [],
          rights,
          classification: 'symbolic',
          method: 'offtopic_reject',
        };
      }

      let score = 0;
      let method = 'none';

      if (topics.length) {
        if (matched.length) {
          // Taxonomy match on title/tags (best).
          score = 10 * matched.length + Number(asset.kind === 'video');
          method = 'provider_metadata_taxonomy_v4';
        } else if (queryAligned && stockThinTitle && descPositive) {
          // Stock API: curated query + positive sport token in tags/title.
          score = 8 + Number(asset.kind === 'video');
          method = 'curated_query_positive_v4';
        } else if (queryAligned && stockThinTitle && !sportTargetIds.length) {
          // Non-sport story: query alignment alone is acceptable for stock.
          score = 6 + Number(asset.kind === 'video');
          method = 'curated_query_alignment_v4';
        } else if (lexical.length) {
          score = 4 * lexical.length;
          method = 'lexical_bn_v4';
        }
        // queryAligned + stock + sport target + NO positive token → score 0 (reject weak stadium noise)
      } else if (lexical.length) {
        score = 4 * lexical.length;
        method = 'lexical_bn_v4';
      }

      return {
        index,
        score,
        matched: matched.length ? matched : queryTopicIds,
        rights,
        classification: 'symbolic',
        method,
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

export function assignVisuals(scenes, assets, options = {}) {
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
      byScene.set(row.index, { asset: assets[pick.index], rank: pick, selection: pick });
    } else {
      byScene.set(row.index, { asset: null, rank: null, selection: null });
    }
  }
  return scenes.map((_, index) => byScene.get(index));
}
