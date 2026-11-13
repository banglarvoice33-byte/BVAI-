import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEditorial, videoGateBasis } from '../source-evidence.mjs';

const now = () => new Date().toISOString();
const bn = 'বাংলা সংবাদে তথ্য যাচাই করা জরুরি। এটি একটি পরীক্ষার সংবাদ এবং সব দাবি যাচাই করার দায়িত্ব সম্পাদকের।';
const trusted = {
  status: 'published', origin: 'aggregated', field_report_id: null, source_id: 'src-1',
  source_name: 'Reuters', source_url: 'https://www.reuters.com/world/x', verification_status: 'auto_verified',
  human_verified: false, is_fallback: false, source_published_at: now(), content_bn: bn, fact_sources: [],
};

test('credited trusted aggregated news passes without a human, with one source domain', () => {
  assert.equal(videoGateBasis(trusted), 'trusted_source');
  assert.doesNotThrow(() => assertEditorial(trusted, 'distribute'));
  assert.doesNotThrow(() => assertEditorial(trusted, 'website'));
});

test('reporter / field-report / manual / original content stays human-gated', () => {
  for (const patch of [{ field_report_id: 'fr-1' }, { origin: 'manual' }, { origin: 'reporter' }, { origin: undefined }]) {
    const a = { ...trusted, ...patch };
    assert.equal(videoGateBasis(a), null);
    assert.throws(() => assertEditorial(a, 'distribute'), /Human verification/);
  }
});

test('approved reporter content passes only with BOTH human_verified and verified, and needs two domains', () => {
  const approved = { ...trusted, origin: 'manual', field_report_id: 'fr-1', human_verified: true, verification_status: 'verified' };
  assert.equal(videoGateBasis(approved), 'editorial');
  assert.throws(() => assertEditorial(approved, 'distribute'), /two source/);
  assert.doesNotThrow(() => assertEditorial({ ...approved, fact_sources: ['https://other.example/story'] }, 'distribute'));
  assert.equal(videoGateBasis({ ...approved, verification_status: 'pending' }), null);
  assert.equal(videoGateBasis({ ...approved, human_verified: false }), null);
});

test('fails closed on incomplete or unsafe trusted-source articles', () => {
  const bad = [
    { source_name: '   ' }, { source_name: null }, { source_url: 'ftp://x' }, { source_url: 'https://a b' },
    { source_id: null }, { verification_status: 'pending' }, { verification_status: 'rejected' },
    { source_published_at: null }, { status: 'pending' },
  ];
  for (const patch of bad) assert.equal(videoGateBasis({ ...trusted, ...patch }), null, JSON.stringify(patch));
  assert.equal(videoGateBasis(null), null);
  assert.equal(videoGateBasis(undefined), null);
});

test('a symbolic/fallback-image article is still eligible (image rights are labelled, not a news-trust problem)', () => {
  assert.equal(videoGateBasis({ ...trusted, is_fallback: true }), 'trusted_source');
});

test('freshness and Bengali content requirements are unchanged', () => {
  assert.throws(() => assertEditorial({ ...trusted, source_published_at: '2020-01-01T00:00:00Z' }, 'distribute'), /stale/);
  assert.throws(() => assertEditorial({ ...trusted, source_published_at: new Date(Date.now() + 3600e3).toISOString() }, 'distribute'), /stale/);
  assert.throws(() => assertEditorial({ ...trusted, content_bn: 'English only' }, 'distribute'), /Bengali/);
  assert.doesNotThrow(() => assertEditorial({ ...trusted, origin: 'manual' }, 'review')); // review mode never publishes
});
