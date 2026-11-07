import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../config.js";
import { supabaseAdmin } from "../lib/pipeline.js";

type QueueJob = {
  id: string;
  video_id: string;
  platform: string;
  platform_account_id: string | null;
  payload: Record<string, unknown>;
  attempt_count: number;
};

type VideoRow = {
  id: string;
  title_bn: string;
  title_en: string;
  description_bn: string;
  category_key: string;
  thumbnail_url: string;
  video_url: string | null;
  status: string;
};

type Credentials = Record<string, string>;

const GRAPH_VERSION = "v23.0";
const MAX_VIDEO_BYTES = 2_000_000_000;
const WORKER_ID = `video-dispatch-${process.env.HOSTNAME || "worker"}-${randomUUID().slice(0, 8)}`;

function safeError(error: unknown): Record<string, string> {
  const raw = error instanceof Error ? error.message : String(error);
  return { code: "VIDEO_DISTRIBUTION_FAILED", message: raw.replace(/(access_token|refresh_token|client_secret|Authorization)[=: ]+[^&\s]+/gi, "$1=[REDACTED]").slice(0, 1200) };
}

function isSafePublicMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (!host || isIP(host) !== 0 || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) || host === "::1") return false;
    return true;
  } catch {
    return false;
  }
}

async function vaultSecret(client: SupabaseClient, names: string[]): Promise<string | null> {
  for (const name of names) {
    const { data: row, error } = await client.from("api_vault")
      .select("key_encrypted")
      .eq("service_name", name)
      .eq("environment", "prod")
      .eq("is_active", true)
      .maybeSingle();
    if (error || !row?.key_encrypted) continue;
    const { data, error: decryptError } = await client.rpc("decrypt_vault_secret", { p_secret_id: row.key_encrypted });
    if (!decryptError && typeof data === "string" && data.length > 0) return data;
  }
  return null;
}

async function getVideo(client: SupabaseClient, job: QueueJob): Promise<{ video: VideoRow; mediaUrl: string; caption: string }> {
  const { data: video, error } = await client.from("videos")
    .select("id,title_bn,title_en,description_bn,category_key,thumbnail_url,video_url,status")
    .eq("id", job.video_id)
    .maybeSingle();
  if (error || !video) throw new Error("VIDEO_RECORD_NOT_FOUND");
  if (video.status !== "published") throw new Error("VIDEO_NOT_EDITORIALLY_PUBLISHED");

  let mediaUrl = "";
    const { data: generation } = await client.from("video_generation_jobs")
      .select("id,status,caption_bn")
      .eq("video_id", job.video_id)
      .eq("status", "publishing")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (generation?.id) {
      const { data: asset } = await client.from("video_generation_assets")
        .select("url")
        .eq("job_id", generation.id)
        .eq("kind", "render")
        .not("url", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      mediaUrl = typeof asset?.url === "string" ? asset.url : "";
    }
  if (!mediaUrl && typeof video.video_url === "string") mediaUrl = video.video_url;
  if (!mediaUrl || !isSafePublicMediaUrl(mediaUrl)) throw new Error("APPROVED_VIDEO_HAS_NO_SAFE_HTTPS_MEDIA_URL");
  const head = await fetch(mediaUrl, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const mediaType = head.headers.get("content-type") || "";
  const mediaLength = Number(head.headers.get("content-length") || 0);
  if (!head.ok || !mediaType.toLowerCase().startsWith("video/") || !mediaLength || mediaLength > MAX_VIDEO_BYTES) {
    throw new Error("VIDEO_SOURCE_NOT_A_PUBLIC_DIRECT_VIDEO_FILE");
  }
  const caption = typeof job.payload?.caption === "string" ? job.payload.caption : video.description_bn;
  return { video: video as VideoRow, mediaUrl, caption };
}

async function facebookUpload(
  client: SupabaseClient,
  job: QueueJob,
  video: VideoRow,
  mediaUrl: string,
  caption: string,
): Promise<{ id: string; url: string }> {
  const [pageId, token] = await Promise.all([
    job.platform_account_id ? Promise.resolve(job.platform_account_id) : vaultSecret(client, ["SOCIAL_FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ID"]),
    vaultSecret(client, ["SOCIAL_FACEBOOK_PAGE_TOKEN", "FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_PAGE_TOKEN"]),
  ]);
  if (!pageId || !token) throw new Error("FACEBOOK_PAGE_CREDENTIALS_MISSING");
  const identity = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}?fields=id`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const identityData = await identity.json().catch(() => ({})) as { id?: string };
  if (!identity.ok || identityData.id !== pageId) throw new Error("FACEBOOK_PAGE_IDENTITY_MISMATCH");
  const form = new URLSearchParams({
    file_url: mediaUrl,
    title: video.title_bn.slice(0, 255),
    description: caption.slice(0, 5000),
    access_token: token,
  });
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!response.ok || !result.id) throw new Error(`FACEBOOK_VIDEO_UPLOAD_FAILED:${result.error?.message || response.status}`);
  return { id: result.id, url: `https://www.facebook.com/${pageId}/videos/${result.id}` };
}

async function youtubeAccessToken(client: SupabaseClient): Promise<{ token: string; expectedChannel: string }> {
  const [clientId, clientSecret, refreshToken, expectedChannel] = await Promise.all([
    vaultSecret(client, ["OAUTH_CLIENT_ID"]),
    vaultSecret(client, ["OAUTH_CLIENT_SECRET"]),
    vaultSecret(client, ["YOUTUBE_REFRESH_TOKEN"]),
    vaultSecret(client, ["YOUTUBE_CHANNEL_ID"]),
  ]);
  if (!clientId || !clientSecret || !refreshToken || !expectedChannel) throw new Error("YOUTUBE_OAUTH_CREDENTIALS_MISSING");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({})) as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error(`YOUTUBE_TOKEN_REFRESH_FAILED:${data.error || response.status}`);
  const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", {
    headers: { Authorization: `Bearer ${data.access_token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const channelData = await channelResponse.json().catch(() => ({})) as { items?: Array<{ id?: string }> };
  const actualChannel = channelData.items?.[0]?.id;
  if (!channelResponse.ok || !actualChannel || actualChannel !== expectedChannel) throw new Error("YOUTUBE_CHANNEL_IDENTITY_MISMATCH");
  const { error: readinessError } = await client.from("social_platforms")
    .update({ names_verified: true, updated_at: new Date().toISOString() })
    .eq("platform", "youtube");
  if (readinessError) console.error("[video-distribution] YouTube identity verified; readiness metadata update failed:", readinessError.message);
  return { token: data.access_token, expectedChannel };
}

async function youtubeUpload(
  client: SupabaseClient,
  video: VideoRow,
  mediaUrl: string,
  caption: string,
): Promise<{ id: string; url: string; channelId: string }> {
  const { token, expectedChannel } = await youtubeAccessToken(client);
  const source = await fetch(mediaUrl, { signal: AbortSignal.timeout(120_000) });
  if (!source.ok || !source.body) throw new Error(`VIDEO_SOURCE_FETCH_FAILED:${source.status}`);
  const contentLength = Number(source.headers.get("content-length") || 0);
  if (!contentLength || contentLength > MAX_VIDEO_BYTES || !(source.headers.get("content-type") || "").toLowerCase().startsWith("video/")) throw new Error("VIDEO_SIZE_OR_CONTENT_TYPE_INVALID");
  const metadata = {
    snippet: {
      title: video.title_bn.slice(0, 100),
      description: caption.slice(0, 5000),
      tags: ["Banglar Voice", "বাংলার ভয়েস", video.category_key || "news"],
      categoryId: "25",
      defaultLanguage: "bn",
      defaultAudioLanguage: "bn",
    },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": source.headers.get("content-type") || "video/mp4",
      "X-Upload-Content-Length": String(contentLength),
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(30_000),
  });
  const uploadUrl = init.headers.get("location");
  if (!init.ok || !uploadUrl) throw new Error(`YOUTUBE_UPLOAD_SESSION_FAILED:${init.status}`);
  const stream = Readable.fromWeb(source.body as import("node:stream/web").ReadableStream);
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": source.headers.get("content-type") || "video/mp4",
      "Content-Length": String(contentLength),
    },
    body: stream,
    // Node fetch requires half-duplex for a streamed request body.
    duplex: "half",
    signal: AbortSignal.timeout(30 * 60_000),
  } as RequestInit & { duplex: "half" });
  const result = await upload.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!upload.ok || !result.id) throw new Error(`YOUTUBE_VIDEO_UPLOAD_FAILED:${result.error?.message || upload.status}`);
  return { id: result.id, url: `https://youtu.be/${result.id}`, channelId: expectedChannel };
}

async function processJob(client: SupabaseClient, job: QueueJob): Promise<void> {
  const { data: platform, error: platformError } = await client.from("social_platforms")
    .select("enabled")
    .eq("platform", job.platform)
    .maybeSingle();
  if (platformError || !platform?.enabled) throw new Error(`VIDEO_PLATFORM_DISABLED:${job.platform}`);
  const { video, mediaUrl, caption } = await getVideo(client, job);
  let published: { id: string; url: string; channelId?: string };
  if (job.platform === "facebook") {
    published = await facebookUpload(client, job, video, mediaUrl, caption);
  } else if (job.platform === "youtube") {
    published = await youtubeUpload(client, video, mediaUrl, caption);
  } else {
    throw new Error(`UNSUPPORTED_VIDEO_PLATFORM:${job.platform}`);
  }

  const { error: completeError } = await client.rpc("complete_video_distribution_job", {
    p_job_id: job.id,
    p_worker_id: WORKER_ID,
    p_provider_job_id: published.id,
    p_provider_status: "published",
    p_result: { url: published.url, platform: job.platform, published_at: new Date().toISOString() },
  });
  if (completeError) throw new Error(`QUEUE_COMPLETE_FAILED:${completeError.message}`);

  if (job.platform === "youtube") {
    const { error } = await client.from("videos").update({
      youtube_id: published.id,
      channel_id: published.channelId,
      embed_url: `https://www.youtube.com/embed/${published.id}`,
      video_url: published.url,
      updated_at: new Date().toISOString(),
    }).eq("id", job.video_id);
    if (error) console.error("[video-distribution] uploaded to YouTube but video metadata sync failed:", error.message);
  }
  console.log(`[video-distribution] job=${job.id} platform=${job.platform} provider_id=${published.id}`);
}

async function processClaim(client: SupabaseClient, job: QueueJob): Promise<void> {
  const heartbeat = setInterval(() => {
    void client.rpc("heartbeat_video_distribution_job", {
      p_job_id: job.id, p_worker_id: WORKER_ID, p_lock_seconds: 900,
    }).then(({ error }) => {
      if (error) console.error("[video-distribution] heartbeat failed:", error.message);
    });
  }, 60_000);
  heartbeat.unref?.();
  try {
    await processJob(client, job);
  } catch (error) {
    const { error: failError } = await client.rpc("fail_video_distribution_job", {
      p_job_id: job.id,
      p_worker_id: WORKER_ID,
      p_error: safeError(error),
      p_retry_delay_seconds: 120,
    });
    console.error("[video-distribution] job failed:", job.id, safeError(error), failError?.message || "");
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runVideoDistributionBatch(cfg: WorkerConfig, limit = 2): Promise<number> {
  if ((process.env.VIDEO_DISTRIBUTION_WORKER_ENABLED || "").toLowerCase() !== "true") return 0;
  const client = supabaseAdmin(cfg);
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for video distribution worker");
  const { data, error } = await client.rpc("claim_video_distribution_jobs", {
    p_worker_id: WORKER_ID,
    p_limit: Math.max(1, Math.min(limit, 10)),
    p_lock_seconds: 900,
  });
  if (error) {
    if (error.message.includes("video_distribution_disabled")) return 0;
    throw new Error(`VIDEO_QUEUE_CLAIM_FAILED:${error.message}`);
  }
  const jobs = (data || []) as QueueJob[];
  for (const job of jobs) await processClaim(client, job);
  return jobs.length;
}

export async function runVideoDistributionOnce(cfg: WorkerConfig): Promise<number> {
  return runVideoDistributionBatch(cfg, Number(process.env.VIDEO_DISTRIBUTION_BATCH_SIZE || "2"));
}
