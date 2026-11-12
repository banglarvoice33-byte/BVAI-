import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
// Import only side-effect-safe runtime entry points. This catches missing exports
// and missing transitive files that `node --check` cannot detect.
const files=['generate-video.js','upload-supabase-video.mjs','source-evidence.mjs','audio-qc.mjs','commons-media.mjs','media-cleanup.mjs','readiness.mjs','delivery-worker.mjs','local-slot.mjs','local-recovery.mjs'];
for(const file of files){if(!fs.existsSync(path.join(root,file)))throw new Error('Missing runtime module: '+file);await import(new URL(file,import.meta.url));}
console.log(`PASS ${files.length} runtime import graphs (no provider calls)`);
