import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server-side Supabase credentials are not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(req: Request) {
  try {
    const requestUrl = new URL(req.url);
    const articleId = requestUrl.searchParams.get('article_id');
    const limit = Math.min(Math.max(Number.parseInt(requestUrl.searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const supabase = getSupabase();

    // Query only columns that exist in the production videos schema.
    // The old query referenced embed_url/youtube_id/is_live/view_count/published_at,
    // which are not columns in public.videos and caused every request to return 503.
    let videosQuery = supabase
      .from('videos')
      .select('id, article_id, title_bn, title_en, description_bn, category_key, thumbnail_url, video_url, duration_sec, duration_seconds, status, created_at')
      .in('status', ['published', 'live']);
    if (articleId) videosQuery = videosQuery.eq('article_id', articleId);

    const { data: videos, error } = await videosQuery
      .order('created_at', { ascending: false })
      .limit(articleId ? 1 : limit);
    if (error) throw error;
    const ids = (videos || []).map((video) => video.id);
    const { data: jobs, error: jobsError } = ids.length
      ? await supabase.from('video_generation_jobs').select('video_id, render_path')
          .in('video_id', ids).not('render_path', 'is', null)
          .order('updated_at', { ascending: false })
      : { data: [], error: null };
    if (jobsError) throw jobsError;
    const pathByVideo = new Map<string, string>();
    for (const job of jobs || []) if (job.video_id && job.render_path && !pathByVideo.has(job.video_id)) pathByVideo.set(job.video_id, job.render_path);

    const items = await Promise.all((videos || []).map(async (video) => {
      let playbackUrl = video.video_url || null;
      const storagePath = pathByVideo.get(video.id);
      if (storagePath) {
        const { data: signed, error: signedError } = await supabase.storage.from('reels').createSignedUrl(storagePath, 3600);
        if (signedError) throw signedError;
        playbackUrl = signed.signedUrl;
      }
      return {
        id: video.id,
        title_bn: video.title_bn,
        title_en: video.title_en || '',
        description: video.description_bn || '',
        category: video.category_key || '',
        thumbnail_url: video.thumbnail_url || null,
        video_url: playbackUrl,
        embed_url: null,
        youtube_id: null,
        duration_sec: video.duration_sec || video.duration_seconds || 0,
        is_live: video.status === 'live',
        view_count: 0,
        published_at: video.created_at,
      };
    }));

    return NextResponse.json(
      articleId ? { video: items[0] || null } : { videos: items, total: items.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return NextResponse.json({ videos: [], video: null, total: 0, error: 'videos_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
