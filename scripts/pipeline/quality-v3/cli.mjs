import fs from 'node:fs';
import {fingerprint,compareFingerprint,measureLoudness,probe} from './media-qc.mjs';
import {assertReview} from './review-contract.mjs';
import {metrics} from './metrics.mjs';
import {preview} from './preview.mjs';
const [mode,input,output]=process.argv.slice(2),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
try{
  if(mode==='review'){assertReview(read(input));console.log('Review contract valid. No publication authorized.');}
  else if(mode==='fingerprint')console.log(JSON.stringify(fingerprint(input),null,2));
  else if(mode==='compare')console.log(JSON.stringify(compareFingerprint(read(input),read(output)),null,2));
  else if(mode==='qc')console.log(JSON.stringify({...probe(input),...measureLoudness(input)},null,2));
  else if(mode==='metrics'){const m=metrics(read(input));console.log(m.prometheus);console.error(JSON.stringify({alerts:m.alerts}));if(m.alerts.length)process.exitCode=2;}
  else if(mode==='preview'){if(!output)throw Error('Output required');fs.writeFileSync(output,preview(read(input)),{flag:'wx',mode:0o600});console.log('Local read-only preview created. No approval or upload.');}
  else throw Error('Mode invalid');
}catch{console.error('Operation failed; inspect input and documented contract locally. No credentials or raw errors logged.');process.exitCode=1;}
