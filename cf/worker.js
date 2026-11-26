import server from '../server.js';
const {handleRequest} = server;
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const req = {url: url.pathname + url.search, method: request.method, headers: {host: url.host, 'x-forwarded-proto': url.protocol.replace(':', ''), 'accept-encoding': ''}};
    for (const [k, v] of request.headers) if (k !== 'accept-encoding') req.headers[k] = v;
    return new Promise(resolve => {
      let status = 200, headers = {}, done = false;
      const res = {
        headersSent: false,
        writeHead(s, h) { status = s; headers = {...headers, ...(h || {})}; this.headersSent = true; return this; },
        setHeader(k, v) { headers[k] = v; },
        end(body) {
          if (done) return; done = true;
          delete headers['Content-Length'];
          const nobody = [204, 304].includes(status) || request.method === 'HEAD';
          resolve(new Response(nobody ? null : body, {status, headers}));
        },
      };
      Promise.resolve(handleRequest(req, res)).catch(e => { console.error(e); if (!done) { done = true; resolve(new Response('error', {status: 500})); } });
    });
  },
};
