import { fetchPublishedArticlesFeed } from '../../lib/supabase/published-articles';
import { canonicalSiteUrl } from '../../lib/site';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

const SITE = canonicalSiteUrl();
const NEWS_NAMESPACE = 'http://www.google.com/schemas/sitemap-news/0.9';

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function publicationDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET() {
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  let articles: any[] = [];

  try {
    // Google recommends retaining only articles from the last two days in a
    // News Sitemap. The query is bounded so this route cannot grow without limit.
    articles = (await fetchPublishedArticlesFeed(undefined, 1000)).filter((article) => {
      const published = publicationDate(article.published_at);
      return Boolean(article.slug && published && new Date(published).getTime() >= cutoff);
    });
  } catch (error) {
    console.error('NEWS_SITEMAP_LOAD_FAILED', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const urls = articles.map((article) => {
    const title = article.title_bn || article.title_en || 'বাংলার ভয়েস সংবাদ';
    const published = publicationDate(article.published_at) as string;
    return [
      '  <url>',
      `    <loc>${xmlEscape(`${SITE}/article/${encodeURIComponent(article.slug)}`)}</loc>`,
      '    <news:news>',
      '      <news:publication>',
      '        <news:name>বাংলার ভয়েস</news:name>',
      '        <news:language>bn</news:language>',
      '      </news:publication>',
      `      <news:publication_date>${xmlEscape(published)}</news:publication_date>`,
      `      <news:title>${xmlEscape(title)}</news:title>`,
      '    </news:news>',
      '  </url>',
    ].join('\n');
  });

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="${NEWS_NAMESPACE}">`,
    ...urls,
    '</urlset>',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
