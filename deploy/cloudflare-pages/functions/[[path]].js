// Optional gateway: Pages alone is NOT the Next.js server.
export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  if (incoming.pathname === '/_deployment-guide') {
    return context.env.ASSETS.fetch(new URL('/index.html', incoming));
  }
  let origin;
  try {
    origin = new URL(context.env.APP_ORIGIN || '');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.hostname === incoming.hostname || /example|localhost|127\.0\.0\.1/i.test(origin.hostname)) throw 0;
  } catch {
    return new Response('Configure a distinct HTTPS APP_ORIGIN; full Next.js backend required.', {status:503,headers:{'Cache-Control':'no-store'}});
  }
  if (context.request.headers.get('Upgrade')) return new Response('WebSocket upgrade unsupported by this gateway', {status:426});
  const target = new URL(incoming.pathname + incoming.search, origin);
  const headers = new Headers(context.request.headers);
  headers.delete('host');
  headers.delete('x-forwarded-for');
  // Used only as a routing hint. Do not trust these for authentication/rate limits.
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', 'https');
  headers.delete('x-pages-origin-key');
  if (context.env.ORIGIN_SHARED_SECRET) headers.set('x-pages-origin-key', context.env.ORIGIN_SHARED_SECRET);
  try {
    const response = await fetch(target, {
      method:context.request.method, headers,
      body:['GET','HEAD'].includes(context.request.method) ? undefined : context.request.body,
      redirect:'manual',
    });
    const out = new Headers(response.headers);
    const location = out.get('location');
    if (location) {
      const destination = new URL(location, origin);
      if (destination.origin === origin.origin) out.set('location', incoming.origin + destination.pathname + destination.search + destination.hash);
    }
    // Public/CDN caching must be configured separately with authenticated-route exclusions.
    out.set('Cache-Control','private, no-store');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers:out});
  } catch { return new Response('Application origin unavailable',{status:502,headers:{'Cache-Control':'no-store'}}); }
}
