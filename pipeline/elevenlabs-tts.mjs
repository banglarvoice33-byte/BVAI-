/**
 * ElevenLabs text-to-speech request builder for Bengali news voice-over.
 *
 * Verified against ElevenLabs documentation (2026-11-27):
 *  - POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}, header xi-api-key
 *  - language_code is NOT supported on eleven_multilingual_v2
 *  - Bengali is listed for Eleven v3 and Eleven v4 (not in the 29 Multilingual v2 languages)
 *  - Eleven v4 has Stability and Similarity only (no Style/Speed sliders, no SSML)
 *  - up to 3 pronunciation dictionary locators per request
 *  - previous_text / next_text improve continuity between scene clips
 * Anything not in that list is deliberately not sent.
 */

export const BENGALI_MODELS = ['eleven_v4', 'eleven_v3'];

export const OUTPUT_FORMATS = new Set([
  'mp3_44100_128', 'mp3_44100_64', 'mp3_44100_96', 'mp3_44100_192', 'mp3_24000_48', 'mp3_22050_32',
  'opus_48000_128', 'opus_48000_64', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'wav_48000',
]);

const BASE = 'https://api.elevenlabs.io';

/**
 * @param {{
 *   text: string, voiceId: string, modelId?: string, languageCode?: string,
 *   previousText?: string, nextText?: string,
 *   dictionaries?: Array<{ id: string, versionId?: string }>,
 *   stability?: number, similarityBoost?: number, seed?: number, outputFormat?: string
 * }} o
 */
export function buildTtsRequest(o) {
  const modelId = o.modelId ?? 'eleven_v4';
  const languageCode = o.languageCode ?? 'bn';
  if (!o.text || !o.text.trim()) throw new Error('text is empty');
  if (/[0-9০-৯]/.test(o.text)) {
    throw new Error('text still contains digits: run normalizeBanglaForSpeech() first');
  }
  if (!o.voiceId) throw new Error('voiceId is required');
  if (languageCode === 'bn' && !BENGALI_MODELS.includes(modelId)) {
    throw new Error(`model ${modelId} is not listed for Bengali; use one of ${BENGALI_MODELS.join(', ')}`);
  }
  if (modelId === 'eleven_multilingual_v2' && languageCode) {
    throw new Error('language_code is not supported on eleven_multilingual_v2');
  }
  const dictionaries = o.dictionaries ?? [];
  if (dictionaries.length > 3) throw new Error('at most 3 pronunciation dictionaries per request');
  const outputFormat = o.outputFormat ?? 'mp3_44100_128';
  if (!OUTPUT_FORMATS.has(outputFormat)) throw new Error(`unsupported output_format ${outputFormat}`);

  const body = {
    text: o.text,
    model_id: modelId,
    language_code: languageCode,
    voice_settings: {
      stability: o.stability ?? 0.5,
      similarity_boost: o.similarityBoost ?? 0.75,
    },
  };
  if (dictionaries.length) {
    body.pronunciation_dictionary_locators = dictionaries.map((d) => ({
      pronunciation_dictionary_id: d.id,
      ...(d.versionId ? { version_id: d.versionId } : {}),
    }));
  }
  if (o.previousText) body.previous_text = o.previousText;
  if (o.nextText) body.next_text = o.nextText;
  if (Number.isInteger(o.seed)) body.seed = o.seed;

  return {
    url: `${BASE}/v1/text-to-speech/${encodeURIComponent(o.voiceId)}?output_format=${outputFormat}`,
    body,
  };
}

/**
 * Sends one scene to ElevenLabs and returns the audio bytes.
 * @param {ReturnType<typeof buildTtsRequest>} request
 * @param {{ apiKey: string, fetchImpl?: typeof fetch }} ctx
 */
export async function synthesizeScene(request, ctx) {
  if (!ctx.apiKey) throw new Error('ELEVENLABS_API_KEY is missing');
  const doFetch = ctx.fetchImpl ?? fetch;
  const res = await doFetch(request.url, {
    method: 'POST',
    headers: { 'xi-api-key': ctx.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`ElevenLabs ${res.status}: ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** ffmpeg arguments that convert a 44.1 kHz TTS clip to the 48 kHz stereo used by the video spec. */
export function resampleArgs(inputPath, outputPath) {
  return ['-y', '-i', inputPath, '-ar', '48000', '-ac', '2', outputPath];
}
