/**
 * Server-only helpers for the newsroom pipeline. Everything here runs inside
 * server functions / route handlers on the Worker runtime — no child_process,
 * no native modules; only fetch-based HTTP and the admin Supabase client.
 */
import { XMLParser } from "fast-xml-parser";
import { scriptSchema, type Script } from "./pipeline.types";

/** Free, open Bengali news feeds ingested by the RSS poll. */
export const RSS_FEEDS = [
  { name: "Prothom Alo", url: "https://www.prothomalo.com/feed/" },
  { name: "BBC Bangla", url: "https://feeds.bbci.co.uk/bengali/rss.xml" },
  { name: "Ittefaq", url: "https://www.ittefaq.com.bd/rss.xml" },
];

const UA =
  "BVAi/1.0 (newsroom automation; contact: operator@example.invalid)";

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: { "user-agent": UA, ...(rest.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export type RssEntry = { title: string; link: string; summary: string };

/** Parse a Bengali RSS/Atom feed into plain entries; tolerant of CDATA/HTML. */
export function parseFeed(xml: string, limit = 12): RssEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });
  const doc = parser.parse(xml) as {
    rss?: { channel?: { item?: unknown } };
    feed?: { entry?: unknown };
  };
  const rawItems: unknown[] =
    (Array.isArray(doc.rss?.channel?.item)
      ? doc.rss?.channel?.item
      : doc.rss?.channel?.item
        ? [doc.rss.channel.item]
        : []) ??
    (Array.isArray(doc.feed?.entry)
      ? doc.feed?.entry
      : doc.feed?.entry
        ? [doc.feed.entry]
        : []);
  const entries: RssEntry[] = [];
  for (const item of rawItems.slice(0, limit)) {
    const it = item as Record<string, unknown>;
    const title = stripTags(String(it["title"] ?? "")).trim();
    const link = typeof it["link"] === "string"
      ? it["link"]
      : ((it["link"] as Record<string, string>)?.["@_href"] ?? "");
    if (!title || !link) continue;
    const summary = stripTags(
      String(it["description"] ?? it["summary"] ?? ""),
    ).trim();
    entries.push({ title: title.slice(0, 300), link, summary: summary.slice(0, 2000) });
  }
  return entries;
}

function stripTags(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}

export type CommonsImage = {
  url: string;
  page_url: string;
  title: string;
  author: string;
  license: string;
};

/**
 * Search Wikimedia Commons (freely licensed media) for a topic. Returns
 * landscape-prefixed thumbnails with license/author metadata so every
 * published post carries proper attribution.
 */
export async function searchCommonsImages(
  query: string,
  limit = 4,
): Promise<CommonsImage[]> {
  const endpoint =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: String(limit * 3),
      prop: "imageinfo",
      iiprop: "url|extmetadata|user|size",
      iiurlwidth: "1920",
      format: "json",
      origin: "*",
    });
  const res = await fetchWithTimeout(endpoint);
  if (!res.ok) throw new Error(`Commons search failed: ${res.status}`);
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: Array<{
            thumburl?: string;
            url?: string;
            descriptionurl?: string;
            user?: string;
            width?: number;
            height?: number;
            extmetadata?: Record<string, { value?: string }>;
          }>;
        }
      >;
    };
  };
  const pages = Object.values(data.query?.pages ?? {});
  const out: CommonsImage[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const url = info?.thumburl ?? info?.url;
    if (!url) continue;
    // Prefer landscape stills for the 16:9 master.
    if (info?.width && info?.height && info.width / info.height < 1.2) continue;
    const meta = info?.extmetadata ?? {};
    out.push({
      url,
      page_url: info?.descriptionurl ?? url,
      title: page.title ?? url,
      author: stripTags(meta["Artist"]?.value ?? info?.user ?? "Unknown").trim(),
      license: stripTags(meta["LicenseShortName"]?.value ?? "See Commons").trim(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export type GitHubDispatchResult =
  | { dispatched: true; repo: string }
  | { dispatched: false; reason: string };

/**
 * Trigger the GitHub Actions render worker via repository_dispatch.
 * Requires GITHUB_PAT (repo scope: actions:write) and GITHUB_REPO
 * ("owner/name"), e.g. YOUR-OWNER/YOUR-REPO.
 */
export async function dispatchRenderWorker(
  jobId: string,
  appUrl: string,
): Promise<GitHubDispatchResult> {
  const pat = process.env["GITHUB_PAT"];
  const repo = process.env["GITHUB_REPO"] ?? "";
  if (!pat) {
    return { dispatched: false, reason: "GITHUB_PAT secret is not configured" };
  }
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/dispatches`,
    {
      method: "POST",
      timeoutMs: 20_000,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${pat}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({
        event_type: "render-news",
        client_payload: { job_id: jobId, app_url: appUrl },
      }),
    },
  );
  if (res.status === 204) return { dispatched: true, repo };
  const body = await res.text().catch(() => "");
  return { dispatched: false, reason: `GitHub dispatch ${res.status}: ${body.slice(0, 200)}` };
}

export type FacebookPublishResult =
  | { posted: true; external_id: string; post_url: string }
  | { posted: false; error: string };

/**
 * Publish the rendered video to the configured Facebook Page. The master is
 * fetched by Facebook from a time-limited signed Storage URL (the bucket is
 * private). Caption carries the Bengali news text plus media credits.
 */
export async function publishToFacebook(opts: {
  videoUrl: string;
  description: string;
}): Promise<FacebookPublishResult> {
  const pageId = process.env["FACEBOOK_PAGE_ID"];
  const token = process.env["FACEBOOK_PAGE_ACCESS_TOKEN"];
  if (!pageId || !token) {
    return {
      posted: false,
      error: "FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN secrets are not configured",
    };
  }
  const res = await fetchWithTimeout(
    `https://graph.facebook.com/v21.0/${pageId}/videos`,
    {
      method: "POST",
      timeoutMs: 120_000,
      body: new URLSearchParams({
        access_token: token,
        file_url: opts.videoUrl,
        description: opts.description.slice(0, 5000),
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!res.ok || data.error) {
    return {
      posted: false,
      error: `Facebook API ${res.status}: ${data.error?.message ?? "unknown error"}`,
    };
  }
  const id = data.id ?? "";
  return {
    posted: true,
    external_id: id,
    post_url: `https://www.facebook.com/${pageId}/videos/${id}`,
  };
}

/** Parse + validate the model's raw script JSON into the canonical schema. */
export function parseModelScript(raw: string): Script | null {
  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) return null;
    const parsed: unknown = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    const result = scriptSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Constant-time compare for shared-secret endpoint guards. */
export async function verifyWorkerSecret(headerValue: string | null): Promise<boolean> {
  const secret = process.env["WORKER_SECRET"];
  if (!secret || !headerValue) return false;
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(headerValue);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
