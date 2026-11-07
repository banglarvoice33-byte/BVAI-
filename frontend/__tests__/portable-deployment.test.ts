import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
const read=(p:string)=>readFileSync(resolve(__dirname,'../..',p),'utf8');
describe('portable deployment contracts',()=>{
 it('uses a single active Next configuration',()=>expect(read('frontend/next.config.js')).toContain("output: 'standalone'"));
 it('does not authorize unverified JWT role claims',()=>{const gateway=read('supabase/functions/ai-gateway/index.ts');expect(gateway).not.toContain('payload?.role');expect(gateway).toContain('await isServiceRole(req)');});
 it('collector checks the configured service credential',()=>expect(read('supabase/functions/news-pipeline/index.ts')).toContain('await verifyServiceCredential(req, SERVICE_ROLE)'));
 it('applies atomic gateway request reservation',()=>{expect(read('supabase/functions/ai-gateway/index.ts')).toContain('reserve_ai_gateway_request');expect(read('supabase/migrations/20261107010000_gateway_atomic_daily_budget.sql')).toContain('on conflict (task, day_utc) do update');});
 it('does not enable Vercel cron by default',()=>expect(JSON.parse(read('frontend/vercel.json')).crons).toEqual([]));
});
