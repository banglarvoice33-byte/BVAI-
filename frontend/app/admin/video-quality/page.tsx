import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/server/require-admin';
import { VideoQualityForm } from '@/components/admin/video-quality-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ভিডিওর চূড়ান্ত মান যাচাই' };

export default async function VideoQualityPage() {
  const actor = await requireAdmin();
  if (!actor) redirect('/login?next=/admin/video-quality');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return <div className="p-8">ভিডিও রিভিউ সার্ভার কনফিগার করা নেই।</div>;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: jobs, error } = await db.from('video_generation_jobs').select('id,render_path,created_at').eq('status', 'needs_review').order('created_at', { ascending: true }).limit(10);
  if (error) return <div className="p-8">ভিডিও রিভিউ কিউ পাওয়া যাচ্ছে না। ডেটাবেস মাইগ্রেশন ও সংযোগ পরীক্ষা করুন।</div>;
  const cards = await Promise.all((jobs || []).map(async job => {
    const { data: asset } = await db.from('video_delivery_assets').select('sha256,manifest').eq('job_id', job.id).maybeSingle();
    if (!asset?.manifest?.spoken_script_hash) return { job, asset: null, signed: null };
    const { data: signed } = await db.storage.from('reels').createSignedUrl(job.render_path, 900);
    return { job, asset, signed };
  }));
  return <div className="mx-auto max-w-4xl px-4 py-8">
    <h1 className="font-serifbn text-3xl font-bold">ভিডিওর চূড়ান্ত মান যাচাই</h1>
    <p className="mt-3 text-sm">বিশ্বস্ত আন্তর্জাতিক উৎসের সংবাদ কারিগরি পরীক্ষা শেষে স্বয়ংক্রিয় পথে যেতে পারে; পুনরায় তিন উৎসের যাচাই আবশ্যক নয়। রিপোর্টার অ্যাপের সংবাদ, ছবি ও ভিডিওর জন্য এটি বাধ্যতামূলক মানব সম্পাদকের অনুমোদন। অনুমোদন ভিডিও ও বলা স্ক্রিপ্টের হ্যাশের সঙ্গে বাঁধা থাকে। একটি শব্দ বা ভিডিও বদলালে নতুন রিভিউ লাগবে। অনুমোদন মানেই প্রকাশ নয়।</p>
    {!cards.length && <p className="mt-8">পর্যালোচনাযোগ্য ভিডিও নেই।</p>}
    {cards.map(({ job, asset, signed }) => <article key={job.id} className="my-8 rounded-xl border border-border p-5">
      <h2 className="font-serifbn text-xl font-bold">{asset?.manifest?.production_plan?.display_script?.split('।')[0] || 'পূর্ববর্তী সংস্করণের ভিডিও'}</h2>
      <p className="my-2 break-all font-mono text-xs">Job: {job.id}</p>
      {!asset || !signed ? <p>নতুন স্ক্রিপ্ট-বাইন্ডিং বা ব্যক্তিগত ভিডিও অনুপস্থিত। পুনরায় রেন্ডার/আপলোড প্রয়োজন; পুরোনো ভিডিওর জন্য অনুমোদন বানানো যাবে না।</p> : <>
        <video controls preload="metadata" playsInline className="mx-auto max-h-[600px] w-full bg-black"><source src={signed.signedUrl} type="video/mp4" /></video>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-8">{asset.manifest.production_plan?.spoken_script}</p>
        <details className="mt-3"><summary className="cursor-pointer font-bold">দৃশ্য পরিকল্পনা ও উৎস দেখুন</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ plan: asset.manifest.production_plan, media: asset.manifest.media }, null, 2)}</pre></details>
        <VideoQualityForm jobId={job.id} videoHash={asset.sha256} scriptHash={asset.manifest.spoken_script_hash} durationSec={asset.manifest.render_duration} />
      </>}
    </article>)}
  </div>;
}
