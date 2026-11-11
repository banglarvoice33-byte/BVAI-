import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(process.argv[2] || '.');
const apply=process.argv.includes('--apply');
if(source===target)throw new Error('Target must be the REAL existing Git clone, not the extracted update');
const gitRoot=execFileSync('git',['-C',target,'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
if(fs.realpathSync(gitRoot)!==fs.realpathSync(target))throw new Error('Target must be the repository root');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'UPDATE_FILE_MANIFEST.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const todo=[],conflicts=[];
for(const item of manifest.files) {
 const relative=item.path;
 if(path.isAbsolute(relative) || relative.split('/').some(p=>p==='..'||p==='.git') || /(^|\/)\.env(?!\.video\.example$)/.test(relative))throw new Error('Unsafe patch path');
 const src=path.join(source,relative),dest=path.join(target,relative);
 if(hash(fs.readFileSync(src))!==item.sha256)throw new Error('Update checksum mismatch: '+relative);
 if(fs.existsSync(dest) && fs.lstatSync(dest).isSymbolicLink())throw new Error('Refusing symlink destination: '+relative);
 const current=fs.existsSync(dest)?hash(fs.readFileSync(dest)):null;
 if(current===item.sha256)continue;
 if(current!==item.previous_sha256){conflicts.push(relative);continue;}
 // A symlinked parent must never redirect the write outside the clone.
 let parent=path.dirname(dest);while(!fs.existsSync(parent))parent=path.dirname(parent);
 if(!fs.realpathSync(parent).startsWith(fs.realpathSync(target)+path.sep) && fs.realpathSync(parent)!==fs.realpathSync(target))throw new Error('Patch parent escapes clone');
 todo.push({relative,src,dest});
}
if(conflicts.length){console.error('STOP: source differs from uploaded baseline. Merge these files manually; nothing changed:\n'+conflicts.join('\n'));process.exit(2);}
console.log(`${todo.length} verified changes; mode=${apply?'apply':'dry-run'}`);
if(apply) {
 const backup=path.join(target,'.local-backups',`reviewed-${Date.now()}`);
 for(const item of todo) {
  if(fs.existsSync(item.dest)){const old=path.join(backup,item.relative);fs.mkdirSync(path.dirname(old),{recursive:true});fs.copyFileSync(item.dest,old);}
  fs.mkdirSync(path.dirname(item.dest),{recursive:true});fs.copyFileSync(item.src,item.dest);
 }
 console.log('Copied reviewed changes with local backups. No git add/commit/push, cloud deployment, secret copying or automation activation was performed.');
}else console.log('No files changed. Re-run with --apply only after review.');
