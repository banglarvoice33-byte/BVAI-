#!/usr/bin/env node
/**
 * Non-secret readiness check for automated YouTube delivery.
 * Prints what is present / missing. Never prints secret values.
 *
 *   node scripts/pipeline/check-delivery-config.mjs
 */
import { deliveryTargets } from './delivery-worker.mjs';

const present = (k) => Boolean(String(process.env[k] || '').trim());
const report = {
  VIDEO_DELIVERY_ENABLED: process.env.VIDEO_DELIVERY_ENABLED ?? '(unset → true)',
  VIDEO_DELIVERY_PLATFORMS: process.env.VIDEO_DELIVERY_PLATFORMS || '(empty)',
  VIDEO_PUBLISH_MODE: process.env.VIDEO_PUBLISH_MODE || '(unset → auto)',
  YOUTUBE_CHANNEL_ID: present('YOUTUBE_CHANNEL_ID') ? 'set' : 'MISSING',
  YOUTUBE_REFRESH_TOKEN: present('YOUTUBE_REFRESH_TOKEN') ? 'set' : 'MISSING',
  OAUTH_CLIENT_ID: present('OAUTH_CLIENT_ID') ? 'set' : 'MISSING',
  OAUTH_CLIENT_SECRET: present('OAUTH_CLIENT_SECRET') ? 'set' : 'MISSING',
  SUPABASE_URL: present('SUPABASE_URL') ? 'set' : 'MISSING',
  SUPABASE_SERVICE_ROLE_KEY: present('SUPABASE_SERVICE_ROLE_KEY') ? 'set' : 'MISSING',
};

let targets = [];
let targetError = null;
try {
  targets = deliveryTargets();
} catch (e) {
  targetError = String(e.message || e);
}

console.log(JSON.stringify({ env: report, targets, targetError }, null, 2));

const blockers = [];
if (!present('SUPABASE_URL') || !present('SUPABASE_SERVICE_ROLE_KEY')) blockers.push('Supabase server credentials');
if (!String(process.env.VIDEO_DELIVERY_PLATFORMS || '').includes('youtube')) blockers.push('VIDEO_DELIVERY_PLATFORMS must include youtube');
if (!present('YOUTUBE_CHANNEL_ID')) blockers.push('YOUTUBE_CHANNEL_ID');
if (!present('YOUTUBE_REFRESH_TOKEN')) blockers.push('YOUTUBE_REFRESH_TOKEN (GitHub secret or vault)');
if (!present('OAUTH_CLIENT_ID') || !present('OAUTH_CLIENT_SECRET')) blockers.push('OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET');
if (targetError) blockers.push(`deliveryTargets: ${targetError}`);

if (blockers.length) {
  console.error('BLOCKERS:', blockers.join(' | '));
  console.error(`
GitHub → Settings → Secrets and variables:

  Variables (Actions):
    VIDEO_DELIVERY_PLATFORMS = youtube
    YOUTUBE_CHANNEL_ID       = UCxxxxxxxx
    VIDEO_PUBLISH_MODE       = distribute   (or leave empty for auto)
    VIDEO_DELIVERY_ENABLED   = true
    VIDEO_AUTOMATION_PAUSED  = false
    ENABLE_VIDEO_AUTOMATION  = true

  Secrets (Actions):
    YOUTUBE_REFRESH_TOKEN, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

After a successful render with mode=distribute, rows appear in video_delivery_outbox
and workflow "BVAI Durable Video Delivery" will claim them.
`);
  process.exitCode = 2;
} else {
  console.log('OK: delivery config looks sufficient for YouTube enqueue + upload');
}
