import test from 'node:test';
import assert from 'node:assert/strict';
import { rational, validateMasterProbe } from '../video-contract.mjs';
import { loudnessOk } from '../audio-qc.mjs';

const fixture = () => ({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', avg_frame_rate: '30/1', sample_aspect_ratio: '1:1', color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709' },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
  ], format: { duration: '42.0' },
});

test('delivery metadata accepts the exact SDR master contract', () => {
  assert.equal(validateMasterProbe(fixture(), 40.5).duration, 42);
});
for (const [name, field, value, diagnostic] of [
  ['full range JPEG YUV', 'pix_fmt', 'yuvj420p', /yuvj420p/],
  ['wrong dimensions', 'width', 1920, /1920×1920/],
  ['missing video codec', 'codec_name', undefined, /missing/],
  ['Termux fractional SAR', 'sample_aspect_ratio', '768000:768053', /square pixels/],
  ['unspecified SAR', 'sample_aspect_ratio', undefined, /square pixels/],
  ['NaN frame rate', 'avg_frame_rate', '0/0', /30 fps/],
  ['infinite frame rate', 'avg_frame_rate', '30/0', /30 fps/],
  ['malformed frame rate', 'avg_frame_rate', 'x/1', /30 fps/],
  ['wrong frame rate', 'avg_frame_rate', '25/1', /30 fps/],
  ['full range signaling', 'color_range', 'pc', /limited color/],
  ['unknown range', 'color_range', undefined, /limited color/],
  ['unknown matrix', 'color_space', undefined, /BT.709/],
]) {
  test(`delivery metadata rejects ${name} with actionable diagnostics`, () => {
    const probe = fixture(); probe.streams[0][field] = value;
    assert.throws(() => validateMasterProbe(probe, 40.5), diagnostic);
  });
}
test('delivery metadata rejects missing/extra streams, mono and wrong sample rate', () => {
  const missing = fixture(); missing.streams.pop();
  assert.throws(() => validateMasterProbe(missing, 40.5), /one video and one audio/);
  const extra = fixture(); extra.streams.push({ ...extra.streams[0] });
  assert.throws(() => validateMasterProbe(extra, 40.5), /one video and one audio/);
  for (const update of [{ sample_rate: '44100' }, { channels: 1 }, { codec_name: 'mp3' }]) {
    const probe = fixture(); Object.assign(probe.streams[1], update);
    assert.throws(() => validateMasterProbe(probe, 40.5), /audio/);
  }
});
test('delivery metadata rejects invalid durations and truncated narration', () => {
  for (const duration of ['NaN', 'Infinity', '0', '39.99', '120.01']) {
    const probe = fixture(); probe.format.duration = duration;
    assert.throws(() => validateMasterProbe(probe, 40.5), /duration/);
  }
  for (const duration of [0, -1, NaN, Infinity, '40.5', 43]) {
    assert.throws(() => validateMasterProbe(fixture(), duration), /narration/);
  }
  assert.throws(() => validateMasterProbe(null, 40.5), /Invalid delivery master/);
});
test('rational parser rejects malformed and nonfinite values', () => {
  for (const rate of ['0/0', '30/0', '1', 'NaN/1', '-30/1', '/1', '30/', null, undefined]) assert.ok(Number.isNaN(rational(rate)));
  assert.equal(rational('30000/1000'), 30);
  assert.equal(rational('1:1', ':'), 1);
});
test('loudness gate fails closed on silence/nonfinite/missing readings', () => {
  assert.ok(loudnessOk({ input_i: '-14', input_tp: '-1.5' }));
  for (const value of [null, {}, { input_i: -14 }, { input_i: -14, input_tp: '-inf' }, { input_i: '-inf', input_tp: -2 }, { input_i: -14, input_tp: 0 }]) assert.equal(loudnessOk(value), false);
});
