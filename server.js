'use strict';

/* سَنا — a small, server-rendered Quran reader. The source text is kept verbatim
   in data/quran-uthmani.txt, including the Tanzil Project copyright notice. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {timingSafeEqual} = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const chapters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chapters.json'), 'utf8'));
const articles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/articles.json'), 'utf8'));
const verseLines = fs.readFileSync(path.join(ROOT, 'data/quran-uthmani.txt'), 'utf8').split(/\r?\n/);
const verses = Array.from({length: 115}, () => []);
for (const line of verseLines) {
  const match = line.match(/^(\d+)\|(\d+)\|(.*)$/u);
  if (!match) continue;
  const surah = Number(match[1]), ayah = Number(match[2]);
  if (surah < 1 || surah > 114 || ayah !== verses[surah].length + 1 || !match[3]) throw new Error('Unexpected Quran source order');
  verses[surah].push(match[3]);
}
if (chapters.length !== 114 || chapters.some(c => verses[c.number].length !== c.ayahCount) || verses.flat().length !== 6236) {
  throw new Error('Quran source verification failed: expected 114 surahs and 6,236 verses');
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const arabicFormatter = new Intl.NumberFormat('ar-EG');
const ar = number => arabicFormatter.format(number);
const ayahCount = number => `${ar(number)} ${number >= 3 && number <= 10 ? 'آيات' : 'آية'}`;
const normalize = text => String(text).normalize('NFKD')
  .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF\u0640\u200B-\u200F\uFEFF]/g, '')
  .replace(/[ٱأإآ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
  .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .toLowerCase().replace(/\s+/g, ' ').trim();
const searchable = chapters.map(c => ({...c, norm: normalize(`${c.name} سورة ${c.englishName} ${c.number}`), verses: verses[c.number].map((t, i) => ({num: i + 1, text: t, norm: normalize(t)}))}));

// For display only, move the source's exact opening prefix onto a separate line.
// This preserves the two special idgham spellings in surahs 95 and 97.
function splitOpening(surah) {
  const first = verses[surah][0];
  if (surah === 1 || surah === 9) return {opening: '', first};
  const match = first.match(/^(ب\S+\s+ٱللَّهِ\s+ٱلرَّحْمَـٰنِ\s+ٱلرَّحِيمِ)\s+(.+)$/u);
  if (!match) throw new Error(`Unrecognized opening in surah ${surah}`);
  return {opening: match[1], first: match[2]};
}
for (let s = 1; s <= 114; s++) splitOpening(s);

const iconPaths = {
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bookmark:'<path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.6L6 21z"/>',
  book:'<path d="M12 6.5c-2.1-1.5-4.9-1.9-8-1v12c3.1-.9 5.9-.5 8 1m0-12c2.1-1.5 4.9-1.9 8-1v12c-3.1-.9-5.9-.5-8 1m0-12v12"/>',
  headphones:'<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="12" width="4" height="7" rx="1.6"/><rect x="17" y="12" width="4" height="7" rx="1.6"/>',
  arrowLeft:'<path d="M19 12H5m6-6-6 6 6 6"/>',
  arrowRight:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  play:'<path d="m9 6 10 6-10 6z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M8 5h3v14H8zm5 0h3v14h-3z" fill="currentColor" stroke="none"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  close:'<path d="M6 6l12 12M18 6 6 18"/>',
  moon:'<path d="M20 13.1A8 8 0 0 1 10.9 4a8.3 8.3 0 1 0 9.1 9.1Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  spark:'<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
  copy:'<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>',
  share:'<circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/>',
  text:'<path d="M4 5h16M12 5v14m-4 0h8M5 11l-2 7m0-3h4m-2-4 2 7"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  trash:'<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v5m4-5v5"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  volume:'<path d="M4 10v4h4l5 4V6L8 10H4zm12-1a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  leaf:'<path d="M19.5 4.5C10 4.5 5 8 5 14c0 3 2 5 5 5 6 0 9.5-5 9.5-14.5ZM5 20c2.5-4 5.5-7 10-10"/>',
};
function icon(name, cls = '', size = 20) {
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
}
function brand() {
  return `<a class="brand" href="/" aria-label="سَنا، الصفحة الرئيسية"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M24 5.3 28 9l5.4-.5 1.9 5.1 5 2-1 5.2 3.7 4-3.7 4 1 5.2-5 2-1.9 5.1-5.4-.5-4 3.7-4-3.7-5.4.5-1.9-5.1-5-2 1-5.2-3.7-4 3.7-4-1-5.2 5-2 1.9-5.1 5.4.5 4-3.7Z" stroke="currentColor" stroke-width="1.15" opacity=".75"/><path d="M24 17v14m0-10c-2-1.9-4.6-2.8-7.5-2.3v8.5c3-.3 5.4.5 7.5 2m0-8c2-1.9 4.6-2.8 7.5-2.3v8.5c-3-.3-5.4.5-7.5 2" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span><span class="brand-word">سَنا<small>للقرآن الكريم</small></span></a>`;
}
function medallion(n) {
  return `<span class="number-medallion"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 2.8 29.5 8l7.5-.2.5 7.3 5.7 4.9-4.1 6.2 1.8 7.2-7 2.3-3.3 6.5L24 39.4l-6.6 2.8-3.3-6.5-7-2.3 1.8-7.2L4.8 20l5.7-4.9.5-7.3 7.5.2L24 2.8Z" stroke="currentColor" stroke-width="1"/><circle cx="24" cy="24" r="14.5" stroke="currentColor" stroke-width=".75"/></svg><span>${ar(n)}</span></span>`;
}
function siteHeader(active = '') {
  return `<header class="site-header"><div class="shell header-inner">${brand()}<nav class="desktop-nav" aria-label="التنقل الرئيسي"><a class="${active === 'home' ? 'active' : ''}" href="/">الرئيسية</a><a href="/#surahs">فهرس السور</a><a href="/#listen">التلاوات</a><a class="${active === 'articles' ? 'active' : ''}" href="/articles">المقالات</a><a href="/#about">عن سَنا</a></nav><div class="header-actions"><button class="icon-button header-search" type="button" data-open-search aria-label="البحث">${icon('search')}</button><a class="icon-button header-bookmark" href="/bookmarks" aria-label="الآيات المحفوظة">${icon('bookmark')}<span class="saved-dot" data-bookmark-dot hidden></span></a><button class="icon-button theme-toggle" type="button" data-theme-toggle aria-label="تغيير المظهر">${icon('moon','moon-icon')}${icon('sun','sun-icon')}</button><a class="header-cta" href="/surah/18">ابدأ القراءة ${icon('arrowLeft','',17)}</a><button class="icon-button menu-toggle" type="button" aria-label="فتح القائمة" aria-expanded="false" aria-controls="mobile-nav" data-menu-toggle>${icon('menu')}</button></div></div><nav id="mobile-nav" class="mobile-nav" aria-label="قائمة الهاتف" hidden><a href="/">الرئيسية</a><a href="/#surahs">فهرس السور</a><a href="/#listen">التلاوات</a><a href="/articles">المقالات</a><a href="/bookmarks">الآيات المحفوظة</a><a href="/#about">عن سَنا</a></nav></header>`;
}
function footer() {
  return `<footer class="footer" id="about"><div class="shell footer-main"><div class="footer-brand">${brand()}<p>رفقةٌ هادئة مع كتاب الله،<br>تبدأ بآية وتستمرّ كل يوم.</p><span class="footer-small">صُنِع بمحبة لكتاب الله ${icon('spark','',16)}</span></div><div class="footer-col"><h3>اكتشف سَنا</h3><a href="/#surahs">فهرس السور</a><a href="/surah/18">سورة الكهف</a><a href="/#listen">التلاوات</a><a href="/articles">مجلة سَنا</a><a href="/feed.xml">خلاصة المجلة RSS</a><a href="/bookmarks">الآيات المحفوظة</a></div><div class="footer-col"><h3>المصادر</h3><a href="https://tanzil.net/" target="_blank" rel="noopener noreferrer">النص القرآني: مشروع تنزيل ↗</a><a href="https://everyayah.com/" target="_blank" rel="noopener noreferrer">تلاوات الآيات: EveryAyah ↗</a><a href="https://www.mp3quran.net/" target="_blank" rel="noopener noreferrer">تلاوات السور: MP3Quran ↗</a><a href="https://alquran.cloud/" target="_blank" rel="noopener noreferrer">التفسير: AlQuran Cloud ↗</a></div><div class="footer-quote"><span>آيةٌ بعد آية</span><strong>طمأنينةٌ<br>ترافق قلبك.</strong><span class="footer-ornament">✺</span></div></div><div class="shell footer-bottom"><p>© سَنا للقرآن الكريم · تجربة صُممت للتدبّر</p><p>النص العثماني من مشروع <a href="https://tanzil.net/" target="_blank" rel="noopener noreferrer">تنزيل</a>، مع الاحتفاظ بإشعار الترخيص.</p></div></footer>`;
}
function dialogsAndPlayer() {
 return `<dialog class="search-dialog" id="search-dialog" aria-labelledby="search-title"><div class="dialog-head"><div><span class="section-kicker">ابحث في كتاب الله</span><h2 id="search-title">عن ماذا تبحث؟</h2></div><button class="icon-button" data-close-dialog aria-label="إغلاق البحث">${icon('close')}</button></div><form class="dialog-search" action="/search" method="get">${icon('search')}<label class="sr-only" for="global-search">ابحث عن سورة أو آية</label><input id="global-search" name="q" placeholder="ابحث عن سورة أو كلمة من آية..." autocomplete="off" required><button class="button button-dark" type="submit">بحث ${icon('arrowLeft','',17)}</button></form><p class="dialog-help">ابحث باسم السورة، رقمها، أو بكلمات من الآية.</p><div class="dialog-shortcuts"><span>قد تبحث عن</span><a href="/surah/18">سورة الكهف</a><a href="/surah/36">سورة يس</a><a href="/surah/67">سورة الملك</a></div></dialog><dialog class="tafsir-dialog" id="tafsir-dialog" aria-labelledby="tafsir-title"><div class="dialog-head"><div><span class="section-kicker">معاني الآيات</span><h2 id="tafsir-title">التفسير الميسّر</h2></div><button class="icon-button" data-close-dialog aria-label="إغلاق التفسير">${icon('close')}</button></div><div id="tafsir-reference" class="tafsir-ref"></div><p id="tafsir-content" class="tafsir-content" role="status"></p><p class="tafsir-source">التفسير الميسّر عبر <a href="https://alquran.cloud/" target="_blank" rel="noopener noreferrer">AlQuran Cloud</a>.</p></dialog><div class="audio-player" id="audio-player" hidden aria-label="مشغل التلاوة"><div class="player-inner"><button class="player-play" data-player-toggle aria-label="إيقاف التلاوة مؤقتًا">${icon('pause','player-pause',19)}${icon('play','player-resume',19)}</button><div class="player-info"><strong id="player-title">سورة الكهف</strong><span id="player-subtitle">مشاري العفاسي</span></div><div class="player-track"><input id="player-progress" type="range" min="0" max="1000" value="0" aria-label="موضع التلاوة"><div class="player-times"><span id="player-current">٠:٠٠</span><span id="player-duration">٠:٠٠</span></div></div><span class="player-volume">${icon('volume','',19)}</span><button class="icon-button player-close" data-player-close aria-label="إغلاق مشغل التلاوة">${icon('close','',19)}</button></div><audio id="audio-element" preload="none"></audio></div><div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}
function layout({title, description, body, active = '', url, canonical, schema = null, noindex = false, image = '/hero-quran.webp', type = 'website', publishedAt = ''}) {
  const schemaTag = schema ? `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>` : '';
  // The verification value is public metadata, not an OAuth credential. Keep it
  // configured in production after verification so Google can recheck ownership.
  const googleVerification = String(process.env.GOOGLE_SITE_VERIFICATION || '').trim().replace(/^google-site-verification=/i, '');
  const googleVerificationTag = googleVerification ? `<meta name="google-site-verification" content="${esc(googleVerification)}">` : '';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#153c32">${googleVerificationTag}<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}"><link rel="canonical" href="${esc(canonical || url)}"><meta property="og:type" content="${esc(type)}"><meta property="og:locale" content="ar_AR"><meta property="og:site_name" content="سَنا للقرآن الكريم"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical || url)}"><meta property="og:image" content="${esc(new URL(image, url).href)}">${publishedAt ? `<meta property="article:published_time" content="${esc(publishedAt)}">` : ''}<meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate" type="application/rss+xml" title="مجلة سَنا" href="/feed.xml"><link rel="preload" href="/fonts/plex-400-arabic.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/style.css"><script>try{if(localStorage.getItem('sana-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}</script>${schemaTag}<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};</script><script defer src="/_vercel/insights/script.js"></script></head><body><a class="skip-link" href="#main">تجاوز إلى المحتوى</a>${siteHeader(active)}<main id="main">${body}</main>${footer()}${dialogsAndPlayer()}<script src="/app.js" defer></script></body></html>`;
}
function quickLink(iconName, title, desc, href, extra = '') {
  return `<a class="quick-link" href="${href}" ${extra}><span class="quick-icon">${icon(iconName,'',22)}</span><span class="quick-copy"><strong>${title}</strong><small>${desc}</small></span><span class="quick-arrow">${icon('arrowLeft','',16)}</span></a>`;
}
function miniFeature(num, label) {
 const c=chapters[num-1];
 return `<a class="mini-feature" href="/surah/${c.number}"><div class="mini-feature-top">${medallion(c.number)}<span>${esc(label)}</span></div><div><h3>سورة ${esc(c.name)}</h3><p>${c.revelation} · ${ayahCount(c.ayahCount)}</p></div><span class="mini-link">قراءة السورة ${icon('arrowLeft','',16)}</span></a>`;
}
function surahCard(c) {
 return `<a class="surah-card" href="/surah/${c.number}" data-surah-card data-surah-name="${esc(`${c.name} ${c.englishName} ${c.number}`)}" data-surah-type="${c.revelation}">${medallion(c.number)}<span class="surah-card-name"><strong>${esc(c.name)}</strong><small dir="ltr">${esc(c.englishName)}</small></span><span class="surah-card-meta"><span>${c.revelation}</span><small>${ayahCount(c.ayahCount)}</small></span>${icon('arrowLeft','card-arrow',16)}</a>`;
}
function homePage(origin) {
 const c18 = chapters[17];
 const body = `<div class="shell home-shell"><div class="home-prelude"><div><span class="prelude-star">✦</span> أَهْلًا بِكَ فِي سَنا</div><span>مساحةٌ هادئة لقلبٍ مطمئن</span></div><section class="hero" aria-labelledby="hero-title"><img class="hero-image" src="/hero-quran.webp" alt="" fetchpriority="high"><div class="hero-shade"></div><div class="hero-copy"><div class="hero-eyebrow"><span>✦</span> وَرْدٌ مِنْ نُورٍ، كُلَّ يَوْم</div><h1 id="hero-title">لأنَّ في القرآن<br><em>حياةً للقلب.</em></h1><p>مساحتك الهادئة لقراءة القرآن الكريم، والاستماع إلى آياته، والتدبّر في معانيه... أينما كنت.</p><div class="hero-actions"><a class="button button-cream" href="/surah/18">ابدأ القراءة ${icon('arrowLeft','',18)}</a><button class="button button-ghost" type="button" data-play-surah="18" data-reciter="afs"><span class="play-outline">${icon('play','',14)}</span> استمع الآن</button></div><div class="hero-foot"><span class="hero-foot-mark">✧</span><span>آيةٌ واحدة قد تغيّر يومك كله</span></div></div><div class="hero-image-caption"><span></span> سَنا · رِفْقَةُ الْقُرْآن</div></section><section class="quick-links" aria-label="روابط سريعة">${quickLink('book','تصفّح السور','كتاب الله بين يديك','/#surahs')}${quickLink('headphones','استمع بخشوع','تلاوات تلامس القلب','/#listen')}${quickLink('clock','أكمل قراءتك','عُد إلى آخر موضع','/surah/18','data-continue')}${quickLink('bookmark','آياتك المحفوظة','لحظات تستحق العودة','/bookmarks')}</section><section class="featured-section" aria-labelledby="featured-title"><div class="section-heading"><div><span class="section-kicker"><span>✦</span> نُورٌ لِيَوْمِكَ</span><h2 id="featured-title">رحلةٌ تبدأ بآية<span class="gold-dot">.</span></h2><p>اختر ما يلامس قلبك، واجعل للقرآن مساحة في يومك.</p></div><a class="text-link" href="#surahs">تصفّح كل السور ${icon('arrowLeft','',18)}</a></div><div class="featured-grid"><a class="feature-kahf" href="/surah/18"><div class="feature-kahf-content"><span class="feature-label">✦ &nbsp; نُورُ يَوْمِ الْجُمُعَة</span><h3>سورة الكهف</h3><p>${c18.revelation} &nbsp;·&nbsp; ${ayahCount(c18.ayahCount)} &nbsp;·&nbsp; السورة ${ar(18)}</p><span class="feature-read">اقرأ السورة ${icon('arrowLeft','',17)}</span></div><div class="feature-arch" aria-hidden="true"><span>الكهف</span></div></a>${miniFeature(1,'البداية')}${miniFeature(36,'للروح')}${miniFeature(67,'قبل النوم')}</div></section><section class="directory-section" id="surahs" aria-labelledby="directory-title"><div class="section-heading directory-heading"><div><span class="section-kicker"><span>✦</span> الْقُرْآنُ الْكَرِيم</span><h2 id="directory-title">فهرس السور<span class="gold-dot">.</span></h2><p>كلّ سور القرآن الكريم، في مكان واحد.</p></div><div class="directory-search">${icon('search','',19)}<label class="sr-only" for="surah-search">ابحث عن سورة</label><input type="search" id="surah-search" placeholder="ابحث عن سورة أو رقمها..." autocomplete="off"><kbd>⌕</kbd></div></div><div class="directory-tabs" role="group" aria-label="تصفية السور"><button type="button" class="filter-tab active" data-filter="all" aria-pressed="true">جميع السور <span>${ar(114)}</span></button><button type="button" class="filter-tab" data-filter="مكية" aria-pressed="false">السور المكية</button><button type="button" class="filter-tab" data-filter="مدنية" aria-pressed="false">السور المدنية</button></div><div class="surah-list" id="surah-list">${chapters.map(surahCard).join('')}</div><p class="empty-filter" id="surah-empty" hidden>لم نجد سورة بهذا الاسم. جرّب كلمة أخرى.</p><div class="directory-more"><button class="button button-outline" id="show-all" type="button" hidden>عرض جميع السور ${icon('down','',17)}</button></div></section><section class="listen-section" id="listen" aria-labelledby="listen-title"><div class="listen-intro"><span class="section-kicker"><span>✦</span> صَوْتٌ يَصِلُ إِلَى الْقَلْب</span><h2 id="listen-title">أنصت، واطمئن<span class="gold-dot">.</span></h2><p>خذ لحظة لنفسك، واستمع إلى سورة الكهف بصوت قارئك المفضل.</p><div class="listen-quote"><span>﴿</span>${esc(verses[13][27])}<span>﴾</span><small>سورة الرعد · الآية ${ar(28)}</small></div></div><div class="reciters"><button class="reciter-card" type="button" data-play-surah="18" data-reciter="afs"><span class="reciter-avatar">م</span><span class="reciter-details"><strong>مشاري العفاسي</strong><small>سورة الكهف · تلاوة قرآنية</small></span><span class="reciter-play">${icon('play','',16)}</span></button><button class="reciter-card" type="button" data-play-surah="18" data-reciter="maher"><span class="reciter-avatar avatar-sand">م</span><span class="reciter-details"><strong>ماهر المعيقلي</strong><small>سورة الكهف · تلاوة قرآنية</small></span><span class="reciter-play">${icon('play','',16)}</span></button><button class="reciter-card" type="button" data-play-surah="18" data-reciter="basit"><span class="reciter-avatar avatar-olive">ع</span><span class="reciter-details"><strong>عبد الباسط عبد الصمد</strong><small>سورة الكهف · تلاوة قرآنية</small></span><span class="reciter-play">${icon('play','',16)}</span></button><span class="audio-source">التلاوات من MP3Quran · تتطلب اتصالًا بالإنترنت</span></div></section>${homeArticleSection()}<section class="closing-note"><span class="closing-icon">${icon('spark','',22)}</span><div><strong>للقرآن في كل يوم حكاية.</strong><p>اجعلها أجمل عادة في يومك.</p></div><a class="button button-dark" href="/surah/1">ابدأ بسورة الفاتحة ${icon('arrowLeft','',17)}</a></section></div>`;
 return layout({title:'سَنا | القرآن الكريم قراءة واستماع وتدبّر',description:'اقرأ القرآن الكريم بالرسم العثماني، واستمع إلى التلاوات، واحفظ آياتك وموضع قراءتك في تجربة عربية هادئة على سَنا.',body,active:'home',url:origin+'/', schema:{'@context':'https://schema.org','@type':'WebSite',name:'سَنا للقرآن الكريم',url:origin+'/',inLanguage:'ar',description:'قراءة القرآن الكريم والاستماع إلى تلاواته.'}});
}
function ayahRow(c, text, n) {
 return `<article class="ayah-row" id="ayah-${n}" data-ayah-row data-surah="${c.number}" data-ayah="${n}" data-surah-name="${esc(c.name)}" data-ayah-text="${esc(text)}"><div class="ayah-row-head"><div class="ayah-reference">${medallion(n)}<span>${ar(c.number)}:${ar(n)}</span></div><div class="ayah-actions"><button class="ayah-action" type="button" data-play-ayah aria-label="استمع إلى الآية ${ar(n)}" title="استمع للآية">${icon('play','',16)}</button><button class="ayah-action bookmark-action" type="button" data-bookmark-ayah aria-label="حفظ الآية ${ar(n)}" aria-pressed="false" title="حفظ الآية">${icon('bookmark','',17)}</button><button class="ayah-action" type="button" data-copy-ayah aria-label="نسخ الآية ${ar(n)}" title="نسخ الآية">${icon('copy','',17)}</button><button class="ayah-action" type="button" data-tafsir-ayah aria-label="تفسير الآية ${ar(n)}" title="التفسير الميسّر">${icon('book','',17)}</button><button class="ayah-action share-action" type="button" data-share-ayah aria-label="مشاركة الآية ${ar(n)}" title="مشاركة الآية">${icon('share','',17)}</button></div></div><p class="ayah-text" lang="ar">${esc(text)} <span class="ayah-end">۝${ar(n)}</span></p></article>`;
}
function surahPage(id, origin) {
 const c = chapters[id - 1], {opening,first} = splitOpening(id);
 const selected = chapters.map(ch => `<option value="${ch.number}"${ch.number===id?' selected':''}>${ar(ch.number)}. ${esc(ch.name)}</option>`).join('');
 const rows = verses[id].map((v,i) => ayahRow(c, i === 0 ? first : v, i+1)).join('');
 const prev=id>1?chapters[id-2]:null, next=id<114?chapters[id]:null;
 const body=`<div class="shell reader-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/#surahs">فهرس السور</a><span>›</span><span>سورة ${esc(c.name)}</span></nav><section class="reader-intro"><div><span class="section-kicker"><span>✦</span> وِرْدُكَ الْيَوْمِيّ</span><h1>سورة ${esc(c.name)} مكتوبة</h1><p>اقرأ سورة ${esc(c.name)} كاملةً بالرسم العثماني، واستمع إلى تلاوتها واقرأ تفسير آياتها.</p></div><div class="intro-motif" aria-hidden="true">✺</div></section><div class="reader-layout"><section class="reader-main" aria-label="قراءة السورة"><div class="reader-toolbar"><div class="reader-tabs"><span class="reader-tab active">${icon('book','',18)} القراءة</span><button type="button" data-play-surah="${id}" data-reciter="afs">${icon('headphones','',18)} الاستماع</button></div><div class="reader-tools"><span>حجم الخط</span><button type="button" class="font-button" data-font-change="-2" aria-label="تصغير خط القرآن">أ−</button><button type="button" class="font-button" data-font-change="2" aria-label="تكبير خط القرآن">أ+</button></div></div><div class="surah-frame"><div class="surah-frame-title"><span class="frame-flourish">❋</span><div><span>الْقُرْآنُ الْكَرِيم</span><h2>سورة ${esc(c.name)}</h2><p>${c.revelation} &nbsp;·&nbsp; ${ayahCount(c.ayahCount)} &nbsp;·&nbsp; ترتيبها ${ar(id)}</p></div><span class="frame-flourish">❋</span></div>${opening?`<div class="basmala" lang="ar">${esc(opening)}</div>`:''}<div class="ayah-list">${rows}</div></div><div class="surah-navigation">${prev?`<a href="/surah/${prev.number}">${icon('arrowRight','',17)}<span><small>السورة السابقة</small><strong>سورة ${esc(prev.name)}</strong></span></a>`:'<span></span>'}${next?`<a href="/surah/${next.number}"><span><small>السورة التالية</small><strong>سورة ${esc(next.name)}</strong></span>${icon('arrowLeft','',17)}</a>`:'<span></span>'}</div>${surahJournalLinks(id)}<div class="source-note">${icon('info','',18)} النص القرآني بالرسم العثماني من <a href="https://tanzil.net/" target="_blank" rel="noopener noreferrer">مشروع تنزيل</a>. يمكنك استخدام أزرار كل آية للاستماع والحفظ والنسخ والتفسير.</div></section><aside class="reader-aside"><div class="aside-card aside-choose"><span class="aside-overline">تَنَقَّلْ بِسُهُولَة</span><h2>فهرس السور</h2><p>إلى أين تأخذك رحلتك اليوم؟</p><form action="/go" method="get" class="surah-select-form"><label class="sr-only" for="surah-select">اختر سورة</label><select id="surah-select" name="id">${selected}</select><button type="submit" aria-label="الانتقال إلى السورة">${icon('arrowLeft','',17)}</button></form><a class="aside-link" href="/#surahs">عرض فهرس السور كاملًا ${icon('arrowLeft','',15)}</a></div><div class="aside-card surah-info"><h2>عن السورة <span>✦</span></h2><div><span>ترتيب السورة</span><strong>${ar(id)}</strong></div><div><span>عدد الآيات</span><strong>${ayahCount(c.ayahCount)}</strong></div><div><span>نوع السورة</span><strong>${c.revelation}</strong></div><div><span>بداية الجزء</span><strong>${ar(c.juz)}</strong></div><div><span>بداية الصفحة</span><strong>${ar(c.page)}</strong></div></div><div class="aside-reminder"><span>✦</span><strong>آيةٌ بعد آية،<br>يطمئن القلب.</strong><p>احفظ ما يلامس قلبك لتعود إليه لاحقًا.</p><a href="/bookmarks">آياتي المحفوظة ${icon('arrowLeft','',15)}</a></div></aside></div></div>`;
 const pageUrl=origin+`/surah/${id}`;
 const schema={'@context':'https://schema.org','@graph':[{'@type':'WebPage','@id':pageUrl,url:pageUrl,name:`سورة ${c.name} مكتوبة كاملة`,inLanguage:'ar',isPartOf:{'@type':'WebSite',name:'سَنا للقرآن الكريم',url:origin+'/'}},{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:`سورة ${c.name}`,item:pageUrl}]}]};
 return layout({title:`سورة ${c.name} مكتوبة كاملة بالتشكيل | سَنا`,description:`اقرأ سورة ${c.name} مكتوبة كاملة بالرسم العثماني، ${c.revelation} وعدد آياتها ${c.ayahCount}. استمع إلى التلاوة، واحفظ الآيات، واقرأ التفسير الميسّر.`,body,url:pageUrl,schema});
}
// Scheduled editorial content is finite, bundled at deploy time, and becomes
// publicly reachable only when its publication instant has passed. This does
// not generate new articles or require a cron job to make pages available.
function validateArticleBatch(batch) {
  if (!Array.isArray(batch)) return [];
  const counts = field => batch.reduce((map, a) => {
    const value = a && typeof a[field] === 'string' ? a[field].trim() : '';
    if (value) map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map());
  const slugCounts = counts('slug'), titleCounts = counts('title');
  const text = (value, min = 1, max = 10000) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
  const safeHttps = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch (_) { return false; } };
  return batch.filter(a => {
    if (!a || typeof a !== 'object' || !text(a.slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug) || slugCounts.get(a.slug) !== 1 || titleCounts.get(a.title) !== 1) return false;
    if (!text(a.title,10,160) || !text(a.summary,40,300) || !text(a.lead,50,1000) || !text(a.category,2,80) || !text(a.imageAlt,10,300)) return false;
    if (!text(a.publishedAt) || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(a.publishedAt) || !Number.isFinite(Date.parse(a.publishedAt))) return false;
    if (!text(a.image) || !/^\/articles\/[a-z0-9-]+\.webp$/.test(a.image) || !fs.existsSync(path.join(PUBLIC, a.image))) return false;
    if (!Number.isInteger(a.minutes) || a.minutes < 1 || a.minutes > 30 || !Array.isArray(a.sections) || a.sections.length < 3) return false;
    if (!a.sections.every(s => s && text(s.heading,4,160) && Array.isArray(s.paragraphs) && s.paragraphs.length && s.paragraphs.every(p => text(p,30,3000)) && (s.list === undefined || (Array.isArray(s.list) && s.list.every(item => text(item,5,500)))))) return false;
    const wordCount = a.sections.flatMap(s => s.paragraphs).join(' ').trim().split(/\s+/).length;
    if (wordCount < 120 || !Array.isArray(a.sources) || a.sources.length < 2 || !a.sources.every(source => source && text(source.label,4,200) && safeHttps(source.url))) return false;
    if (!Array.isArray(a.related) || !a.related.length || !a.related.every(r => r && text(r.label,4,200) && text(r.href) && r.href.startsWith('/') && !r.href.startsWith('//'))) return false;
    return true;
  });
}
// Fail closed for malformed content without taking the Quran reader offline.
// These checks are structural, not a scholarly or semantic content review.
const validatedArticles = validateArticleBatch(articles);
function getPublishedArticles(now = Date.now()) {
  const instant = now instanceof Date ? now.getTime() : Number(now);
  return validatedArticles.filter(a => Date.parse(a.publishedAt) <= instant)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
// Reading pages are the highest-authority pages on the site, so each surah also
// links to a few evergreen magazine articles: real internal links, not a link farm.
const SURAH_ARTICLE_HINTS = {
  1: ['how-to-read-tafsir-al-muyassar','daily-quran-reading-plan','tafsir-versus-translation'],
  2: ['distinguish-similar-verses','memorize-a-page-in-a-week','focus-while-reading-quran'],
  18: ['surah-al-kahf-reading-guide','quran-surahs-directory-guide','listen-to-quran-surah-and-ayah'],
  36: ['tadabbur-journal','daily-quran-reading-plan'],
  54: ['memorize-a-page-in-a-week','focus-while-reading-quran'],
  55: ['tadabbur-journal','teach-children-quran-at-home'],
  67: ['memorize-a-page-in-a-week','listen-to-quran-while-commuting','distinguish-similar-verses'],
  73: ['focus-while-reading-quran','daily-quran-reading-plan'],
  75: ['focus-while-reading-quran','listen-to-quran-surah-and-ayah']
};
function articlesForSurah(id, limit = 3, now = Date.now()) {
  const published = getPublishedArticles(now);
  if (!published.length) return [];
  const bySlug = new Map(published.map(a => [a.slug, a]));
  const picked = (SURAH_ARTICLE_HINTS[id] || []).map(slug => bySlug.get(slug)).filter(Boolean);
  const rest = published.filter(a => !picked.includes(a));
  let cursor = rest.length ? (id * 3) % rest.length : 0;
  while (picked.length < limit && rest.length) { picked.push(rest[cursor % rest.length]); cursor++; }
  return [...new Map(picked.map(a => [a.slug, a])).values()].slice(0, limit);
}
function surahJournalLinks(id, now = Date.now()) {
  const items = articlesForSurah(id, 3, now);
  if (!items.length) return '';
  return `<section class="surah-journal" aria-labelledby="surah-journal-title"><div class="surah-journal-head"><div><span class="section-kicker"><span>✦</span> مِنْ مَجَلَّةِ سَنا</span><h2 id="surah-journal-title">اقرأ بعد التلاوة</h2></div><a href="/articles" class="text-link">جميع المقالات ${icon('arrowLeft','',15)}</a></div><ul>${items.map(a => `<li><a href="/articles/${esc(a.slug)}"><span>${esc(a.category)}</span><strong>${esc(a.title)}</strong></a></li>`).join('')}</ul></section>`;
}
function articleDate(value) {
  return new Intl.DateTimeFormat('ar-EG', {year:'numeric',month:'long',day:'numeric',timeZone:'Africa/Cairo'}).format(new Date(value));
}
function articleCard(article, featured = false) {
  return `<article class="journal-card${featured ? ' journal-card-featured' : ''}"><a class="journal-card-image" href="/articles/${esc(article.slug)}" tabindex="-1" aria-hidden="true"><img src="${esc(article.image)}" alt="" width="1280" height="714" loading="lazy"></a><div class="journal-card-copy"><div class="journal-card-meta"><span>${esc(article.category)}</span><span class="meta-divider">•</span><time datetime="${esc(article.publishedAt)}">${esc(articleDate(article.publishedAt))}</time></div><h3><a href="/articles/${esc(article.slug)}">${esc(article.title)}</a></h3><p>${esc(article.summary)}</p><a class="journal-card-link" href="/articles/${esc(article.slug)}" aria-label="اقرأ: ${esc(article.title)}">اقرأ المقال ${icon('arrowLeft','',16)}</a></div></article>`;
}
function homeArticleSection(now = Date.now()) {
  const article = getPublishedArticles(now)[0];
  if (!article) return '';
  return `<section class="home-journal" aria-labelledby="home-journal-title"><div class="section-heading"><div><span class="section-kicker"><span>✦</span> مَجَلَّةُ سَنا</span><h2 id="home-journal-title">للقراءة بقلبٍ حاضر<span class="gold-dot">.</span></h2><p>أفكار وأدلة عملية ترافق رحلتك مع القرآن.</p></div><a class="text-link" href="/articles">جميع المقالات ${icon('arrowLeft','',18)}</a></div><a class="home-journal-card" href="/articles/${esc(article.slug)}"><img src="${esc(article.image)}" alt="" width="1280" height="714" loading="lazy"><div><span class="home-journal-eyebrow">${esc(article.category)} <i>·</i> ${esc(articleDate(article.publishedAt))}</span><h3>${esc(article.title)}</h3><p>${esc(article.summary)}</p><span class="home-journal-link">اقرأ المقال ${icon('arrowLeft','',16)}</span></div></a></section>`;
}
function articlesPage(origin, now = Date.now()) {
  const published = getPublishedArticles(now), pageUrl = origin + '/articles';
  const cards = published.length ? published.map((article, index) => articleCard(article, index === 0)).join('') : `<div class="journal-empty"><span>✧</span><h2>قريبًا في مجلة سَنا</h2><p>نعدّ لك مساحة لمقالات وأدلة ترافق قراءتك.</p><a href="/">العودة للرئيسية</a></div>`;
  const body = `<div class="shell journal-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>المقالات</span></nav><section class="journal-hero"><div class="journal-hero-copy"><span class="journal-kicker"><i>✦</i> مَجَلَّةُ سَنا</span><h1>للقراءة<br><em>حكايةٌ أخرى.</em></h1><p>مساحة هادئة لأدلة ومقالات تساعدك على القراءة، والاستماع، والعودة إلى كتاب الله كل يوم.</p><span class="journal-hero-tag"><span>✧</span> آيةٌ بعد آية، نتعلّم</span></div><div class="journal-hero-art" aria-hidden="true"><span class="journal-art-ring ring-one"></span><span class="journal-art-ring ring-two"></span><div class="journal-art-center">✳<small>سَنا</small></div><span class="journal-art-note">اقْرَأْ وَتَدَبَّرْ</span></div></section><div class="journal-list-head"><div><span class="section-kicker"><span>✦</span> فِي الْمَجَلَّة</span><h2>مقالات وأدلة<span class="gold-dot">.</span></h2><p>خطوات بسيطة، لرحلة قراءة أكثر حضورًا.</p></div><span class="journal-count">${ar(published.length)} ${published.length === 1 ? 'مقال منشور' : 'مقالات منشورة'}</span></div><section class="journal-grid" aria-label="المقالات المنشورة">${cards}</section><aside class="journal-disclosure"><span class="disclosure-icon">✧</span><div><strong>عن محتوى المجلة</strong><p>أُعدّت هذه المقالات بمساعدة الذكاء الاصطناعي، وهي أدلة عامة لا تغني عن الرجوع إلى المصادر الموثوقة وأهل العلم في المسائل المتخصصة. صور المقالات توضيحية ومولّدة بالذكاء الاصطناعي.</p></div></aside></div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'CollectionPage','@id':pageUrl,url:pageUrl,name:'مجلة سَنا: مقالات وأدلة للقراءة',inLanguage:'ar',isPartOf:{'@type':'WebSite',name:'سَنا للقرآن الكريم',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'المقالات',item:pageUrl}]},
    {'@type':'ItemList','@id':pageUrl+'#articles',numberOfItems:published.length,itemListElement:published.map((a,index)=>({'@type':'ListItem',position:index+1,url:origin+'/articles/'+a.slug,name:a.title}))}
  ]};
  return layout({title:'مجلة سَنا | مقالات وأدلة للقراءة في القرآن',description:'مقالات وأدلة عملية لقراءة القرآن الكريم والاستماع إليه، واستخدام أدوات سَنا.',body,active:'articles',url:pageUrl,schema});
}
function articlePage(article, origin, now = Date.now()) {
  const pageUrl = origin + '/articles/' + article.slug;
  const parts = article.sections.map((section, index) => `<section class="article-section" id="section-${index + 1}"><h2>${esc(section.heading)}</h2>${section.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}${section.list ? `<ul>${section.list.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}</section>`).join('');
  const outline = article.sections.map((section, index) => `<a href="#section-${index + 1}"><span>${ar(index + 1).padStart(1,'٠')}</span>${esc(section.heading)}</a>`).join('');
  const sources = article.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} <span aria-hidden="true">↗</span></a></li>`).join('');
  const relatedLinks = article.related.map(r => `<a href="${esc(r.href)}">${esc(r.label)} ${icon('arrowLeft','',16)}</a>`).join('');
  const next = getPublishedArticles(now).filter(a => a.slug !== article.slug).slice(0, 2);
  const relatedArticles = next.length ? `<section class="article-more"><div class="section-heading"><div><span class="section-kicker"><span>✦</span> تَابِعِ الْقِرَاءَة</span><h2>قد يعجبك أيضًا<span class="gold-dot">.</span></h2></div><a href="/articles" class="text-link">جميع المقالات ${icon('arrowLeft','',17)}</a></div><div class="article-more-grid">${next.map(a => articleCard(a)).join('')}</div></section>` : `<div class="article-bottom-cta"><div><strong>لا تتوقف رحلتك هنا.</strong><p>اكتشف سور القرآن الكريم وابدأ القراءة من حيث تحب.</p></div><a class="button button-dark" href="/#surahs">فهرس السور ${icon('arrowLeft','',16)}</a></div>`;
  const body = `<div class="shell article-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/articles">المقالات</a><span>›</span><span>${esc(article.title)}</span></nav><article class="editorial-article"><header class="article-header"><div class="article-topline"><a href="/articles">مَجَلَّةُ سَنا</a><span>✦</span><span>${esc(article.category)}</span></div><h1>${esc(article.title)}<span class="article-heading-star" aria-hidden="true">✦</span></h1><p>${esc(article.summary)}</p><div class="article-byline"><span class="article-author-mark">س</span><div><strong>سَنا</strong><span>أُعدّ بمساعدة الذكاء الاصطناعي</span></div><span class="byline-divider"></span><time datetime="${esc(article.publishedAt)}">${esc(articleDate(article.publishedAt))}</time><span class="byline-dot">•</span><span>${ar(article.minutes)} دقائق قراءة تقريبًا</span></div></header><figure class="article-cover"><img src="${esc(article.image)}" alt="${esc(article.imageAlt)}" width="1280" height="714" fetchpriority="high"><figcaption>صورة توضيحية مولّدة بالذكاء الاصطناعي</figcaption></figure><div class="article-layout"><div class="article-prose"><p class="article-lead">${esc(article.lead)}</p>${parts}<section class="article-links"><h2>روابط مفيدة من سَنا</h2><div>${relatedLinks}</div></section><section class="article-sources"><h2>المصادر والمراجع</h2><ul>${sources}</ul><p>محتوى إرشادي عام أُعدّ بمساعدة الذكاء الاصطناعي، ولا يغني عن الرجوع إلى أهل العلم والمصادر المتخصصة.</p></section></div><aside class="article-sidebar"><div class="article-toc"><span>فِي هَذَا الْمَقَال</span><nav aria-label="محتويات المقال">${outline}</nav></div><div class="article-side-note"><span>✧</span><strong>آيةٌ بعد آية.</strong><p>مساحة لقراءة القرآن والاستماع إليه بتأنٍّ.</p><a href="/surah/1">ابدأ بسورة الفاتحة ${icon('arrowLeft','',15)}</a></div></aside></div></article>${relatedArticles}</div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'Article','@id':pageUrl+'#article',mainEntityOfPage:{'@type':'WebPage','@id':pageUrl},headline:article.title,description:article.summary,image:[new URL(article.image,origin).href],datePublished:article.publishedAt,inLanguage:'ar',author:{'@type':'Organization',name:'سَنا',url:origin+'/'},publisher:{'@type':'Organization',name:'سَنا',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'المقالات',item:origin+'/articles'},{'@type':'ListItem',position:3,name:article.title,item:pageUrl}]}
  ]};
  return layout({title:`${article.title} | مجلة سَنا`,description:article.summary,body,active:'articles',url:pageUrl,schema,image:article.image,type:'article',publishedAt:article.publishedAt});
}
function searchPage(query, origin) {
 const cleaned = query.trim().slice(0, 120), q = normalize(cleaned).replace(/^سور[ةه]\s+/, '');
 const chapterMatches = q ? searchable.filter(c => c.norm.includes(q)).slice(0, 12) : [];
 const matches = [];
 if (q && q.length >= 2) for (const c of searchable) { for (const v of c.verses) { if (v.norm.includes(q)) { matches.push({c,v}); if(matches.length >= 40) break; } } if(matches.length>=40) break; }
 const body=`<div class="shell subpage-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>البحث</span></nav><div class="subpage-title"><span class="section-kicker"><span>✦</span> ابْحَثْ فِي كِتَابِ الله</span><h1>البحث في القرآن<span class="gold-dot">.</span></h1><p>ابحث باسم السورة أو بكلمة من الآية.</p></div><form class="page-search" action="/search" method="get">${icon('search')}<label class="sr-only" for="page-search-input">كلمة البحث</label><input id="page-search-input" name="q" value="${esc(cleaned)}" placeholder="ابحث عن سورة أو آية..." required><button class="button button-dark">بحث ${icon('arrowLeft','',16)}</button></form>${q?`<p class="search-summary">نتائج البحث عن <strong>«${esc(cleaned)}»</strong>${matches.length===40?' · أول ٤٠ آية':''}</p>`:''}${chapterMatches.length?`<div class="results-header"><h2>السور</h2></div><div class="surah-list result-surahs">${chapterMatches.map(surahCard).join('')}</div>`:''}${matches.length?`<div class="results-header"><h2>الآيات</h2><span>${ar(matches.length)} نتيجة${matches.length===40?' أو أكثر':''}</span></div><div class="verse-results">${matches.map(({c,v})=>`<a class="verse-result" href="/surah/${c.number}#ayah-${v.num}"><div><strong>سورة ${esc(c.name)}</strong><span>الآية ${ar(v.num)} ${icon('arrowLeft','',16)}</span></div><p lang="ar">${esc(v.text)}</p></a>`).join('')}</div>`:''}${q && !chapterMatches.length && !matches.length?`<div class="empty-state">${icon('search','',28)}<h2>لم نجد نتائج مطابقة</h2><p>جرّب كلمة مختلفة أو ابحث باسم سورة.</p><a href="/#surahs" class="button button-outline">استكشف السور ${icon('arrowLeft','',16)}</a></div>`:''}</div>`;
 return layout({title:'البحث في القرآن الكريم | سَنا',description:'ابحث في سور القرآن الكريم وآياته.',body,url:origin+'/search',noindex:true});
}
function bookmarksPage(origin) {
 const body=`<div class="shell subpage-shell bookmarks-page"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>الآيات المحفوظة</span></nav><div class="subpage-title"><span class="section-kicker"><span>✦</span> مِمَّا لَامَسَ قَلْبَكَ</span><h1>آيات�� المحفوظة<span class="gold-dot">.</span></h1><p>آيات اخترت الاحتفاظ بها، لتعود إليها متى أحببت.</p></div><div id="bookmarks-list"><noscript><div class="empty-state">يرجى تفعيل JavaScript لعرض الآيات المحفوظة على جهازك.</div></noscript></div><p class="local-note">${icon('info','',17)} تُحفظ العلامات على هذا المتصفح فقط، ولا تُرفع إلى خادم.</p></div>`;
 return layout({title:'الآيات المحفوظة | سَنا',description:'آياتك المحفوظة للعودة إليها على هذا الجهاز.',body,url:origin+'/bookmarks',noindex:true});
}
function notFound(origin) {
 return layout({title:'الصفحة غير موجودة | سَنا',description:'الصفحة التي تبحث عنها غير متاحة.',url:origin+'/',noindex:true,body:`<div class="shell subpage-shell"><div class="empty-state"><span class="empty-ornament">✺</span><h1>هذه الصفحة غير موجودة</h1><p>يمكنك العودة إلى فهرس السور ومتابعة القراءة.</p><a href="/" class="button button-dark">العودة للرئيسية ${icon('arrowLeft','',17)}</a></div></div>`});
}
const tafsirCache = new Map();
function getOrigin(req) {
  if (process.env.SITE_URL) { try { const u = new URL(process.env.SITE_URL); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (_) {} }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  const safeHost = /^[a-z0-9.\-:\[\]]+$/i.test(host) ? host : 'localhost:3000';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : (safeHost.startsWith('localhost') || safeHost.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${safeHost}`;
}
function sitemapXml(origin, now = Date.now()) {
  const root = `<url><loc>${esc(origin + '/')}</loc></url>`;
  const surahs = chapters.map(c => `<url><loc>${esc(origin + `/surah/${c.number}`)}</loc></url>`).join('');
  const index = `<url><loc>${esc(origin + '/articles')}</loc></url>`;
  // Covers are declared as image sitemap entries so search engines can associate
  // each illustration with its article page.
  const entries = getPublishedArticles(now).map(a => `<url><loc>${esc(origin + '/articles/' + a.slug)}</loc><lastmod>${esc(a.publishedAt)}</lastmod><image:image><image:loc>${esc(new URL(a.image, origin).href)}</image:loc><image:title>${esc(a.title)}</image:title></image:image></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${root}${surahs}${index}${entries}</urlset>`;
}
function feedXml(origin, now = Date.now()) {
  const items = getPublishedArticles(now).map(a => {
    const link = origin + '/articles/' + a.slug;
    return '<item><title>' + esc(a.title) + '</title><link>' + esc(link) + '</link><guid isPermaLink="true">' + esc(link) + '</guid><pubDate>' + new Date(a.publishedAt).toUTCString() + '</pubDate><category>' + esc(a.category) + '</category><description>' + esc(a.summary) + '</description><enclosure url="' + esc(new URL(a.image, origin).href) + '" type="image/webp"/></item>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>مجلة سَنا — مقالات وأدلة للقراءة في القرآن</title><link>' + esc(origin + '/articles') + '</link><description>مقالات وأدلة عملية لقراءة القرآن الكريم والاستماع إليه، تنشر تدريجيًا.</description><language>ar</language><copyright>سَنا للقرآن الكريم</copyright><lastBuildDate>' + new Date(now).toUTCString() + '</lastBuildDate><atom:link href="' + esc(origin + '/feed.xml') + '" rel="self" type="application/rss+xml"/>' + items + '</channel></rss>';
}
// A plain-text map for AI agents and answer engines that look for one. Google
// ignores this file; sitemap.xml and ordinary crawling stay the source of truth.
function llmsTxt(origin, now = Date.now()) {
  const articles = getPublishedArticles(now).map(a => '- [' + a.title + '](' + origin + '/articles/' + a.slug + '): ' + a.summary).join('\n');
  return '# سَنا للقرآن الكريم\n\n> موقع عربي لقراءة القرآن الكريم بالرسم العثماني كاملًا، والاستماع إلى التلاوات، وقراءة التفسير الميسّر لكل آية، مع مجلة مقالات وأدلة للقراءة اليومية.\n\n## الصفحات الأساسية\n- [الرئيسية](' + origin + '/): فهرس السور والبحث والاستماع.\n- [المقالات](' + origin + '/articles): مجلة سَنا.\n- [خريطة الموقع](' + origin + '/sitemap.xml)\n- [خلاصة RSS](' + origin + '/feed.xml)\n\n## السور\n' + origin + '/surah/1 … ' + origin + '/surah/114 — صفحة كاملة لكل سورة بالرسم العثماني مع التلاوة والتفسير.\n\n## المقالات المنشورة\n' + (articles || '- لا توجد مقالات منشورة بعد.') + '\n\n## ملاحظات\n- النص القرآني من مشروع تنزيل مع الاحتفاظ بإشعار الترخيص، والتفسير الميسّر عبر AlQuran Cloud.\n- مقالات المجلة إرشادية أُعدّت بمساعدة الذكاء الاصطناعي، والصور توضيحية مولّدة.\n- لغة الموقع: العربية (ar).\n';
}
function validIndexNowKey(key) { return /^[A-Za-z0-9-]{8,128}$/.test(key); }
function recentArticleUrls(origin, now = Date.now()) {
  const instant = now instanceof Date ? now.getTime() : Number(now);
  // Two days' overlap covers delayed/missed daily invocations without needing
  // a persistent database. Nothing is submitted after the finite queue ages out.
  const recent = getPublishedArticles(instant).filter(a => Date.parse(a.publishedAt) >= instant - 48 * 60 * 60 * 1000);
  return recent.length ? [origin + '/articles', ...recent.map(a => origin + '/articles/' + a.slug)] : [];
}
async function notifyRecentArticles(origin, key, now = Date.now(), fetchImpl = fetch) {
  if (!validIndexNowKey(key)) throw new Error('IndexNow key is not configured');
  const urlList = recentArticleUrls(origin, now);
  if (!urlList.length) return {submitted:0, status:null};
  const response = await fetchImpl('https://api.indexnow.org/indexnow', {
    method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'},
    body:JSON.stringify({host:new URL(origin).host,key,keyLocation:`${origin}/${key}.txt`,urlList}),
    signal:AbortSignal.timeout(10000)
  });
  if (![200,202].includes(response.status)) throw new Error(`IndexNow rejected notification (${response.status})`);
  return {submitted:urlList.length, status:response.status};
}
function validCronAuthorization(req) {
  const secret = String(process.env.CRON_SECRET || '');
  const actual = Buffer.from(String(req.headers.authorization || ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  return secret.length >= 16 && actual.length === expected.length && timingSafeEqual(actual, expected);
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
function send(req,res,status,content,type='text/html; charset=utf-8',extra={}) {
 const buf=Buffer.isBuffer(content)?content:Buffer.from(content);
 const compress = buf.length > 1024 && /\b(?:gzip)\b/.test(req.headers['accept-encoding'] || '') && /^(?:text\/|application\/(?:json|xml))/.test(type);
 const payload=compress?zlib.gzipSync(buf):buf;
 res.writeHead(status,{'Content-Type':type,'Content-Length':payload.length,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin', ...(compress?{'Content-Encoding':'gzip','Vary':'Accept-Encoding'}:{}),...extra});
 res.end(req.method === 'HEAD' ? undefined : payload);
}
async function handleRequest(req,res){
 try {
  if (!['GET','HEAD'].includes(req.method)) return send(req,res,405,'Method not allowed','text/plain; charset=utf-8',{'Allow':'GET, HEAD'});
  const origin=getOrigin(req); const u=new URL(req.url,origin); const pathname=decodeURIComponent(u.pathname);
  const indexNowKey = String(process.env.INDEXNOW_KEY || '').trim();
  if (validIndexNowKey(indexNowKey) && pathname === `/${indexNowKey}.txt`) return send(req,res,200,indexNowKey,'text/plain; charset=utf-8',{'Cache-Control':'public, max-age=3600'});
  if(pathname==='/api/cron/indexnow'){
    if(req.method !== 'GET') return send(req,res,405,JSON.stringify({error:'Method not allowed'}),'application/json; charset=utf-8',{'Allow':'GET','Cache-Control':'no-store'});
    if(!validCronAuthorization(req)) return send(req,res,401,JSON.stringify({error:'Unauthorized'}),'application/json; charset=utf-8',{'Cache-Control':'no-store'});
    try {
      const result = await notifyRecentArticles(origin,indexNowKey);
      return send(req,res,200,JSON.stringify(result),'application/json; charset=utf-8',{'Cache-Control':'no-store'});
    } catch(error) {
      console.error('IndexNow notification failed:', error.message);
      return send(req,res,502,JSON.stringify({error:'IndexNow notification failed'}),'application/json; charset=utf-8',{'Cache-Control':'no-store'});
    }
  }
  if(pathname==='/') return send(req,res,200,homePage(origin));
  if(pathname==='/articles/') { res.writeHead(301,{'Location':'/articles'}); return res.end(); }
  if(pathname==='/articles') return send(req,res,200,articlesPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=60'});
  const articleMatch=pathname.match(/^\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if(articleMatch){
    const article=getPublishedArticles().find(a=>a.slug===articleMatch[1]);
    if(!article) return send(req,res,404,notFound(origin),'text/html; charset=utf-8',{'Cache-Control':'no-store'});
    if(pathname.endsWith('/')) { res.writeHead(301,{'Location':`/articles/${article.slug}`}); return res.end(); }
    return send(req,res,200,articlePage(article,origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=300'});
  }
  if(pathname==='/bookmarks') return send(req,res,200,bookmarksPage(origin));
  if(pathname==='/search') return send(req,res,200,searchPage(u.searchParams.get('q')||'',origin));
  if(pathname==='/go'){const id=Number(u.searchParams.get('id'));res.writeHead(302,{'Location':Number.isInteger(id)&&id>=1&&id<=114?`/surah/${id}`:'/#surahs'});return res.end();}
  if(pathname==='/robots.txt') return send(req,res,200,`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,'text/plain; charset=utf-8');
  if(pathname==='/sitemap.xml') return send(req,res,200,sitemapXml(origin),'application/xml; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=60'});
  if(pathname==='/feed.xml') return send(req,res,200,feedXml(origin),'application/rss+xml; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=300'});
  if(pathname==='/rss.xml'||pathname==='/feed'||pathname==='/rss'){res.writeHead(301,{'Location':'/feed.xml'});return res.end();}
  if(pathname==='/llms.txt') return send(req,res,200,llmsTxt(origin),'text/plain; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=3600'});
  const legacy=pathname.match(/^\/(\d{1,3})\.html$/); if(legacy){const id=Number(legacy[1]);if(id>=1&&id<=114){res.writeHead(301,{'Location':`/surah/${id}`});return res.end();}}
  const surahMatch=pathname.match(/^\/surah\/(\d{1,3})\/?$/); if(surahMatch){const id=Number(surahMatch[1]);if(id>=1&&id<=114)return send(req,res,200,surahPage(id,origin));}
  const tafsirMatch=pathname.match(/^\/api\/tafsir\/(\d{1,3})\/(\d{1,3})$/);
  if(tafsirMatch){
    const s=Number(tafsirMatch[1]),a=Number(tafsirMatch[2]);
    if(s<1||s>114||a<1||a>verses[s].length) return send(req,res,404,JSON.stringify({error:'الآية غير موجودة'}),'application/json; charset=utf-8');
    const key=`${s}:${a}`;
    if(!tafsirCache.has(key)){
      try {const r=await fetch(`https://api.alquran.cloud/v1/ayah/${s}:${a}/ar.muyassar`,{signal:AbortSignal.timeout(10000)});const j=await r.json();if(!r.ok||typeof j?.data?.text!=='string')throw new Error('upstream');if(tafsirCache.size>500)tafsirCache.clear();tafsirCache.set(key,j.data.text);}
      catch(e){return send(req,res,502,JSON.stringify({error:'تعذّر تحميل التفسير. تحقّق من الاتصال وحاول مرة أخرى.'}),'application/json; charset=utf-8');}
    }
    return send(req,res,200,JSON.stringify({surah:s,ayah:a,text:tafsirCache.get(key),source:'التفسير الميسر عبر AlQuran Cloud'}),'application/json; charset=utf-8',{'Cache-Control':'public, max-age=86400'});
  }
  const file=path.resolve(PUBLIC, '.'+pathname);
  if(file.startsWith(PUBLIC+path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()){
    const ext=path.extname(file);return send(req,res,200,fs.readFileSync(file),mime[ext]||'application/octet-stream',{'Cache-Control':'public, max-age=86400'});
  }
  return send(req,res,404,notFound(origin));
 } catch(e) {console.error(e);if(!res.headersSent)send(req,res,500,'حدث خطأ غير متوقع.','text/plain; charset=utf-8');else res.end();}
}
const server=http.createServer(handleRequest);
if(require.main===module){const port=Number(process.env.PORT)||3000;server.listen(port,'0.0.0.0',()=>console.log(`سَنا يعمل على المنفذ ${port}`));}
module.exports={server,handleRequest,chapters,verses,splitOpening,normalize,articles,validateArticleBatch,getPublishedArticles,articlesPage,articlePage,sitemapXml,feedXml,llmsTxt,articlesForSurah,surahJournalLinks,recentArticleUrls,notifyRecentArticles,validIndexNowKey};
