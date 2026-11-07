import {describe,it,expect} from 'vitest';
import {verifyServiceCredential} from '../../supabase/functions/_shared/service-auth';
const req = (token:string)=>new Request('https://edge.test/',{headers:{Authorization:`Bearer ${token}`}});
describe('Edge server credential boundary',()=>{
 it('accepts the exact configured new service key',async()=>expect(await verifyServiceCredential(req('new-server-credential'),'new-server-credential')).toBe(true));
 it('rejects a wrong key',async()=>expect(await verifyServiceCredential(req('wrong-key'),'new-server-credential')).toBe(false));
 it('rejects missing configuration',async()=>expect(await verifyServiceCredential(req('anything'),'')).toBe(false));
 it('rejects a forged JWT claiming service_role',async()=>{
  const forged=[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from('{"role":"service_role"}').toString('base64url'),'forged'].join('.');
  expect(await verifyServiceCredential(req(forged),'new-server-credential')).toBe(false);
 });
});
