// Claim identity MUST match SQL public.media_claim_key / media_review_claims (cross-checked by tests against PostgreSQL).
import {createHash} from 'node:crypto';
export const normalizeClaim=t=>String(t||'').normalize('NFC').replace(/\s+/g,' ').trim();
export const claimKey=t=>createHash('sha256').update(normalizeClaim(t),'utf8').digest('hex').slice(0,16);
export const VERDICTS=['verified','disputed','unverified','needs_primary'];
export const ROLES=['news_source','primary_document','official_statement'];
export const CHECKLIST=[['names','নাম ও পদবি'],['numbers','সংখ্যা ও পরিমাণ'],['dates','তারিখ ও সময়'],['sources','সোর্স লিংক ও সময়'],['pronunciation','উচ্চারণ (শুনে দেখা)'],['scene_relevance','প্রতিটি দৃশ্য খবরের সঙ্গে প্রাসঙ্গিক'],['captions','ক্যাপশন বানান ও সময়'],['audio_level','অডিও লেভেল ও পিক'],['safe_zone','সেফ জোন (UI-র নিচে/ওপরে লেখা নেই)'],['copyright','কপিরাইট/লাইসেন্স/ক্রেডিট'],['disclosure','প্রতীকী দৃশ্য/AI ডিসক্লোজার']];
// Editor evidence lines: "https://url | role | independent". Independence is the editor's explicit statement, never inferred from distinct domains.
export function parseEvidenceLines(text) {
  const out=[];
  for(const raw of String(text||'').split(/\r?\n/)) {
    const line=raw.trim();if(!line)continue;
    const [url,role='news_source',flag=''] = line.split('|').map(x=>x.trim());
    if(!/^https:\/\/[^/\s]+/.test(url))throw new Error('Evidence URL must start with https://');
    if(!['news_source','primary_document','official_statement'].includes(role))throw new Error('Evidence role must be news_source, primary_document or official_statement');
    out.push({url,role,...(flag==='independent'?{independent_confirmed:true}:{})});
  }
  return out;
}
