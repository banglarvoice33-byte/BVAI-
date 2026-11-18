// Publication policy v2: source trust, human editorial approval and technical QC are separate.
import { createHash } from 'node:crypto';
export const POLICY_VERSION = '2026-11-16.v2';
export const TECHNICAL_CHECKS = Object.freeze(['master','decode','loudness','captions','rights','source_credit','script_binding']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function assertTechnicalReport(report, { videoHash, scriptHash, now = Date.now() }) {
  if (report?.version !== 1 || report.policy_version !== POLICY_VERSION || report.video_sha256 !== videoHash || report.script_sha256 !== scriptHash || !/^[a-f0-9]{64}$/.test(videoHash || '') || !/^[a-f0-9]{64}$/.test(scriptHash || '')) throw new Error('technical_report_binding_required');
  const when = Date.parse(report.inspected_at);
  if (!Number.isFinite(when) || when > now + 60000 || now - when > 86400000) throw new Error('technical_report_stale');
  for (const key of TECHNICAL_CHECKS) if (report.checks?.[key] !== true) throw new Error('technical_check_required:' + key);
  const m=report.measured;
  if(!m || !Number.isFinite(m.integrated_lufs) || m.integrated_lufs < -16 || m.integrated_lufs > -12 || !Number.isFinite(m.true_peak_dbtp) || m.true_peak_dbtp > -1 || !Number.isFinite(m.duration_sec) || m.duration_sec < 40 || m.duration_sec > 120)throw new Error('technical_measurements_invalid');
  return true;
}
export function assertPublicationPolicy({ basis, manifest, videoHash, approval, now = Date.now() }) {
  if (!['trusted_source','editorial'].includes(basis)) throw new Error('editorial_authorization_required');
  assertTechnicalReport(manifest?.technical_qc, {videoHash, scriptHash: manifest?.spoken_script_hash, now});
  if (basis === 'trusted_source') return { route: 'trusted_source_auto', human_required: false, policy_version: POLICY_VERSION };
  if (!approval || approval.video_sha256 !== videoHash || approval.script_sha256 !== manifest.spoken_script_hash || !(Date.parse(approval.expires_at) > now)) throw new Error('fresh_asset_bound_human_approval_required');
  return { route: 'reporter_editor_approved', human_required: true, policy_version: POLICY_VERSION };
}
export function technicalReport(manifest, inspected, {now = Date.now()} = {}) {
  const spoken = manifest.production_plan?.spoken_script;
  if (typeof spoken !== 'string' || sha256(spoken) !== manifest.spoken_script_hash) throw new Error('spoken_script_binding_invalid');
  let u; try { u = new URL(manifest.source?.url); } catch { throw new Error('source_credit_missing'); }
  if (!['https:','http:'].includes(u.protocol) || u.username || u.password || !manifest.source?.name?.trim()) throw new Error('source_credit_missing');
  for (const m of manifest.media || []) {
    if (!m.author?.trim() || !m.license?.trim() || !/^https:\/\//.test(m.source_url || '') || !/^https:\/\//.test(m.license_url || '') || !/^[a-f0-9]{64}$/.test(m.sha256 || '')) throw new Error('media_rights_metadata_missing');
  }
  return { version: 1, policy_version: POLICY_VERSION, video_sha256: inspected.hash, script_sha256: manifest.spoken_script_hash,
    inspected_at: new Date(now).toISOString(), checks: Object.fromEntries(TECHNICAL_CHECKS.map(k => [k,true])),
    measured: { duration_sec: inspected.duration, size_bytes: inspected.size, integrated_lufs: Number(inspected.loudness.input_i), true_peak_dbtp: Number(inspected.loudness.input_tp) },
    scope: 'Technical tests and rights metadata only; not independent fact verification, rights adjudication or human perceptual certification.' };
}
