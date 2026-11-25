import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { notoSerifBengali, hindSiliguri, inter } from '@/lib/fonts';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getLocaleFromCookie } from '@/lib/i18n';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { CookieBanner } from '@/components/CookieBanner';
import { PlausibleAnalytics } from '@/components/plausible';
import { LearningHub } from '@/components/learning-hub';
import { canonicalSiteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: { default: 'বাংলার ভয়েস', template: '%s — বাংলার ভয়েস' },
  description:
    'স্বাধীন সংবাদ প্রকাশে নির্ভীক — বাংলাদেশ ও বিশ্বের নির্ভরযোগ্য বাংলা সংবাদ, ভিডিও ও ই-পেপার। Banglar Voice autonomous Bangla news platform.',
  metadataBase: new URL(canonicalSiteUrl()),
  alternates: {
    canonical: '/',
    languages: { 'bn-BD': '/', en: '/?lang=en' },
    types: {
      'application/rss+xml': [{ url: '/rss.xml', title: 'বাংলার ভয়েস RSS' }],
    },
  },
  applicationName: 'বাংলার ভয়েস',
  authors: [{ name: 'বাংলার ভয়েস' }],
  creator: 'বাংলার ভয়েস',
  publisher: 'বাংলার ভয়েস',
  category: 'news',
  keywords: [
    'বাংলা সংবাদ',
    'Banglar Voice',
    'বাংলাদেশ',
    'news',
    'epaper',
    'ক্রিকেট',
    'রাজনীতি',
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
  openGraph: {
    siteName: 'বাংলার ভয়েস',
    title: 'বাংলার ভয়েস — স্বাধীন সংবাদ প্রচারে নির্ভীক',
    description: 'বাংলাদেশ ও বিশ্ব — নিরপেক্ষ, দায়িত্বশীল ও নির্ভরযোগ্য সাংবাদিকতা',
    url: canonicalSiteUrl(),
    locale: 'bn_BD',
    type: 'website',
    images: [{ url: '/banglar-voice-logo.png', width: 512, height: 512, alt: 'বাংলার ভয়েস' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'বাংলার ভয়েস — স্বাধীন সংবাদ',
    description: 'নিরপেক্ষ বাংলা সংবাদ, ভিডিও ও ই-পেপার',
    images: ['/banglar-voice-logo.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFAFD' },
    { media: '(prefers-color-scheme: dark)', color: '#0F172A' },
  ],
};

const organizationLd = {
  '@context': 'https://schema.org',
  '@type': 'NewsMediaOrganization',
  name: 'বাংলার ভয়েস',
  alternateName: 'Banglar Voice',
  url: canonicalSiteUrl(),
  logo: `${canonicalSiteUrl()}/banglar-voice-logo.png`,
  publishingPrinciples: `${canonicalSiteUrl()}/about`,
  sameAs: [].filter(Boolean),
};

const websiteLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'বাংলার ভয়েস',
  url: canonicalSiteUrl(),
  inLanguage: 'bn-BD',
  potentialAction: {
    '@type': 'SearchAction',
    target: `${canonicalSiteUrl()}/search?q={search_term_string}`,
    'query-input': 'required name=search_term_string',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const locale = getLocaleFromCookie(cookieStore.get(LOCALE_COOKIE)?.value);
  const savedTheme = cookieStore.get('bv-theme')?.value;
  return (
    <html lang={locale} className={savedTheme === 'dark' ? 'dark' : undefined} suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
        />
      </head>
      <body
        className={`${notoSerifBengali.variable} ${hindSiliguri.variable} ${inter.variable} bg-paper font-sansbn text-ink antialiased min-h-screen flex flex-col`}
      >
        <PlausibleAnalytics />
        <Header locale={locale} />
        <main className="flex-1">{children}</main>
        <Footer locale={locale} />
        <CookieBanner locale={locale} />
        <LearningHub locale={locale} />
      </body>
    </html>
  );
}
