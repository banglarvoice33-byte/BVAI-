import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-video-job-id, x-video-article-id, x-video-sha256, x-video-claim-token",
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

  const expected = Deno.env.get("VIDEO_UPLOAD_TOKEN") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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
    const claimToken = String(req.headers.get("x-video-claim-token") ?? "");
    const articleId = String(req.headers.get("x-video-article-id") ?? body.article_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(jobId) || !/^[0-9a-f-]{36}$/i.test(articleId) || !/^[0-9a-f-]{36}$/i.test(claimToken)) {
      return reply(400, { error: "invalid_job_or_article_id" });
    }

    const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: job, error: jobError } = await supabase.from("video_generation_jobs")
      .select("id,article_id,video_id,status,claim_token").eq("id", jobId).eq("article_id", articleId).maybeSingle();
    if (jobError || !job) return reply(404, { error: "generation_job_not_found" });
    if (!job.claim_token || !safeEqual(String(job.claim_token), claimToken)) return reply(401, { error: "invalid_job_claim" });
    if (action === "upload" && job.status !== "processing") return reply(409, { error: "job_not_processing" });
    if (action === "finalize" && !["processing", "needs_review"].includes(job.status)) return reply(409, { error: "job_not_finalizable" });

    const { data: article, error: articleError } = await supabase.from("articles")
      .select("id,status,title_bn,title_en,content_bn,category,thumbnail_url")
      .eq("id", articleId).maybeSingle();
    if (articleError || !article || article.status !== "published") {
      return reply(403, { error: "article_not_published" });
    }

    if (action === "cleanup") {
      if (job.status !== "processing") return reply(409, { error: "job_not_cleanup_eligible" });
      const path = String(body.path ?? "");
      if (!path.startsWith(`${articleId}/${jobId}-`) || !path.endsWith(".mp4")) {
        return reply(400, { error: "invalid_cleanup_path" });
      }
      const { error: removeError } = await supabase.storage.from("reels").remove([path]);
      if (removeError) return reply(502, { error: "orphan_cleanup_failed" });
      return reply(200, { cleaned: true, bucket: "reels", path });
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

      const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_video_generation_job", {
        p_job_id: jobId,
        p_article_id: articleId,
        p_claim_token: claimToken,
        p_path: path,
        p_signed_url: signed.signedUrl,
        p_duration_sec: Math.round(durationSec),
        p_sha256: actualHash,
        p_size_bytes: file.size,
      });
      if (finalizeError || !Array.isArray(finalized) || !finalized[0]) {
        return reply(500, { error: "atomic_finalization_failed", detail: finalizeError?.message ?? "No finalization result" });
      }
      const result = finalized[0];
      return reply(200, {
        verified: true, quality_gate: "storage_integrity", review_status: result.job_status,
        video_id: result.video_id, asset_id: result.asset_id, bucket: "reels", path,
        size_bytes: file.size, duration_sec: durationSec, sha256: actualHash,
      });
    }

    return reply(400, { error: "unsupported_action" });
  } catch (error) {
    return reply(400, { error: "invalid_request", detail: error instanceof Error ? error.message : "unknown" });
  }
});
