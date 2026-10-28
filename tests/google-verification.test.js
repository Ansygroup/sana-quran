'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {server} = require('../server');

test('Google verification is configurable, escaped and present in the initial head', async t => {
  const oldValue = process.env.GOOGLE_SITE_VERIFICATION;
  t.after(() => {
    if (oldValue === undefined) delete process.env.GOOGLE_SITE_VERIFICATION;
    else process.env.GOOGLE_SITE_VERIFICATION = oldValue;
  });
  delete process.env.GOOGLE_SITE_VERIFICATION;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let html = await (await fetch(url)).text();
  assert.doesNotMatch(html, /name="google-site-verification"/);

  // Google sometimes supplies the same value in DNS-TXT format.
  process.env.GOOGLE_SITE_VERIFICATION = 'google-site-verification=example_"&<>';
  html = await (await fetch(url)).text();
  const tag = '<meta name="google-site-verification" content="example_&quot;&amp;&lt;&gt;">';
  assert.ok(html.includes(tag));
  assert.ok(html.indexOf(tag) < html.indexOf('</head>'));
  assert.ok(html.indexOf(tag) < 2_000_000);
});
