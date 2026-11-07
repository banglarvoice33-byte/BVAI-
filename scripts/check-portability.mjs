import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), failures=[];
const skip=new Set(['node_modules','.next','.git','build','dist','.dart_tool']);
async function visit(dir){for(const e of await readdir(dir,{withFileTypes:true})){
 if(skip.has(e.name)) continue;
 const f=path.join(dir,e.name),relative=path.relative(root,f);
 if(e.isDirectory()){if(['.vercel','.wrangler','.temp'].includes(e.name)) failures.push(relative+': deployment state');else await visit(f);continue;}
 if (/^\.env(?:\..+)?$/.test(e.name) && !e.name.endsWith('.example')) failures.push(relative+': private env file');
 if(/\.(jks|keystore|p12|pem)$/.test(e.name)) failures.push(relative+': private signing material');
 if(!/\.(ts|tsx|js|mjs|json|md|toml|sql|yml|yaml|dart|html|sh|py|example)$/.test(e.name)) continue;
 const text=await readFile(f,'utf8');
 if(/https?:\/\/[a-z]{20}\.supabase\.co/.test(text)) failures.push(relative+': hardcoded project hostname');
 if(/\b(?:prj|dpl|org)_[A-Za-z0-9]{15,}\b/.test(text)) failures.push(relative+': deployment identifier');
 for(const token of text.match(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g)||[]) {
  try { const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url')); if(payload.ref || payload.role==='service_role') failures.push(relative+': embedded project JWT'); } catch{}
 }
}}
await visit(root);
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Portability checks passed: no embedded project host, platform IDs, project JWTs or deployment state detected. This is not a complete secret scanner.');
