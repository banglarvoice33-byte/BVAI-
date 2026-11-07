import { indexNowKey } from '../../../../lib/indexnow';

export const dynamic = 'force-dynamic';

export async function GET() {
  const key = indexNowKey();
  if (!key) return new Response('not configured', { status: 404 });
  return new Response(`${key}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
