// AES-256-GCM envelope for CI recovery assets. Never upload plaintext claim/session files.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
const root=fileURLToPath(new URL('../../',import.meta.url));
const magic=Buffer.from('BVAIENC1');
function key(){const encoded=process.env.VIDEO_RECOVERY_KEY || '';const bytes=Buffer.from(encoded,'base64');if(bytes.length!==32 || bytes.toString('base64')!==encoded)throw new Error('VIDEO_RECOVERY_KEY must be a canonical base64-encoded random 32-byte key');return bytes;}
try {
  if(process.argv.includes('--check-key')){key();console.log('Encrypted recovery key configured.');}
  else if(process.argv[2]==='--decrypt') {
    const input=process.argv[3],output=process.argv[4];
    if(!input || !output || fs.existsSync(output))throw new Error('Provide encrypted input and a NEW output .tar.gz path');
    const fd=fs.openSync(input,'r'),size=fs.statSync(input).size;
    const header=Buffer.alloc(20),tag=Buffer.alloc(16);fs.readSync(fd,header,0,20,0);fs.readSync(fd,tag,0,16,size-16);fs.closeSync(fd);
    if(size<37 || !header.subarray(0,8).equals(magic))throw new Error('Invalid recovery envelope');
    const decipher=createDecipheriv('aes-256-gcm',key(),header.subarray(8));decipher.setAuthTag(tag);
    try{await pipeline(fs.createReadStream(input,{start:20,end:size-17}),decipher,fs.createWriteStream(output,{flags:'wx',mode:0o600}));}
    catch(error){fs.rmSync(output,{force:true});throw error;}
    console.log('Authenticated recovery archive decrypted. Extract only into an inspected recovery directory.');
  } else {
    const tmp=path.join(root,'temp_assets');
    if(!fs.existsSync(path.join(tmp,'claim.json')) && !fs.existsSync(path.join(tmp,'manifest.json'))){console.log('No unfinished claim/manifest; no recovery artifact needed.');}
    else {
      const secret=key(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);
      const output=path.join(root,'recovery.bvai.enc');
      const out=fs.createWriteStream(output,{mode:0o600});out.write(Buffer.concat([magic,iv]));
      const tar=spawn('tar',['-czf','-','temp_assets'],{cwd:root,stdio:['ignore','pipe','ignore']});
      const done=new Promise((resolve,reject)=>{tar.on('error',reject);tar.on('close',code=>code===0?resolve():reject(new Error('Recovery archive failed')));});
      try{await Promise.all([pipeline(tar.stdout,cipher,out),done]);fs.appendFileSync(output,cipher.getAuthTag());}
      catch(error){fs.rmSync(output,{force:true});throw error;}
      console.log('Encrypted recovery artifact ready; no plaintext claim or upload-session credentials exported.');
    }
  }
} catch(error){console.error('Recovery operation failed:',error.message);process.exitCode=1;}
