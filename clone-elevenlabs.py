import os
from elevenlabs.client import ElevenLabs

for i in [1, 2, 3]:
    key = os.environ.get(f"TTS_ELEVENLABS_{i}")
    if not key:
        print(f"SKIP ElevenLabs #{i}: key missing in .env")
        continue
    client = ElevenLabs(api_key=key)
    with open("myvoice.mp3", "rb") as f:
        voice = client.voices.ivc.create(name="Banglar Voice - Dulal", files=[f])
    print(f"ElevenLabs #{i} Voice ID: {voice.voice_id}")
