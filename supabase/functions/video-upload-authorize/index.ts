import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-video-job-id, x-video-article-id, x-video-sha256",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function safeEqual(a: string, b: string): boolean {
  const e = new TextEncoder(), aa = e.encode(a), bb = e.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const expected = Deno.env.get("VIDEO_UPLOAD_TOKEN");
  const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || !safeEqual(supplied, expected)) return reply(401, { error: "unauthorized" });

  const url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(503, { error: "server_not_configured" });

  try {
    const requestUrl = new URL(req.url);
    const uploadAction = requestUrl.searchParams.get("action") === "upload";
    const body = uploadAction ? {} : await req.json();
    const action = uploadAction ? "upload" : body.action;
    const jobId = String(req.headers.get("x-video-job-id") ?? body.job_id ?? "");
    const articleId = String(req.headers.get("x-video-article-id") ?? body.article_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(jobId) || !/^[0-9a-f-]{36}$/i.test(articleId)) {
      return reply(400, { error: "invalid_job_or_article_id" });
    }

    const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: job, error: jobError } = await supabase.from("video_generation_jobs")
      .select("id,article_id,video_id,status").eq("id", jobId).eq("article_id", articleId).maybeSingle();
    if (jobError || !job) return reply(404, { error: "generation_job_not_found" });

    const { data: article, error: articleError } = await supabase.from("articles")
      .select("id,status,title_bn,title_en,content_bn,category,thumbnail_url")
      .eq("id", articleId).maybeSingle();
    if (articleError || !article || article.status !== "published") {
      return reply(403, { error: "article_not_published" });
    }

    if (action === "upload") {
      if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("video/mp4")) {
        return reply(415, { error: "video_mp4_required" });
      }
      const bytes = new Uint8Array(await req.arrayBuffer());
      const expectedHash = (req.headers.get("x-video-sha256") ?? "").toLowerCase();
      if (bytes.length < 1024 || bytes.length > 104857600 || !/^[a-f0-9]{64}$/.test(expectedHash)) {
        return reply(400, { error: "invalid_upload_metadata" });
      }
      const actualHash = await sha256(bytes);
      if (actualHash !== expectedHash) return reply(409, { error: "upload_sha256_mismatch" });
      // Verify ISO BMFF/MP4 ftyp marker before accepting bytes.
      const marker = new TextDecoder().decode(bytes.slice(4, 8));
      if (marker !== "ftyp") return reply(415, { error: "invalid_mp4_container" });
      const path = `${articleId}/${jobId}-${crypto.randomUUID()}.mp4`;
      const { error: uploadError } = await supabase.storage.from("reels").upload(path, bytes, {
        contentType: "video/mp4",
        cacheControl: "3600",
        upsert: false,
      });
      if (uploadError) return reply(502, { error: "storage_upload_failed", detail: uploadError.message });
      return reply(200, { uploaded: true, bucket: "reels", path, size_bytes: bytes.length, sha256: actualHash });
    }

    if (action === "authorize") {
      const path = `${articleId}/${jobId}-${crypto.randomUUID()}.mp4`;
      const { data, error } = await supabase.storage.from("reels").createSignedUploadUrl(path, { upsert: false });
      if (error || !data) return reply(502, { error: "signed_upload_creation_failed" });
      return reply(200, { bucket: "reels", path, token: data.token, signed_url: data.signedUrl });
    }

    if (action === "finalize") {
      const path = String(body.path ?? "");
      const expectedHash = String(body.sha256 ?? "").toLowerCase();
      const expectedSize = Number(body.size_bytes);
      const durationSec = Number(body.duration_sec);
      if (!path.startsWith(`${articleId}/${jobId}-`) || !path.endsWith(".mp4") ||
          !/^[a-f0-9]{64}$/.test(expectedHash) ||
          !Number.isSafeInteger(expectedSize) || expectedSize < 1024 || expectedSize > 104857600 ||
          !Number.isFinite(durationSec) || durationSec < 1 || durationSec > 3600) {
        return reply(400, { error: "invalid_asset_metadata" });
      }

      const { data: file, error: downloadError } = await supabase.storage.from("reels").download(path);
      if (downloadError || !file) return reply(404, { error: "uploaded_object_not_found" });
      if (file.size !== expectedSize || file.size > 104857600) return reply(409, { error: "uploaded_size_mismatch" });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const actualHash = await sha256(bytes);
      if (actualHash !== expectedHash) return reply(409, { error: "sha256_mismatch" });

      const { data: signed, error: signedError } = await supabase.storage.from("reels").createSignedUrl(path, 86400);
      if (signedError || !signed?.signedUrl) return reply(502, { error: "signed_read_url_failed" });

      let videoId = job.video_id as string | null;
      if (!videoId) {
        const { data: video, error: videoError } = await supabase.from("videos").insert({
          title_bn: article.title_bn,
          title_en: article.title_en ?? "",
          description_bn: article.content_bn ?? "",
          category_key: article.category ?? "national",
          thumbnail_url: article.thumbnail_url ?? "",
          video_url: signed.signedUrl,
          source_url: article.source_url ?? null,
          duration_sec: Math.round(durationSec),
          status: "draft",
        }).select("id").single();
        if (videoError || !video) return reply(500, { error: "video_record_create_failed", detail: videoError?.message });
        videoId = video.id;
      }

      const { data: asset, error: assetError } = await supabase.from("video_generation_assets").insert({
        job_id: jobId,
        kind: "render",
        provider: "supabase_storage",
        external_id: path,
        url: signed.signedUrl,
        license: "original_or_cleared",
        metadata: {
          bucket: "reels", path, sha256: actualHash, size_bytes: file.size,
          duration_sec: durationSec, mime_type: "video/mp4", verified_at: new Date().toISOString(),
        },
      }).select("id,job_id,kind,provider,external_id,metadata").single();
      if (assetError || !asset) return reply(500, { error: "asset_record_insert_failed", detail: assetError?.message });

      const { error: updateError } = await supabase.from("video_generation_jobs")
        .update({ video_id: videoId, render_path: path, status: "needs_review", updated_at: new Date().toISOString() })
        .eq("id", jobId);
      if (updateError) return reply(500, { error: "job_asset_link_failed", asset_id: asset.id });
      return reply(200, {
        verified: true, quality_gate: "storage_integrity", review_status: "needs_review",
        video_id: videoId, asset_id: asset.id, bucket: "reels", path,
        size_bytes: file.size, duration_sec: durationSec, sha256: actualHash,
      });
    }

    return reply(400, { error: "unsupported_action" });
  } catch (error) {
    return reply(400, { error: "invalid_request", detail: error instanceof Error ? error.message : "unknown" });
  }
});
