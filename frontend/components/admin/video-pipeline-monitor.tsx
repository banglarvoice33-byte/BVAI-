'use client';
import {useEffect,useState} from 'react';
type Snapshot={as_of:string;jobs:Record<string,number>;alerts:string[];events:{id:number;event_type:string;created_at:string;job_id:string|null}[];delivery:{status:string;platform:string;created_at:string}[];experiments:{id:string;status:string}[];coverage:{possibly_truncated:boolean}};
export function VideoPipelineMonitor(){
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>;let controller:AbortController;
  async function refresh(){controller=new AbortController();try{const response=await fetch('/api/admin/video-pipeline',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();const next=await response.json();if(active){setData(next);setError('');}}catch{if(active)setError('অবস্থা হালনাগাদ হয়নি; প্রদর্শিত তথ্য পুরোনো হতে পারে।');}finally{if(active)timer=setTimeout(refresh,10000);}}
  void refresh();return()=>{active=false;clearTimeout(timer);controller?.abort();};
 },[]);
 return <section className="space-y-5" aria-live="polite">
  {error&&<p role="alert" className="rounded border border-red-500 p-3">{error}</p>}
  {!data?<p>পাইপলাইনের অবস্থা আসছে…</p>:<>
   <p className="text-sm">শেষ হালনাগাদ: {data.as_of} · প্রতি ১০ সেকেন্ডে হালনাগাদ · গত ২৪ ঘণ্টার কাজ</p>
   {data.coverage.possibly_truncated&&<p>তালিকার সীমা পূর্ণ হয়েছে; সঠিক মোটের জন্য ডেটাবেসে পরীক্ষা করুন।</p>}
   <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(data.jobs).map(([status,count])=><div key={status} className="rounded-xl border border-border p-4"><strong className="text-2xl">{count}</strong><p>{status}</p></div>)}</div>
   <h2 className="text-xl font-bold">সতর্কতা</h2>{data.alerts.length?data.alerts.map(a=><p key={a} className="rounded border border-amber-500 p-3">{a}</p>):<p>এই পরীক্ষায় সতর্কতা নেই; এটি সামগ্রিক মানের সার্টিফিকেট নয়।</p>}
   <h2 className="text-xl font-bold">বিতরণ কিউ</h2><div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>প্ল্যাটফর্ম</th><th>অবস্থা</th><th>কিউয়ের সময়</th></tr></thead><tbody>{data.delivery.map((d,i)=><tr key={i}><td>{d.platform}</td><td>{d.status}</td><td>{d.created_at}</td></tr>)}</tbody></table></div>
   <h2 className="text-xl font-bold">সাম্প্রতিক কার্যক্রম</h2>{data.events.map(e=><p key={e.id} className="break-all border-b border-border py-2 text-sm">{e.created_at} · {e.event_type} · {e.job_id||'সম্পাদকীয় কাজ'}</p>)}
   <h2 className="text-xl font-bold">উপস্থাপনার A/B পরীক্ষা</h2>{data.experiments.length?data.experiments.map(e=><p key={e.id}>{e.id} · {e.status}</p>):<p>কোনো পরীক্ষা চালু নেই। সম্পাদকীয় অনুমতি ছাড়া স্বয়ংক্রিয় পরীক্ষা চালু হয় না।</p>}
  </>}
 </section>;
}
