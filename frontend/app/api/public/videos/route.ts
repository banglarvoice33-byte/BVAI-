import { NextResponse } from 'next/server';
import { readPublishedVideos } from '../../../../lib/supabase/published-videos';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const articleId = url.searchParams.get('article_id');
    if (articleId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(articleId)) {
      return NextResponse.json({error:'invalid_article_id'}, {status:400});
    }
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '20',10) || 20,1),50);
    const items = await readPublishedVideos(articleId,limit);
    return NextResponse.json(articleId ? {video:items[0] || null} : {videos:items,total:items.length},
      {headers:{'Cache-Control':'private, no-store'}});
  } catch {
    return NextResponse.json({videos:[],video:null,total:0,error:'videos_unavailable'},
      {status:503,headers:{'Cache-Control':'no-store'}});
  }
}
