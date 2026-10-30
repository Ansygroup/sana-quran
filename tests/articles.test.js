'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  server, articles, validateArticleBatch, getPublishedArticles, articlesPage, articlePage,
  sitemapXml, recentArticleUrls, notifyRecentArticles, validIndexNowKey, allIndexableUrls,
  activeCategoryHubs, categoryArticles, categoryPage, CATEGORY_HUBS, aboutPage,
  learnPage, LEARN_STAGES, learnStageArticles, surahGuides, surahPage, chapters, juzAmmaPage, guidesPage,
  juzPage, juzIndexPage, juzBounds, surahKeyAyahs, topicsPage, topics,
  keywordClusters, popularSearches, surahQuickFacts,
  relatedArticlesFor, articlesPageCount, surahMentions, surahMentionIndex, articlesForSurah, SURAH_ARTICLE_HINTS, questionsPage, QuranQuestions, surahArticleHub, surahArticleGroups,
  adSlot, ayahPage, ayahIndexPage, ayahOfDay, AYAH_PAGES, homePage, searchPage,
  surahStatsFor, surahStats, surahSummary, articleSearchText, normalize
} = require('../server');
const ORIGIN = 'https://sana-quran.vercel.app';
const arabicWords = n => new Intl.NumberFormat('ar-EG').format(n);
const htmlSchema = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

test('الدفعة الحادية والثلاثون: ٢٨٣ مقالة أصلية بصور ومراجع', () => {
  assert.equal(articles.length, 389);
  assert.equal(new Set(articles.map(a => a.slug)).size, 389);
  assert.equal(new Set(articles.map(a => a.title)).size, 389);
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
  assert.equal(validateArticleBatch(articles).length, 389);
  const a = articles[0];
  assert.equal(validateArticleBatch([{...a, image:'/articles/missing.webp'}]).length, 0);
  assert.equal(validateArticleBatch([{...a, sources:[a.sources[0]]}]).length, 0);
  assert.equal(validateArticleBatch([{...a, sources:[{label:'bad source',url:'javascript:alert(1)'},a.sources[0]]}]).length, 0);
  assert.equal(validateArticleBatch([{...a, related:[{label:'unsafe',href:'//example.com'}]}]).length, 0);
  assert.equal(validateArticleBatch([{...a, sections:a.sections.map(s => ({...s, paragraphs:['قصير جدًا']}))}]).length, 0);
  assert.equal(validateArticleBatch([a, {...a}]).length, 0);
});

test('الحجب الزمني والخريطة لا يعرضان المقالات المقبلة مبكرًا', () => {
  assert.equal(getPublishedArticles(Date.parse('2026-10-05T23:59:59Z')).length, 0);
  assert.equal(getPublishedArticles(Date.parse('2026-10-06T08:00:00Z')).length, 1);
  assert.equal(getPublishedArticles(Date.parse('2026-10-28T08:00:00Z')).length, 27);
  // لحظة مرجعية بعد آخر نشر (تُحسب من البيانات حتى لا تتعطل مع كل دفعة)
  const REFERENCE = articles.reduce((max, a) => Math.max(max, Date.parse(a.publishedAt)), 0) + 60000;
  assert.equal(getPublishedArticles(REFERENCE).length, 389);
  assert.equal(getPublishedArticles().length, 389);
  const xml = sitemapXml(ORIGIN);
  assert.equal((xml.match(/<loc>/g) || []).length, 1263); // home + about + surahs + listen + learn + juz/30 + juz + 29 juz pages + guides + topics + 114 surahs + magazine + archive pages + 365 articles + 6 hubs + questions + surah hub + 696 ayah pages + ayah index
  articles.forEach(a => assert.ok(xml.includes(`${ORIGIN}/articles/${a.slug}`)));
  assert.equal((xml.match(/<image:loc>/g) || []).length, 389);
  const hubs = activeCategoryHubs();
  assert.equal(hubs.length, 6);
  hubs.forEach(hub => assert.ok(xml.includes(`${ORIGIN}/articles/category/${hub.slug}`)));
  const index = articlesPage(ORIGIN);
  assert.equal((index.match(/journal-card-image/g) || []).length, 24, 'الصفحة الأولى تعرض ٢٤ بطاقة');
  assert.ok(index.includes('category-chips'));
  hubs.forEach(hub => assert.ok(index.includes(`/articles/category/${hub.slug}`)));
  // كل مقال يظهر في صفحةٍ مرقّمة واحدة على الأقل، ولا يظهر مرتين
  const slugSet = new Set(articles.map(a => a.slug));
  const perPage = [];
  for (let n = 1; n <= articlesPageCount(); n++) {
    const html = articlesPage(ORIGIN, Date.now(), n);
    const found = new Set();
    for (const m of html.matchAll(/href="\/articles\/([a-z0-9-]+)"/g)) {
      if (slugSet.has(m[1])) found.add(m[1]);
    }
    assert.ok(found.size <= 24, 'لا أكثر من ٢٤ بطاقة في الصفحة ' + n);
    perPage.push(found);
  }
  const union = new Set(perPage.flatMap(s => [...s]));
  articles.forEach(a => assert.ok(union.has(a.slug), 'ظاهر في الأرشيف: ' + a.slug));
  perPage.forEach((set, i) => {
    perPage.forEach((other, j) => {
      if (i >= j) return;
      for (const slug of set) assert.ok(!other.has(slug), 'لا يتكرر بين الصفحتين: ' + slug);
    });
  });
});

// صور المقالات تُخزَّن كملفات، وأي ملفٍ ناقص يُسقط المقال من الفهرسة بصمت.
// هذا الاختبار يمنع تكرار ما حدث في الدفعة ٣٩: مقالاتٌ منشورة بلا صورة.
test('كل مقال لديه صورة hero ونسخة ٦٤٠ على القرص', () => {
  const missing = [];
  for (const a of articles) {
    const main = path.join(__dirname, '..', 'public', a.image.replace(/^\//, ''));
    const small = main.replace(/\.webp$/, '-640.webp');
    if (!fs.existsSync(main)) missing.push(a.image);
    else if (!fs.existsSync(small)) missing.push(a.image.replace(/\.webp$/, '-640.webp'));
  }
  assert.deepEqual(missing, [], 'صور ناقصة: ' + missing.slice(0, 10).join(', '));
  const sizes = articles.map(a => {
    const f = path.join(__dirname, '..', 'public', a.image.replace(/^\//, ''));
    return fs.statSync(f).size;
  });
  assert.ok(Math.max(...sizes) < 320 * 1024, 'لا صورة hero تتجاوز ٣٢٠ كيلوبايت');
  assert.ok(Math.min(...sizes) > 8 * 1024, 'لا صورة hero أقل من ٨ كيلوبايت');
});

// الأسئلة السريعة: عنصر مرئي + FAQPage في البيانات المنظمة، ويجب أن يتطابقا.
// البحث في المجلة يجب أن يجد الكلمة داخل متن المقال وأسئلته، لا في العنوان فقط.
test('بحث المجلة يطابق متن المقال ويُظهر مقتطفًا', () => {
  const clean = w => w.replace(/[«»،.:؛؟\-]/g, '');
  const pick = words => words.map(clean).find(w => w.length > 6);
  // كلمةٌ لا ترد في عنوان المقال ولا ملخصه ولا مقدمته، ونادرةٌ حتى لا تُقطع من أول ٨ نتائج
  const corpus = articles.map(a => articleSearchText(a));
  const rarity = w => corpus.filter(t => t.includes(normalize(w))).length;
  const candidates = [];
  for (const a of articles) {
    const head = [a.title, a.summary, a.lead].join(' ');
    for (const p of a.sections.flatMap(x => x.paragraphs)) {
      const w = pick(p.split(/\s+/).filter(x => !head.includes(x) && rarity(x.replace(/[«»،.:؛؟\-]/g, '')) <= 2));
      if (w) { candidates.push({ article: a, word: w }); break; }
    }
    if (candidates.length >= 2) break;
  }
  assert.ok(candidates.length, 'لا توجد كلمةٌ خارج العنوان لاختبار البحث');
  for (const { article, word } of candidates) {
    const html = searchPage(word, ORIGIN);
    assert.ok(html.includes(`/articles/${article.slug}`), `البحث لم يجد «${word}» في متن: ${article.slug}`);
    assert.ok(/<small>[^<]{20,}<\/small>/.test(html), 'لا مقتطف في نتيجة البحث');
  }
  // كلمةٌ من نص الأسئلة السريعة تصل بالمقال صاحبها
  const withFaq = articles.find(a => Array.isArray(a.faq) && a.faq.length && a.faq[0].a.split(/\s+/).some(w => w.length > 9));
  const faqWord = pick(withFaq.faq[0].a.split(/\s+/).filter(w => !withFaq.title.includes(w)));
  assert.ok(searchPage(faqWord, ORIGIN).includes(`/articles/${withFaq.slug}`), 'البحث لا يطابق الأسئلة السريعة: ' + faqWord);
  // كل من طابق عنوانه/ملخصه/مقدمته يجب أن يسبق من طابقت كلمةٌ في متنه فقط
  const order = [...searchPage('الكوثر', ORIGIN).matchAll(/href="\/articles\/([a-z0-9-]+)"/g)].map(m => m[1]);
  const bySlug = new Map(articles.map(a => [a.slug, a]));
  const headHit = slug => {
    const a = bySlug.get(slug);
    return a && normalize([a.title, a.summary, a.lead].join(' ')).includes(normalize('الكوثر'));
  };
  const firstBodyOnly = order.findIndex(slug => !headHit(slug));
  if (firstBodyOnly !== -1) {
    const after = order.slice(firstBodyOnly);
    assert.ok(after.every(slug => !headHit(slug)), 'مطابق العنوان يجب أن يسبق مطابق المتن');
  }
  assert.ok(order.some(headHit), 'لا نتيجة مطابقة في العنوان لكلمة الكوثر');
});

test('الأسئلة السريعة تُعرض وتُصدَّر كـFAQPage متطابق', () => {
  const withFaq = articles.filter(a => Array.isArray(a.faq) && a.faq.length);
  assert.ok(withFaq.length >= 8, 'ثماني مقالات على الأقل فيها أسئلة سريعة');
  for (const article of withFaq) {
    const html = articlePage(article, ORIGIN);
    assert.equal((html.match(/class="faq-item"/g) || []).length, article.faq.length, 'عدد العناصر يطابق: ' + article.slug);
    assert.ok(html.includes('id="faq"'), 'قسم الأسئلة موجود: ' + article.slug);
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
    const faqPage = graph.find(node => node['@type'] === 'FAQPage');
    assert.ok(faqPage, 'FAQPage موجود: ' + article.slug);
    assert.equal(faqPage.mainEntity.length, article.faq.length);
    article.faq.forEach((item, index) => {
      assert.equal(faqPage.mainEntity[index].name, item.q);
      assert.equal(faqPage.mainEntity[index].acceptedAnswer.text, item.a);
      assert.ok(html.includes(item.q.slice(0, 25)), 'نص السؤال مرئي في الصفحة');
    });
    // صفحةٌ بلا أسئلة لا تُصدر FAQPage فارغًا
    const plain = articles.find(a => !a.faq);
    if (plain) assert.ok(!articlePage(plain, ORIGIN).includes('FAQPage'), 'لا FAQPage وهميًا');
  }
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

test('الرئيسية تعرض أربعة مقالات من تصنيفات متنوعة وتربطها من أقوى صفحة في الموقع', () => {
  const html = homePage(ORIGIN);
  const latest = getPublishedArticles()[0];
  const list = getPublishedArticles();
  const picked = [latest]; const seen = new Set([latest.category]);
  for (const a of list.slice(1)) { if (picked.length === 4) break; if (seen.has(a.category)) continue; seen.add(a.category); picked.push(a); }
  assert.equal(picked.length, 4, 'لا بد من أربعة تصنيفات مختلفة في أعلى القائمة');
  assert.equal(new Set(picked.map(a => a.category)).size, 4);
  for (const article of picked) assert.ok(html.includes(`/articles/${article.slug}`), `الرئيسية لا تربط ${article.slug}`);
  assert.equal((html.match(/class="home-journal-more"/g) || []).length, 1);
  assert.equal((html.match(/<li><a href="\/articles\//g) || []).length, 3);
});

test('كل مقال يربط سوره بصفحة السورة وبالاستماع الفوري', () => {
  const sample = getPublishedArticles().filter(a => surahMentions(a).length).slice(0, 6);
  assert.ok(sample.length >= 3);
  for (const article of sample) {
    const html = articlePage(article, ORIGIN);
    const first = surahMentions(article)[0];
    assert.ok(html.includes(`href="/surah/${first.number}"`), `${article.slug} لا يربط سورة ${first.name}`);
    assert.ok(html.includes(`data-play-surah="${first.number}"`), `${article.slug} لا يتيح الاستماع إلى سورة ${first.name}`);
    assert.equal((html.match(/class="article-surah-listen"/g) || []).length, 1);
  }
});

test('كل مقال يفتح شبكة ربط داخلية إلى مقالاتٍ أخرى عن السورة نفسها', () => {
  const sample = getPublishedArticles().filter(a => surahMentions(a).length).slice(0, 8);
  let linked = 0;
  for (const article of sample) {
    const html = articlePage(article, ORIGIN);
    const block = html.match(/<section class="article-same-surah"[\s\S]*?<\/section>/);
    if (!block) continue;
    linked += 1;
    const hrefs = [...block[0].matchAll(/href="\/articles\/([a-z0-9-]+)"/g)].map(m => m[1]);
    assert.ok(hrefs.length >= 1, `لا روابط في شبكة ${article.slug}`);
    assert.ok(!hrefs.includes(article.slug), `المقال يربط نفسه ${article.slug}`);
    assert.ok(hrefs.length <= 3);
  }
  assert.ok(linked >= 6, 'شبكة السورة لم تظهر في معظم المقالات');
});

test('كل بطاقة سورة تعرض عدد المقالات المكتوبة عنها', () => {
  const html = homePage(ORIGIN);
  assert.equal((html.match(/class="surah-card-articles"/g) || []).length, 114);
  const index = surahMentionIndex();
  for (const number of [1, 18, 57, 88]) {
    const start = html.indexOf(`href="/surah/${number}" data-surah-card`);
    assert.ok(start > -1);
    const card = html.slice(start, html.indexOf('</a>', start));
    const shown = (card.match(/surah-card-articles[^>]*>([^<]+)</) || [])[1];
    assert.equal(shown, `${arabicWords((index.get(number) || []).length)} مقالًا`, `بطاقة السورة ${number} تعرض عدًّا خاطئًا`);
  }
});

test('البحث يعرض مقالات المجلة إلى جانب السور والآيات', () => {
  const html = searchPage('الفلق', ORIGIN);
  assert.ok(html.includes('من المجلة'), 'قسم المقالات غير ظاهر في البحث');
  const links = [...html.matchAll(/href="\/articles\/([a-z0-9-]+)"/g)].map(m => m[1]).filter(slug => slug !== 'surahs');
  assert.ok(links.length >= 2, 'لا نتائج من المجلة');
  for (const slug of links) assert.ok(articles.some(a => a.slug === slug), `رابط مقال غير موجود: ${slug}`);
  const empty = searchPage('قققققققق', ORIGIN);
  assert.ok(empty.includes('لم نجد نتائج مطابقة'));
});

test('صفحة المقال تحمل شريط تقدّم القراءة مع أنماطه وسلوكه', () => {
  const html = articlePage(getPublishedArticles()[0], ORIGIN);
  assert.equal((html.match(/id="reading-progress"/g) || []).length, 1);
  assert.ok(!homePage(ORIGIN).includes('id="reading-progress"'), 'الشريط لا يظهر في الرئيسية');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/style.css'), 'utf8');
  assert.ok(css.includes('.reading-progress span'), 'لا أنماط للشريط');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
  assert.ok(js.includes("getElementById('reading-progress')"), 'لا سلوك للشريط');
});

test('صفحة السورة تعرض عدّاد مقالاتها وتربط صفحة الفهرس المخصّصة', () => {
  const index = surahMentionIndex();
  for (const id of [26, 55, 1]) {
    const html = surahPage(id, ORIGIN);
    const shown = (html.match(/class="surah-about-count"[^>]*>([^<]+)</) || [])[1];
    assert.ok(shown, `لا عدّاد في صفحة السورة ${id}`);
    assert.ok(shown.includes(arabicWords((index.get(id) || []).length)), `الرقم غير مطابق للسورة ${id}`);
    assert.ok(html.includes(`/articles/surahs#surah-${id}`), `لا رابط لفهرس السورة ${id}`);
  }
  // السورة ذات المقال الواحد فقط لا تعرض عدّادًا — يُحسب من البيانات لا يُثبَّت يدويًّا
  const singleId = chapters.map(c => c.number).find(n => (index.get(n) || []).length === 1);
  if (singleId) {
    const single = surahPage(singleId, ORIGIN);
    assert.ok(!single.includes('surah-about-count'), `السورة ذات المقال الواحد (${singleId}) لا تعرض عدّادًا`);
  }
});

test('قسم «اقرأ بعد التلاوة» في صفحة السورة يعرض بطاقةً مصوّرة أولًا', () => {
  const html = surahPage(55, ORIGIN);
  const block = html.match(/<section class="surah-journal"[\s\S]*?<\/section>/);
  assert.ok(block, 'قسم المجلة غير موجود في صفحة السورة');
  assert.equal((block[0].match(/class="surah-journal-card"/g) || []).length, 1);
  assert.ok(/class="surah-journal-card"[^>]*>\s*<img/.test(block[0]), 'البطاقة بلا صورة');
  const lead = articlesForSurah(55, 4)[0];
  assert.ok(block[0].includes(`/articles/${lead.slug}`), 'البطاقة لا تشير إلى أحدث مقال للسورة');
  assert.ok((block[0].match(/<li>/g) || []).length >= 1, 'لا قائمة مقالات مصاحبة');
});

test('كل مقال يعرض اقتراحاتٍ من تصنيفه تربط صفحة المركز', () => {
  const hubs = new Map(CATEGORY_HUBS.map(h => [h.name, h.slug]));
  const sample = [0, 40, 120, 250, 340].map(i => getPublishedArticles()[i]).filter(Boolean);
  for (const article of sample) {
    const html = articlePage(article, ORIGIN);
    assert.ok(html.includes('article-same-category'), `لا اقتراحات تصنيف في ${article.slug}`);
    assert.ok(html.includes(`/articles/category/${hubs.get(article.category)}`), `لا رابط للمركز في ${article.slug}`);
    const block = html.match(/<section class="article-same-category"[\s\S]*?<\/section>/)[0];
    const hrefs = [...block.matchAll(/href="\/articles\/([a-z0-9-]+)"/g)].map(m => m[1]);
    assert.ok(hrefs.length >= 1 && hrefs.length <= 3, `عدد اقتراحات غير مناسب في ${article.slug}`);
    assert.ok(!hrefs.includes(article.slug), `المقال يقترح نفسه ${article.slug}`);
    for (const slug of hrefs) {
      const peer = articles.find(a => a.slug === slug);
      assert.equal(peer.category, article.category, `اقتراح من تصنيف مختلف: ${slug}`);
    }
  }
});

test('كل تصنيف في المجلة له صفحة مركزية بثلاثة مقالات على الأقل', () => {
  activeCategoryHubs().forEach(hub => {
    const items = categoryArticles(hub.name);
    assert.ok(items.length >= 3, `${hub.slug} needs at least three articles`);
    assert.ok(hub.intro.length >= 150, `${hub.slug} intro is too thin`);
    const html = categoryPage(hub, ORIGIN);
    assert.ok(html.includes(`rel="canonical" href="${ORIGIN}/articles/category/${hub.slug}"`));
    items.forEach(a => assert.ok(html.includes(a.slug)));
    const schema = htmlSchema(html);
    assert.deepEqual(schema['@graph'].map(n => n['@type']), ['CollectionPage', 'BreadcrumbList']);
  });
  const hubNames = new Set(CATEGORY_HUBS.map(h => h.name));
  const orphans = [...new Set(articles.map(a => a.category))].filter(name => !hubNames.has(name));
  assert.deepEqual(orphans, [], 'لا تصنيف بلا صفحة مركزية');
});

test('صفحة «عن سَنا» تحمل سياسة تحرير وبيانات AboutPage وOrganization', () => {
  const html = aboutPage(ORIGIN);
  assert.ok(html.includes(`rel="canonical" href="${ORIGIN}/about"`));
  assert.ok(html.includes('كيف تُعدّ مقالات المجلة؟'));
  assert.ok(html.includes('ما لا تجده في سَنا'));
  assert.ok(html.includes('المصادر والتراخيص'));
  assert.ok(html.includes('tanzil.net'));
  assert.ok(html.includes('href="/about"'));
  const schema = htmlSchema(html);
  assert.deepEqual(schema['@graph'].map(node => node['@type']), ['AboutPage', 'BreadcrumbList']);
  // every page carries a sitewide Organization node
  const organization = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1]))
    .find(node => node['@type'] === 'Organization');
  assert.equal(organization.name, 'سَنا للقرآن الكريم');
});

test('صفحتا فهرس السور والاستماع كاملتان وقابلتان للفهرسة', async t => {
  const { surahsPage, listenPage, sitemapXml: sm } = require('../server');
  const index = surahsPage(ORIGIN);
  assert.equal((index.match(/data-surah-card/g) || []).length, 114);
  assert.ok(index.includes('rel="canonical" href="' + ORIGIN + '/surahs"'));
  const indexSchema = htmlSchema(index);
  const itemList = indexSchema['@graph'].find(node => node['@type'] === 'ItemList');
  assert.equal(itemList.numberOfItems, 114);
  assert.equal(itemList.itemListElement.at(-1).url, ORIGIN + '/surah/114');
  const listen = listenPage(ORIGIN);
  assert.ok(listen.includes('rel="canonical" href="' + ORIGIN + '/listen"'));
  assert.ok((listen.match(/data-play-surah=/g) || []).length >= 8);
  const xml = sm(ORIGIN);
  assert.ok(xml.includes(ORIGIN + '/surahs</loc>'));
  assert.ok(xml.includes(ORIGIN + '/listen</loc>'));
  // the sitewide WebSite node advertises the internal search endpoint
  assert.ok(surahsPage(ORIGIN).includes('SearchAction'));
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
  assert.ok(surahLinks.size >= 4, 'صفحة السورة تربط مقالات المجلة ودليل السورة');
  const about = await fetch(`${origin}/about`);
  assert.equal(about.status, 200);
  assert.match(await about.text(), /سياسة تحرير/);
  const llmsNav = await (await fetch(`${origin}/llms.txt`)).text();
  assert.ok(llmsNav.includes(`${origin}/about`));
  const hub = await fetch(`${origin}/articles/category/memorization`);
  assert.equal(hub.status, 200);
  assert.match(await hub.text(), /الحفظ والمراجعة/);
  const missingHub = await fetch(`${origin}/articles/category/does-not-exist`);
  assert.equal(missingHub.status, 404);
  const hubRedirect = await fetch(`${origin}/articles/category/`, {redirect:'manual'});
  assert.equal(hubRedirect.status, 301);
  const llms = await (await fetch(`${origin}/llms.txt`)).text();
  assert.match(llms, /^# سَنا للقرآن الكريم/);
  assert.ok(llms.includes(`${origin}/surah/114`));
  assert.ok(llms.includes(`${origin}/articles/${articles[0].slug}`));
});

test('الإرسال الكامل إلى IndexNow يغطي كل ما في خريطة الموقع', async () => {
  const origin = 'https://example.com';
  const urls = allIndexableUrls(origin);
  const locs = (sitemapXml(origin).match(/<loc>/g) || []).length;
  assert.equal(urls.length, locs);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every(u => u.startsWith(origin + '/')), 'كل عنوان يبدأ بأصل الموقع');
  assert.ok(urls.includes(origin + '/articles/surah-al-kahf-four-stories'), 'المقالات الجديدة مشمولة');
});

test('كل مقال ينتمي إلى تصنيف له صفحة مركزية، ولكل مقال غلاف خاص', () => {
  const hubNames = new Set(CATEGORY_HUBS.map(h => h.name));
  const orphans = articles.filter(a => !hubNames.has(a.category)).map(a => a.slug);
  assert.deepEqual(orphans, []);
  const covers = articles.map(a => a.image);
  assert.equal(new Set(covers).size, covers.length, 'لكل مقال صورة غلاف فريدة');
  for (const a of articles) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', a.image)), 'الغلاف موجود: ' + a.slug);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', a.image.replace(/\.webp$/, '-640.webp'))), 'نسخة ٦٤٠ موجودة: ' + a.slug);
  }
  for (const hub of CATEGORY_HUBS) {
    assert.ok(categoryArticles(hub.name).length >= 3, 'التصنيف غير رقيق: ' + hub.name);
  }
});

test('لا يتنافس عنوانان على النيّة نفسها', () => {
  const stop = new Set(['من','في','على','إلى','عن','مع','أو','ثم','هل','لماذا','ما','كيف','ماذا','التي','الذي','هذه','هذا','بعد','قبل','بين','أن','إن','لا','كل','عند','حين','دون']);
  const tokens = title => new Set(title.replace(/[«»؟:،.!()]/g, ' ').split(/\s+/).filter(w => w && !stop.has(w) && w.length > 2));
  const pairs = [];
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const a = tokens(articles[i].title), b = tokens(articles[j].title);
      const shared = [...a].filter(w => b.has(w)).length;
      const union = new Set([...a, ...b]).size;
      const score = union ? shared / union : 0;
      if (score >= 0.4) pairs.push(articles[i].slug + ' ≈ ' + articles[j].slug + ' (' + score.toFixed(2) + ')');
    }
  }
  assert.deepEqual(pairs, [], 'عنوانان بنيّة واحدة يضعفان بعضهما');
});

test('فتحة اللافتة معطّلة افتراضيًّا، والسكربت الخارجي الوحيد هو وسم Monetag', () => {
  const cfg = require(path.join(__dirname, '..', 'data', 'ads.json'));
  assert.equal(cfg.enabled, false, 'اللافتات معطّلة في المستودع');
  assert.equal(adSlot('article-end'), '', 'لا وسم لافتة والسكربتات معطّلة');
  const html = articlePage(getPublishedArticles()[0], ORIGIN);
  assert.ok(!html.includes('ad-slot'), 'صفحة المقال بلا فتحة لافتة');
  assert.ok(!html.includes('data-ad-script'), 'لا فتحة لافتة مُفعّلة');
  const thirdParty = [...new Set(html.match(/https?:\/\/[^"']+\.js[^"']*/g) || [])].sort();
  assert.deepEqual(thirdParty, ['https://5gvci.com/act/files/tag.min.js?z=12145083', 'https://quge5.com/88/tag.min.js'], 'سكربتا المنصة فقط');
  assert.ok(!/3nbf4|adsbygoogle|popunder|nap5k/i.test(html), 'لا شبكات أخرى في صفحة المقال');
});

test('الفتحة الإعلانية تظهر فقط لسكربت https صريح', () => {
  const path_ = require('node:path');
  const backup = fs.readFileSync(path_.join(__dirname, '..', 'data', 'ads.json'), 'utf8');
  try {
    const cfg = JSON.parse(backup);
    cfg.enabled = true;
    cfg.slots['article-end'].script = 'https://example.com/banner.js';
    fs.writeFileSync(path_.join(__dirname, '..', 'data', 'ads.json'), JSON.stringify(cfg, null, 2));
    delete require.cache[require.resolve('../server')];
    const fresh = require('../server');
    const markup = fresh.adSlot('article-end');
    assert.match(markup, /class="ad-slot"/);
    assert.match(markup, /data-ad-script="https:\/\/example\.com\/banner\.js"/);
    assert.match(markup, /مساحة إعلانية/);
    const closed = JSON.parse(backup);
    for (const bad of ['', 'http://unsecure.example/x.js', 'javascript:alert(1)', 'https://a b/c.js']) {
      cfg.slots['article-end'].script = bad;
      fs.writeFileSync(path_.join(__dirname, '..', 'data', 'ads.json'), JSON.stringify(cfg, null, 2));
      delete require.cache[require.resolve('../server')];
      assert.equal(require('../server').adSlot('article-end'), '', 'سكربت مرفوض: ' + bad);
    }
    assert.equal(closed.enabled, false);
  } finally {
    fs.writeFileSync(path_.join(__dirname, '..', 'data', 'ads.json'), backup);
    delete require.cache[require.resolve('../server')];
  }
});

test('أرشيف المجلة مرقّم: canonical ذاتي وprev/next ونطاق صحيح', () => {
  const total = articlesPageCount();
  assert.ok(total >= 2, 'الأرشيف تجاوز صفحة واحدة');
  const p1 = articlesPage(ORIGIN);
  assert.match(p1, new RegExp('rel="canonical" href="' + ORIGIN + '/articles"'), 'الصفحة الأولى تُعرّف نفسها');
  assert.ok(!p1.includes('rel="prev"'), 'لا سابق للصفحة الأولى');
  assert.match(p1, new RegExp('rel="next" href="' + ORIGIN + '/articles/page/2"'));
  const p2 = articlesPage(ORIGIN, Date.now(), 2);
  assert.match(p2, new RegExp('rel="canonical" href="' + ORIGIN + '/articles/page/2"'), 'canonical ذاتي لا مجمَّع');
  assert.match(p2, new RegExp('rel="prev" href="' + ORIGIN + '/articles"'));
  const last = articlesPage(ORIGIN, Date.now(), total);
  assert.ok(!last.includes('rel="next"'), 'لا تالٍ للصفحة الأخيرة');
  assert.ok(!last.includes('journal-hero'), 'الغلاف في الصفحة الأولى فقط');
  // خارج النطاق يُقصّ إلى آخر صفحة داخليًّا
  const beyond = articlesPage(ORIGIN, Date.now(), total + 5);
  assert.match(beyond, new RegExp('rel="canonical" href="' + ORIGIN + '/articles/page/' + total + '"'));
  // صفحات الأرشيف معلنة في الخريطة، والصفحة الأولى غير معلنة لأنها تُحوَّل
  const xml = sitemapXml(ORIGIN);
  assert.ok(xml.includes(ORIGIN + '/articles/page/2'));
  assert.ok(!xml.includes(ORIGIN + '/articles/page/1<'));
});

test('المقال يربط السور التي يذكرها ويُعلنها في about', () => {
  const art = articles.find(a => a.slug === 'surah-al-mulk-structure');
  assert.ok(art, 'المقال المرجعي موجود');
  const html = articlePage(art, ORIGIN);
  assert.ok(html.includes('article-surah-links'), 'كتلة روابط السور');
  assert.match(html, /href="\/surah\/67"/, 'رابط سورة الملك');
  const schema = htmlSchema(html);
  const node = schema['@graph'].find(n => n['@type'] === 'Article');
  assert.ok(Array.isArray(node.about) && node.about.length >= 1, 'about ليس فارغًا');
  assert.ok(node.about.every(t => t['@type'] === 'Thing' && t.url.startsWith(ORIGIN + '/surah/')), 'about يشير إلى صفحات السور');
  assert.ok(typeof node.keywords === 'string' && node.keywords.includes(art.category), 'الكلمات المفتاحية تضم التصنيف');
  const plain = articles.find(a => surahMentions(a).length === 0);
  assert.ok(plain, 'يوجد مقال بلا ذكر سورة');
  assert.ok(!articlePage(plain, ORIGIN).includes('article-surah-links'), 'لا كتلة فارغة');
  // كل رابط سورة مُشتق من فهرس السور الرسمي، فلا رابط مكسور
  articles.forEach(a => surahMentions(a).forEach(c => assert.ok(chapters[c.number - 1].name === c.name)));
});

test('صفحة الأسئلة السريعة: FAQPage كامل وروابط داخلية سليمة', () => {
  const html = questionsPage(ORIGIN);
  assert.ok(QuranQuestions.length >= 20, 'عشرون سؤالًا على الأقل');
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.ok(html.includes('rel="canonical" href="' + ORIGIN + '/questions"'));
  assert.equal((html.match(/class="qa-item"/g) || []).length, QuranQuestions.length);
  const schema = htmlSchema(html);
  const faq = schema['@graph'].find(n => n['@type'] === 'FAQPage');
  assert.ok(faq && faq.mainEntity.length === QuranQuestions.length, 'كل سؤال في FAQPage');
  faq.mainEntity.forEach((q, i) => {
    assert.equal(q['@type'], 'Question');
    assert.equal(q.name, QuranQuestions[i].q);
    assert.ok(q.acceptedAnswer.text.length > 60, 'جوابٌ غير مختصر: ' + QuranQuestions[i].q);
  });
  // كل رابط داخلي في الصفحة يشير إلى صفحةٍ موجودة في الخريطة أو مسار معروف
  const xml = sitemapXml(ORIGIN);
  QuranQuestions.forEach(item => item.links.forEach(link => {
    assert.ok(link.href.startsWith('/') && !link.href.startsWith('//'));
    assert.ok(html.includes('href="' + link.href + '"'), 'رابط ظاهر: ' + link.href);
  }));
  assert.ok(xml.includes(ORIGIN + '/questions</loc>'), 'الصفحة في الخريطة');
});

test('روابط صفحة السورة موضوعية لا عشوائية وتشير إلى المحور', () => {
  const index = surahMentionIndex();
  const fallback = new Set(['reading-a-surah-in-one-sitting', 'tadabbur-questions-for-a-surah', 'how-to-read-tafsir-al-muyassar', 'tadabbur-journal']);
  for (let id = 1; id <= 114; id++) {
    const items = articlesForSurah(id, 4);
    assert.equal(items.length, 4, 'أربعة روابط للسورة ' + id);
    const mentioned = new Set((index.get(id) || []).map(a => a.slug));
    (SURAH_ARTICLE_HINTS[id] || []).forEach(slug => mentioned.add(slug));
    const name = chapters[id - 1].name.replace(/^سورة\s*/, '');
    items.forEach(a => {
      const ok = mentioned.has(a.slug) || a.title.includes(name) || a.summary.includes(name) || fallback.has(a.slug);
      assert.ok(ok, 'رابط غير موضوعي في السورة ' + id + ': ' + a.slug);
    });
  }
  assert.ok(articlesForSurah(89, 4).some(a => a.slug === 'surah-al-fajr-three-stories'), 'سورة الفجر تربط مقالها');
  assert.ok(articlesForSurah(93, 4).some(a => a.slug === 'surah-al-duha-comfort'), 'سورة الضحى تربط مقالها');
  const page = surahPage(89, ORIGIN);
  assert.ok(page.includes('/articles/surahs#surah-89'), 'رابط المحور من صفحة السورة');
});

test('صفحة «المقالات بحسب السورة» تجمع المقالات وتُعلنها في الخريطة', () => {
  const groups = surahArticleGroups();
  assert.ok(groups.length >= 10, 'عشر سور على الأقل');
  const totalLinks = groups.reduce((n, g) => n + g.articles.length, 0);
  const html = surahArticleHub(ORIGIN);
  assert.ok(html.includes('rel="canonical" href="' + ORIGIN + '/articles/surahs"'));
  assert.equal((html.match(/<h1/g) || []).length, 1, 'عنوان h1 واحد');
  groups.forEach(g => {
    assert.ok(html.includes('id="surah-' + g.chapter.number + '"'), 'مرساة السورة ' + g.chapter.number);
    assert.ok(html.includes('/surah/' + g.chapter.number), 'رابط صفحة السورة ' + g.chapter.number);
    g.articles.forEach(a => assert.ok(html.includes('/articles/' + a.slug), 'مقال مربوط: ' + a.slug));
  });
  const schema = htmlSchema(html);
  assert.deepEqual(schema['@graph'].map(n => n['@type']), ['CollectionPage', 'BreadcrumbList', 'ItemList']);
  const list = schema['@graph'].find(n => n['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, groups.length);
  assert.equal(list.itemListElement.length, groups.length);
  const xml = sitemapXml(ORIGIN);
  assert.ok(xml.includes(ORIGIN + '/articles/surahs</loc>'), 'المحور في الخريطة');
  assert.ok(html.includes('عدد') || totalLinks > 0);
  // كل مقال ظاهر في المحور منشور فعلًا
  const slugs = new Set(getPublishedArticles().map(a => a.slug));
  groups.flatMap(g => g.articles).forEach(a => assert.ok(slugs.has(a.slug)));
});

test('صورة غلاف المقال تُعلن مسبقًا في head وتُوصف بأبعادها', () => {
  const article = articles.at(-1);
  const html = articlePage(article, ORIGIN);
  const preload = html.match(/<link rel="preload" as="image"[^>]*>/);
  assert.ok(preload, 'رابط preload لصورة الغلاف');
  assert.ok(preload[0].includes(article.image), 'يُحمّل صورة المقال نفسها');
  assert.ok(preload[0].includes('imagesrcset'), 'srcset للصورتين ٦٤٠ و١٢٨٠');
  assert.ok(preload[0].includes('fetchpriority="high"'), 'أولوية عالية لعنصر LCP');
  assert.ok(preload[0].includes('imagesizes'), 'sizes مطابقة لصورة الغلاف');
  const start = html.indexOf('article-cover');
  const img = html.slice(start, start + 900);
  assert.ok(img.includes('width="1280"') && img.includes('height="714"'), 'أبعاد صريحة تمنع CLS');
});

test('كل صفحة أرشيف (وإن رُقّمت) لها عنوان h1 واحد قابل للفهرسة', () => {
  const total = articlesPageCount();
  for (let n = 1; n <= total; n++) {
    const html = articlesPage(ORIGIN, Date.now(), n);
    const h1s = html.match(/<h1[\s>]/g) || [];
    assert.equal(h1s.length, 1, 'عنوان h1 واحد في الصفحة ' + n);
    assert.ok(!/<h1[^>]*>\s*<\/h1>/.test(html), 'h1 غير فارغ في الصفحة ' + n);
  }
});

test('«قد يعجبك أيضًا» اختيارٌ موضوعي لا مجرد الأحدث', () => {
  const published = getPublishedArticles();
  assert.ok(published.length >= 20);
  const counts = new Map();
  for (const a of published) {
    for (const r of [a.category]) counts.set(r, (counts.get(r) || 0) + 1);
  }
  let topics = 0, total = 0;
  for (const a of published) {
    const picks = relatedArticlesFor(a);
    assert.equal(picks.length, 2, 'اختياران لكل مقال: ' + a.slug);
    assert.equal(new Set(picks.map(x => x.slug)).size, 2, 'لا تكرار: ' + a.slug);
    assert.ok(!picks.some(x => x.slug === a.slug), 'لا يشير المقال إلى نفسه: ' + a.slug);
    picks.forEach(x => { total += 1; if (x.category === a.category) topics += 1; });
  }
  assert.ok(topics / total >= 0.8, 'اختيارات من الباب نفسه: ' + topics + '/' + total);
});

test('خريطة الموقع تُعلن تاريخ تحديث صفحة المجلة', () => {
  const xml = sitemapXml(ORIGIN, Date.parse('2026-10-29T09:00:00Z'));
  const hub = xml.match(/<url><loc>[^<]*\/articles<\/loc>(<lastmod>[^<]+<\/lastmod>)?<\/url>/);
  assert.ok(hub, 'صفحة المجلة موجودة في الخريطة');
  assert.match(hub[0], /<lastmod>\d{4}-\d{2}-\d{2}T/);
});

test('روابط المقالات الداخلية تشير إلى صفحات موجودة', () => {
  const slugs = new Set(articles.map(a => a.slug));
  const hubs = new Set(CATEGORY_HUBS.map(h => h.slug));
  const missing = [];
  for (const a of articles) {
    for (const link of a.related) {
      const m = link.href.match(/^\/articles\/(?:category\/)?([^/?#]+)/);
      if (!m) continue;
      const target = m[1];
      if (link.href.includes('/articles/category/')) { if (!hubs.has(target)) missing.push(link.href); }
      else if (!slugs.has(target)) missing.push(link.href);
    }
  }
  assert.deepEqual(missing, []);
});

test('صفحة مسار التعلّم تجمع المراحل وتربط مقالات منشورة فقط', () => {
  const html = learnPage(ORIGIN);
  const published = getPublishedArticles();
  const slugs = new Set(published.map(a => a.slug));
  assert.equal((html.match(/class="learn-stage"/g) || []).length, LEARN_STAGES.length);
  LEARN_STAGES.forEach(stage => {
    assert.ok(stage.intro.length >= 100, 'مقدمة المرحلة كافية: ' + stage.title);
    const linked = learnStageArticles(stage);
    assert.equal(linked.length, stage.slugs.length, 'كل مقالات المرحلة منشورة: ' + stage.title);
    linked.forEach(a => assert.ok(slugs.has(a.slug)) && assert.ok(html.includes(`href="/articles/${a.slug}"`)));
  });
  const hrefs = [...html.matchAll(/href="\/articles\/([a-z0-9-]+)"/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 20, 'المسار يربط عشرين مقالًا على الأقل');
  assert.deepEqual([...new Set(hrefs)].filter(slug => slug !== 'surahs' && !slugs.has(slug)), [], 'لا روابط مكسورة');
  const schema = htmlSchema(html);
  assert.deepEqual(schema['@graph'].map(n => n['@type']), ['LearningResource', 'BreadcrumbList', 'ItemList']);
  assert.ok(html.includes('rel="canonical" href="' + ORIGIN + '/learn"'));
  assert.ok(html.includes('href="/learn"'), 'الصفحة مرتبطة من التنقل');
});

test('مسار التعلّم داخل خريطة الموقع وفي بيانات الموقع', () => {
  const xml = sitemapXml(ORIGIN);
  assert.ok(xml.includes('<loc>' + ORIGIN + '/learn</loc>'));
  const llms = require('../server').llmsTxt(ORIGIN);
  assert.ok(llms.includes(ORIGIN + '/learn'));
});

test('أدلة السور: محتوى فريد وصحيح ومربوط بالمسار', () => {
  const ids = Object.keys(surahGuides).map(Number);
  assert.equal(ids.length, 114, 'دليل لكل سورة في المصحف');
  const slugs = new Set(articles.map(a => a.slug));
  for (const id of ids) {
    const chapter = chapters.find(c => c.number === id);
    assert.ok(chapter, 'رقم سورة صحيح: ' + id);
    const guide = surahGuides[String(id)];
    assert.ok(guide.intro.length >= 180, 'مقدمة كافية للسورة ' + id);
    assert.ok(guide.themes.length >= 2, 'محوران على الأقل للسورة ' + id);
    assert.ok(guide.note.length >= 40, 'ملاحظة عملية للسورة ' + id);
    assert.match(guide.updatedAt || '', /^\d{4}-\d{2}-\d{2}$/, 'تاريخ تحديث صالح للسورة ' + id);
    if (guide.article) {
      assert.ok(guide.article.startsWith('/articles/'));
      assert.ok(slugs.has(guide.article.replace('/articles/', '')), 'المقال المربوط موجود: ' + guide.article);
    }
    const html = surahPage(id, ORIGIN);
    assert.ok(html.includes('surah-about'), 'المقطع يُعرض في صفحة السورة ' + id);
    assert.ok(html.includes(guide.intro.slice(0, 60)), 'نص الدليل ظاهر في الصفحة ' + id);
    assert.ok(html.includes('href="/learn"'), 'رابط مسار التعلّم موجود في السورة ' + id);
    assert.ok(html.includes(chapter.name), 'اسم السورة يطابق البيانات');
  }
  assert.equal(new Set(ids.map(id => surahGuides[String(id)].intro)).size, ids.length, 'لا تكرار بين المقدمات');
});

test('فضل السورة لا يُعرض إلا بنصّ منقول ومصدر واضح', () => {
  const merited = Object.entries(surahGuides).filter(([, g]) => g.merit);
  assert.ok(merited.length >= 7, 'سبع سور على الأقل بفضل منقول');
  for (const [id, guide] of merited) {
    assert.ok(guide.merit.length >= 90, 'نصّ الفضل كافٍ للسورة ' + id);
    assert.ok(/صحيح|سنن|حسّنه|ثبت|صحّح/.test(guide.merit), 'ذكر مرجع حديثي للسورة ' + id);
    const html = surahPage(Number(id), ORIGIN);
    assert.ok(html.includes('surah-merit'), 'كتلة الفضل معروضة للسورة ' + id);
    assert.ok(html.includes(guide.merit.slice(0, 40)), 'نصّ الفضل ظاهر للسورة ' + id);
  }
  const kahf = surahPage(18, ORIGIN);
  assert.ok(kahf.includes('يوم الجمعة'), 'فضل قراءة الكهف يوم الجمعة مذكور');
  assert.ok(!surahPage(2, ORIGIN).includes('surah-merit'), 'لا كتلة فضل بلا نصّ منقول');
  const index = require('../server').surahsPage(ORIGIN);
  assert.ok(index.includes('merit-strip'), 'فهرس السور يعرض شريط الفضل');
  merited.forEach(([id]) => assert.ok(index.includes(`href="/surah/${id}"`), 'شريط الفضل يربط السورة ' + id));
});

test('صفحة أدلة السور: ٧٥ دليلًا مع روابط عميقة إلى مقطع السورة', () => {
  const html = guidesPage(ORIGIN);
  const ids = Object.keys(surahGuides).map(Number).sort((a, b) => a - b);
  assert.equal((html.match(/class="guide-card"/g) || []).length, ids.length, 'بطاقة لكل دليل');
  ids.forEach(id => assert.ok(html.includes(`href="/surah/${id}#surah-about"`), 'رابط عميق للسورة ' + id));
  assert.ok(html.includes('جزء عمّ أولًا') && html.includes('وبقية المصحف'), 'تجميع تحريري واضح');
  const schema = htmlSchema(html);
  const list = schema['@graph'].find(n => n['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, ids.length);
  assert.equal(list.itemListElement.length, ids.length);
  assert.equal(schema['@graph'].find(n => n['@type'] === 'CollectionPage').dateModified, '2026-10-29');
  assert.equal(schema['@graph'].find(n => n['@type'] === 'BreadcrumbList').itemListElement.length, 3);
  assert.ok(sitemapXml(ORIGIN).includes(`${ORIGIN}/guides</loc>`), 'الصفحة في الخريطة');
  assert.ok(require('../server').llmsTxt(ORIGIN).includes(`${ORIGIN}/guides`), 'الصفحة في llms.txt');
  assert.ok(require('../server').surahsPage(ORIGIN).includes('href="/guides"'), 'فهرس السور يربطها');
});

test('جزء عمّ مكتمل تحريريًّا: دليل لكل سورة من سور الجزء', () => {
  const juz30 = chapters.filter(c => c.juz === 30);
  assert.equal(juz30.length, 37);
  const missing = juz30.filter(c => !surahGuides[String(c.number)]);
  assert.deepEqual(missing.map(c => c.number), [], 'لا سورة في جزء عمّ بلا دليل');
  const page = juzAmmaPage(ORIGIN);
  assert.equal((page.match(/class="juz-card"/g) || []).length, 37);
  assert.equal((page.match(/<em>/g) || []).length, 37, 'كل بطاقة تعرض محورًا تحريريًّا');
  assert.ok(page.includes('دليلًا تحريريًّا'), 'الصفحة تعلن اكتمال الأدلة');
  const guides = guidesPage(ORIGIN);
  assert.ok(guides.includes('٣٧ سورة'), 'صفحة الأدلة تعلن اكتمال جزء عمّ');
});

test('أجزاء القرآن الثلاثون محسوبة ومتقاطعة مع النص الكامل', () => {
  const numbers = Object.keys(juzBounds).map(Number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 30 }, (_, i) => i + 1));
  const ayahs = numbers.reduce((sum, n) => sum + juzBounds[String(n)].ayahs, 0);
  const words = numbers.reduce((sum, n) => sum + juzBounds[String(n)].words, 0);
  assert.equal(ayahs, 6236, 'مجموع آيات الأجزاء = آيات المصحف');
  assert.equal(words, 77881, 'مجموع كلمات الأجزاء = كلمات المصحف');
  // البدايات المشهورة في مصحف المدينة
  const start = n => `${juzBounds[String(n)].first.s}:${juzBounds[String(n)].first.a}`;
  assert.equal(start(1), '1:1');
  assert.equal(start(2), '2:142');
  assert.equal(start(15), '17:1');
  assert.equal(start(26), '46:1');
  assert.equal(start(29), '67:1');
  assert.equal(start(30), '78:1');
  const page = juzPage(14, ORIGIN);
  assert.ok(page.includes('الجزء ١٤ من القرآن الكريم'), 'العنوان يحمل رقم الجزء');
  assert.ok(page.includes('href="/surah/15#ayah-1"'), 'رابط أول آية في الجزء');
  assert.ok(page.includes('href="/juz/13"') && page.includes('href="/juz/15"'), 'التنقل بين الأجزاء');
  const schema = htmlSchema(page)['@graph'];
  assert.equal(schema.find(n => n['@type'] === 'ItemList').numberOfItems, juzBounds['14'].surahs.length);
  assert.equal(schema.find(n => n['@type'] === 'BreadcrumbList').itemListElement.length, 3);
  const index = juzIndexPage(ORIGIN);
  assert.equal((index.match(/class="juz-card"/g) || []).length, 30);
  // آية السورة: رقم صحيح داخل حدودها
  const keys = Object.keys(surahKeyAyahs).map(Number);
  assert.equal(keys.length, 114, 'آية مفتاحية لكل سورة');
  assert.equal(htmlSchema(index)['@graph'].find(n => n['@type'] === 'ItemList').numberOfItems, 30);
  const xml = sitemapXml(ORIGIN);
  numbers.forEach(n => assert.ok(xml.includes(`${ORIGIN}/juz/${n}</loc>`), 'الجزء في الخريطة: ' + n));
});

test('آية تُختصر بها السورة: مطابقة للنص لا للأرقام المحفوظة', () => {
  // هيكل صوتي بلا حروف مد ولا همزات، يقارن الرسم العثماني بالإملائي
  const flush = t => t
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[اويء]/g, '').replace(/\s+/g, '');
  const ids = Object.keys(surahKeyAyahs).map(Number).sort((a, b) => a - b);
  assert.deepEqual(ids, chapters.map(c => c.number), 'آية لكل سورة من ١١٤');
  for (const id of ids) {
    const entry = surahKeyAyahs[String(id)];
    const chapter = chapters[id - 1];
    assert.ok(Number.isInteger(entry.ayah) && entry.ayah >= 1 && entry.ayah <= chapter.ayahCount, 'رقم آية صالح ' + id);
    assert.ok(entry.why.length >= 30, 'تعليل كافٍ ' + id);
    const verseText = flush(require('../server').verses[id][entry.ayah - 1]);
    assert.ok(verseText.includes(flush(entry.snippet)), `نصّ الآية يطابق المقطع المحفوظ للسورة ${id} (الآية ${entry.ayah})`);
    const html = surahPage(id, ORIGIN);
    assert.ok(html.includes('id="surah-key"'), 'الكتلة معروضة في ' + id);
    assert.ok(html.includes(`href="#ayah-${entry.ayah}"`), 'رابط الآية الصحيح في ' + id);
    assert.ok(html.includes('آية السورة'), 'رابط الانتقال السريع في ' + id);
  }
  const { verses, splitOpening } = require('../server');
  const quote = id => {
    const m = surahPage(id, ORIGIN).match(/<p class="surah-key-text"[^>]*>﴿ ([\s\S]*?) ﴾<\/p>/);
    return m && m[1];
  };
  assert.equal(flush(quote(1)), flush(verses[1][surahKeyAyahs['1'].ayah - 1]), 'الاقتباس مطابق لنصّ المصحف كلمةً بكلمة');
  assert.equal(flush(quote(112)), flush(splitOpening(112).first), 'البسملة لا تُكرّر داخل الاقتباس');
  assert.ok(quote(18).length > 20, 'الاقتباس غير فارغ');
});

test('صفحة الموضوعات: ١٨ موضوعًا مستخرجًا من محاور الأدلة', () => {
  assert.ok(topics.length >= 18, 'ثمانية عشر موضوعًا');
  const seen = new Set();
  for (const t of topics) {
    assert.ok(/^[a-z-]+$/.test(t.slug) && !seen.has(t.slug), 'معرّف فريد: ' + t.slug);
    seen.add(t.slug);
    assert.ok(t.intro.length >= 90, 'مقدمة تحريرية كافية: ' + t.slug);
    assert.ok(t.surahs.length >= 3, 'ثلاث سور على الأقل: ' + t.slug);
    assert.ok(t.surahs.every(id => Number.isInteger(id) && id >= 1 && id <= 114));
    assert.equal(new Set(t.surahs).size, t.surahs.length, 'بلا تكرار داخل الموضوع: ' + t.slug);
  }
  const html = topicsPage(ORIGIN);
  assert.equal((html.match(/class="topic-block"/g) || []).length, topics.length);
  assert.ok(html.includes('id="topic-sabr"'), 'مرساة الموضوع');
  topics.forEach(t => assert.ok(html.includes(`href="/surah/${t.surahs[0]}#surah-about"`), 'رابط عميق للموضوع: ' + t.slug));
  const schema = htmlSchema(html);
  assert.equal(schema['@graph'].find(n => n['@type'] === 'ItemList').numberOfItems, topics.length);
  assert.equal(schema['@graph'].find(n => n['@type'] === 'BreadcrumbList').itemListElement.length, 3);
  assert.ok(sitemapXml(ORIGIN).includes(`${ORIGIN}/topics</loc>`), 'الصفحة في الخريطة');
  assert.ok(require('../server').llmsTxt(ORIGIN).includes(`${ORIGIN}/topics`), 'الصفحة في llms.txt');
});

test('أسئلة سريعة محسوبة في كل صفحة سورة بلا تكرار بين سورتين', () => {
  const seen = new Set();
  for (const chapter of chapters) {
    const html = surahPage(chapter.number, ORIGIN);
    const block = html.match(/<section class="surah-quick"[\s\S]*?<\/section>/);
    assert.ok(block, 'الكتلة موجودة في ' + chapter.number);
    const answers = [...block[0].matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map(m => m[1]);
    assert.ok(answers.length >= 4, 'أربعة أسئلة على الأقل في ' + chapter.number);
    assert.ok(answers[0].includes('آية'), 'جواب عدد الآيات في ' + chapter.number);
    assert.ok(answers[1].includes('الجزء'), 'جواب الجزء في ' + chapter.number);
    assert.ok(answers[2].includes('كلمة'), 'جواب الكلمات في ' + chapter.number);
    const signature = answers[0] + '|' + answers[2];
    assert.ok(!seen.has(signature), 'لا تكرار حرفيّ بين سورتين: ' + chapter.number);
    seen.add(signature);
    assert.ok(html.includes('href="#surah-quick"'), 'رابط الانتقال السريع في ' + chapter.number);
  }
  const kahf = surahPage(18, ORIGIN);
  assert.ok(kahf.includes('١١٠ آية'), 'عدد آيات الكهف مطابق');
  assert.ok(kahf.includes(arabicWords(surahStatsFor(18).words)), 'عدد كلمات الكهف مطابق');
});

test('خريطة الكلمات المفتاحية: عناقيد موجّهة إلى صفحات قائمة', () => {
  assert.ok(keywordClusters.length >= 25, '٢٥ عنقودًا على الأقل');
  const ids = keywordClusters.map(c => c.id), queries = keywordClusters.map(c => c.query);
  assert.equal(new Set(ids).size, ids.length, 'معرّفات فريدة');
  assert.equal(new Set(queries).size, queries.length, 'استعلامات فريدة');
  const validTarget = t => t === '/' || /^\/(surahs|listen|learn|guides|topics|articles|about|juz)$/.test(t) || /^\/surah\/(\d{1,3})$/.test(t) || /^\/juz\/(\d{1,2})$/.test(t) || /^\/topics#topic-[a-z-]+$/.test(t);
  for (const c of keywordClusters) {
    assert.ok(validTarget(c.target), 'هدف صالح: ' + c.id + ' → ' + c.target);
    assert.ok(c.longTails.length >= 2, 'ذيل طويل كافٍ: ' + c.id);
    assert.ok(c.intent.length >= 6, 'نيّة محددة: ' + c.id);
    const m = c.target.match(/^\/surah\/(\d{1,3})$/);
    if (m) assert.ok(chapters[Number(m[1]) - 1], 'السورة موجودة: ' + c.id);
    const t = c.target.match(/^\/topics#topic-([a-z-]+)$/);
    if (t) assert.ok(topics.some(x => x.slug === t[1]), 'الموضوع موجود: ' + c.id);
    const j = c.target.match(/^\/juz\/(\d{1,2})$/);
    if (j) assert.ok(juzBounds[j[1]], 'الجزء موجود: ' + c.id);
  }
  const nav = popularSearches();
  assert.ok(nav.includes('popular-searches'), 'شريط الأكثر طلبًا يُبنى');
  assert.equal((nav.match(/<a /g) || []).length, 10, 'عشرة روابط في الشريط');
  assert.ok(require('../server').surahsPage(ORIGIN).includes('popular-searches'), 'الشريط معروض في فهرس السور');
});

test('كل سورة لها موضوع واحد على الأقل، والربط في الاتجاهين', () => {
  const covered = new Set(topics.flatMap(t => t.surahs));
  const missing = chapters.filter(c => !covered.has(c.number)).map(c => c.number);
  assert.deepEqual(missing, [], 'لا سورة خارج تصنيف الموضوعات');
  for (const id of [1, 2, 18, 55, 112, 113, 114]) {
    const html = surahPage(id, ORIGIN);
    const block = html.match(/<nav class="surah-topics"[\s\S]*?<\/nav>/);
    assert.ok(block, 'شريط الموضوعات في السورة ' + id);
    const slugs = [...block[0].matchAll(/href="\/topics#topic-([a-z-]+)"/g)].map(m => m[1]);
    assert.ok(slugs.length >= 1, 'موضوع واحد على الأقل للسورة ' + id);
    assert.equal(new Set(slugs).size, slugs.length, 'بلا تكرار في السورة ' + id);
    for (const slug of slugs) {
      const topic = topics.find(t => t.slug === slug);
      assert.ok(topic, 'الموضوع موجود: ' + slug);
      assert.ok(topic.surahs.includes(id), `الربط متطابق في الاتجاهين: ${slug} ↔ ${id}`);
    }
  }
});

test('اكتمال مشروع الأدلة: دليل مستقل لكل سورة من ١١٤ سورة', () => {
  const ids = Object.keys(surahGuides).map(Number).sort((a, b) => a - b);
  assert.equal(ids.length, 114);
  assert.deepEqual(ids, chapters.map(c => c.number), 'كل سورة من ١ إلى ١١٤ لها دليل');
  surahGuides && ids.forEach(id => {
    const guide = surahGuides[String(id)];
    assert.ok(guide.intro.length >= 180 && guide.themes.length >= 2 && guide.note.length >= 40, 'دليل مكتمل للسورة ' + id);
  });
  const html = guidesPage(ORIGIN);
  assert.equal((html.match(/class="guide-card"/g) || []).length, 114);
  assert.ok(html.includes('على كل سورة من سور المصحف'), 'الصفحة تعلن الاكتمال');
  const list = htmlSchema(html)['@graph'].find(n => n['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, 114);
  assert.equal(list.itemListElement.length, 114);
  // كل صفحة سورة تحمل الآن تاريخ تحديث تحريري
  for (const id of [1, 42, 77, 114]) {
    const schema = htmlSchema(surahPage(id, ORIGIN));
    assert.equal(schema['@graph'][0].dateModified, surahGuides[String(id)].updatedAt);
  }
});

test('كل صفحة سورة تربط مسار التعلّم ولو بلا دليل مخصص', () => {
  for (const id of [5, 33, 77, 95]) {
    const html = surahPage(id, ORIGIN);
    assert.ok(html.includes('surah-learn-hint'), 'تلميح المسار في السورة ' + id);
    assert.ok(html.includes('href="/learn"'));
  }
});

test('إحصاءات السور محسوبة من النص ومطابقة لمرجع خارجي', () => {
  // ١٬٥٨٣ كلمة لسورة الكهف هي نفس القيمة المنشورة على surahquran.com — تحقق تقاطعي.
  assert.equal(surahStatsFor(18).words, 1583);
  assert.equal(surahStatsFor(1).words, 29);
  assert.equal(surahStatsFor(112).words, 19);
  const total = Object.keys(surahStats).reduce((n, id) => n + surahStats[id].words, 0);
  assert.equal(total, 77881, 'مجموع كلمات المصحف ثابت');
  for (const chapter of chapters) {
    const stats = surahStatsFor(chapter.number);
    assert.ok(stats.words >= 3, 'كلمات السورة ' + chapter.number);
    assert.ok(stats.letters > stats.words * 3, 'الحروف أكثر من الكلمات بثلاثة أضعاف: ' + chapter.number);
    assert.ok(stats.minutes >= 1, 'زمن قراءة موجب: ' + chapter.number);
  }
  const summary = surahSummary(chapters[17]);
  assert.ok(summary.includes('مكية') && summary.includes('١١٠') && summary.includes('١٬٥٨٣'));
});

test('أسماء السور تُطابق بصور الهمزة المختلفة (إبراهيم ↔ ابراهيم)', () => {
  const article = { slug: 'x', title: 'سورة إبراهيم: دعاءٌ للذرية', summary: 'عن سورة إبراهيم', lead: '', sections: [{ heading: '', paragraphs: [] }] };
  const mentioned = surahMentions(article, 4).map(c => c.number);
  assert.ok(mentioned.includes(14), 'سورة إبراهيم تُطابق ١٤');
  const article2 = { slug: 'y', title: 'سورة الإنفطار: مشهد الانشقاق', summary: '', lead: '', sections: [{ heading: '', paragraphs: [] }] };
  assert.ok(surahMentions(article2, 4).map(c => c.number).includes(82), 'الإنفطار تُطابق ٨٢');
});

test('صفحة الآية تعرض النص والتفسير ومسار التنقّل وتُفهرس', () => {
  const html = ayahPage(2, 1, ORIGIN);
  assert.ok(html && html.length > 4000);
  assert.ok(html.includes('الآية ١'), 'عنوان الصفحة يذكر رقم الآية');
  assert.ok(html.includes('التفسير الميسّر'), 'قسم التفسير موجود');
  assert.ok(html.includes('rel="canonical" href="' + ORIGIN + '/ayah/2/1"'), 'canonical صحيح');
  assert.equal(ayahPage(2, 100, ORIGIN), null, 'الآية غير المشمولة تُرجع صفحة مفقودة');
  assert.ok(ayahPage(2, 255, ORIGIN), 'آية الكرسي مشمولة دائمًا');
  assert.ok(sitemapXml(ORIGIN).includes('<loc>' + ORIGIN + '/ayah/2/1</loc>'), 'الآية في الخريطة');
  const schema = htmlSchema(html);
  assert.deepEqual(schema['@graph'].map(n => n['@type']), ['WebPage', 'BreadcrumbList']);
  assert.equal(schema['@graph'][1].itemListElement.length, 4, 'مسار من أربع درجات');
});

test('النص العثماني منزوع البسملة من أول آية إلا الفاتحة', () => {
  const strip = t => t.replace(/[\u064B-\u0652\u0670\u0640\u06D6-\u06ED]/g, '');
  const withBasmala = AYAH_PAGES.filter(x => strip(x.text).startsWith('بسم') && !(x.s === 1 && x.a === 1));
  assert.deepEqual(withBasmala.map(x => x.s + ':' + x.a), [], 'لا بسملة ملتصقة بآية');
  assert.ok(AYAH_PAGES.find(x => x.s === 18 && x.a === 1).text.trim().length > 10, 'الكهف:١ نص حقيقي');
});

test('آية اليوم تتغيّر يوميًا وتشير إلى صفحة آية موجودة', () => {
  const a = ayahOfDay(ORIGIN, Date.parse('2026-10-29T08:00:00Z'));
  const b = ayahOfDay(ORIGIN, Date.parse('2026-10-30T08:00:00Z'));
  assert.notEqual(a, b, 'محتوى اليوم يختلف عن الغد');
  assert.ok(a.includes('آيَةُ اليَوْم'));
  const m = a.match(/href="\/ayah\/(\d+)\/(\d+)"/);
  assert.ok(m, 'رابط صفحة الآية موجود');
  assert.ok(AYAH_PAGES.some(x => x.s === Number(m[1]) && x.a === Number(m[2])), 'الآية موجودة في البيانات');
});

test('فهرس الآيات يعرض كل الصفحات ويُفهرس', () => {
  const html = ayahIndexPage(ORIGIN);
  assert.ok(html && html.length > 50000);
  const linked = new Set(html.match(/href="\/ayah\/\d+\/\d+"/g) || []);
  assert.equal(linked.size, AYAH_PAGES.length, 'كل آية مفهرسة مرة واحدة');
  assert.ok(html.includes('rel="canonical" href="' + ORIGIN + '/ayah"'));
  assert.ok(sitemapXml(ORIGIN).includes('<loc>' + ORIGIN + '/ayah</loc>'), 'الفهرس في الخريطة');
  assert.equal(htmlSchema(html)['@graph'].map(n => n['@type']).join(','), 'CollectionPage,BreadcrumbList');
  const surahSections = new Set((html.match(/href="\/surah\/(\d+)"/g) || []));
  assert.equal(surahSections.size, 114, 'روابط السور الـ١١٤');
});

test('كل صفحات الآيات مبنيّة من نصٍّ قرآني وتفسيرٍ غير فارغ', () => {
  const empty = AYAH_PAGES.filter(item => !item.text || !item.tafsir || item.tafsir.length < 12).map(item => item.s + ':' + item.a);
  assert.deepEqual(empty, []);
  assert.equal(new Set(AYAH_PAGES.map(item => item.s + ':' + item.a)).size, AYAH_PAGES.length, 'لا تكرار');
  assert.ok(AYAH_PAGES.length >= 600, 'عدد صفحات الآيات ' + AYAH_PAGES.length);
});

test('صفحة السورة تعرض حقائق البيانات وروابط الانتقال الداخلي', () => {
  const html = surahPage(18, ORIGIN);
  assert.ok(html.includes('عدد الكلمات'));
  assert.ok(html.includes('Al-Kahf'), 'الاسم الإنجليزي للبحث الثنائي اللغة');
  assert.ok(html.includes('زمن القراءة'));
  assert.ok(html.includes('class="reader-jump"'), 'شريط انتقال سريع');
  assert.ok(html.includes('id="reading"'));
  assert.ok(html.includes('href="#surah-about"'));
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(description.includes('وكلماتها'), 'وصف الصفحة يتضمن عدد الكلمات');
  assert.ok(description.length <= 165, 'وصف الصفحة لا يتجاوز حد العرض');
});

test('أدلة السور تحمل تاريخ تحديث ظاهرًا وبيانات منظمة مطابقة', () => {
  const html = surahPage(18, ORIGIN);
  const schema = htmlSchema(html);
  assert.equal(schema['@graph'][0]['@type'], 'WebPage');
  assert.equal(schema['@graph'][0].dateModified, surahGuides['18'].updatedAt);
  assert.ok(html.includes('آخر تحديث للمحتوى التحريري'), 'التاريخ ظاهر للقارئ لا للمحرك فقط');
  // كل السور لها أدلة الآن، فنختبر مسار «بلا دليل» بحذف دليل مؤقتًا ثم إعادته.
  const saved = surahGuides['114'];
  delete surahGuides['114'];
  const plain = surahPage(114, ORIGIN);
  surahGuides['114'] = saved;
  assert.ok(!('dateModified' in htmlSchema(plain)['@graph'][0]), 'لا تاريخ مزعوم لصفحة بلا محتوى تحريري');
  assert.ok(plain.includes('surah-learn-hint'), 'تلميح المسار يظهر بدل الدليل');
});

test('تغطية الأدلة تشمل أكثر السور بحثًا', () => {
  const covered = Object.keys(surahGuides).map(Number);
  for (const id of [1, 2, 12, 18, 19, 20, 36, 55, 56, 67, 78, 112, 113, 114]) {
    assert.ok(covered.includes(id), 'السورة المشهورة مغطاة: ' + id);
  }
  // لا يتجاوز عدد الأدلة عدد السور أصلًا
  assert.ok(covered.length <= 114);
  assert.deepEqual(covered, [...new Set(covered)], 'لا تكرار');
});

test('صفحة السورة تربط ثلاث سور أخرى دون ربط السورة بنفسها', () => {
  for (const id of [1, 18, 30, 60, 114]) {
    const html = surahPage(id, ORIGIN);
    const block = html.match(/<nav class="surah-same-juz"[\s\S]*?<\/nav>/);
    assert.ok(block, 'كتلة السور المجاورة موجودة في ' + id);
    const hrefs = [...block[0].matchAll(/href="\/surah\/(\d+)"/g)].map(m => Number(m[1]));
    assert.equal(hrefs.length, 3, 'ثلاثة روابط داخلية في ' + id);
    assert.equal(new Set(hrefs).size, 3, 'لا تكرار في ' + id);
    assert.ok(!hrefs.includes(id), 'لا رابط للسورة نفسها في ' + id);
    for (const target of hrefs) assert.ok(target >= 1 && target <= 114);
  }
});

test('صفحة جزء عمّ تجمع ٣٧ سورة بالترتيب وتُفهرس', () => {
  const html = juzAmmaPage(ORIGIN);
  const expected = chapters.filter(c => c.juz === 30);
  assert.equal(expected.length, 37);
  assert.equal((html.match(/class="juz-card"/g) || []).length, 37);
  const hrefs = [...html.matchAll(/href="\/surah\/(\d+)"/g)].map(m => Number(m[1]));
  for (const c of expected) assert.ok(hrefs.includes(c.number), 'السورة مدرجة: ' + c.name);
  assert.ok(html.includes(ORIGIN + '/juz/30'), 'canonical');
  const schema = htmlSchema(html);
  assert.deepEqual(schema['@graph'].map(n => n['@type']), ['CollectionPage', 'BreadcrumbList', 'ItemList']);
  assert.equal(schema['@graph'][2].numberOfItems, 37);
  assert.equal(schema['@graph'][1].itemListElement.length, 3, 'مسار تنقّل من ثلاث درجات');
  assert.ok(sitemapXml(ORIGIN).includes('<loc>' + ORIGIN + '/juz/30</loc>'));
});

test('كل مقالٍ عنوانه «سورة كذا» يظهر في صفحة سورته نفسها', () => {
  const names = chapters.map(c => ({ number: c.number, name: c.name.replace(/^سورة\s*/, '').trim() }))
    .sort((a, b) => b.name.length - a.name.length);
  const surahArticles = articles.filter(a => a.slug.startsWith('surah-') && a.title.startsWith('سورة '));
  assert.ok(surahArticles.length >= 30, 'عدد مقالات السور ' + surahArticles.length);
  const missed = [];
  for (const a of surahArticles) {
    const rest = a.title.replace(/^سورة\s+/, '');
    const hit = names.find(n => rest.startsWith(n.name));
    if (!hit) { missed.push(a.slug + ' (اسم السورة غير مطابق في العنوان)'); continue; }
    const top = articlesForSurah(hit.number, 4).map(x => x.slug);
    if (!top.includes(a.slug)) missed.push(a.slug + ' -> ' + hit.name + ' :: ' + top.join(','));
  }
  assert.deepEqual(missed, []);
});

test('أسماء السور القصيرة «ص» و«ق» لا تُطابق حرفًا داخل كلمة', () => {
  // «تُلخّص» تنتهي بشدّةٍ قبل الصاد؛ بلا تجريد التشكيل تُقرأ كأنها كلمة «ص» مستقلة.
  for (const id of [38, 50]) {
    const links = articlesForSurah(id, 4).map(x => x.slug);
    assert.equal(links.length, 4, 'روابط كاملة للسورة ' + id);
    assert.ok(!links.includes('surah-al-asr-four-verses'));
    assert.ok(!links.includes('surah-al-humazah-wealth'));
  }
  assert.ok(articlesForSurah(68, 4).length > 0, 'سورة القلم تُعرض بلا تعطّل');
});

test('كل سورة من ١١٤ لها مقال يذكرها بالاسم', () => {
  const seen = new Set();
  for (const article of articles) for (const chapter of surahMentions(article)) seen.add(chapter.number);
  const missing = [];
  for (let n = 1; n <= 114; n += 1) if (!seen.has(n)) missing.push(n);
  assert.deepEqual(missing, []);
});

test('تحليلات Vercel تظهر في بيئة Vercel فقط وبلا تبعية npm', () => {
  const prev = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    assert.ok(!homePage(ORIGIN).includes('/_vercel/insights/'), 'لا سكربت تحليلات خارج Vercel');
    process.env.VERCEL = '1';
    const html = homePage(ORIGIN);
    assert.ok(html.includes('src="/_vercel/insights/script.js"'), 'سكربت التحليلات موجود في بيئة Vercel');
    assert.ok(html.includes('window.va=window.va||'), 'مهيّئ قائمة الأحداث موجود قبل السكربت');
    assert.ok(html.indexOf('window.va=') < html.indexOf('/_vercel/insights/script.js'), 'المهيّئ يسبق السكربت المؤجّل');
  } finally {
    if (prev === undefined) delete process.env.VERCEL; else process.env.VERCEL = prev;
  }
  assert.ok(!('@vercel/analytics' in (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).dependencies || {})), 'لا تبعية @vercel/analytics غير المستخدمة');
});
