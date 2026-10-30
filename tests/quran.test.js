'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {server, chapters, verses, splitOpening, normalize, getPublishedArticles, activeCategoryHubs} = require('../server');

test('المصحف: ١١٤ سورة و٦٢٣٦ آية بترتيب صحيح', () => {
  assert.equal(chapters.length, 114);
  assert.equal(verses.flat().length, 6236);
  chapters.forEach((chapter, i) => {
    assert.equal(chapter.number, i + 1);
    assert.equal(verses[chapter.number].length, chapter.ayahCount);
  });
});
test('فصل البسملة للعرض يحافظ على نص المصدر بما فيه الموضعان الخاصان', () => {
  for (let s = 2; s <= 114; s++) {
    if (s === 9) continue;
    const {opening, first} = splitOpening(s);
    assert.equal(`${opening} ${first}`, verses[s][0]);
  }
  assert.equal(splitOpening(1).opening, '');
  assert.equal(splitOpening(9).opening, '');
  assert.ok(splitOpening(95).opening.startsWith('بِّ'));
  assert.ok(splitOpening(97).opening.startsWith('بِّ'));
});
test('بادئة التحقّق في /sw.js لا تجلب أي كود خارجي', async t => {
  const fsx = require('node:fs'), pathx = require('node:path');
  const cfgPath = pathx.join(__dirname, '..', 'data', 'ads.json');
  const backup = fsx.readFileSync(cfgPath, 'utf8');
  const serve = async (cfg) => {
    fsx.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    delete require.cache[require.resolve('../server')];
    const fresh = require('../server');
    const srv = require('node:http').createServer(fresh.handleRequest);
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const body = await (await fetch(`http://127.0.0.1:${srv.address().port}/sw.js`)).text();
    await new Promise(r => srv.close(r));
    return body;
  };
  try {
    const cfg = JSON.parse(backup);
    cfg.monetag.enabled = true;
    const on = await serve(cfg);
    const swHost = cfg.monetag.swDomain || cfg.monetag.domain;
    const swZone = Number.isInteger(cfg.monetag.swZoneId) ? cfg.monetag.swZoneId : cfg.monetag.zoneId;
    assert.match(on, /self\.options = \{/, 'البادئة موجودة عند التفعيل');
    assert.ok(on.includes(`"domain": "${swHost}"`), 'النطاق من الإعداد');
    assert.ok(on.includes(`"zoneId": ${swZone}`), 'المنطقة من الإعداد');
    assert.equal((on.match(/importScripts\s*\(/g) || []).length, 1, 'استيراد واحد لا أكثر');
    const escapedHost = swHost.replace(/\./g, '\\.');
    assert.match(on, new RegExp("try\\s*\\{\\s*importScripts\\(\\s*'https:\\/\\/" + escapedHost + "\\/act\\/files\\/service-worker\\.min\\.js\\?r=sw"), 'مصدر واحد محمي');
    assert.ok(!/propellerads|popunder|3nbf4\.com\/act\/files\/tag/i.test(on), 'لا شبكة أخرى');
    assert.match(on, /sana-v1/, 'كود عامل الخدمة المحلي باقٍ');

    cfg.monetag.enabled = false;
    const off = await serve(cfg);
    assert.ok(!/self\.options/.test(off), 'لا بادئة عند التعطيل');
    assert.ok(!/importScripts/.test(off), 'لا استيراد خارجي عند التعطيل');
    assert.match(off, /sana-v1/);
  } finally {
    fsx.writeFileSync(cfgPath, backup);
    delete require.cache[require.resolve('../server')];
  }
});

test('أي مسار عامل خدمة من طرف ثالث يُعطَّل ولا يُنفَّذ', async t => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const own = await fetch(base + '/sw.js');
  assert.equal(own.status, 200);
  assert.match(await own.text(), /sana-v1/, 'عامل الخدمة الخاص بنا يبقى كما هو');
  for (const path of ['/service-worker.js', '/firebase-messaging-sw.js', '/ngsw-worker.js', '/push-worker.js']) {
    const r = await fetch(base + path);
    const body = await r.text();
    assert.equal(r.status, 200, 'يُخدَم ليمسح التسجيل: ' + path);
    assert.match(body, /Sana neutral worker/, 'عامل محلي محايد: ' + path);
    assert.ok(!/importScripts|3nbf4|monetag/i.test(body), 'لا كود خارجي: ' + path);
    assert.match(r.headers.get('cache-control'), /no-store/);
  }
});

test('وسم تحقّق Monetag موجود مرة واحدة ولا يقترن بأي سكربت إعلاني', async t => {
  const fsx = require('node:fs'), pathx = require('node:path');
  const sw = fsx.readFileSync(pathx.join(__dirname, '..', 'data', 'sw.js'), 'utf8');
  const app = fsx.readFileSync(pathx.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  // sw.js نقيٌّ من أي محمّلٍ خارجي؛ ذكر «Monetag» في التعليقات التوضيحية فقط.
  assert.ok(!/importScripts|5gvci|3nbf4|propellerads|popunder/i.test(sw), 'لا محمّل خارجي في sw.js');
  assert.ok(!/monetag|3nbf4|propellerads|popunder/i.test(app), 'لا سكربت إعلاني في app.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(origin + '/')).text();
  assert.equal((html.match(/name="monetag"/g) || []).length, 2, 'وسما تحقّق: القديم والجديد');
  assert.match(html, /<meta name="monetag" content="fcfba283784091810952fa1ef887081e">/);
  assert.match(html, /<meta name="monetag" content="037ce2f953912695c619b6d08ab4c006">/);
  assert.ok(!/3nbf4|service-worker\.min\.js|popunder/i.test(html), 'لا تحميل سكربتات إعلانية في الصفحة');
});

test('عامل الخدمة محلي ولا يستورد شيئًا خارجيًّا ولا يعرض إشعارات', () => {
  const sw = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'data', 'sw.js'), 'utf8');
  assert.ok(!/importScripts\s*\(/.test(sw), 'لا استيراد سكربتات خارجية');
  assert.ok(!/https?:\/\//.test(sw.replace(/self\.location\.origin/g, '')), 'لا روابط خارجية داخل عامل الخدمة');
  assert.ok(!/Notification|pushManager|showNotification/.test(sw), 'لا إشعارات ولا دفع');
  assert.match(sw, /const VERSION = '[a-z0-9-]+'/);
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /serviceWorker\.register\('\/sw\.js'/);
});

test('تطبيع البحث يتجاهل التشكيل واختلافات الألف', () => {
  assert.equal(normalize('ٱلرَّحْمَـٰنِ'), 'الرحمن');
  assert.equal(normalize('إِيمَان'), 'ايمان');
  assert.equal(normalize('١٨'), '18');
});
test('صفحة الكهف قابلة للفهرسة وخريطة الموقع تعرض جميع السور', async t => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const reader = await fetch(`${origin}/surah/18`);
  assert.equal(reader.status, 200);
  const html = await reader.text();
  assert.match(html, /سورة الكهف مكتوبة/);
  assert.equal((html.match(/data-ayah-row/g) || []).length, 110);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /application\/ld\+json/);
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  // 153 = الرئيسية + عن سَنا + فهرس السور + الاستماع + مسار التعلّم + جزء عمّ + فهرس الأجزاء + ٢٩ جزءًا + أدلة السور + الموضوعات + المقالات + ١١٤ سورة
  assert.equal((sitemap.match(/<loc>/g) || []).length, 156 + getPublishedArticles().length + activeCategoryHubs().length + (require('../server').articlesPageCount() - 1) + require('../server').AYAH_PAGES.length); // ١٥٦ = الصفحات الثابتة + محور المقالات + صفحات الآيات
  assert.match(sitemap, /\/surah\/18<\/loc>/);
  const robots = await (await fetch(`${origin}/robots.txt`)).text();
  assert.match(robots, /Sitemap:/);
  const search = await (await fetch(`${origin}/search?q=${encodeURIComponent('الرحمن')}`)).text();
  assert.match(search, /class="verse-result"/);
  const surahSearch = await (await fetch(`${origin}/search?q=${encodeURIComponent('سورة الكهف')}`)).text();
  assert.match(surahSearch, /href="\/surah\/18"/);
  const legacy = await fetch(`${origin}/18.html`, {redirect:'manual'});
  assert.equal(legacy.status, 301);
  assert.equal(legacy.headers.get('location'), '/surah/18');
});

test('سكربت Monetag داخل الصفحات يتبع المفتاح نفسه ويُعطَّل بمفتاح واحد', async () => {
  const fsx = require('node:fs'), pathx = require('node:path');
  const cfgPath = pathx.join(__dirname, '..', 'data', 'ads.json');
  const backup = fsx.readFileSync(cfgPath, 'utf8');
  const home = async (cfg) => {
    fsx.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    delete require.cache[require.resolve('../server')];
    const fresh = require('../server');
    const srv = require('node:http').createServer(fresh.handleRequest);
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const html = await (await fetch(`http://127.0.0.1:${srv.address().port}/`)).text();
    await new Promise(r => srv.close(r));
    return html;
  };
  try {
    const cfg = JSON.parse(backup);
    cfg.monetag.enabled = true;
    const on = await home(cfg);
    assert.equal((on.match(/tag\.min\.js\?z=12145083/g) || []).length, 1, 'سكربت واحد فقط');
    assert.match(on, /src="https:\/\/5gvci\.com\/act\/files\/tag\.min\.js\?z=12145083"/);
    assert.match(on, /async data-cfasync="false"/, 'async: لا يحجب الرسم');
    const headHtml = on.slice(on.indexOf('<head>'), on.indexOf('</head>'));
    assert.match(headHtml, /tag\.min\.js/, 'الوسم داخل <head> كما يفحصه المزوّد');
    assert.ok(!on.slice(on.indexOf('</head>')).includes('tag.min.js'), 'ولا يتكرر في الجسم');
    assert.equal((on.match(/data-zone="303289"/g) || []).length, 1, 'وسم المنطقة الثانية مرة واحدة');
    assert.match(on, /src="https:\/\/quge5\.com\/88\/tag\.min\.js"/);
    assert.ok(!/3nbf4|nap5k|propellerads|popunder/i.test(on), 'لا مصادر إعلانية أخرى');
    cfg.monetag.enabled = false;
    const off = await home(cfg);
    assert.ok(!/tag\.min\.js/.test(off), 'لا سكربت عند التعطيل');
    assert.ok(!/quge5/.test(off), 'لا وسم ثانٍ عند التعطيل');
  } finally {
    fsx.writeFileSync(cfgPath, backup);
    delete require.cache[require.resolve('../server')];
  }
});

test('منطقة عامل الخدمة قابلة للتبديل من ملف الإعداد وحده', async () => {
  const fsx = require('node:fs'), pathx = require('node:path');
  const cfgPath = pathx.join(__dirname, '..', 'data', 'ads.json');
  const backup = fsx.readFileSync(cfgPath, 'utf8');
  const serveSw = async (cfg) => {
    fsx.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    delete require.cache[require.resolve('../server')];
    const fresh = require('../server');
    const srv = require('node:http').createServer(fresh.handleRequest);
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const body = await (await fetch(`http://127.0.0.1:${srv.address().port}/sw.js`)).text();
    await new Promise(r => srv.close(r));
    return body;
  };
  try {
    const cfg = JSON.parse(backup);
    cfg.monetag.swDomain = '3nbf4.com';
    cfg.monetag.swZoneId = 12146901;
    const alt = await serveSw(cfg);
    assert.match(alt, /"domain": "3nbf4\.com"/);
    assert.match(alt, /"zoneId": 12146901/);
    assert.match(alt, /importScripts\('https:\/\/3nbf4\.com\/act\/files\/service-worker\.min\.js\?r=sw'/);
    assert.match(alt, /sana-v1/, 'الكاش يبقى');
    cfg.monetag.swVerbatim = true;
    const raw = await serveSw(cfg);
    assert.ok(!/sana-v1/.test(raw), 'الوضع الحرفي بلا كاش سَنا');
    assert.match(raw, /^self\.options = \{\n    "domain": "3nbf4\.com",\n    "zoneId": 12146901\n\}/, 'شكل الملف كما يسلّمه المزوّد');
    assert.match(raw, /importScripts\('https:\/\/3nbf4\.com\/act\/files\/service-worker\.min\.js\?r=sw'\);/);
    cfg.monetag.swVerbatim = false;
    cfg.monetag.swDomain = '5gvci.com';
    cfg.monetag.swZoneId = 12145083;
    const back = await serveSw(cfg);
    assert.match(back, /"domain": "5gvci\.com"/);
    assert.match(back, /sana-v1/);
  } finally {
    fsx.writeFileSync(cfgPath, backup);
    delete require.cache[require.resolve('../server')];
  }
});
