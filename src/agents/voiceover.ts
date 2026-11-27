import { supabase } from '../db/supabase.ts';
import { normalizeForTts } from '../../scripts/voiceover/bn-num-to-words.ts';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const VOICE_ID = process.env.ELEVENLABS_BN_NEWS_VOICE_ID!;

// বাকেটের নাম কনফিগারযোগ্য, ডিফল্ট field-media
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'field-media';

export interface VoiceoverScene {
  scene_id: string;
  spoken_text_bn: string;
  duration_target_seconds: number;
}

export interface VoiceoverResult {
  scene_id: string;
  audio_path: string;
  duration_seconds: number;
  normalized_text: string;
}

/**
 * বাংলা TTS অডিও তৈরি করে।
 * গুরুত্বপূর্ণ: eleven_v4 মডেল এবং language_code='bn' ব্যবহার করতে হবে।
 */
export async function generateSceneVoiceover(
  scene: VoiceoverScene,
  previousText?: string,
  nextText?: string
): Promise<VoiceoverResult> {
  const safeText = normalizeForTts(scene.spoken_text_bn);
  if (!safeText) throw new Error(`Empty text for scene ${scene.scene_id}`);

  const payload: Record<string, unknown> = {
    text: safeText,
    model_id: 'eleven_v4',
    language_code: 'bn',
    voice_settings: {
      stability: 0.62,
      similarity_boost: 0.78,
      style: 0.05,
      speed: 1.0,
      use_speaker_boost: true,
    },
  };

  if (previousText) payload.previous_text = normalizeForTts(previousText);
  if (nextText) payload.next_text = normalizeForTts(nextText);
  if (process.env.ELEVENLABS_BN_PRONUNCIATION_DICT_ID) {
    payload.pronunciation_dictionary_locators = [
      { pronunciation_dictionary_id: process.env.ELEVENLABS_BN_PRONUNCIATION_DICT_ID },
    ];
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${err}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const storagePath = `voiceover/${scene.scene_id}_${Date.now()}.mp3`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, audioBuffer, {
      contentType: 'audio/mpeg',
      upsert: false,
    });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  return {
    scene_id: scene.scene_id,
    audio_path: storagePath,
    duration_seconds: Math.round((audioBuffer.byteLength / 16000) * 10) / 10,
    normalized_text: safeText,
  };
}
