import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const required = ["SUPABASE_URL", "VIDEO_UPLOAD_TOKEN", "VIDEO_JOB_ID", "VIDEO_CLAIM_TOKEN", "ARTICLE_ID", "VIDEO_FILE"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);

const base = process.env.SUPABASE_URL.replace(/\/$/, "");
const auth = `Bearer ${process.env.VIDEO_UPLOAD_TOKEN}`;
const file = process.env.VIDEO_FILE;
const jobId = process.env.VIDEO_JOB_ID;
const articleId = process.env.ARTICLE_ID;
const size = statSync(file).size;
if (!file.toLowerCase().endsWith(".mp4") || size < 1 || size > 100 * 1024 * 1024) {
  throw new Error("MP4 must be non-empty and no larger than the reels bucket 100 MiB limit");
}

const sha = createHash("sha256");
for await (const chunk of createReadStream(file)) sha.update(chunk);
const sha256 = sha.digest("hex");

async function endpoint(body) {
  const response = await fetch(`${base}/functions/v1/video-upload-authorize`, {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json", "x-video-claim-token": process.env.VIDEO_CLAIM_TOKEN },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Upload endpoint failed (${response.status}): ${result.error ?? "unknown"}`);
  return result;
}

const durationSec = Number(execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration",
  "-of", "default=noprint_wrappers=1:nokey=1", file,
], { encoding: "utf8" }).trim());
if (!Number.isFinite(durationSec) || durationSec < 1) throw new Error("Unable to read MP4 duration");

const uploadResponse = await fetch(`${base}/functions/v1/video-upload-authorize?action=upload`, {
  method: "POST",
  headers: {
    authorization: auth,
    "content-type": "video/mp4",
    "x-video-job-id": jobId,
    "x-video-article-id": articleId,
    "x-video-sha256": sha256,
    "x-video-claim-token": process.env.VIDEO_CLAIM_TOKEN,
  },
  body: createReadStream(file),
  duplex: "half",
});
const uploaded = await uploadResponse.json().catch(() => ({}));
if (!uploadResponse.ok || !uploaded.uploaded || uploaded.sha256 !== sha256) {
  throw new Error(`Server-side Storage upload failed (${uploadResponse.status}): ${uploaded.error ?? "unknown"}`);
}

const finalizePayload = {
  action: "finalize",
  job_id: jobId,
  article_id: articleId,
  path: uploaded.path,
  size_bytes: size,
  duration_sec: durationSec,
  sha256,
};

// Finalization is idempotent. Retry once to handle a lost HTTP response after
// the database transaction committed; only then attempt claim-guarded cleanup.
let verified;
try {
  verified = await endpoint(finalizePayload);
} catch (firstError) {
  try {
    verified = await endpoint(finalizePayload);
  } catch (retryError) {
    try {
      await endpoint({
        action: "cleanup",
        job_id: jobId,
        article_id: articleId,
        path: uploaded.path,
      });
      console.error("Unfinalized Storage object cleaned up after finalization failure.");
    } catch {
      console.error("Storage cleanup was not confirmed; inspect this job's object path in the private reels bucket.");
    }
    throw retryError;
  }
}
console.log(JSON.stringify(verified, null, 2));
if (!verified.verified || verified.sha256 !== sha256 || verified.path !== uploaded.path) {
  throw new Error("Storage verification did not pass");
}
