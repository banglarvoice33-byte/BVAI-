import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
try{execFileSync('bash',[fileURLToPath(new URL('../../run-bvai.sh',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,BVAI_ENV_LOADED:'1'}});}catch(error){process.exitCode=error.status || 1;}
