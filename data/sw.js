/* سَنا — عامل خدمة (Service Worker) للتسريع والعمل دون اتصال.
   القواعد الملزمة لهذا الملف:
   1) كاش سَنا لا يتدخل في أي مصدر (origin) غير مصدر الموقع نفسه.
   2) لا يخزّن مسارات /api/ ولا مقاطع الصوت (Range) ولا طلبات غير GET.
   3) صفحات HTML تُجلب من الشبكة أولًا، والمخزّن نسخة احتياطية للانقطاع فقط.
   4) هذا الملف نقيٌّ من أي كود خارجي. مقطع Monetag (بإذن المالك) يُضاف
      إلى الرد من الخادم فقط حين يكون data/ads.json ← monetag.enabled = true،
      محصورًا في نطاقٍ واحد ومحميًّا بـ try/catch. إيقافه بزر واحد. */
const VERSION = 'sana-v1';
const SHELL_CACHE = VERSION + '-shell';
const PAGE_CACHE = VERSION + '-pages';
const MEDIA_CACHE = VERSION + '-media';
const SHELL_FILES = [
  '/style.css',
  '/app.js',
  '/favicon.svg',
  '/fonts/plex-400-arabic.woff2',
  '/fonts/plex-600-arabic.woff2',
  '/fonts/plex-700-arabic.woff2',
  '/fonts/quran-arabic.woff2'
];

const OFFLINE_HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>لا يوجد اتصال — سَنا</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ee;color:#153c32;font-family:system-ui,"Segoe UI",Tahoma,sans-serif;text-align:center;padding:24px}
main{max-width:420px}h1{font-size:22px;margin:0 0 10px}p{line-height:1.9;color:#4a5d57;margin:0 0 22px}
a{display:inline-block;background:#153c32;color:#f6f4ee;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600}</style></head>
<body><main><h1>لا يوجد اتصال بالإنترنت</h1><p>الصفحات التي زرتها سابقًا محفوظة على جهازك ويمكنك العودة إليها، وسيُستأنف العمل تلقائيًّا عند عودة الاتصال.</p><a href="/">العودة إلى الرئيسية</a></main></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_FILES.map((file) =>
      cache.add(new Request(file, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGE_CACHE));
    return;
  }
  if (/\.(css|js|woff2|svg)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }
  if (/\.(webp|png|jpg|jpeg)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, MEDIA_CACHE));
  }
});
