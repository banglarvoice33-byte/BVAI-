'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';
import { LanguageToggle } from './LanguageToggle';
import { BreakingMarquee } from './breaking-marquee';
import { WeatherWidget } from './weather-widget';
import { t, type Locale } from '@/lib/i18n';
import { formatBanglaCalendarDate } from '@/lib/bn-date';

const NAV_KEYS = [
  { href: '/#latest', key: 'latest' as const },
  { href: '/category/politics', key: 'politics' as const },
  { href: '/category/economy', key: 'economy' as const },
  { href: '/category/international', key: 'international' as const },
  { href: '/epaper', key: 'epaper' as const },
  { href: '/search', key: 'search_placeholder' as const },
  { href: '/download', key: 'app' as const },
];

function LiveBanglaClock({ locale }: { locale: Locale }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  const bcp47 = locale === 'en' ? 'en-US' : 'bn-BD';
  const bengaliCalendarDate = formatBanglaCalendarDate(now, locale);
  const gregorianDate = new Intl.DateTimeFormat(bcp47, {
    timeZone: 'Asia/Dhaka',
    calendar: 'gregory',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);

  const timeStr = now.toLocaleTimeString(bcp47, {
    timeZone: 'Asia/Dhaka',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-ink/80 dark:text-white/80 sm:text-xs">
      {/* Date */}
      <span className="inline-flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-70">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span>{bengaliCalendarDate}</span>
      </span>

      {/* Tagline - Desktop only in this row */}
      <span className="hidden md:inline text-ink/60 dark:text-white/60">
        {locale === 'bn' ? 'সংবাদ • ভিডিও • পডকাস্ট' : 'News • Video • Podcast'}
      </span>

      {/* Time + Dhaka */}
      <span className="inline-flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-70">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span>{timeStr}</span>
        <span className="text-[#CC0000] font-semibold">•</span>
        <span>{locale === 'bn' ? 'ঢাকা' : 'Dhaka'}</span>
      </span>
    </div>
  );
}

export function Header({ locale = 'bn' as Locale }: { locale?: Locale }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) {
      menuRef.current?.focus();
    }
  }, [menuOpen]);

  const navLinks = NAV_KEYS.map((n) => ({ href: n.href, label: t(locale, n.key) }));

  return (
    <>
      {/* ========== DESKTOP + TABLET HEADER ========== */}
      <header className="border-b border-border/80 bg-paper dark:bg-ink">
        {/* Row 1 — Masthead */}
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:py-4">
          {/* Left: Menu + Logo */}
          <div className="flex items-center gap-2 md:gap-3">
            {/* Mobile menu button */}
            <button
              type="button"
              ref={triggerRef}
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={t(locale, menuOpen ? 'menu_close' : 'menu_open')}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border text-ink transition-colors hover:bg-muted md:hidden dark:border-white/20 dark:text-white"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {menuOpen ? (
                  <path d="M18 6 6 18M6 6l12 12" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>

            {/* Logo */}
            <Link
              href="/"
              className="inline-flex shrink-0 items-center gap-2.5"
              aria-label={`Banglar Voice 24NEWS — ${t(locale, 'home')}`}
            >
              {/* Circular mic mark */}
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#CC0000] md:h-12 md:w-12">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-white">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="currentColor" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              {/* Wordmark */}
              <div className="flex flex-col leading-none">
                <span className="text-[10px] font-bold tracking-[0.15em] text-ink/70 dark:text-white/70 md:text-[11px]">
                  BANGLAR VOICE
                </span>
                <span className="text-[22px] font-bold text-[#CC0000] md:text-[26px] lg:text-[28px]">
                  বাংলার ভয়েস
                </span>
              </div>
            </Link>
          </div>

          {/* Right: Language + theme + 24NEWS */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:block">
              <LanguageToggle locale={locale} />
            </div>
            <ThemeToggle />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#CC0000] px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/90" />
              24NEWS
            </span>
          </div>
        </div>

        {/* Row 2 — Metadata (date / tagline / time) */}
        <div className="border-t border-border/60 bg-paper/80 dark:bg-ink/90">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
            <LiveBanglaClock locale={locale} />
            <div className="flex items-center gap-3">
              <Link
                href="/search"
                aria-label={locale === 'en' ? 'Search news' : 'সংবাদ খুঁজুন'}
                title={locale === 'en' ? 'Search news' : 'সংবাদ খুঁজুন'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-ink transition-colors hover:border-[#CC0000] hover:bg-[#CC0000]/5 hover:text-[#CC0000] md:hidden dark:border-white/20 dark:text-white dark:hover:border-[#CC0000] dark:hover:bg-[#CC0000]/15"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4.25 4.25" />
                </svg>
              </Link>
              <div className="hidden items-center gap-3 md:flex">
                <WeatherWidget locale={locale} />
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden border-t border-border/60 md:block" aria-label="Main navigation">
          <div className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-full px-3.5 py-1.5 text-sm font-semibold text-ink/80 transition-colors hover:bg-muted hover:text-ink dark:text-white/80 dark:hover:bg-white/10"
              >
                {l.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Row 3 — Breaking Ticker */}
        <BreakingMarquee locale={locale} />
      </header>

      {/* ========== MOBILE MENU DRAWER ========== */}
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label={t(locale, 'menu_close')}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          />
          <nav
            id="mobile-menu"
            ref={menuRef}
            tabIndex={-1}
            className="fixed inset-x-0 top-[120px] z-50 max-h-[calc(100dvh-120px)] overflow-y-auto border-t border-border bg-paper px-4 py-4 shadow-xl outline-none md:hidden dark:bg-ink dark:border-white/10"
            aria-label="Mobile navigation"
          >
            <ul className="space-y-1">
              {navLinks.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2.5 text-[15px] font-semibold text-ink/85 hover:bg-muted dark:text-white/85 dark:hover:bg-white/10"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
              <li className="flex gap-4 pt-3 text-sm font-medium text-ink/70 dark:text-white/70">
                <a href="/about" className="hover:underline">
                  {t(locale, 'about')}
                </a>
                <a href="/contact" className="hover:underline">
                  {t(locale, 'contact')}
                </a>
              </li>
            </ul>

            {/* Mobile language toggle */}
            <div className="mt-4 border-t border-border pt-4 dark:border-white/10">
              <LanguageToggle locale={locale} />
            </div>
          </nav>
        </>
      )}
    </>
  );
}
