import { cookies } from 'next/headers';
import Link from 'next/link';
import { api } from '../../lib/api';
import { LOCALE_COOKIE, getLocaleFromCookie } from '../../lib/i18n';
import { ArticleCard } from '../../components/hero-bento';
import type { FeedArticle } from '../../lib/mockData';

export const dynamic = 'force-dynamic';

const CATEGORIES = [
  ['national', 'জাতীয়'],
  ['politics', 'রাজনীতি'],
  ['economy', 'অর্থনীতি'],
  ['sports', 'খেলাধুলা'],
  ['entertainment', 'বিনোদন'],
  ['international', 'বিশ্ব'],
  ['tech', 'প্রযুক্তি'],
  ['health', 'স্বাস্থ্য'],
] as const;

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

type PageProps = {
  searchParams: Promise<{
    q?: string;
    period?: string;
    from?: string;
    to?: string;
    category?: string;
    page?: string;
  }>;
};

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = (params.q || '').trim();
  const period = params.period === 'all' ? 'all' : '30d';
  const today = startOfToday();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const from = params.from || (period === '30d' ? dateOnly(defaultFrom) : '');
  const to = params.to || (period === '30d' ? dateOnly(today) : '');
  const category = params.category || '';
  const page = Math.max(1, Number.parseInt(params.page || '1', 10) || 1);
  const cookieStore = await cookies();
  const locale = getLocaleFromCookie(cookieStore.get(LOCALE_COOKIE)?.value);

  let items: FeedArticle[] = [];
  let total = 0;
  let pageSize = 12;
  try {
    const data = await api.searchArticles(
      {
        query,
        from: from ? `${from}T00:00:00.000Z` : undefined,
        to: to ? nextDate(to) : undefined,
        category: category || undefined,
        page,
        pageSize,
      },
      locale,
    );
    items = data.items || [];
    total = data.total;
    pageSize = data.pageSize;
  } catch {
    items = [];
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const label = locale === 'en' ? 'News archive' : 'সংবাদ আর্কাইভ';
  const resultLabel = locale === 'en' ? `${total} stories found` : `${total.toLocaleString('bn-BD')}টি সংবাদ পাওয়া গেছে`;
  const buildPageUrl = (nextPage: number) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (period) next.set('period', period);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    if (category) next.set('category', category);
    next.set('page', String(nextPage));
    return `/search?${next.toString()}`;
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <div className="mb-8 rounded-3xl border border-border bg-gradient-to-br from-[#fff8f5] via-white to-[#f5f8ff] p-5 shadow-sm dark:border-white/10 dark:from-neutral-900 dark:via-neutral-950 dark:to-[#171b2a] sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#CC0000]">BANGLAR VOICE 24NEWS</p>
            <h1 className="font-serifbn text-3xl font-extrabold tracking-tight sm:text-4xl">{label}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              {locale === 'en' ? 'Find today’s stories first, or search the complete published archive.' : 'প্রথমে গত ৩০ দিনের সংবাদ দেখুন—প্রয়োজনে প্রকাশিত সব পুরোনো সংবাদও খুঁজে নিন।'}
            </p>
          </div>
          <span className="rounded-full bg-[#CC0000]/10 px-3 py-1.5 text-xs font-bold text-[#CC0000]">{resultLabel}</span>
        </div>

        <form action="/search" method="get" className="mt-6" role="search">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="q" className="sr-only">{locale === 'en' ? 'Search news' : 'সংবাদ খুঁজুন'}</label>
            <div className="relative flex-1">
              <svg aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input id="q" name="q" defaultValue={query} placeholder={locale === 'en' ? 'Search headlines, topics, sources…' : 'শিরোনাম, বিষয় বা সংবাদমাধ্যম লিখুন…'} className="w-full rounded-2xl border border-border bg-white py-3.5 pl-12 pr-4 text-sm outline-none ring-[#CC0000]/20 transition focus:ring-4 dark:border-white/15 dark:bg-neutral-900" />
            </div>
            <button type="submit" className="rounded-2xl bg-[#CC0000] px-7 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#a90000]">{locale === 'en' ? 'Search' : 'খুঁজুন'}</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold text-neutral-500">{locale === 'en' ? 'Scope:' : 'সময়কাল:'}</span>
            <Link href={`/search?${new URLSearchParams({ ...(query ? { q: query } : {}), period: '30d' })}`} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${period === '30d' ? 'bg-[#CC0000] text-white' : 'border border-border bg-white text-ink hover:border-[#CC0000] dark:border-white/15 dark:bg-neutral-900 dark:text-white'}`}>{locale === 'en' ? 'Last 30 days' : 'গত ৩০ দিন'}</Link>
            <Link href={`/search?${new URLSearchParams({ ...(query ? { q: query } : {}), period: 'all' })}`} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${period === 'all' ? 'bg-[#CC0000] text-white' : 'border border-border bg-white text-ink hover:border-[#CC0000] dark:border-white/15 dark:bg-neutral-900 dark:text-white'}`}>{locale === 'en' ? 'Full archive' : 'সম্পূর্ণ আর্কাইভ'}</Link>
            <details className="group ml-1">
              <summary className="cursor-pointer list-none rounded-full border border-border bg-white px-3 py-1.5 text-xs font-bold text-ink hover:border-[#CC0000] dark:border-white/15 dark:bg-neutral-900 dark:text-white">{locale === 'en' ? 'Custom dates' : 'তারিখ বাছাই'}</summary>
              <div className="mt-2 flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-white p-3 dark:border-white/15 dark:bg-neutral-900">
                <label className="text-xs font-semibold">{locale === 'en' ? 'From' : 'শুরু'}<input type="date" name="from" defaultValue={from} className="mt-1 block rounded-lg border border-border px-2 py-1.5 text-xs dark:border-white/15 dark:bg-neutral-950" /></label>
                <label className="text-xs font-semibold">{locale === 'en' ? 'To' : 'শেষ'}<input type="date" name="to" defaultValue={to} className="mt-1 block rounded-lg border border-border px-2 py-1.5 text-xs dark:border-white/15 dark:bg-neutral-950" /></label>
                <button type="submit" className="rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-ink">{locale === 'en' ? 'Apply' : 'প্রয়োগ'}</button>
              </div>
            </details>
            <label className="ml-auto text-xs font-semibold text-neutral-500"><span className="sr-only">{locale === 'en' ? 'Category' : 'বিভাগ'}</span><select name="category" defaultValue={category} className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-bold text-ink dark:border-white/15 dark:bg-neutral-900 dark:text-white"><option value="">{locale === 'en' ? 'All sections' : 'সব বিভাগ'}</option>{CATEGORIES.map(([value, bn]) => <option key={value} value={value}>{locale === 'en' ? value : bn}</option>)}</select><input type="hidden" name="period" value={period} /></label>
          </div>
        </form>
      </div>

      {query && <p className="mb-4 text-sm text-neutral-500">{locale === 'en' ? `Results for “${query}”` : `“${query}” এর ফলাফল`}</p>}
      {items.length === 0 ? <div className="rounded-3xl border border-dashed border-border p-12 text-center text-neutral-500 dark:border-white/15">{locale === 'en' ? 'No published stories match these filters.' : 'এই ফিল্টারে কোনো প্রকাশিত সংবাদ পাওয়া যায়নি।'}</div> : <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((a) => <ArticleCard key={a.id} locale={locale} article={{ id: a.id, slug: a.slug, title: locale === 'en' ? a.title_en || a.title_bn : a.title_bn, summary: locale === 'en' ? a.dek_en || a.dek_bn : a.dek_bn, category: a.category, image_url: a.featured_image, image_credit: a.image_credit, read_time: a.reading_time_min, published_at: a.published_at, source_name: a.source_name, source_url: a.source_url }} href={`/article/${a.slug}`} />)}</div>}

      {totalPages > 1 && <nav aria-label={locale === 'en' ? 'Archive pages' : 'আর্কাইভ পৃষ্ঠা'} className="mt-8 flex items-center justify-center gap-3"><Link aria-disabled={page <= 1} href={page <= 1 ? '#' : buildPageUrl(page - 1)} className={`rounded-full border border-border px-4 py-2 text-sm font-bold dark:border-white/15 ${page <= 1 ? 'pointer-events-none opacity-40' : 'hover:border-[#CC0000]'}`}>{locale === 'en' ? 'Previous' : 'পেছনে'}</Link><span className="text-sm font-semibold text-neutral-500">{page.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-US')} / {totalPages.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-US')}</span><Link aria-disabled={page >= totalPages} href={page >= totalPages ? '#' : buildPageUrl(page + 1)} className={`rounded-full border border-border px-4 py-2 text-sm font-bold dark:border-white/15 ${page >= totalPages ? 'pointer-events-none opacity-40' : 'hover:border-[#CC0000]'}`}>{locale === 'en' ? 'Next' : 'সামনে'}</Link></nav>}
      <p className="mt-8"><Link href="/" className="text-sm font-semibold text-primary underline">{locale === 'en' ? 'Back to home' : 'হোমে ফিরে যান'}</Link></p>
    </main>
  );
}
