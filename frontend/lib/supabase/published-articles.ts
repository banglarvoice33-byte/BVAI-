import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const PUBLISHED_ARTICLE_COLUMNS = 'id, slug, title_bn, title_en, content_bn, content_en, excerpt_bn, thumbnail_url, featured_image, category, status, published_at, source_name, source_url, canonical_url, created_at, video_id';

function taggedArticleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return fetch(input, init);
  const options = {
    ...init,
    next: { revalidate: 60, tags: ['articles'] },
  } as RequestInit & { next: { revalidate: number; tags: string[] } };
  return fetch(input, options);
}

export function createPublicSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase public credentials are not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: taggedArticleFetch },
  });
}

export async function fetchPublishedArticlesFeed(supabase?: SupabaseClient | number, limit = 30): Promise<any[]> {
  let client: SupabaseClient;
  let take = limit;
  if (supabase === undefined) {
    client = createPublicSupabase();
  } else if (typeof supabase === 'number') {
    take = supabase;
    client = createPublicSupabase();
  } else {
    client = supabase as SupabaseClient;
  }
  const { data, error } = await client.from('articles').select(PUBLISHED_ARTICLE_COLUMNS).eq('status','published').order('published_at',{ascending:false}).limit(take);
  if (error) {
    // Minimal compatibility query: older production schemas may not yet have the
    // optional newsroom columns. Keep the public feed usable while migrations catch up.
    const { data: d2, error: fallbackError } = await client
      .from('articles')
      .select('id, title_bn, title_en, content_bn, content_en, thumbnail_url, category, status, published_at, created_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(take);
    if (fallbackError) throw fallbackError;
    return (d2 || []) as any[];
  }
  return (data || []) as any[];
}

export async function fetchPublishedArticleById(id: string, supabase?: SupabaseClient) {
  const client = supabase || createPublicSupabase();
  const { data } = await client.from('articles').select(PUBLISHED_ARTICLE_COLUMNS).eq('id', id).eq('status','published').single();
  return data || null;
}

export async function fetchPublishedArticleBySlug(slug: string, supabase?: SupabaseClient) {
  const client = supabase || createPublicSupabase();
  const { data } = await client.from('articles').select(PUBLISHED_ARTICLE_COLUMNS).eq('slug', slug).eq('status','published').single();
  return data || null;
}

export async function fetchPublishedArticles(supabase?: SupabaseClient, limit=30) {
  return fetchPublishedArticlesFeed(supabase, limit);
}

export type PublishedArticleSearchOptions = {
  query?: string;
  from?: string;
  to?: string;
  category?: string;
  page?: number;
  pageSize?: number;
};

export type PublishedArticleSearchResult = {
  items: any[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Search the complete published archive rather than the short homepage feed.
 * The query stays server-side so old articles are searchable without exposing
 * the full database to the browser or making the client download every story.
 */
export async function searchPublishedArticles(
  options: PublishedArticleSearchOptions = {},
  supabase?: SupabaseClient,
): Promise<PublishedArticleSearchResult> {
  const client = supabase || createPublicSupabase();
  const pageSize = Math.min(24, Math.max(1, options.pageSize || 12));
  const page = Math.max(1, options.page || 1);
  const query = (options.query || '').trim().slice(0, 120);
  let builder = client
    .from('articles')
    .select(PUBLISHED_ARTICLE_COLUMNS, { count: 'exact' })
    .eq('status', 'published')
    .not('published_at', 'is', null);

  if (query) {
    const escaped = query.replace(/[(),]/g, ' ').replace(/[*]/g, '').replace(/[%_]/g, '\\$&');
    if (escaped) {
      builder = builder.or(
        [
          `title_bn.ilike.%${escaped}%`,
          `title_en.ilike.%${escaped}%`,
          `excerpt_bn.ilike.%${escaped}%`,
          `content_bn.ilike.%${escaped}%`,
          `content_en.ilike.%${escaped}%`,
          `category.ilike.%${escaped}%`,
          `source_name.ilike.%${escaped}%`,
        ].join(','),
      );
    }
  }
  if (options.from) builder = builder.gte('published_at', options.from);
  if (options.to) builder = builder.lt('published_at', options.to);
  if (options.category) builder = builder.eq('category', options.category);

  const { data, count, error } = await builder
    .order('published_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;

  return { items: data || [], total: count || 0, page, pageSize };
}
