// Route only ravirgo.com/flowad* to the Render service.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/flowad') {
      url.pathname = '/flowad/';
      return Response.redirect(url.toString(), 308);
    }
    if (!url.pathname.startsWith('/flowad/')) return fetch(request);

    const target = new URL(url.pathname + url.search, 'https://flowad.onrender.com');
    const upstream = await fetch(new Request(target, request), { redirect: 'manual' });
    const headers = new Headers(upstream.headers);
    const location = headers.get('Location');
    if (location) {
      const destination = new URL(location, target);
      if (destination.origin === target.origin) {
        destination.protocol = url.protocol;
        destination.host = url.host;
        headers.set('Location', destination.toString());
      }
    }
    if (url.pathname.startsWith('/flowad/api/')) headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  },
};
