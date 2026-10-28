'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {server, chapters, verses, splitOpening, normalize, getPublishedArticles} = require('../server');

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
  assert.equal((sitemap.match(/<loc>/g) || []).length, 116 + getPublishedArticles().length);
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
