'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  server, articles, validateArticleBatch, getPublishedArticles, articlesPage, articlePage,
  sitemapXml, recentArticleUrls, notifyRecentArticles, validIndexNowKey
} = require('../server');
const ORIGIN = 'https://sana-quran.vercel.app';
const htmlSchema = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

test('الدفعة سبعة مقالات أصلية بصور ومراجع وجدول يومي واضح', () => {
  assert.equal(articles.length, 15);
  assert.equal(new Set(articles.map(a => a.slug)).size, 15);
  assert.equal(new Set(articles.map(a => a.title)).size, 15);
  articles.forEach((a, index) => {
    assert.match(a.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(a.title && a.summary && a.lead && a.imageAlt);
    assert.ok(a.sections.length >= 3 && a.sources.length >= 2 && a.related.length >= 1);
    assert.ok(a.sections.every(s => s.heading && s.paragraphs.length && s.paragraphs.every(Boolean)));
    assert.ok(a.sources.every(s => s.label && new URL(s.url).protocol === 'https:'));
    assert.ok(a.related.every(r => r.label && r.href.startsWith('/') && !r.href.startsWith('//')));
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', a.image)));
    assert.ok(Date.parse(a.publishedAt) <= Date.now(), `${a.slug} must not be future-dated`);
  });
});

test('الفحص الآلي يستبعد أي مقال ناقص قبل إتاحته', () => {
  assert.equal(validateArticleBatch(articles).length, 15);
  const a = articles[0];
  assert.equal(validateArticleBatch([{...a, image:'/articles/missing.webp'}]).length, 0);
  assert.equal(validateArticleBatch([{...a, sources:[a.sources[0]]}]).length, 0);
  assert.equal(validateArticleBatch([{...a, sources:[{label:'bad source',url:'javascript:alert(1)'},a.sources[0]]}]).length, 0);
  assert.equal(validateArticleBatch([{...a, related:[{label:'unsafe',href:'//example.com'}]}]).length, 0);
  assert.equal(validateArticleBatch([{...a, sections:a.sections.map(s => ({...s, paragraphs:['قصير جدًا']}))}]).length, 0);
  assert.equal(validateArticleBatch([a, {...a}]).length, 0);
});

test('الحجب الزمني والخريطة لا يعرضان المقالات المقبلة مبكرًا', () => {
  assert.equal(getPublishedArticles(Date.parse('2026-10-13T23:59:59Z')).length, 0);
  assert.equal(getPublishedArticles(Date.parse('2026-10-14T08:00:00Z')).length, 1);
  assert.equal(getPublishedArticles(Date.parse('2026-10-28T08:00:00Z')).length, 15);
  assert.equal(getPublishedArticles().length, 15);
  const xml = sitemapXml(ORIGIN);
  assert.equal((xml.match(/<loc>/g) || []).length, 131); // 116 fixed pages + 15 articles
  articles.forEach(a => assert.ok(xml.includes(`${ORIGIN}/articles/${a.slug}`)));
  assert.equal((xml.match(/<image:loc>/g) || []).length, 15);
  const index = articlesPage(ORIGIN);
  articles.forEach(a => assert.ok(index.includes(a.slug)));
  assert.equal((index.match(/journal-card-image/g) || []).length, 15);
});

test('المقال يعرض إفصاحًا وروابط وصورة وبيانات منظمة مطابقة', () => {
  const article = articles[0], url = `${ORIGIN}/articles/${article.slug}`;
  const html = articlePage(article, ORIGIN, Date.parse('2026-10-28T20:00:00Z'));
  assert.ok(html.includes('أُعدّ بمساعدة الذكاء الاصطناعي'));
  assert.ok(html.includes('صورة توضيحية مولّدة بالذكاء الاصطناعي'));
  assert.ok(html.includes(`rel="canonical" href="${url}"`));
  assert.ok(html.includes(`content="${ORIGIN}${article.image}"`));
  const schema = htmlSchema(html);
  const node = schema['@graph'].find(item => item['@type'] === 'Article');
  assert.equal(node.headline, article.title);
  assert.equal(node.datePublished, article.publishedAt);
  assert.deepEqual(node.image, [`${ORIGIN}${article.image}`]);
  assert.equal(node.author.name, 'سَنا');
  const breadcrumb = schema['@graph'].find(item => item['@type'] === 'BreadcrumbList');
  assert.equal(breadcrumb.itemListElement.at(-1).item, url);
  assert.ok(article.related.every(r => html.includes(`href="${r.href}"`)));
});

test('IndexNow يرسل المنشور حديثًا فقط ويقف بعد نفاد الدفعة', async () => {
  assert.equal(validIndexNowKey('abcdef0123456789'), true);
  assert.equal(validIndexNowKey('../not-a-key'), false);
  const instant = Date.parse('2026-10-28T12:00:00Z');
  const urls = recentArticleUrls(ORIGIN, instant);
  assert.equal(urls.length, 3); // magazine index + the two most recent articles
  assert.equal(urls[0], `${ORIGIN}/articles`);
  let called = 0;
  const bodies = [];
  const fetchMock = async (url, options) => {
    called++;
    assert.equal(url, 'https://api.indexnow.org/indexnow');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.host, 'sana-quran.vercel.app');
    assert.equal(body.keyLocation, `${ORIGIN}/abcdef0123456789.txt`);
    bodies.push(body);
    return {status:202};
  };
  assert.deepEqual(await notifyRecentArticles(ORIGIN, 'abcdef0123456789', instant, fetchMock), {submitted:3,status:202});
  assert.deepEqual(bodies[0].urlList, urls);
  assert.equal(called, 1);
  const afterWindow = await notifyRecentArticles(ORIGIN, 'abcdef0123456789', Date.parse('2026-11-05T09:30:00Z'), fetchMock);
  assert.deepEqual(afterWindow, {submitted:0,status:null}); // nothing within 48h any more
  assert.equal(called, 1);
  assert.deepEqual(await notifyRecentArticles(ORIGIN, 'abcdef0123456789', Date.parse('2026-11-20T09:30:00Z'), fetchMock), {submitted:0,status:null});
  assert.equal(called, 1);
  await assert.rejects(notifyRecentArticles(ORIGIN, 'bad', instant, fetchMock));
});

test('الصفحات والصور وملف IndexNow تعمل، والجدولة محمية', async t => {
  const oldKey = process.env.INDEXNOW_KEY, oldSecret = process.env.CRON_SECRET;
  process.env.INDEXNOW_KEY = 'abcdef0123456789';
  process.env.CRON_SECRET = 'test-secret-with-at-least-16-characters';
  t.after(() => {
    if (oldKey === undefined) delete process.env.INDEXNOW_KEY; else process.env.INDEXNOW_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(`${origin}/articles`); assert.equal(index.status, 200);
  assert.match(await index.text(), /مقالات وأدلة/);
  const first = await fetch(`${origin}/articles/${articles[0].slug}`); assert.equal(first.status, 200);
  assert.match(await first.text(), /بمساعدة الذكاء الاصطناعي/);
  const future = articles.find(a => Date.parse(a.publishedAt) > Date.now());
  if (future) {
    const response = await fetch(`${origin}/articles/${future.slug}`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /noindex/);
  }
  const image = await fetch(`${origin}${articles[0].image}`); assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/webp/);
  const key = await fetch(`${origin}/abcdef0123456789.txt`); assert.equal(await key.text(), 'abcdef0123456789');
  const unauthorized = await fetch(`${origin}/api/cron/indexnow`); assert.equal(unauthorized.status, 401);
  const wrong = await fetch(`${origin}/api/cron/indexnow`, {headers:{authorization:'Bearer wrong'}}); assert.equal(wrong.status, 401);
  const head = await fetch(`${origin}/api/cron/indexnow`, {method:'HEAD',headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}}); assert.equal(head.status, 405);
  const robots = await (await fetch(`${origin}/robots.txt`)).text(); assert.match(robots, /User-agent: \*\nAllow: \/\n/);
  const feed = await fetch(`${origin}/feed.xml`);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('content-type'), /application\/rss\+xml/);
  const feedBody = await feed.text();
  assert.match(feedBody, /<rss version="2.0"/);
  assert.equal((feedBody.match(/<item>/g) || []).length, getPublishedArticles().length);
  assert.ok(feedBody.includes(`${origin}/articles/${articles[0].slug}`));
  const knownFuture = articles.find(a => Date.parse(a.publishedAt) > Date.now());
  if (knownFuture) assert.ok(!feedBody.includes(knownFuture.slug));
  const rssRedirect = await fetch(`${origin}/rss.xml`, {redirect:'manual'});
  assert.equal(rssRedirect.status, 301);
  assert.equal(rssRedirect.headers.get('location'), '/feed.xml');
  const surah = await (await fetch(`${origin}/surah/18`)).text();
  assert.ok(surah.includes('surah-journal'), 'surah pages link to the magazine');
  assert.ok(surah.includes('/articles/surah-al-kahf-reading-guide'));
  const surahLinks = new Set((surah.match(/href="\/articles\/[a-z0-9-]+"/g) || []).map(value => value.slice(7, -1)));
  assert.equal(surahLinks.size, 3);
  const llms = await (await fetch(`${origin}/llms.txt`)).text();
  assert.match(llms, /^# سَنا للقرآن الكريم/);
  assert.ok(llms.includes(`${origin}/surah/114`));
  assert.ok(llms.includes(`${origin}/articles/${articles[0].slug}`));
});
