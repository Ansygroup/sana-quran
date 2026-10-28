'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const handler = require('../api/index');

test('Vercel handler preserves rewritten paths and original query strings', async t => {
  const s = http.createServer(handler);
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => s.close(resolve)));
  const base = `http://127.0.0.1:${s.address().port}`;
  const get = p => fetch(base + p);
  let r = await get('/api/index?__path=%2F');
  assert.equal(r.status, 200); assert.match(await r.text(), /لأنَّ في القرآن/);
  r = await get('/api/index?__path=%2Fsurah%2F18');
  assert.equal(r.status, 200); const html = await r.text();
  assert.match(html, /سورة الكهف مكتوبة/); assert.equal((html.match(/data-ayah-row/g) || []).length, 110);
  r = await get(`/api/index?__path=%2Fsearch&q=${encodeURIComponent('الرحمن')}`);
  assert.equal(r.status, 200); assert.match(await r.text(), /class="verse-result"/);
  r = await get('/api/index?__path=%2Fstyle.css');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/css/);
  r = await get('/api/index?__path=%2Fapi%2Ftafsir%2F999%2F1');
  assert.equal(r.status, 404); assert.match(r.headers.get('content-type'), /application\/json/);
  r = await get('/surah/18?__path=%2F'); // Original URL passed through; do not overwrite.
  assert.equal(r.status, 200); assert.match(await r.text(), /سورة الكهف مكتوبة/);
});
