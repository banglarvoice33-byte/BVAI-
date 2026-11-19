'use client';

import { useState, useEffect } from 'react';
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

function placeholderGradient(seed = ''): string {
  const palettes = [
    'from-[#E5E2DE] via-[#F5F2ED] to-[#C5A880]/30',
    'from-sky-100 via-indigo-50 to-blue-100',
    'from-emerald-100 via-teal-50 to-lime-100',
    'from-violet-100 via-purple-50 to-fuchsia-100',
    'from-amber-100 via-yellow-50 to-orange-100',
    'from-cyan-100 via-sky-50 to-blue-100',
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

function ZeroClsImg({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const grad = placeholderGradient(alt);
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${grad} dark:from-neutral-800 dark:via-neutral-800 dark:to-neutral-700 ${className ?? 'aspect-[16/9] w-full'}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src || undefined}
        alt={alt}
        loading="lazy"
        className={`relative z-10 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 ${src ? 'opacity-100' : 'opacity-0'}`}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      {!src && (
        <span
          aria-hidden
          className="absolute inset-0 grid select-none place-items-center font-serifbn text-4xl font-extrabold text-black/20 dark:text-white/15"
        >
          {(alt || 'বাংলার ভয়েস').slice(0, 1)}
        </span>
      )}
    </div>
  );
}

export function LeadCard({ article, href, locale }: { article: Article; href: string; locale: Locale }) {
  return (
    <a
      href={href}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-sm transition-shadow hover:shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
    >
      <ZeroClsImg src={article.image_url} alt={article.title} className="aspect-[16/10] w-full" />
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
          <span>{translateCategory(locale, article.category || 'সর্বশেষ')}</span>
        </div>
        <h3 className="font-serifbn text-2xl font-extrabold leading-snug text-ink group-hover:text-primary dark:text-paper md:text-3xl">
          {article.title}
        </h3>
        {article.summary && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
            {article.summary}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-4 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="rounded-full border border-border px-2 py-0.5 font-semibold text-ink dark:border-white/15 dark:text-paper">
            {article.source_name || article.author || t(locale, 'source_label')}
          </span>
          {article.read_time ? <span>• {fmtNum(article.read_time, locale)} {t(locale, 'min_read')}</span> : null}
          <span>• <ClientTimeAgo iso={article.published_at} locale={locale} /></span>
        </div>
        {article.image_is_representational ? (
          <p className="pt-2 text-[10px] font-semibold text-neutral-500">{t(locale, 'representative_image')}</p>
        ) : null}
        {article.image_credit ? (
          <p className="pt-2 text-[10px] text-neutral-400">{t(locale, 'image_credit')}: {article.image_credit}</p>
        ) : null}
      </div>
    </a>
  );
}

export function ArticleCard({ article, href, locale }: { article: Article; href: string; locale: Locale }) {
  return (
    <a
      href={href}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-white transition-shadow hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
    >
      <ZeroClsImg src={article.image_url} alt={article.title} className="aspect-[16/9] w-full" />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            {translateCategory(locale, article.category || 'সর্বশেষ')}
          </span>
        </div>
        <h3 className="font-serifbn text-lg font-bold leading-snug text-ink group-hover:text-primary dark:text-paper">
          {article.title}
        </h3>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className="rounded-full border border-border px-2 py-0.5 font-semibold text-ink dark:border-white/15 dark:text-paper">
            {article.source_name || article.author || t(locale, 'source_label')}
          </span>
          {article.read_time ? <span>{fmtNum(article.read_time, locale)} {t(locale, 'min_short')}</span> : null}
          <span>•</span>
          <span><ClientTimeAgo iso={article.published_at} locale={locale} /></span>
        </div>
        {article.image_is_representational ? (
          <p className="pt-2 text-[10px] font-semibold text-neutral-500">{t(locale, 'representative_image')}</p>
        ) : null}
        {article.image_credit ? (
          <p className="pt-2 text-[10px] text-neutral-400">{t(locale, 'image_credit')}: {article.image_credit}</p>
        ) : null}
      </div>
    </a>
  );
}

export function TrendingItem({ rank, article, href, locale }: { rank?: number; article: Article; href: string; locale: Locale }) {
  return (
    <a
      href={href}
      className="group flex items-start gap-3 rounded-xl p-2 transition-colors hover:bg-muted dark:hover:bg-neutral-800"
    >
      {rank !== undefined && (
        <span className="font-serifbn text-2xl font-extrabold leading-none text-neutral-300 dark:text-neutral-600">
          {String(rank).padStart(2, '0')}
        </span>
      )}
      <div className="min-w-0">
        <h4 className="line-clamp-2 text-sm font-bold leading-snug text-ink group-hover:text-primary dark:text-paper">
          {article.title}
        </h4>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-neutral-500">
          <span className="font-semibold text-ink dark:text-paper">{article.source_name || article.author || t(locale, 'source_label')}</span>
          <span>•</span>
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
    tab === 'trending'
      ? sortedByTime.slice(3, 9)
      : sortedByTime.slice(1, 7);

  if (!lead) {
    return (
      <div className="rounded-3xl border border-dashed border-border p-10 text-center text-neutral-500">
        {t(locale, 'no_published_stories')}
      </div>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <LeadCard article={lead} locale={locale} href={`/article/${lead.slug ?? lead.id ?? ''}`} />
      </div>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {secondary.map((a) => (
            <ArticleCard locale={locale} key={a.id ?? a.slug ?? a.title} article={a} href={`/article/${a.slug ?? a.id ?? ''}`} />
          ))}
        </div>
        <div
          id="trending"
          className="scroll-mt-24 rounded-2xl border border-border bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div
            role="tablist"
            aria-label={t(locale, 'side_column')}
            className="mb-2 flex gap-1 rounded-full bg-muted p-1 dark:bg-neutral-800"
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
                className={`flex-1 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                  tab === key
                    ? 'bg-white text-ink shadow-sm dark:bg-neutral-900 dark:text-paper'
                    : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {railItems.map((a, i) => (
              <TrendingItem locale={locale}
                key={a.id ?? a.slug ?? a.title}
                rank={tab === 'trending' ? i + 1 : undefined}
                article={a}
                href={`/article/${a.slug ?? a.id ?? ''}`}
              />
            ))}
          </div>
          <div className="mt-4 border-t border-border pt-3 text-center">
            <a href="/latest" className="text-sm font-bold text-primary hover:underline">
              আরও সংবাদ দেখুন →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
