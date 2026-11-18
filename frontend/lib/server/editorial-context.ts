// Authenticated editorial context for browser cookie sessions AND native Admin/Studio JWTs.
// A body-supplied UID, role, secret key or 'human_verified' flag is never trusted.
import {createClient} from '@supabase/supabase-js';
import {requireAdmin} from './require-admin';
import {createClient as browserSession} from '@/lib/supabase/server';
export class EditorialAuthError extends Error {
 constructor(public readonly status:number,code:string){super(code);}
}
export async function editorialContext(request:Request,{mutation=true}={}){
 const origin=request.headers.get('origin');
 if(mutation && origin && origin!==new URL(request.url).origin)throw new EditorialAuthError(403,'same_origin_required');
 const authorization=request.headers.get('authorization');
 if(authorization){
  const match=/^Bearer ([^\s]{1,8192})$/.exec(authorization);
  if(!match)throw new EditorialAuthError(401,'invalid_editorial_token');
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)throw new EditorialAuthError(503,'editorial_auth_unconfigured');
  const session=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}});
  const {data,error}=await session.auth.getUser(match[1]);
  if(error||!data.user)throw new EditorialAuthError(401,'authenticated_editor_required');
  const {data:profile,error:profileError}=await session.from('profiles').select('role').eq('id',data.user.id).maybeSingle();
  if(profileError||!profile||!['desk_editor','chief_editor','admin'].includes(profile.role))throw new EditorialAuthError(403,'authenticated_editor_required');
  return {actor:{id:data.user.id,email:data.user.email||'',role:profile.role},session};
 }
 // CSRF defense applies to ambient cookie auth; no-Origin is accepted ONLY for a verified bearer.
 if(mutation && origin!==new URL(request.url).origin)throw new EditorialAuthError(403,'same_origin_required');
 const actor=await requireAdmin();
 if(!actor)throw new EditorialAuthError(403,'authenticated_editor_required');
 return {actor,session:await browserSession()};
}
