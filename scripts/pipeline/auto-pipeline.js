// Unified portable entry point. Configure VIDEO_PUBLISH_MODE explicitly in environment.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);
const i=args.indexOf('--article');
if(i>=0){if(!/^[a-f0-9-]{36}$/i.test(args[i+1] || ''))throw new Error('Invalid article UUID');process.env.ARTICLE_ID=args[i+1];}
if(args.includes('--public'))throw new Error('Use VIDEO_PUBLISH_MODE=distribute and explicit target accounts; legacy --public is retired');
try{execFileSync('bash',[fileURLToPath(new URL('../../run-bvai.sh',import.meta.url))],{stdio:'inherit',env:process.env});}catch{process.exitCode=1;}
