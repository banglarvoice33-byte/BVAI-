// Local claim-by-claim review UI for the operator (127.0.0.1 only). Records verdicts/checklist through the service-only
// RPCs record_claim_review / record_review_check and shows media_review_gate. It never publishes: approval stays in
// publish-review.mjs, which refuses unless the gate is ok. Reviewer identity is operator-attested (BVAI_REVIEWER), not
// per-user authenticated — the website admin route remains the authenticated editor path.
import http from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {CHECKLIST,VERDICTS,parseEvidenceLines} from './review-claims.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sha=s=>createHash('sha256').update(s).digest('hex');
const same=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length && timingSafeEqual(x,y);};
const VERDICT_BN={verified:'যাচাইকৃত',disputed:'বিতর্কিত',unverified:'অযাচাইকৃত',needs_primary:'প্রাথমিক সূত্র দরকার'};
const page=(body)=>`<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BVAI review</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:12px}video{width:100%;max-height:60vh;background:#000}textarea,select,input[type=text]{width:100%;box-sizing:border-box;font:inherit}fieldset{margin:12px 0}.ok{color:#0a7a2f}.bad{color:#b00020}code{word-break:break-all}</style><body>${body}</body></html>`;

export function createReviewApp({db,token,reviewer,bucket='reels',host='127.0.0.1',port=8787}) {
  if(!token || token.length<24)throw new Error('review token too short');
  if(!reviewer || !reviewer.trim())throw new Error('BVAI_REVIEWER is required (name recorded against every verdict)');
  const csrf=sha('csrf:'+token);
  const allowedHosts=new Set([`${host}:${port}`,`localhost:${port}`]);
  const send=(res,status,body,extra={})=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; media-src https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",...extra});res.end(body);};
  const redirect=(res,to,extra={})=>{res.writeHead(303,{Location:to,'Cache-Control':'no-store',...extra});res.end();};
  const readForm=req=>new Promise((resolve,reject)=>{let size=0;const chunks=[];req.on('data',c=>{size+=c.length;if(size>65536){reject(new Error('body_too_large'));req.destroy();}else chunks.push(c);});req.on('end',()=>resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));req.on('error',reject);});
  const authed=req=>{const m=/(?:^|;\s*)bvai_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie||'');return !!m && same(m[1],token);};

  async function jobList() {
    const {data,error}=await db.from('video_generation_jobs').select('id,article_id,status,created_at').in('status',['needs_review','completed']).not('video_id','is',null).order('created_at',{ascending:false}).limit(30);
    if(error)throw new Error('jobs_unavailable');
    const {data:review}=await db.from('video_generation_jobs').select('id,article_id,status,created_at').eq('status','needs_review').order('created_at',{ascending:false}).limit(30);
    const merged=new Map([...(review||[]),...(data||[])].map(j=>[j.id,j]));
    return page(`<h1>রিভিউ কিউ</h1><p>রিভিউয়ার: <b>${esc(reviewer)}</b></p><ul>${[...merged.values()].map(j=>`<li><a href="/job/${esc(j.id)}">${esc(j.id.slice(0,8))}</a> · ${esc(j.status)} · ${esc(j.created_at)}</li>`).join('')||'<li>কোনো জব নেই</li>'}</ul>`);
  }
  async function jobPage(id) {
    const {data:job,error}=await db.from('video_generation_jobs').select('id,article_id,status,render_path').eq('id',id).maybeSingle();
    if(error || !job)return null;
    const {data:claims}=await db.rpc('media_review_claims',{p_job_id:id});
    const {data:gate}=await db.rpc('media_review_gate',{p_job_id:id});
    const {data:reviews}=await db.from('video_claim_reviews').select('claim_key,verdict,evidence,note,reviewer,video_sha256').eq('job_id',id);
    const {data:checks}=await db.from('video_review_checks').select('item,passed,reviewer,video_sha256').eq('job_id',id);
    const {data:article}=await db.from('articles').select('title_bn,source_name,source_url').eq('id',job.article_id).maybeSingle();
    let videoUrl=null;
    if(job.render_path){const s=await db.storage.from(bucket).createSignedUrl(job.render_path,900);videoUrl=s.data?.signedUrl||null;}
    const rev=new Map((reviews||[]).filter(r=>!gate?.video_sha256||r.video_sha256===gate.video_sha256).map(r=>[r.claim_key,r]));
    const chk=new Map((checks||[]).filter(c=>!gate?.video_sha256||c.video_sha256===gate.video_sha256).map(c=>[c.item,c]));
    const blockers=(gate?.blockers||[]).map(b=>`<li class="bad">${esc(b.code)} ${esc(b.item||b.claim_key||'')}</li>`).join('');
    const claimForms=(claims||[]).map(c=>{const r=rev.get(c.claim_key);return `<fieldset><legend>${esc(c.ord)}. ${esc(c.claim_text)}</legend>
<p>${r?`<b class="${r.verdict==='verified'?'ok':'bad'}">${esc(VERDICT_BN[r.verdict]||r.verdict)}</b> — ${esc(r.reviewer)}`:'<b class="bad">রিভিউ হয়নি</b>'}</p>
<form method="post" action="/job/${esc(id)}/claim"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="claim_key" value="${esc(c.claim_key)}">
<select name="verdict">${VERDICTS.map(v=>`<option value="${v}"${r?.verdict===v?' selected':''}>${esc(VERDICT_BN[v])}</option>`).join('')}</select>
<textarea name="evidence" rows="3" placeholder="https://... | primary_document | independent&#10;https://... | news_source | independent">${esc((r?.evidence||[]).map(e=>`${e.url} | ${e.role}${e.independent_confirmed?' | independent':''}`).join('\n'))}</textarea>
<input type="text" name="note" maxlength="2000" placeholder="নোট" value="${esc(r?.note||'')}"><button>সংরক্ষণ</button></form></fieldset>`;}).join('');
    const checkForms=CHECKLIST.map(([k,label])=>{const c=chk.get(k);return `<form method="post" action="/job/${esc(id)}/check"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="item" value="${esc(k)}">
<label>${esc(label)} ${c?`<b class="${c.passed?'ok':'bad'}">${c.passed?'✔':'✘'}</b>`:''}</label> <button name="passed" value="true">পাস</button> <button name="passed" value="false">ফেল</button></form>`;}).join('');
    return page(`<p><a href="/">← কিউ</a></p><h1>${esc(article?.title_bn||id)}</h1><p>সূত্র: ${esc(article?.source_name||'')} <code>${esc(article?.source_url||'')}</code></p>
${videoUrl?`<video controls playsinline src="${esc(videoUrl)}"></video>`:'<p class="bad">ভিডিও সাইন করা যায়নি</p>'}
<h2>অনুমোদন গেট: <span class="${gate?.ok?'ok':'bad'}">${gate?.ok?'পাস':'আটকে আছে'}</span></h2><ul>${blockers}</ul>
<p>পাস হলে টার্মিনালে: <code>node --env-file=.env scripts/pipeline/publish-review.mjs ${esc(id)} --approve-website</code></p>
<h2>দাবি ও প্রমাণ</h2>${claimForms}<h2>চেকলিস্ট (ভিডিও দেখে-শুনে)</h2>${checkForms}`);
  }

  return async function handler(req,res) {
    try {
      if(!allowedHosts.has(String(req.headers.host||'').toLowerCase()))return send(res,421,page('bad host'));
      const url=new URL(req.url,`http://${host}:${port}`);
      if(req.method==='GET' && url.pathname==='/' && url.searchParams.get('token')) {
        if(!same(url.searchParams.get('token'),token))return send(res,403,page('forbidden'));
        return redirect(res,'/',{'Set-Cookie':`bvai_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`});
      }
      if(!authed(req))return send(res,403,page('Open the one-time URL printed in the terminal.'));
      if(req.method==='GET' && url.pathname==='/')return send(res,200,await jobList());
      let m=/^\/job\/([^/]+)$/.exec(url.pathname);
      if(req.method==='GET' && m) {
        if(!UUID.test(m[1]))return send(res,400,page('bad id'));
        const html=await jobPage(m[1]);return html?send(res,200,html):send(res,404,page('not found'));
      }
      m=/^\/job\/([^/]+)\/(claim|check)$/.exec(url.pathname);
      if(req.method==='POST' && m) {
        if(!UUID.test(m[1]))return send(res,400,page('bad id'));
        if(req.headers['content-type']?.split(';')[0]!=='application/x-www-form-urlencoded')return send(res,415,page('unsupported'));
        const form=await readForm(req);
        if(!same(form.get('csrf')||'',csrf))return send(res,403,page('csrf'));
        let error;
        if(m[2]==='claim') {
          const verdict=form.get('verdict');
          if(!VERDICTS.includes(verdict))return send(res,400,page('bad verdict'));
          let evidence;try{evidence=parseEvidenceLines(form.get('evidence'));}catch(e){return send(res,400,page(esc(e.message)+' <a href="">back</a>'));}
          ({error}=await db.rpc('record_claim_review',{p_job_id:m[1],p_claim_key:form.get('claim_key'),p_verdict:verdict,p_evidence:evidence,p_note:form.get('note')||'',p_reviewer:reviewer}));
        } else {
          const item=form.get('item');
          if(!CHECKLIST.some(([k])=>k===item))return send(res,400,page('bad item'));
          ({error}=await db.rpc('record_review_check',{p_job_id:m[1],p_item:item,p_passed:form.get('passed')==='true',p_reviewer:reviewer,p_note:null}));
        }
        if(error)return send(res,409,page(esc(String(error.message).slice(0,200))+' <a href="">back</a>'));
        return redirect(res,`/job/${m[1]}`);
      }
      return send(res,404,page('not found'));
    } catch(e) { return send(res,500,page('server error')); }
  };
}

export async function startReviewServer({db,reviewer=process.env.BVAI_REVIEWER,port=Number(process.env.BVAI_REVIEW_PORT||8787),token=process.env.BVAI_REVIEW_TOKEN||randomBytes(24).toString('base64url')}={}) {
  const handler=createReviewApp({db,token,reviewer,port});
  const server=http.createServer(handler);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,token,url:`http://127.0.0.1:${port}/?token=${token}`};
}

if(process.argv[1] && import.meta.url===new URL(process.argv[1],'file:').href) {
  const {createClient}=await import('@supabase/supabase-js');
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {url}=await startReviewServer({db});
  console.log('Review UI (127.0.0.1 only). Open this one-time URL in the phone browser:\n'+url);
}
