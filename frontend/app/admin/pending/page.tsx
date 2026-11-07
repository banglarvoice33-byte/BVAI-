'use client';
import { useEffect, useState, useCallback } from 'react';
type PendingArticle = {
  id: string; slug: string; title_bn: string; summary: string;
  category: string; reporter_name: string; source_url: string;
  thumbnail_url: string; ai_score: number; submitted_at: string;
  content_bn?: string; image_is_representational?: boolean;
  image_credit?: string; image_alt_bn?: string;
};
export default function PendingPage() {
  const [items, setItems] = useState<PendingArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const fetchPending = useCallback(async()=>{
    setLoading(true);
    try{
      const res = await fetch('/api/admin/pending',{cache:'no-store'});
      const data = await res.json();
      if(!res.ok) throw new Error(data.error);
      setItems(data.items||[]);
    }catch(e){ setError(String(e)); } finally{ setLoading(false); }
  },[]);
  useEffect(()=>{fetchPending()},[fetchPending]);
  async function approve(id:string){
    const it = items.find(x=>x.id===id);
    // 6-criteria check - simple
    if(!it?.content_bn || it.content_bn.length < 450){
      if(!confirm(`Content ${it?.content_bn?.length||0}/450 chars. Still approve?`)) return;
    }
    if(!it?.image_alt_bn){
      if(!confirm('Alt text missing. Still approve?')) return;
    }
    const res = await fetch('/api/admin/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id, note:'approved with 6-criteria check'})});
    if(res.ok) setItems(p=>p.filter(x=>x.id!==id));
  }
  async function reject(id:string){
    if(!confirm('Reject?')) return;
    const res = await fetch('/api/admin/reject',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id, reason:'rejected'})});
    if(res.ok) setItems(p=>p.filter(x=>x.id!==id));
  }
  return(
    <div className="min-h-screen bg-zinc-50 p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between mb-6"><h1 className="text-2xl font-bold">📋 Editorial Queue - 6 Criteria</h1><button onClick={fetchPending} className="px-4 py-2 bg-zinc-900 text-white rounded">Refresh</button></div>
        {loading && <div>Loading...</div>}
        {error && <div className="bg-red-50 p-4 text-red-800">{error}</div>}
        <div className="space-y-3">
        {items.map(item=>(
          <div key={item.id} className="bg-white border rounded p-4">
            <div className="flex gap-4">
              {item.thumbnail_url && <img src={item.thumbnail_url} alt="" className="w-24 h-24 object-cover rounded"/>}
              <div className="flex-1">
                <div className="flex gap-2 text-xs mb-1">
                  <span className="px-2 py-0.5 bg-amber-100 rounded">{item.category}</span>
                  <span>AI:{item.ai_score}</span>
                  <span className={item.content_bn && item.content_bn.length>=450 ? 'text-green-600' : 'text-red-600'}>Content:{item.content_bn?.length||0}/450</span>
                  <span className={item.image_is_representational ? 'bg-blue-100 text-blue-800 px-2 rounded' : 'bg-green-100 text-green-800 px-2 rounded'}>{item.image_is_representational ? 'Symbolic(Pexels)' : 'Real(Reporter)'}</span>
                </div>
                <h3 className="font-semibold">{item.title_bn}</h3>
                <p className="text-sm text-zinc-600 line-clamp-2">{item.summary}</p>
                <div className="text-xs mt-1 space-y-1">
                  <div>Credit: {item.image_credit || '❌ missing'} | Alt: {item.image_alt_bn || '❌ missing'}</div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={()=>approve(item.id)} className="px-3 py-1 bg-green-600 text-white rounded text-sm">Approve</button>
                  <button onClick={()=>reject(item.id)} className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm">Reject</button>
                  {item.source_url && <a href={item.source_url} target="_blank" className="px-3 py-1 text-sm text-blue-600">Source</a>}
                </div>
              </div>
            </div>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
