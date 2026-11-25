import { cookies } from 'next/headers';
import EPaperViewer from '../../components/epaper/EPaperViewer';
import PdfArchiveViewer from '../../components/epaper/PdfArchiveViewer';
import { createPublicSupabase, fetchPublishedArticlesFeed } from '../../lib/supabase/published-articles';
import { getLocaleFromCookie, LOCALE_COOKIE } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

export default async function EpaperPage() {
  const cookieStore = await cookies();
  const locale = getLocaleFromCookie(cookieStore.get(LOCALE_COOKIE)?.value);
  const isEnglish = locale === 'en';
  const copy = isEnglish
    ? { empty: 'No published stories are available yet.', section: 'Front page', live: 'LIVE', archive: 'Latest archive' }
    : { empty: 'কোনো প্রকাশিত সংবাদ নেই', section: 'প্রথম পাতা', live: 'লাইভ', archive: 'সর্বশেষ আর্কাইভ' };

  let rows: any[] = [];
  try {
    rows = await fetchPublishedArticlesFeed(createPublicSupabase(), 20);
  } catch (error) {
    console.error('[epaper] failed to load published articles:', error instanceof Error ? error.message : error);
  }

  let archive: { url: string; label: string } | null = null;
  try {
    const { data } = await createPublicSupabase()
      .from('epaper_editions')
      .select('title, archive_path')
      .not('archive_path', 'is', null)
      .order('edition_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    if (data?.archive_path && base) {
      archive = {
        url: `${base}/storage/v1/object/public/epaper-archives/${data.archive_path}`,
        label: `${copy.archive} — ${data.title}`,
      };
    }
  } catch {
    archive = null;
  }

  if (!rows.length) {
    return <div className="bg-[#f4f1ea] p-10 text-center">{copy.empty}</div>;
  }

  const now = new Date();
  const editionLabel = now.toLocaleDateString(isEnglish ? 'en-GB' : 'bn-BD', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: 'long', day: 'numeric',
  });
  const titleFor = (article: any) => isEnglish ? (article.title_en || article.title_bn || '') : (article.title_bn || article.title_en || '');
  const bodyFor = (article: any, length: number) => (isEnglish
    ? (article.content_en || article.excerpt_bn || '')
    : (article.content_bn || article.excerpt_bn || '')).slice(0, length);

  const edition = {
    locale,
    editionDate: now.toISOString().split('T')[0],
    editionLabel,
    volume: '1',
    issue: 1,
    pages: [{
      number: 1,
      section: copy.section,
      layout: 'front',
      lead: { id: rows[0].id, headline: titleFor(rows[0]), body: bodyFor(rows[0], 600) },
      articles: rows.slice(1, 6).map((article: any) => ({ id: article.id, headline: titleFor(article), body: bodyFor(article, 400) })),
      briefs: rows.slice(6, 12).map(titleFor),
    }],
  };

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#1a1a1a]">
      <div className="mx-auto max-w-5xl px-4 pt-3">
        <div className="h-[3px] bg-gradient-to-r from-[#C41E1E] via-[#1a1a1a] to-[#C41E1E]" />
        <div className="flex items-center justify-between py-2 text-[10px] font-mono uppercase tracking-wide">
          <span className="font-semibold">{isEnglish ? 'Dhaka' : 'ঢাকা'} · {editionLabel}</span>
          <span className="rounded-full bg-[#C41E1E] px-2 py-0.5 font-bold text-white">{copy.live} · {rows.length}</span>
          <span className="text-neutral-600">bvai-chi.vercel.app</span>
        </div>
      </div>
      <EPaperViewer edition={edition} />
      {archive ? <PdfArchiveViewer url={archive.url} label={archive.label} /> : null}
    </div>
  );
}
