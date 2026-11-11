import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
/** Called ONLY after remote checksum and finalize transaction succeed.
 * Retain durable source/hash/license metadata; never delete the render or captions.
 */
export function cleanupDownloadedMedia(manifest,{root}={}) {
  const boundary=fs.realpathSync(root)+path.sep;
  return (manifest.media || []).map(item=>{
    const receipt={sha256:item.sha256,source_url:item.source_url,license:item.license,author:item.author};
    try {
      const file=path.resolve(item.path || '');
      if(!file.startsWith(boundary) || !fs.realpathSync(file).startsWith(boundary))throw new Error('Unsafe cleanup path');
      if(!/^broll-\d+\.(webm|ogv|mp4)$/.test(path.basename(file)))throw new Error('Not a downloaded source clip');
      if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==item.sha256)throw new Error('Cleanup checksum changed');
      fs.unlinkSync(file);
      return {...receipt,deleted_at:new Date().toISOString()};
    } catch(error) {
      return {...receipt,cleanup_error:error.code==='ENOENT'?'already_absent':error.message};
    }
  });
}
