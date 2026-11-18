import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/server/require-admin';
import {VideoPipelineMonitor} from '@/components/admin/video-pipeline-monitor';
export const dynamic='force-dynamic';
export const metadata={title:'ভিডিও পাইপলাইন পর্যবেক্ষণ'};
export default async function VideoPipelinePage(){
 if(!await requireAdmin())redirect('/login?next=/admin/video-pipeline');
 return <main className="mx-auto max-w-5xl space-y-6 px-4 py-8"><h1 className="font-serifbn text-3xl font-bold">ভিডিও পাইপলাইন পর্যবেক্ষণ</h1><p>বিশ্বস্ত সংবাদ উৎস → স্বয়ংক্রিয় কারিগরি পরীক্ষা → প্রকাশ। রিপোর্টারের সংবাদ, ছবি ও ভিডিও → মানব সম্পাদকের অনুমোদন → মান পরীক্ষা → প্রকাশ। ত্রুটিতে সীমিত সংশোধন ও পুনরায় পরীক্ষা হয়; অনুমোদন বা মানের পরীক্ষা এড়িয়ে প্রকাশ হয় না।</p><a href="/admin/video-quality" className="inline-block rounded border border-border px-4 py-2">সম্পাদকীয় ভিডিও অনুমোদন</a><VideoPipelineMonitor /></main>;
}
