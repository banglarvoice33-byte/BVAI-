import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { cleanHeadline, uniqueHeadlines, AUTOMATION_DISCLOSURE } from '../lib/headline-quality';

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
describe('reader-first presentation safety', () => {
  it('normalizes spacing without rewriting names, conjuncts or factual numbers', () => {
    expect(cleanHeadline('  ঢাকায়\n\t২৫টি বাস চলাচল শুরু  ')).toBe('ঢাকায় ২৫টি বাস চলাচল শুরু');
    expect(cleanHeadline('যুক্তরাষ্ট্রের অর্থনীতি')).toBe('যুক্তরাষ্ট্রের অর্থনীতি');
  });
  it('rejects markup, URLs, broken glyphs, bidi spoofing and overlong copy', () => {
    for (const value of ['<b>খবর</b>', 'https://example.test', 'ভ\uFFFDল', 'সংবাদ\u202E', 'ক'.repeat(241), '', null, 'নমুনা: সংবাদ']) expect(cleanHeadline(value)).toBeNull();
  });
  it('deduplicates normalized headlines', () => {
    expect(uniqueHeadlines(['সংবাদ এক', ' সংবাদ  এক ', 'সংবাদ দুই'])).toEqual(['সংবাদ এক', 'সংবাদ দুই']);
  });
  it('discloses AI use without asserting measured 24/7 uptime', () => {
    expect(AUTOMATION_DISCLOSURE.bn).toContain('এআই');
    expect(AUTOMATION_DISCLOSURE.bn).not.toMatch(/১০০%|২৪\/৭|নিরবচ্ছিন্ন/);
  });
  it('has persistent pause and all headlines available to assistive technology', () => {
    const code = read('../components/breaking-marquee.tsx');
    expect(code).toContain('aria-pressed={paused}'); expect(code).toContain("loopTexts.join(' • ')");
    expect(code).toContain('setInterval'); expect(code).toContain('clearInterval(poll)');
    expect(code).toContain(".gte('published_at'");
  });
  it('moves lead news above promotions and defaults off 3D and demo output', () => {
    const code = read('../app/page.tsx');
    expect(code.indexOf('<HeroBentoGrid')).toBeLessThan(code.indexOf('দৈনিক ই-পেপার পড়ুন'));
    expect(code.indexOf('<LatestGrid')).toBeLessThan(code.indexOf('দৈনিক ই-পেপার পড়ুন'));
    expect(code).toContain("process.env.BVAI_DEMO_MODE === 'true'");
    expect(code).toContain("cookieStore.get('ff_3d_visuals')?.value === '1'");
    expect(code).not.toContain('<main');
  });
  it('does not call bias-based sorting audience trending or promise numerical neutrality', () => {
    const code = read('../components/hero-bento.tsx');
    expect(code).not.toContain('b.bias_index'); expect(code).not.toContain('{biasBadge(');
    expect(code).toContain('আরও সংবাদ');
  });
  it('publishes an actual AI policy rather than aliasing copyright', () => {
    const code = read('../app/(legal)/ai-policy/page.tsx');
    expect(code).not.toContain("export { default }"); expect(code).toContain('কোনো মডেলকে');
  });
  it('requires server identity, same origin and user-JWT RPC for quality approval', () => {
    const code = read('../app/api/admin/video-quality/route.ts');
    expect(code).toContain('editorialContext(request)');
    const auth=read('../lib/server/editorial-context.ts');expect(auth).toContain('requireAdmin()');expect(auth).toContain("request.headers.get('origin')");
    expect(code).toContain('assertBoundReview('); expect(code).toContain("session.rpc('record_video_quality_review'");
    expect(code).toContain('reviewer_id: actor.id');
  });
});
