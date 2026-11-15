type VideoIdentity = { id?: string; youtube_id?: string; embed_url?: string; video_url?: string; title_bn?: string; title_en?: string };

/** Identify the asset, never the rotating signed URL query or an object snapshot. */
export function videoIdentity(video: VideoIdentity): string {
  if (video.id) return `id:${video.id}`;
  if (video.youtube_id) return `youtube:${video.youtube_id}`;
  if (video.embed_url) return `embed:${video.embed_url}`;
  if (video.video_url) return `file:${video.video_url.split('?')[0]}`;
  return `title:${video.title_bn || video.title_en || ''}`;
}

export function selectedVideo<T extends VideoIdentity>(videos: T[], identity: string | null): T | undefined {
  return identity ? videos.find((video) => videoIdentity(video) === identity) : undefined;
}
