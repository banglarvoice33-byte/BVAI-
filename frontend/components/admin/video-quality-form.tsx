'use client';
import { useState } from 'react';

const checks = [
 ['names_numbers_dates','নাম, সংখ্যা, তারিখ ও সম্পাদকীয় বক্তব্য পরীক্ষা করেছি'],
 ['pronunciation','উচ্চারণ ও সংবাদপাঠ শুনেছি'],
 ['scene_relevance','প্রতিটি দৃশ্য প্রাসঙ্গিক; প্রতীকী ফুটেজের লেবেল সঠিক'],
 ['caption_spelling','অডিওর সঙ্গে ক্যাপশন ও বানান মিলিয়েছি'],
 ['safe_zones','মোবাইলে শিরোনাম ও ক্যাপশন সম্পূর্ণ দৃশ্যমান'],
 ['rights','ছবি, ভিডিও ও কণ্ঠের ব্যবহারের অধিকার পরীক্ষা করেছি'],
 ['human_perceptual_qc','সম্পূর্ণ ভিডিও দেখে ও শুনে চূড়ান্ত মান অনুমোদন করছি'],
] as const;

export function VideoQualityForm({jobId,videoHash,scriptHash,durationSec}:{jobId:string;videoHash:string;scriptHash:string;durationSec:number}) {
 const [checked,setChecked]=useState<Record<string,boolean>>({});
 const [note,setNote]=useState('');
 const [authorized,setAuthorized]=useState(false);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const ready=checks.every(([key])=>checked[key]) && authorized && note.trim().length>=10;
 async function submit(event:React.FormEvent){
  event.preventDefault();if(!ready||busy)return;
  setBusy(true);setMessage('');
  try {
   const response=await fetch('/api/admin/video-quality',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:jobId,review:{version:2,video_sha256:videoHash,script_sha256:scriptHash,duration_sec:durationSec,editorial_authorized:authorized,editorial_note:note,qc:checked}})});
   if(!response.ok)throw new Error('review_failed');
   setMessage('এই ভিডিও ও স্ক্রিপ্টের সম্পাদকীয় অনুমোদন সংরক্ষিত। অনুমোদন ২৪ ঘণ্টা কার্যকর। প্রকাশ আলাদা নিয়ন্ত্রিত ধাপ।');
  }catch{setMessage('অনুমোদন হয়নি। সেশন, ভূমিকা, ভিডিওর সংস্করণ ও ডেটাবেস মাইগ্রেশন পরীক্ষা করুন।');}
  finally{setBusy(false);}
 }
 return <form onSubmit={submit} className="mt-4 space-y-4">
  <fieldset className="space-y-2"><legend className="font-bold">সম্পূর্ণ ভিডিও দেখে ও শুনে যাচাই</legend>
   {checks.map(([key,label])=><label key={key} className="flex items-start gap-3 text-sm"><input type="checkbox" checked={checked[key]||false} onChange={event=>setChecked(value=>({...value,[key]:event.target.checked}))} className="mt-1 h-5 w-5" />{label}</label>)}
  </fieldset>
  <label className="block text-sm font-bold">সম্পাদকের সিদ্ধান্ত ও প্রয়োজনীয় নির্দেশনা<textarea value={note} onChange={event=>setNote(event.target.value)} minLength={10} maxLength={4000} rows={4} required className="mt-2 w-full rounded border border-border bg-transparent p-3" /></label>
  <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)} className="mt-1 h-5 w-5" />আমি এই নির্দিষ্ট ভিডিও সংস্করণ প্রকাশের জন্য সম্পাদকীয় অনুমোদন দিচ্ছি।</label>
  <p className="text-xs text-neutral-500">রিপোর্টারের নিজস্ব সংবাদে বাইরের তিনটি সংবাদমাধ্যমের সূত্র বাধ্যতামূলক নয়। মানব সম্পাদকের সিদ্ধান্ত অপরিহার্য। পরিচয় ও সময় সার্ভার নির্ধারণ করে; ভিডিও বা স্ক্রিপ্ট বদলালে এই অনুমোদন কার্যকর থাকবে না।</p>
  <button disabled={!ready||busy} type="submit" className="rounded bg-crimson px-4 py-3 text-sm font-bold text-white disabled:opacity-40">{busy?'সংরক্ষণ হচ্ছে…':'এই সংস্করণের অনুমোদন সংরক্ষণ করুন'}</button>
  <p role="status" className="text-sm">{message}</p>
 </form>;
}
