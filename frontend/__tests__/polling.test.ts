import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPolling } from '../lib/polling';
import { selectedVideo, videoIdentity } from '../lib/video-identity';

afterEach(() => { vi.useRealTimers(); });

describe('serialized polling', () => {
  it('waits for completion before scheduling another request', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const stop = startPolling(task, 1000, 10000);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
    complete(); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    stop(); complete();
  });
  it('aborts in-flight work on cleanup and never schedules a replacement', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal; let complete!: () => void;
    const task = vi.fn((value: AbortSignal) => { signal = value; return new Promise<void>((resolve) => { complete = resolve; }); });
    const stop = startPolling(task, 1000);
    stop(); expect(signal.aborted).toBe(true);
    complete(); await vi.advanceTimersByTimeAsync(20000);
    expect(task).toHaveBeenCalledTimes(1);
  });
  it('times out a fetch and recovers on the next poll', async () => {
    vi.useFakeTimers();
    const task = vi.fn((signal: AbortSignal) => new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
    }));
    const stop = startPolling(task, 1000, 100);
    await vi.advanceTimersByTimeAsync(1100);
    expect(task).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(0);
  });
  it('recovers from transient request rejection without blanking content', async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => { throw new Error('network'); });
    const stop = startPolling(task, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2); stop();
  });
  it('rejects invalid configuration', () => {
    expect(() => startPolling(async () => {}, 0)).toThrow();
    expect(() => startPolling(async () => {}, 1, NaN)).toThrow();
  });
});

describe('video identity survives signed URL renewal', () => {
  it('resolves selection to the latest record rather than the stale object', () => {
    const old = { id: 'v1', video_url: 'https://storage.example/video.mp4?token=old' };
    const fresh = { ...old, video_url: 'https://storage.example/video.mp4?token=new' };
    expect(selectedVideo([fresh], videoIdentity(old))).toBe(fresh);
    expect(selectedVideo([], videoIdentity(old))).toBeUndefined();
  });
  it('ignores rotating signature queries in the fallback asset identity', () => {
    expect(videoIdentity({ video_url: 'https://example.test/a.mp4?token=old' })).toBe(videoIdentity({ video_url: 'https://example.test/a.mp4?token=new' }));
    expect(videoIdentity({ youtube_id: 'abc' })).not.toBe(videoIdentity({ id: 'abc' }));
  });
});
