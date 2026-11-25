'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { t, translateCategory, type Locale } from '@/lib/i18n';

export type Article = {
  id?: string;
  slug?: string;
  title: string;
  summary?: string;
  category?: string;
  image_url?: string;
  image_credit?: string;
  read_time?: number;
  published_at?: string;
  author?: string;
  source_name?: string;
  source_url?: string;
  image_is_representational?: boolean;
  origin?: 'aggregated' | 'original';
};

const fmtNum = (s: string | number, locale: Locale): string =>
  locale === 'bn'
    ? String(s).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[+d])
    : String(s);

function timeAgo(iso: string | undefined, locale: Locale): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${fmtNum(mins, locale)} ${t(locale, 'time_ago_minutes')}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${fmtNum(hrs, locale)} ${t(locale, 'time_ago_hours')}`;
  return `${fmtNum(Math.round(hrs / 24), locale)} ${t(locale, 'time_ago_days')}`;
}

function ClientTimeAgo({ iso, locale, className }: { iso?: string; locale: Locale; className?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(1);
    const id = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  if (tick === 0) return <span className={className} aria-hidden>···</span>;
  return <span className={className}>{timeAgo(iso, locale)}</span>;
}

/** Refined placeholder gradients — warm editorial tones */
function placeholderGradient(seed = ''): string {
  const palettes = [
    'from-[#E8E2D8] via-[#F5F0E8] to-[#C5A880]/40',
    'from-slate-200 via-slate-100 to-indigo-100/60',
    'from-emerald-100 via-teal-50 to-lime-100/70',
    'from-violet-100 via-purple-50 to-fuchsia-100/50',
    'from-amber-100 via-orange-50 to-rose-100/50',
    'from-cyan-100 via-sky-50 to-blue-100/60',
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

function ZeroClsImg({
  src,
  alt,
  className,
  overlay = false,
}: {
  src?: string;
  alt: string;
  className?: string;
  overlay?: boolean;
}) {
  const grad = placeholderGradient(alt);
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${grad} dark:from-neutral-800 dark:via-neutral-800 dark:to-neutral-900 ${className ?? 'aspect-[16/9] w-full'}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src || undefined}
        alt={alt}
        loading="lazy"
        className={`img-zoom relative z-10 h-full w-full object-cover ${src ? 'opacity-100' : 'opacity-0'}`}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      {!src && (
        <span
          aria-hidden
          className="absolute inset-0 z-0 grid select-none place-items-center font-serifbn text-5xl font-extrabold text-black/15 dark:text-white/10"
        >
          {(alt || 'বাংলার ভয়েস').slice(0, 1)}
        </span>
      )}
      {overlay && <div className="card-image-overlay z-20" />}
    </div>
  );
}

/** Lead story — large editorial treatment with gradient overlay on image */
export function LeadCard({ article, href, locale }: { article: Article; href: string; locale: Locale }) {
  return (
    <a
      href={href}
      className="card-premium group relative flex h-full flex-col"
    >
      <ZeroClsImg
        src={article.image_url}
        alt={article.title}
        className="aspect-[16/10] w-full sm:aspect-[16/9]"
        overlay
      />
      <div className="relative z-10 flex flex-1 flex-col p-5 sm:p-6">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="badge-category">
            {translateCategory(locale, article.category || 'সর্বশেষ')}
          </span>
          {article.origin === 'original' && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              {locale === 'bn' ? 'মূল' : 'Original'}
            </span>
          )}
        </div>
        <h3 className="font-serifbn text-[1.65rem] font-extrabold leading-[1.3] tracking-tight text-ink transition-colors group-hover:text-primary dark:text-paper md:text-[1.85rem]">
          {article.title}
        </h3>
        {article.summary && (
          <p className="mt-2.5 line-clamp-2 text-[0.95rem] leading-relaxed text-neutral-600 dark:text-neutral-300">
            {article.summary}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-5 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="source-chip">
            {article.source_name || article.author || t(locale, 'source_label')}
          </span>
          {article.read_time ? (
            <span className="opacity-80">
              {fmtNum(article.read_time, locale)} {t(locale, 'min_read')}
            </span>
          ) : null}
          <span className="opacity-60">·</span>
          <ClientTimeAgo iso={article.published_at} locale={locale} className="opacity-80" />
        </div>
        {article.image_is_representational && (
          <p className="pt-2 text-[10px] font-medium text-neutral-400">
            {t(locale, 'representative_image')}
          </p>
        )}
        {article.image_credit && (
          <p className="pt-1 text-[10px] text-neutral-400">
            {t(locale, 'image_credit')}: {article.image_credit}
          </p>
        )}
      </div>
    </a>
  );
}

/** Secondary / grid cards */
export function ArticleCard({ article, href, locale }: { article: Article; href: string; locale: Locale }) {
  return (
    <a
      href={href}
      className="card-premium group flex h-full flex-col"
    >
      <ZeroClsImg
        src={article.image_url}
        alt={article.title}
        className="aspect-[16/9] w-full"
      />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="badge-category">
            {translateCategory(locale, article.category || 'সর্বশেষ')}
          </span>
        </div>
        <h3 className="font-serifbn text-[1.05rem] font-bold leading-snug text-ink transition-colors group-hover:text-primary dark:text-paper sm:text-lg">
          {article.title}
        </h3>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className="source-chip">
            {article.source_name || article.author || t(locale, 'source_label')}
          </span>
          {article.read_time ? (
            <span>{fmtNum(article.read_time, locale)} {t(locale, 'min_short')}</span>
          ) : null}
          <span className="opacity-50">·</span>
          <ClientTimeAgo iso={article.published_at} locale={locale} />
        </div>
        {article.image_is_representational && (
          <p className="pt-2 text-[10px] font-medium text-neutral-400">
            {t(locale, 'representative_image')}
          </p>
        )}
      </div>
    </a>
  );
}

/** Compact ranked list item for side rail */
export function TrendingItem({
  rank,
  article,
  href,
  locale,
}: {
  rank?: number;
  article: Article;
  href: string;
  locale: Locale;
}) {
  return (
    <a
      href={href}
      className="group flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-muted/80 dark:hover:bg-white/5"
    >
      {rank !== undefined && (
        <span className="mt-0.5 font-serifbn text-xl font-extrabold leading-none tabular-nums text-neutral-300 dark:text-neutral-600">
          {String(rank).padStart(2, '0')}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h4 className="line-clamp-2 text-[0.875rem] font-bold leading-snug text-ink transition-colors group-hover:text-primary dark:text-paper">
          {article.title}
        </h4>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className="font-semibold text-ink/70 dark:text-paper/70">
            {article.source_name || article.author || t(locale, 'source_label')}
          </span>
          <span className="opacity-40">·</span>
          <ClientTimeAgo iso={article.published_at} locale={locale} />
        </div>
      </div>
    </a>
  );
}

export function HeroBentoGrid({ articles, locale }: { articles: Article[]; locale: Locale }) {
  const [tab, setTab] = useState<'latest' | 'trending'>('latest');
  const lead = articles[0];
  const secondary = articles.slice(1, 3);
  const sortedByTime = [...articles].sort((a, b) => {
    const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
    const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
    return tb - ta;
  });
  const railItems =
    tab === 'trending' ? sortedByTime.slice(3, 9) : sortedByTime.slice(1, 7);

  if (!lead) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-muted/30 p-12 text-center dark:bg-white/5">
        <p className="font-serifbn text-lg font-semibold text-neutral-500 dark:text-neutral-400">
          {t(locale, 'no_published_stories')}
        </p>
        <p className="mt-2 text-sm text-neutral-400">
          {locale === 'bn' ? 'শীঘ্রই নতুন সংবাদ প্রকাশিত হবে' : 'New stories coming soon'}
        </p>
      </div>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-6">
      <div className="lg:col-span-2 animate-fade-up">
        <LeadCard
          article={lead}
          locale={locale}
          href={`/article/${lead.slug ?? lead.id ?? ''}`}
        />
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {secondary.map((a, idx) => (
            <div key={a.id ?? a.slug ?? a.title} className="animate-fade-up" style={{ animationDelay: `${(idx + 1) * 80}ms` }}>
              <ArticleCard
                locale={locale}
                article={a}
                href={`/article/${a.slug ?? a.id ?? ''}`}
              />
            </div>
          ))}
        </div>

        <div
          id="trending"
          className="scroll-mt-24 overflow-hidden rounded-[1.25rem] border border-border bg-white shadow-card dark:border-white/10 dark:bg-neutral-900"
        >
          <div
            role="tablist"
            aria-label={t(locale, 'side_column')}
            className="flex gap-1 border-b border-border/70 bg-muted/50 p-1.5 dark:border-white/10 dark:bg-white/5"
          >
            {(
              [
                ['latest', t(locale, 'latest_tab')],
                ['trending', t(locale, 'trending_tab')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-bold transition-all ${
                  tab === key
                    ? 'bg-white text-ink shadow-sm dark:bg-neutral-800 dark:text-paper'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-0.5 p-2">
            {railItems.map((a, i) => (
              <TrendingItem
                locale={locale}
                key={a.id ?? a.slug ?? a.title}
                rank={tab === 'trending' ? i + 1 : undefined}
                article={a}
                href={`/article/${a.slug ?? a.id ?? ''}`}
              />
            ))}
          </div>

          <div className="border-t border-border/70 px-4 py-3 text-center dark:border-white/10">
            <Link
              href="/#latest"
              className="text-sm font-bold text-primary transition-colors hover:text-crimson"
            >
              {locale === 'bn' ? 'আরও সংবাদ দেখুন →' : 'More stories →'}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
