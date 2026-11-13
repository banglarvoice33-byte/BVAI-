import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase admin creds missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(req: Request) {
  try {
    const { id, note } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const supabase = getAdmin();
    const { data, error } = await supabase
      .from('articles')
      .update({
        status: 'published',
        // A human editor (Admin/Studio, enforced by middleware.ts role check) approved this
        // item. These flags are what the DB guard on reporter/field-report articles and the
        // video gate (video_gate_basis = 'editorial') rely on.
        editorial_status: 'approved',
        verification_status: 'verified',
        human_verified: true,
        workflow_status: 'published',
        review_reason: null,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, status, published_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'not found or not pending' }, { status: 404 });

    // Field-report articles: publish the reporter's photo. The upload sits in the
    // private `field-media` bucket; copy it to the public `thumbnails` bucket.
    // A media problem must never block the approval itself.
    let featuredImage: string | null = null;
    try {
      const { data: art } = await supabase
        .from('articles')
        .select('field_report_id, featured_image')
        .eq('id', id)
        .maybeSingle();
      if (art?.field_report_id && !art.featured_image) {
        const { data: rep } = await supabase
          .from('field_reports')
          .select('media_urls')
          .eq('id', art.field_report_id)
          .maybeSingle();
        const src = ((rep?.media_urls as string[] | null) ?? []).find((p) =>
          /\.(jpe?g|png|webp)$/i.test(p),
        );
        if (src) {
          const dl = await supabase.storage.from('field-media').download(src);
          if (dl.data) {
            const ext = (src.split('.').pop() || 'jpg').toLowerCase();
            const dest = `field-reports/${art.field_report_id}.${ext}`;
            const contentType =
              ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            const up = await supabase.storage
              .from('thumbnails')
              .upload(dest, dl.data, { contentType, upsert: true });
            if (!up.error) {
              const pub = supabase.storage.from('thumbnails').getPublicUrl(dest).data.publicUrl;
              await supabase
                .from('articles')
                .update({ featured_image: pub, thumbnail_url: pub, media_type: 'image' })
                .eq('id', id);
              featuredImage = pub;
            }
          }
        }
      }
    } catch (mediaErr) {
      console.error('[approve] field-report media copy failed', mediaErr);
    }

    return NextResponse.json(
      { ok: true, id: data.id, status: data.status, published_at: data.published_at, note: note || '', featured_image: featuredImage },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 500 },
    );
  }
}
