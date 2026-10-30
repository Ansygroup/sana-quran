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
const surahGuides = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/surah-guides.json'), 'utf8'));
// حدود الأجزاء محسوبة من نسخة Quran Uthmani (alquran.cloud) ومقاطعة بنصّنا: ٦٢٣٦ آية و٧٧٨٨١ كلمة.
const juzBounds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/juz-bounds.json'), 'utf8'));
// آية واحدة تُختصر بها كل سورة؛ رقم الآية تحقّق آليًّا من نصّها لا من الذاكرة.
const surahKeyAyahs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/surah-key-ayahs.json'), 'utf8'));
// موضوعات مشتقّة من محاور الأدلة الـ٤٠٣، مع مقدمة تحريرية لكل موضوع.
const topics = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/topics.json'), 'utf8'));
// إعلانات اختيارية: لا يُحمَّل أي سكربت ما دامت معطّلة، ولا تُقبل عوامل خدمة.
const adsConfig = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ads.json'), 'utf8')); } catch (_) { return { enabled: false, slots: {} }; } })();
// خريطة الكلمات المفتاحية: عناقيد مقصودة لكل صفحة، تُستخدم في الروابط الداخلية والاستهداف.
const keywordClusters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/keywords.json'), 'utf8')).clusters;
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
  return `<header class="site-header"><div class="shell header-inner">${brand()}<nav class="desktop-nav" aria-label="التنقل الرئيسي"><a class="${active === 'home' ? 'active' : ''}" href="/">الرئيسية</a><a class="${active === 'surahs' ? 'active' : ''}" href="/surahs">فهرس السور</a><a class="${active === 'listen' ? 'active' : ''}" href="/listen">التلاوات</a><a class="${active === 'articles' ? 'active' : ''}" href="/articles">المقالات</a><a class="${active === 'learn' ? 'active' : ''}" href="/learn">مسار التعلّم</a><a class="${active === 'about' ? 'active' : ''}" href="/about">عن سَنا</a></nav><div class="header-actions"><button class="icon-button header-search" type="button" data-open-search aria-label="البحث">${icon('search')}</button><a class="icon-button header-bookmark" href="/bookmarks" aria-label="الآيات المحفوظة">${icon('bookmark')}<span class="saved-dot" data-bookmark-dot hidden></span></a><button class="icon-button theme-toggle" type="button" data-theme-toggle aria-label="تغيير المظهر">${icon('moon','moon-icon')}${icon('sun','sun-icon')}</button><a class="header-cta" href="/surah/18">ابدأ القراءة ${icon('arrowLeft','',17)}</a><button class="icon-button menu-toggle" type="button" aria-label="فتح القائمة" aria-expanded="false" aria-controls="mobile-nav" data-menu-toggle>${icon('menu')}</button></div></div><nav id="mobile-nav" class="mobile-nav" aria-label="قائمة الهاتف" hidden><a href="/">الرئيسية</a><a href="/surahs">فهرس السور</a><a href="/juz/30">جزء عمّ</a><a href="/listen">التلاوات</a><a href="/articles">المقالات</a><a href="/learn">مسار التعلّم</a><a href="/bookmarks">الآيات المحفوظة</a><a href="/about">عن سَنا</a></nav></header>`;
}
function footer() {
  return `<footer class="footer" id="about"><div class="shell footer-main"><div class="footer-brand">${brand()}<p>رفقةٌ هادئة مع كتاب الله،<br>تبدأ بآية وتستمرّ كل يوم.</p><span class="footer-small">صُنِع بمحبة لكتاب الله ${icon('spark','',16)}</span></div><div class="footer-col"><h3>اكتشف سَنا</h3><a href="/surahs">فهرس السور</a><a href="/surah/18">سورة الكهف</a><a href="/listen">التلاوات</a><a href="/articles">مجلة سَنا</a><a href="/articles/surahs">مقالات بحسب السورة</a><a href="/questions">أسئلة سريعة</a><a href="/learn">مسار التعلّم</a><a href="/guides">أدلة السور</a><a href="/ayah">فهرس الآيات</a><a href="/topics">الموضوعات</a><a href="/juz">الأجزاء الثلاثون</a><a href="/feed.xml">خلاصة المجلة RSS</a><a href="/bookmarks">الآيات المحفوظة</a></div><div class="footer-col"><h3>المصادر</h3><a href="https://tanzil.net/" target="_blank" rel="noopener noreferrer">النص القرآني: مشروع تنزيل ↗</a><a href="https://everyayah.com/" target="_blank" rel="noopener noreferrer">تلاوات الآيات: EveryAyah ↗</a><a href="https://www.mp3quran.net/" target="_blank" rel="noopener noreferrer">تلاوات السور: MP3Quran ↗</a><a href="https://alquran.cloud/" target="_blank" rel="noopener noreferrer">التفسير: AlQuran Cloud ↗</a></div><div class="footer-quote"><span>آيةٌ بعد آية</span><strong>طمأنينةٌ<br>ترافق قلبك.</strong><span class="footer-ornament">✺</span></div></div><div class="shell footer-bottom"><p>© سَنا للقرآن الكريم · تجربة صُممت للتدبّر</p><p>النص العثماني من مشروع <a href="https://tanzil.net/" target="_blank" rel="noopener noreferrer">تنزيل</a>، مع الاحتفاظ بإشعار الترخيص.</p></div></footer>`;
}
function dialogsAndPlayer() {
 return `<dialog class="search-dialog" id="search-dialog" aria-labelledby="search-title"><div class="dialog-head"><div><span class="section-kicker">ابحث في كتاب الله</span><h2 id="search-title">عن ماذا تبحث؟</h2></div><button class="icon-button" data-close-dialog aria-label="إغلاق البحث">${icon('close')}</button></div><form class="dialog-search" action="/search" method="get">${icon('search')}<label class="sr-only" for="global-search">ابحث عن سورة أو آية</label><input id="global-search" name="q" placeholder="ابحث عن سورة أو كلمة من آية..." autocomplete="off" required><button class="button button-dark" type="submit">بحث ${icon('arrowLeft','',17)}</button></form><p class="dialog-help">ابحث باسم السورة، رقمها، أو بكلمات من الآية.</p><div class="dialog-shortcuts"><span>قد تبحث عن</span><a href="/surah/18">سورة الكهف</a><a href="/surah/36">سورة يس</a><a href="/surah/67">سورة الملك</a></div></dialog><dialog class="tafsir-dialog" id="tafsir-dialog" aria-labelledby="tafsir-title"><div class="dialog-head"><div><span class="section-kicker">معاني الآيات</span><h2 id="tafsir-title">التفسير الميسّر</h2></div><button class="icon-button" data-close-dialog aria-label="إغلاق التفسير">${icon('close')}</button></div><div id="tafsir-reference" class="tafsir-ref"></div><p id="tafsir-content" class="tafsir-content" role="status"></p><p class="tafsir-source">التفسير الميسّر عبر <a href="https://alquran.cloud/" target="_blank" rel="noopener noreferrer">AlQuran Cloud</a>.</p></dialog><div class="audio-player" id="audio-player" hidden aria-label="مشغل التلاوة"><div class="player-inner"><button class="player-play" data-player-toggle aria-label="إيقاف التلاوة مؤقتًا">${icon('pause','player-pause',19)}${icon('play','player-resume',19)}</button><div class="player-info"><strong id="player-title">سورة الكهف</strong><span id="player-subtitle">مشاري العفاسي</span></div><div class="player-track"><input id="player-progress" type="range" min="0" max="1000" value="0" aria-label="موضع التلاوة"><div class="player-times"><span id="player-current">٠:٠٠</span><span id="player-duration">٠:٠٠</span></div></div><span class="player-volume">${icon('volume','',19)}</span><button class="icon-button player-close" data-player-close aria-label="إغلاق مشغل التلاوة">${icon('close','',19)}</button></div><audio id="audio-element" preload="none"></audio></div><div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}
function layout({title, description, body, active = '', url, canonical, schema = null, noindex = false, image = '/hero-quran.webp', type = 'website', publishedAt = '', preload = '', prev = '', next = ''}) {
  const orgSchema = {'@context':'https://schema.org','@type':'Organization','@id':url.replace(/\/[^/]*$/, '') + '/#organization',name:'سَنا للقرآن الكريم',alternateName:'Sana Quran',url:new URL('/', url).href,logo:new URL('/favicon.svg', url).href,description:'موقع عربي لقراءة القرآن الكريم بالرسم العثماني، والاستماع إلى التلاوات، وقراءة التفسير الميسّر، مع مجلة مقالات.'};
  const siteSchema = {'@context':'https://schema.org','@type':'WebSite','@id':new URL('/', url).href + '#website',name:'سَنا للقرآن الكريم',alternateName:'Sana Quran',url:new URL('/', url).href,inLanguage:'ar',potentialAction:{'@type':'SearchAction',target:{'@type':'EntryPoint',urlTemplate:new URL('/', url).href + 'search?q={search_term_string}'},'query-input':'required name=search_term_string'}};
  const schemaTag = (schema ? `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>` : '') + `<script type="application/ld+json">${JSON.stringify(orgSchema).replace(/</g, '\\u003c')}</script><script type="application/ld+json">${JSON.stringify(siteSchema).replace(/</g, '\\u003c')}</script>`;
  // The verification value is public metadata, not an OAuth credential. Keep it
  // configured in production after verification so Google can recheck ownership.
  const googleVerification = String(process.env.GOOGLE_SITE_VERIFICATION || (process.env.VERCEL ? '-L9XZtpuZKcKhoRjQUkLAvotYp9eLPJ3azjG1Eetf08' : '')).trim().replace(/^google-site-verification=/i, '');
  // وسم تحقّق Monetag فقط: لا سكربت ولا Service Worker ولا إشعارات.
  // لإزالته بالكامل: احذف السطرين التاليين، واحذف ${monetagVerificationTag} من القالب.
  // قيم التحقّق بياناتٌ عامة لا أسرار؛ يُعرض وسمٌ لكل قيمة حتى يعمل التحقّق
  // القديم والجديد معًا دون إسقاط أيٍّ منهما.
  const MONETAG_VERIFICATIONS = ['fcfba283784091810952fa1ef887081e', '037ce2f953912695c619b6d08ab4c006'];
  const monetagVerificationTag = MONETAG_VERIFICATIONS.map(v => `<meta name="monetag" content="${esc(v)}">`).join('');
  const googleVerificationTag = googleVerification ? `<meta name="google-site-verification" content="${esc(googleVerification)}">` : '';
  // سكربت Monetag داخل الصفحة (إنْ أباحه مالك الموقع في data/ads.json).
  // نفس المفتاح يوقف العامل والسكربت معًا؛ والنطاق مُقيَّد بمصدرٍ واحد.
  const mtCfg = adsConfig && adsConfig.monetag;
  const mtHost = mtCfg && typeof mtCfg.domain === 'string' && /^[a-z0-9.-]+$/i.test(mtCfg.domain) ? mtCfg.domain : '';
  const mtOn = mtCfg && mtCfg.enabled === true;
  // وسوم إضافية (مناطق أخرى في المنصة نفسها): كل وسمٍ يُتحقّق من رابطه قبل إدراجه،
  // ولا يُقبل إلا https ونطاقٌ لاتيني صالح. المعرّف يبقى نصًّا رقميًّا فقط.
  const mtExtraHosts = [];
  const mtExtraTags = mtOn && Array.isArray(mtCfg.extraScripts) ? mtCfg.extraScripts.filter(x => {
    if (!x || typeof x.src !== 'string') return false;
    if (!/^https:\/\/[a-z0-9.-]+\/[^"'\s<>]+$/i.test(x.src)) return false;
    if (x.zone !== undefined && !/^\d+$/.test(String(x.zone))) return false;
    try { mtExtraHosts.push(new URL(x.src).host); } catch (_) { return false; }
    return true;
  }).map(x => `<script src="${esc(x.src)}"${x.zone !== undefined ? ` data-zone="${esc(String(x.zone))}"` : ''} async data-cfasync="false"></script>`) : [];
  const monetagPageTag = (mtOn && mtHost && Number.isInteger(mtCfg.zoneId))
    ? `<script src="https://${mtHost}/act/files/tag.min.js?z=${mtCfg.zoneId}" async data-cfasync="false"></script>` + mtExtraTags.join('')
    : mtExtraTags.join('');
  // فتح الاتصال مسبقًا يقلّل زمن التحميل بدل أن يبدأ من الصفر بعد الرسم.
  const mtHosts = [...new Set([...(mtOn && mtHost ? [mtHost] : []), ...mtExtraHosts])];
  const monetagPreconnectTag = mtHosts.map(h => `<link rel="preconnect" href="https://${h}" crossorigin>`).join('');
  // تحليلات Vercel (مسارٌ أصليّ في المنصة نفسها): تُحقن في بيئة Vercel فقط،
  // حتى لا تطلب المعاينة والتطوير مسارًا غير موجود. بلا أي تبعية npm.
  const vercelAnalyticsTag = process.env.VERCEL
    ? `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};</script><script defer src="/_vercel/insights/script.js"></script>`
    : '';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#153c32">${googleVerificationTag}${monetagVerificationTag}${monetagPreconnectTag}${monetagPageTag}<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}"><link rel="canonical" href="${esc(canonical || url)}">${prev ? `<link rel="prev" href="${esc(prev)}">` : ''}${next ? `<link rel="next" href="${esc(next)}">` : ''}<meta property="og:type" content="${esc(type)}"><meta property="og:locale" content="ar_AR"><meta property="og:site_name" content="سَنا للقرآن الكريم"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical || url)}"><meta property="og:image" content="${esc(new URL(image, url).href)}"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="714"><meta name="twitter:image" content="${esc(new URL(image, url).href)}"><link rel="alternate" hreflang="ar" href="${esc(canonical || url)}"><link rel="alternate" hreflang="x-default" href="${esc(canonical || url)}">${publishedAt ? `<meta property="article:published_time" content="${esc(publishedAt)}">` : ''}<meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate" type="application/rss+xml" title="مجلة سَنا" href="/feed.xml"><link rel="preload" href="/fonts/plex-400-arabic.woff2" as="font" type="font/woff2" crossorigin>${preload}<link rel="stylesheet" href="/style.css"><script>try{if(localStorage.getItem('sana-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}</script>${schemaTag}${vercelAnalyticsTag}</head><body><a class="skip-link" href="#main">تجاوز إلى المحتوى</a>${siteHeader(active)}<main id="main">${body}</main>${footer()}${dialogsAndPlayer()}<script src="/app.js" defer></script></body></html>`;
}
function quickLink(iconName, title, desc, href, extra = '') {
  return `<a class="quick-link" href="${href}" ${extra}><span class="quick-icon">${icon(iconName,'',22)}</span><span class="quick-copy"><strong>${title}</strong><small>${desc}</small></span><span class="quick-arrow">${icon('arrowLeft','',16)}</span></a>`;
}
function miniFeature(num, label) {
 const c=chapters[num-1];
 return `<a class="mini-feature" href="/surah/${c.number}"><div class="mini-feature-top">${medallion(c.number)}<span>${esc(label)}</span></div><div><h3>سورة ${esc(c.name)}</h3><p>${c.revelation} · ${ayahCount(c.ayahCount)}</p></div><span class="mini-link">قراءة السورة ${icon('arrowLeft','',16)}</span></a>`;
}
function surahCard(c) {
 return `<a class="surah-card" href="/surah/${c.number}" data-surah-card data-surah-name="${esc(`${c.name} ${c.englishName} ${c.number}`)}" data-surah-type="${c.revelation}">${medallion(c.number)}<span class="surah-card-name"><strong>${esc(c.name)}</strong><small dir="ltr">${esc(c.englishName)}</small></span><span class="surah-card-meta"><span>${c.revelation}</span><small>${ayahCount(c.ayahCount)}</small>${(() => { const n = (surahMentionIndex().get(c.number) || []).length; return n ? `<small class="surah-card-articles" title="عدد مقالات مجلة سَنا عن السورة">${ar(n)} مقالًا</small>` : ''; })()}</span>${icon('arrowLeft','card-arrow',16)}</a>`;
}
function homePage(origin) {
 const c18 = chapters[17];
 const body = `<div class="shell home-shell"><div class="home-prelude"><div><span class="prelude-star">✦</span> أَهْلًا بِكَ فِي سَنا</div><span>مساحةٌ هادئة لقلبٍ مطمئن</span></div><section class="hero" aria-labelledby="hero-title"><img class="hero-image" srcset="/hero-quran-900.webp 900w, /hero-quran.webp 1280w" sizes="100vw" src="/hero-quran.webp" alt="" fetchpriority="high"><div class="hero-shade"></div><div class="hero-copy"><div class="hero-eyebrow"><span>✦</span> وَرْدٌ مِنْ نُورٍ، كُلَّ يَوْم</div><h1 id="hero-title">لأنَّ في القرآن<br><em>حياةً للقلب.</em></h1><p>مساحتك الهادئة لقراءة القرآن الكريم، والاستماع إلى آياته، والتدبّر في معانيه... أينما كنت.</p><div class="hero-actions"><a class="button button-cream" href="/surah/18">ابدأ القراءة ${icon('arrowLeft','',18)}</a><button class="button button-ghost" type="button" data-play-surah="18" data-reciter="afs"><span class="play-outline">${icon('play','',14)}</span> استمع الآن</button></div><div class="hero-foot"><span class="hero-foot-mark">✧</span><span>آيةٌ واحدة قد تغيّر يومك كله</span></div></div><div class="hero-image-caption"><span></span> سَنا · رِفْقَةُ الْقُرْآن</div></section>${keyAyahStrip()}${ayahOfDay(origin)}<section class="quick-links" aria-label="روابط سريعة">${quickLink('book','تصفّح السور','كتاب الله بين يديك','/#surahs')}${quickLink('headphones','استمع بخشوع','تلاوات تلامس القلب','/#listen')}${quickLink('clock','أكمل قراءتك','عُد إلى آخر موضع','/surah/18','data-continue')}${quickLink('bookmark','آياتك المحفوظة','لحظات تستحق العودة','/bookmarks')}</section><section class="featured-section" aria-labelledby="featured-title"><div class="section-heading"><div><span class="section-kicker"><span>✦</span> نُورٌ لِيَوْمِكَ</span><h2 id="featured-title">رحلةٌ تبدأ بآية<span class="gold-dot">.</span></h2><p>اختر ما يلامس قلبك، واجعل للقرآن مساحة في يومك.</p></div><a class="text-link" href="#surahs">تصفّح كل السور ${icon('arrowLeft','',18)}</a></div><div class="featured-grid"><a class="feature-kahf" href="/surah/18"><div class="feature-kahf-content"><span class="feature-label">✦ &nbsp; نُورُ يَوْمِ الْجُمُعَة</span><h3>سورة الكهف</h3><p>${c18.revelation} &nbsp;·&nbsp; ${ayahCount(c18.ayahCount)} &nbsp;·&nbsp; السورة ${ar(18)}</p><span class="feature-read">اقرأ السورة ${icon('arrowLeft','',17)}</span></div><div class="feature-arch" aria-hidden="true"><span>الكهف</span></div></a>${miniFeature(1,'البداية')}${miniFeature(36,'للروح')}${miniFeature(67,'قبل النوم')}</div></section><section class="directory-section" id="surahs" aria-labelledby="directory-title"><div class="section-heading directory-heading"><div><span class="section-kicker"><span>✦</span> الْقُرْآنُ الْكَرِيم</span><h2 id="directory-title">فهرس السور<span class="gold-dot">.</span></h2><p>كلّ سور القرآن الكريم، في مكان واحد.</p></div><div class="directory-search">${icon('search','',19)}<label class="sr-only" for="surah-search">ابحث عن سورة</label><input type="search" id="surah-search" placeholder="ابحث عن سورة أو رقمها..." autocomplete="off"><kbd>⌕</kbd></div></div><div class="directory-tabs" role="group" aria-label="تصفية السور"><button type="button" class="filter-tab active" data-filter="all" aria-pressed="true">جميع السور <span>${ar(114)}</span></button><button type="button" class="filter-tab" data-filter="مكية" aria-pressed="false">السور المكية</button><button type="button" class="filter-tab" data-filter="مدنية" aria-pressed="false">السور المدنية</button></div><div class="surah-list" id="surah-list">${chapters.map(surahCard).join('')}</div><p class="empty-filter" id="surah-empty" hidden>لم نجد سورة بهذا الاسم. جرّب كلمة أخرى.</p><div class="directory-more"><button class="button button-outline" id="show-all" type="button" hidden>عرض جميع السور ${icon('down','',17)}</button></div></section><section class="listen-section" id="listen" aria-labelledby="listen-title"><div class="listen-intro"><span class="section-kicker"><span>✦</span> صَوْتٌ يَصِلُ إِلَى الْقَلْب</span><h2 id="listen-title">أنصت، واطمئن<span class="gold-dot">.</span></h2><p>خذ لحظة لنفسك، واستمع إلى سورة الكهف بصوت قارئك المفضل.</p><div class="listen-quote"><span>﴿</span>${esc(verses[13][27])}<span>﴾</span><small>سورة الرعد · الآية ${ar(28)}</small></div></div><div class="reciters"><button class="reciter-card" type="button" data-play-surah="18" data-reciter="afs"><span class="reciter-avatar">م</span><span class="reciter-details"><strong>مشاري العفاسي</strong><small>سورة الكهف · تلاوة قرآنية</small></span><span class="reciter-play">${icon('play','',16)}</span></button><button class="reciter-card" type="button" data-play-surah="18" data-reciter="maher"><span class="reciter-avatar avatar-sand">م</span><span class="reciter-details"><strong>ماهر المعيقلي</strong><small>سورة الكهف · تلاوة قرآنية</small></span><span class="reciter-play">${icon('play','',16)}</span></button><button class="reciter-card" type="button" data-play-surah="18" data-reciter="basit"><span class="reciter-avatar avatar-olive">ع</span><span class="reciter-details"><strong>عبد الباسط عبد الصمد</strong><small>سورة الكهف · تلاوة قرآنية</small></span><span class="reciter-play">${icon('play','',16)}</span></button><span class="audio-source">التلاوات من MP3Quran · تتطلب اتصالًا بالإنترنت</span></div></section>${homeArticleSection()}<section class="closing-note"><span class="closing-icon">${icon('spark','',22)}</span><div><strong>للقرآن في كل يوم حكاية.</strong><p>اجعلها أجمل عادة في يومك.</p></div><a class="button button-dark" href="/surah/1">ابدأ بسورة الفاتحة ${icon('arrowLeft','',17)}</a></section></div>`;
 return layout({title:'القرآن الكريم مكتوبًا كاملًا: قراءة واستماع وتفسير | سَنا',description:'اقرأ سور القرآن الكريم مكتوبة كاملة بالرسم العثماني، واستمع إلى التلاوات، واقرأ التفسير الميسّر لكل آية، مع فهرس السور والأجزاء والموضوعات وحفظ موضع القراءة.',body,active:'home',url:origin+'/', schema:{'@context':'https://schema.org','@type':'WebSite',name:'سَنا للقرآن الكريم',url:origin+'/',inLanguage:'ar',description:'قراءة القرآن الكريم والاستماع إلى تلاواته.'}});
}
function ayahRow(c, text, n) {
 return `<article class="ayah-row" id="ayah-${n}" data-ayah-row data-surah="${c.number}" data-ayah="${n}" data-surah-name="${esc(c.name)}" data-ayah-text="${esc(text)}"><div class="ayah-row-head"><div class="ayah-reference">${medallion(n)}<span>${ar(c.number)}:${ar(n)}</span></div><div class="ayah-actions"><button class="ayah-action" type="button" data-play-ayah aria-label="استمع إلى الآية ${ar(n)}" title="استمع للآية">${icon('play','',16)}</button><button class="ayah-action bookmark-action" type="button" data-bookmark-ayah aria-label="حفظ الآية ${ar(n)}" aria-pressed="false" title="حفظ الآية">${icon('bookmark','',17)}</button><button class="ayah-action" type="button" data-copy-ayah aria-label="نسخ الآية ${ar(n)}" title="نسخ الآية">${icon('copy','',17)}</button><button class="ayah-action" type="button" data-tafsir-ayah aria-label="تفسير الآية ${ar(n)}" title="التفسير الميسّر">${icon('book','',17)}</button><button class="ayah-action share-action" type="button" data-share-ayah aria-label="مشاركة الآية ${ar(n)}" title="مشاركة الآية">${icon('share','',17)}</button></div></div><p class="ayah-text" lang="ar">${esc(text)} <span class="ayah-end">۝${ar(n)}</span></p></article>`;
}
// The Uthmani face is only used by reading pages; preloading it there removes the
// late font swap that shifted verse text after paint.
function surahPreloads() {
  return '<link rel="preload" href="/fonts/quran-arabic.woff2" as="font" type="font/woff2" crossorigin>';
}
const ARABIC_LETTER = /[\u0621-\u063A\u0641-\u064A\u0671\u0670]/;
const ARABIC_MARK = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const surahStats = (() => {
  const map = {};
  for (const chapter of chapters) {
    const text = verses[chapter.number].join(' ');
    const tokens = text.split(/\s+/).filter(token => token && ARABIC_LETTER.test(token));
    const letters = text.replace(ARABIC_MARK, '').replace(/[^\u0621-\u063A\u0641-\u064A\u0671]/g, '').length;
    map[chapter.number] = { words: tokens.length, letters, minutes: Math.max(1, Math.round(tokens.length / 140)) };
  }
  return map;
})();
function surahStatsFor(id) { return surahStats[id] || { words: 0, letters: 0, minutes: 1 }; }
function surahSummary(chapter) {
  const stats = surahStatsFor(chapter.number);
  return `سورة ${chapter.name} ${chapter.revelation}، عدد آياتها ${ar(chapter.ayahCount)} آية وعدد كلماتها ${ar(stats.words)} كلمة، وهي في الجزء ${ar(chapter.juz)} من المصحف. اقرأها كاملة بالرسم العثماني، واستمع إلى التلاوة، واقرأ التفسير الميسّر لكل آية.`;
}
function surahAbout(id, chapter) {
  const learnHint = '<span class="learn-hint-mark" aria-hidden="true">✦</span> جديد على المصحف؟ <a href="/learn">ابدأ من مسار التعلّم</a> — خمس مراحل من أول صفحة إلى ورد يومي.';
  const guide = surahGuides[String(id)];
  if (!guide) return `<p class="surah-learn-hint">${learnHint}</p>`;
  const linked = guide.article ? articles.find(a => '/articles/' + a.slug === guide.article) : null;
  const articleLink = linked ? `<a href="/articles/${esc(linked.slug)}">${esc(linked.title)} ${icon('arrowLeft','',15)}</a>` : '';
  // عدّاد مقالات السورة: يوضّح للزائر مقدار ما كُتب عن هذه السورة ويقوده إلى صفحة الفهرس المخصّصة.
  const articlesCount = (surahMentionIndex().get(Number(id)) || []).length;
  const hubLink = articlesCount >= 2 ? `<a class="surah-about-count" href="/articles/surahs#surah-${id}">${ar(articlesCount)} مقالات عن هذه السورة ${icon('arrowLeft','',15)}</a>` : '';
  const meritBlock = guide.merit ? `<div class="surah-merit"><span class="surah-merit-label">${icon('spark','',14)} فَضْلُ السُّورَة</span><p>${esc(guide.merit)}</p><small>الفضل منقول بنصّه من المصادر الحديثية المذكورة في النص، دون استدلال فقهي على الصفحة.</small></div>` : '';
  return `<section class="surah-about" id="surah-about" aria-labelledby="surah-about-title"><div class="surah-about-head"><span class="section-kicker"><span>✦</span> تَعَرَّفْ عَلَى السُّورَة</span><h2 id="surah-about-title">عن سورة ${esc(chapter.name)}</h2></div><p class="surah-about-intro">${esc(guide.intro)}</p><ul class="surah-about-themes">${guide.themes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>${meritBlock}<p class="surah-about-note">${icon('info','',16)} <span>${esc(guide.note)}</span></p>${surahTopicsNav(id)}<div class="surah-about-links"><a href="/learn">مسار التعلّم ${icon('arrowLeft','',15)}</a>${articleLink}${hubLink}</div><p class="surah-about-updated">آخر تحديث للمحتوى التحريري: ${esc(articleDate(guide.updatedAt))}</p></section><p class="surah-learn-hint">${learnHint}</p>`;
}
function relatedSurahsByJuz(id) {
  const chapter = chapters[id - 1];
  const sameJuz = chapters.filter(x => x.juz === chapter.juz && x.number !== id).sort((a, b) => { const da = Math.abs(a.number - id), db = Math.abs(b.number - id); if (da !== db) return da - db; return (a.number > id ? 0 : 1) - (b.number > id ? 0 : 1); });
  const forward = chapters.filter(x => x.number > id).sort((a, b) => a.number - b.number);
  const backward = chapters.filter(x => x.number < id).sort((a, b) => b.number - a.number);
  const seen = new Set([id]);
  const list = [];
  for (const chapter of [...sameJuz, ...forward, ...backward]) {
    if (list.length >= 3) break;
    if (seen.has(chapter.number)) continue;
    seen.add(chapter.number);
    list.push(chapter);
  }
  if (!list.length) return '';
  const label = sameJuz.length >= 3 ? `سور تبدأ في الجزء ${ar(chapter.juz)}` : 'سور متجاورة في المصحف';
  return `<nav class="surah-same-juz" aria-label="سور أخرى للقراءة بعد هذه السورة"><span>${label}</span><div>${list.map(x => `<a href="/surah/${x.number}">سورة ${esc(x.name)}</a>`).join('')}</div></nav>`;
}
// أسئلة قصيرة تُبنى من بيانات محسوبة فقط (آيات/كلمات/جزء/نوع)، فلا تتكرّر بين سورتين.
function juzRangeFor(id) {
  const js = Object.keys(juzBounds).filter(n => juzBounds[n].surahs.some(p => p.number === id)).map(Number).sort((a, b) => a - b);
  return js;
}
function surahQuickFacts(id, chapter) {
  const stats = surahStatsFor(id);
  const juzs = juzRangeFor(id);
  const juzText = juzs.length === 1 ? `في الجزء ${ar(juzs[0])}` : `من الجزء ${ar(juzs[0])} إلى الجزء ${ar(juzs[juzs.length - 1])}`;
  const rows = [
    [`كم عدد آيات سورة ${chapter.name}؟`, `${ar(chapter.ayahCount)} آية، وهي السورة ${ar(id)} في ترتيب المصحف.`],
    [`في أي جزء تقع سورة ${chapter.name}؟`, `${juzText}، وتبدأ في الصفحة ${ar(chapter.page)} من المصحف.`],
    [`كم عدد كلمات سورة ${chapter.name}، وكم يستغرق قرؤها؟`, `${ar(stats.words)} كلمة و${ar(stats.letters)} حرفًا تقريبًا، ويقدّر زمن قراءتها ب${ar(stats.minutes)} ${stats.minutes === 1 ? 'دقيقة' : 'دقائق'}.`],
    [`هل سورة ${chapter.name} مكية أم مدنية؟`, `${chapter.revelation === 'مكية' ? 'مكية' : 'مدنية'} في المشهور عند أهل العلم.`]
  ];
  const guide = surahGuides[String(id)];
  if (guide && guide.merit) rows.push([`هل ورد فضلٌ لسورة ${chapter.name}؟`, guide.merit]);
  const list = rows.map(([q, a]) => `<div class="qa-row"><dt>${esc(q)}</dt><dd>${esc(a)}</dd></div>`).join('');
  return `<section class="surah-quick" id="surah-quick" aria-labelledby="surah-quick-title"><h2 id="surah-quick-title">أسئلة سريعة عن سورة ${esc(chapter.name)}</h2><dl>${list}</dl></section>`;
}
function surahTopicsNav(id) {
  const list = topics.filter(t => t.surahs.includes(id));
  if (!list.length) return '';
  return `<nav class="surah-topics" aria-label="موضوعات هذه السورة"><span>مَوْضُوعَاتُهَا</span><div>${list.map(t => `<a href="/topics#topic-${t.slug}">${esc(t.name)}</a>`).join('')}</div></nav>`;
}
function keyAyahBlock(id, chapter) {
  const entry = surahKeyAyahs[String(id)];
  if (!entry) return '';
  const { opening, first } = splitOpening(id);
  const text = entry.ayah === 1 && opening ? first : verses[id][entry.ayah - 1];
  if (!text) return '';
  return `<section class="surah-key" id="surah-key" aria-labelledby="surah-key-title"><div class="surah-key-head"><span class="surah-key-label">${icon('spark', '', 14)} آيَةٌ تُخْتَصَرُ بِهَا السُّورَة</span><a class="surah-key-ref" href="#ayah-${entry.ayah}">سورة ${esc(chapter.name)} · الآية ${ar(entry.ayah)}</a></div><p class="surah-key-text" lang="ar">﴿ ${esc(text.trim())} ﴾</p><p class="surah-key-why">${esc(entry.why)}</p></section>`;
}
// صفحات الآيات: نصٌّ قرآني حقيقي وتفسير ميسّر لكل آية مختارة.
// المحتوى فيها فريد بالضرورة (نص الآية نفسها)، ولذلك تُبنى من بيانات لا من قوالب نصية.
const AYAH_PAGES = require('./data/ayat-pages.json');
const AYAH_INDEX = new Map(AYAH_PAGES.map(item => [item.s + ':' + item.a, item]));
function ayahKey(s, a) { return Number(s) + '/' + Number(a); }
function ayahLinksFor(id) {
  const items = AYAH_PAGES.filter(item => item.s === Number(id));
  if (!items.length) return '';
  return `<nav class="ayah-links" aria-label="آيات مفردة من السورة" style="margin:18px 0"><span class="section-kicker"><span>✦</span> آيَاتٌ مُفْرَدَة</span><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${items.map(item => `<a class="text-link" href="/ayah/${item.s}/${item.a}">الآية ${ar(item.a)}</a>`).join('')}</div></nav>`;
}
// آية اليوم: اختيار يوميّ حتميّ من آياتٍ مشهورة، يُبنى عند الطلب فيتغيّر بلا كتابةٍ جديدة.
const AYAH_OF_DAY = [[2,255],[2,286],[2,152],[2,186],[3,26],[3,173],[3,190],[13,28],[17,80],[18,10],[21,87],[24,35],[25,74],[36,82],[39,53],[40,60],[59,22],[59,23],[59,24],[65,2],[65,3],[67,1],[94,5],[94,6],[1,1],[112,1],[113,1],[114,1],[18,1]];
function ayahOfDay(origin, now = Date.now()) {
  const pool = AYAH_OF_DAY.filter(pair => AYAH_INDEX.has(pair[0] + ':' + pair[1]));
  if (!pool.length) return '';
  const dayNumber = Math.floor(now / 86400000);
  const pick = pool[dayNumber % pool.length];
  const item = AYAH_INDEX.get(pick[0] + ':' + pick[1]);
  const chapter = chapters[pick[0] - 1];
  const excerpt = (() => { const full = (item.tafsir || '').trim(); if (full.length <= 190) return full; const cut = full.slice(0, 190); const dot = cut.lastIndexOf('. '); if (dot > 90) return cut.slice(0, dot + 1); const space = cut.lastIndexOf(' '); return cut.slice(0, space > 90 ? space : 190) + '…'; })();
  return `<section class="ayah-of-day" aria-labelledby="aod-title"><div class="aod-head"><span class="section-kicker"><span>✦</span> آيَةُ اليَوْم</span><span class="aod-ref">سورة ${esc(chapter.name)} · الآية ${ar(pick[1])} · الجزء ${ar(item.juz)}</span></div><h2 id="aod-title" class="aod-text" lang="ar" dir="rtl">${esc(item.text)}</h2><p class="aod-tafsir">${esc(excerpt)}</p><div class="aod-links"><a class="button button-outline" href="/ayah/${pick[0]}/${pick[1]}">اقرأ الآية وتفسيرها كاملًا ${icon('arrowLeft','',16)}</a><a class="text-link" href="/ayah">فهرس الآيات ${icon('arrowLeft','',15)}</a></div></section>`;
}
function ayahIndexPage(origin) {
  const groups = [];
  for (let id = 1; id <= 114; id++) {
    const items = AYAH_PAGES.filter(x => x.s === id);
    if (!items.length) continue;
    groups.push(`<section class="ayah-group" aria-labelledby="ag-${id}"><div class="ayah-group-head"><h2 id="ag-${id}"><span>${ar(id)}</span> سورة ${esc(chapters[id-1].name)}</h2><a href="/surah/${id}" class="text-link">السورة كاملة ${icon('arrowLeft','',15)}</a></div><div class="ayah-group-links">${items.map(x => `<a href="/ayah/${x.s}/${x.a}">${ar(x.a)}</a>`).join('')}</div></section>`);
  }
  const picks = keyAyahStrip();
  const body = `<div class="shell subpage-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/surahs">فهرس السور</a><span>›</span><span>فهرس الآيات</span></nav><header class="surahs-hero"><span class="section-kicker"><span>✦</span> آيَةً آيَة</span><h1>فهرس الآيات المفردة<span class="gold-dot">.</span></h1><p>كل آيةٍ في هذا الفهرس لها صفحتها: النص بالرسم العثماني، والتفسير الميسّر، وموضعها من الجزء والصفحة، مع روابط التنقّل داخل السورة. اختر سورةً ثم اضغط رقم الآية.</p><div class="surahs-stats"><span><strong>${ar(AYAH_PAGES.length)}</strong> صفحة آية</span><span><strong>${ar(114)}</strong> سورة</span><span><strong>${ar(6236)}</strong> آية في المصحف</span></div>${picks}</header>${groups.join('')}<nav class="category-back" aria-label="روابط أخرى"><a href="/surahs">فهرس السور ${icon('arrowLeft','',16)}</a><a href="/articles">مجلة سَنا ${icon('arrowLeft','',16)}</a></nav></div>`;
  const pageUrl = origin + '/ayah';
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'CollectionPage','@id':pageUrl,url:pageUrl,name:'فهرس الآيات المفردة',inLanguage:'ar',isPartOf:{'@type':'WebSite',name:'سَنا للقرآن الكريم',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'فهرس السور',item:origin+'/surahs'},{'@type':'ListItem',position:3,name:'فهرس الآيات',item:pageUrl}]}
  ]};
  return layout({title:'فهرس الآيات المفردة — نص عثماني وتفسير ميسّر | سَنا',description:`${AYAH_PAGES.length} صفحة آية موزّعة على سور القرآن الكريم، كل واحدة بالنص العثماني والتفسير الميسّر وموضعها من المصحف.`,body,url:pageUrl,schema});
}
function ayahPage(surahId, ayahNumber, origin) {
  const item = AYAH_INDEX.get(Number(surahId) + ':' + Number(ayahNumber));
  if (!item) return null;
  const c = chapters[item.s - 1];
  const pageUrl = origin + '/ayah/' + item.s + '/' + item.a;
  const prev = AYAH_INDEX.get(item.s + ':' + (item.a - 1));
  const next = AYAH_INDEX.get(item.s + ':' + (item.a + 1));
  const siblings = AYAH_PAGES.filter(x => x.s === item.s && x.a !== item.a).slice(0, 12);
  const articles = articlesForSurah(item.s, 3);
  const body = `<div class="shell reader-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/surahs">فهرس السور</a><span>›</span><a href="/surah/${item.s}">سورة ${esc(c.name)}</a><span>›</span><span>الآية ${ar(item.a)}</span></nav><section class="reader-intro"><div><span class="section-kicker"><span>✦</span> آيَةٌ وَتَفْسِيرُهَا</span><h1>سورة ${esc(c.name)} — الآية ${ar(item.a)}</h1><p>نصّ الآية بالرسم العثماني، ثم التفسير الميسّر، ثم موضعها من المصحف وما يتّصل بها من قراءةٍ وعمل.</p></div><div class="intro-motif" aria-hidden="true">✺</div></section><nav class="reader-jump" aria-label="انتقال سريع داخل الصفحة"><a href="#reading">الآية</a><a href="#tafsir">التفسير</a><a href="#ayah-about">عن الآية</a>${articles.length ? '<a href="#ayah-journal">مقالات السورة</a>' : ''}<a href="/surah/${item.s}">السورة كاملة</a></nav><div class="reader-layout"><section class="reader-main" aria-label="الآية وتفسيرها"><div class="surah-frame" id="reading"><div class="surah-frame-title"><span class="frame-flourish">❋</span><div><span>الْقُرْآنُ الْكَرِيم</span><h2>سورة ${esc(c.name)} · الآية ${ar(item.a)}</h2><p>${c.revelation} &nbsp;·&nbsp; ${ayahCount(item.total)} &nbsp;·&nbsp; الجزء ${ar(item.juz)} &nbsp;·&nbsp; الصفحة ${ar(item.page)}${item.sajda ? ' &nbsp;·&nbsp; آية سجدة' : ''}</p></div><span class="frame-flourish">❋</span></div><div class="ayah-list">${ayahRow(c, item.text, item.a)}</div></div><div class="surah-navigation">${prev ? `<a href="/ayah/${item.s}/${prev.a}">${icon('arrowRight','',17)}<span><small>الآية السابقة</small><strong>الآية ${ar(prev.a)}</strong></span></a>` : '<span></span>'}${next ? `<a href="/ayah/${item.s}/${next.a}"><span><small>الآية التالية</small><strong>الآية ${ar(next.a)}</strong></span>${icon('arrowLeft','',17)}</a>` : '<span></span>'}</div><div class="aside-card tafsir-card" id="tafsir"><h2>التفسير الميسّر <span>✦</span></h2><p>${esc(item.tafsir)}</p><p class="tafsir-note">التفسير الميسّر من <a href="https://quran.com/" target="_blank" rel="noopener noreferrer">موسوعة القرآن</a> عبر AlQuran Cloud، والنص بالرسم العثماني من <a href="https://tanzil.net/" target="_blank" rel="noopener noreferrer">مشروع تنزيل</a>.</p></div><div class="aside-card surah-info" id="ayah-about"><h2>عن هذه الآية <span>✦</span></h2><div><span>السورة</span><strong>سورة ${esc(c.name)}</strong></div><div><span>رقم الآية</span><strong>${ar(item.a)}</strong></div><div><span>عدد آيات السورة</span><strong>${ayahCount(item.total)}</strong></div><div><span>الجزء</span><strong>${ar(item.juz)}</strong></div><div><span>الصفحة</span><strong>${ar(item.page)}</strong></div><div><span>النزول</span><strong>${c.revelation}</strong></div>${siblings.length ? `<p style="margin-top:14px">آيات أخرى من السورة نفسها: ${siblings.map(x => `<a class="text-link" href="/ayah/${x.s}/${x.a}">${ar(x.a)}</a>`).join(' · ')}</p>` : ''}</div>${articles.length ? `<section class="surah-journal" id="ayah-journal"><div class="surah-journal-head"><div><span class="section-kicker"><span>✦</span> مِنْ مَجَلَّةِ سَنا</span><h2>اقرأ بعد التلاوة</h2></div><a href="/articles" class="text-link">جميع المقالات ${icon('arrowLeft','',15)}</a></div><ul>${articles.map(a => `<li><a href="/articles/${esc(a.slug)}"><span>${esc(a.category)}</span><strong>${esc(a.title)}</strong></a></li>`).join('')}</ul></section>` : ''}<div class="source-note">${icon('info','',18)} رقم الآية وموضعها مطابقان لمصحف المدينة، والتلاوة متاحة من زر الاستماع أعلى الآية.</div></section><aside class="reader-aside"><div class="aside-card aside-choose"><span class="aside-overline">تَنَقَّلْ بِسُهُولَة</span><h2>فهرس السور</h2><p>إلى أين تأخذك رحلتك اليوم؟</p><a class="aside-link" href="/surahs">عرض فهرس السور كاملًا ${icon('arrowLeft','',15)}</a></div><div class="aside-card"><h2>السورة كاملة <span>✦</span></h2><p>اقرأ سورة ${esc(c.name)} كلها بالرسم العثماني، مع الاستماع والتفسير لكل آية.</p><a class="aside-link" href="/surah/${item.s}">فتح سورة ${esc(c.name)} ${icon('arrowLeft','',15)}</a></div><div class="aside-reminder"><span>✦</span><strong>آية واحدة،<br>قد تغيّر يومك.</strong><p>احفظ الآية بزر الحفظ أعلى النص، وعُد إليها متى شئت.</p><a href="/bookmarks">آياتي المحفوظة ${icon('arrowLeft','',15)}</a></div></aside></div></div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'WebPage','@id':pageUrl,url:pageUrl,name:`سورة ${c.name} — الآية ${item.a} بالرسم العثماني والتفسير`,inLanguage:'ar',about:{'@type':'Thing',name:`سورة ${c.name}`},isPartOf:{'@type':'WebSite',name:'سَنا للقرآن الكريم',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'فهرس السور',item:origin+'/surahs'},{'@type':'ListItem',position:3,name:`سورة ${c.name}`,item:origin+'/surah/'+item.s},{'@type':'ListItem',position:4,name:`الآية ${item.a}`,item:pageUrl}]}
  ]};
  return layout({title:`سورة ${c.name} — الآية ${ar(item.a)} بالرسم العثماني والتفسير | سَنا`,description:`الآية ${ar(item.a)} من سورة ${c.name} بالرسم العثماني، مع التفسير الميسّر وموضع الآية في الجزء ${ar(item.juz)} والصفحة ${ar(item.page)}.`,body,url:pageUrl,schema,preload:surahPreloads()});
}
function surahPage(id, origin) {
 const c = chapters[id - 1], {opening,first} = splitOpening(id);
 const selected = chapters.map(ch => `<option value="${ch.number}"${ch.number===id?' selected':''}>${ar(ch.number)}. ${esc(ch.name)}</option>`).join('');
 const rows = verses[id].map((v,i) => ayahRow(c, i === 0 ? first : v, i+1)).join('');
 const prev=id>1?chapters[id-2]:null, next=id<114?chapters[id]:null;
 const body=`<div class="shell reader-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/surahs">فهرس السور</a><span>›</span><span>سورة ${esc(c.name)}</span></nav><section class="reader-intro"><div><span class="section-kicker"><span>✦</span> وِرْدُكَ الْيَوْمِيّ</span><h1>سورة ${esc(c.name)} مكتوبة</h1><p>${surahSummary(c)}</p></div><div class="intro-motif" aria-hidden="true">✺</div></section><nav class="reader-jump" aria-label="انتقال سريع داخل الصفحة"><a href="#reading">القراءة</a><a href="#surah-about">عن السورة</a>${surahKeyAyahs[String(id)] ? '<a href="#surah-key">آية السورة</a>' : ''}<a href="#ayah-1">من أول آية</a><a href="#surah-quick">أسئلة سريعة</a><a href="#surah-journal">مقالات السورة</a><a href="/learn">مسار التعلّم</a></nav><div class="reader-layout"><section class="reader-main" aria-label="قراءة السورة"><div class="reader-toolbar"><div class="reader-tabs"><span class="reader-tab active">${icon('book','',18)} القراءة</span><button type="button" data-play-surah="${id}" data-reciter="afs">${icon('headphones','',18)} الاستماع</button></div><div class="reader-tools"><span>حجم الخط</span><button type="button" class="font-button" data-font-change="-2" aria-label="تصغير خط القرآن">أ−</button><button type="button" class="font-button" data-font-change="2" aria-label="تكبير خط القرآن">أ+</button></div></div><div class="surah-frame" id="reading"><div class="surah-frame-title"><span class="frame-flourish">❋</span><div><span>الْقُرْآنُ الْكَرِيم</span><h2>سورة ${esc(c.name)}</h2><p>${c.revelation} &nbsp;·&nbsp; ${ayahCount(c.ayahCount)} &nbsp;·&nbsp; ترتيبها ${ar(id)}</p></div><span class="frame-flourish">❋</span></div>${opening?`<div class="basmala" lang="ar">${esc(opening)}</div>`:''}<div class="ayah-list">${rows}</div></div><div class="surah-navigation">${prev?`<a href="/surah/${prev.number}">${icon('arrowRight','',17)}<span><small>السورة السابقة</small><strong>سورة ${esc(prev.name)}</strong></span></a>`:'<span></span>'}${next?`<a href="/surah/${next.number}"><span><small>السورة التالية</small><strong>سورة ${esc(next.name)}</strong></span>${icon('arrowLeft','',17)}</a>`:'<span></span>'}</div>${surahJournalLinks(id)}${ayahLinksFor(id)}${surahAbout(id, c)}${keyAyahBlock(id, c)}${surahQuickFacts(id, c)}${relatedSurahsByJuz(id)}<div class="source-note">${icon('info','',18)} النص القرآني بالرسم العثماني من <a href="https://tanzil.net/" target="_blank" rel="noopener noreferrer">مشروع تنزيل</a>. يمكنك استخدام أزرار كل آية للاستماع والحفظ والنسخ والتفسير.</div></section><aside class="reader-aside"><div class="aside-card aside-choose"><span class="aside-overline">تَنَقَّلْ بِسُهُولَة</span><h2>فهرس السور</h2><p>إلى أين تأخذك رحلتك اليوم؟</p><form action="/go" method="get" class="surah-select-form"><label class="sr-only" for="surah-select">اختر سورة</label><select id="surah-select" name="id">${selected}</select><button type="submit" aria-label="الانتقال إلى السورة">${icon('arrowLeft','',17)}</button></form><a class="aside-link" href="/surahs">عرض فهرس السور كاملًا ${icon('arrowLeft','',15)}</a></div><div class="aside-card surah-info"${surahGuides[String(id)] ? '' : ' id="surah-about"'}><h2>عن السورة <span>✦</span></h2><div><span>ترتيب السورة</span><strong>${ar(id)}</strong></div><div><span>عدد الآيات</span><strong>${ayahCount(c.ayahCount)}</strong></div><div><span>عدد الكلمات</span><strong>${ar(surahStatsFor(id).words)}</strong></div><div><span>الاسم بالإنجليزية</span><strong>${esc(c.englishName || '')}</strong></div><div><span>زمن القراءة</span><strong>${ar(surahStatsFor(id).minutes)} دقيقة تقريبًا</strong></div><div><span>نوع السورة</span><strong>${c.revelation}</strong></div><div><span>بداية الجزء</span><strong>${ar(c.juz)}</strong></div><div><span>بداية الصفحة</span><strong>${ar(c.page)}</strong></div></div><div class="aside-reminder"><span>✦</span><strong>آيةٌ بعد آية،<br>يطمئن القلب.</strong><p>احفظ ما يلامس قلبك لتعود إليه لاحقًا.</p><a href="/bookmarks">آياتي المحفوظة ${icon('arrowLeft','',15)}</a></div></aside></div></div>`;
 const pageUrl=origin+`/surah/${id}`;
 const guide=surahGuides[String(id)];
 const schema={'@context':'https://schema.org','@graph':[{'@type':'WebPage','@id':pageUrl,url:pageUrl,name:`سورة ${c.name} مكتوبة كاملة`,inLanguage:'ar',isPartOf:{'@type':'WebSite',name:'سَنا للقرآن الكريم',url:origin+'/'},...(guide&&guide.updatedAt?{dateModified:guide.updatedAt}:{})},{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:`سورة ${c.name}`,item:pageUrl}]}]};
 return layout({title:`سورة ${c.name} مكتوبة كاملة بالتشكيل | سَنا`,description:`سورة ${c.name} ${c.revelation} في الجزء ${ar(c.juz)}، عدد آياتها ${ar(c.ayahCount)} وكلماتها ${ar(surahStatsFor(id).words)}. اقرأها مكتوبة كاملة بالرسم العثماني مع الاستماع والتفسير الميسّر لكل آية.`,body,url:pageUrl,schema,preload:surahPreloads()});
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
    if (a.faq !== undefined && (!Array.isArray(a.faq) || !a.faq.length || a.faq.length > 6 || !a.faq.every(f => f && text(f.q,8,200) && text(f.a,40,900)))) return false;
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
  1: ['fatiha-tafsir-verse-by-verse','how-to-read-tafsir-al-muyassar','daily-quran-reading-plan','tafsir-versus-translation'],
  2: ['ayat-al-kursi-explained','last-verses-of-al-baqarah','distinguish-similar-verses'],
  18: ['surah-al-kahf-on-friday','surah-al-kahf-reading-guide','surah-al-kahf-four-stories','quran-surahs-directory-guide'],
  12: ['surah-yusuf-story','reading-a-surah-in-one-sitting','tadabbur-journal'],
  36: ['surah-yasin-structure','tadabbur-journal','daily-quran-reading-plan'],
  54: ['quran-parables-how-to-read','memorize-a-page-in-a-week','focus-while-reading-quran'],
  8: ['al-anfal-after-badr','reading-a-surah-in-one-sitting'],
  55: ['surah-al-rahman-gratitude','tadabbur-journal','teach-children-quran-at-home','quran-parables-how-to-read'],
  67: ['surah-al-mulk-structure','memorize-a-page-in-a-week','listen-to-quran-while-commuting','distinguish-similar-verses'],
  73: ['night-prayer-with-memory','focus-while-reading-quran','daily-quran-reading-plan'],
  75: ['focus-while-reading-quran','listen-to-quran-surah-and-ayah']
};
// ربط الكيانات: كل مقالٍ يذكر سورةً بالاسم يحصل على رابطٍ مباشر إلى صفحة السورة،
// وعلى `about` في بيانات Article — وهذا ما يربط المحتوى بكيان السورة عند محركات الإجابة.
const SURAH_NAME_ORDER = chapters.map(c => ({ number: c.number, name: c.name }))
  .sort((a, b) => b.name.length - a.name.length);
// التشكيل يُفسد حدّ الكلمة: «تُلخّص» تنتهي بشدّةٍ قبل الصاد فتُشبه كلمةً مستقلة.
const stripTashkeel = value => String(value).replace(/[\u064B-\u0652\u0670\u0640]/g, '');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// توحيد صور الهمزة: أسماء السور في فهرسنا بلا همزات (ابراهيم، الانفطار)،
// وكثيرٌ من المقالات يكتبها بالهمزة (إبراهيم، الإنفطار). بدون هذا التوحيد
// لا يجد المقال سورتَه ولا تراه صفحتها.
function normalizeHamza(value) {
  return String(value).replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627');
}
function surahMentions(article, limit = 3) {
  const text = normalizeHamza(stripTashkeel([article.title, article.summary, article.lead]
    .concat(article.sections.flatMap(section => [section.heading].concat(section.paragraphs)))
    .join(' ')));
  const found = [];
  for (const item of SURAH_NAME_ORDER) {
    if (found.length >= limit) break;
    const escaped = escapeRegExp(normalizeHamza(stripTashkeel(item.name)));
    const pattern = new RegExp('سورة\\s+' + escaped + '(?![\\u0621-\\u064A])');
    if (pattern.test(text)) found.push(chapters[item.number - 1]);
    else if (normalizeHamza(stripTashkeel(article.title)).match(new RegExp('^(?:(?:سورة|تفسير|تدبر|وقفة مع|خطة|دليل|مقال)\\s+)*' + escaped + '(?![\\u0621-\\u064A])'))) found.push(chapters[item.number - 1]);
  }
  return found;
}
// فهرسٌ يُبنى مرة كل دقيقة: أي مقالٍ يذكر سورةً بالاسم داخل نصه،
// حتى تُعرض في صفحة السورة مقالاتٌ موضوعية لا مقالاتٌ عشوائية.
let surahMentionCache = { at: 0, map: null };
function surahMentionIndex(now = Date.now()) {
  if (surahMentionCache.map && Math.abs(now - surahMentionCache.at) < 60000) return surahMentionCache.map;
  const map = new Map();
  for (const article of getPublishedArticles(now)) {
    for (const chapter of surahMentions(article, 4)) {
      if (!map.has(chapter.number)) map.set(chapter.number, []);
      map.get(chapter.number).push(article);
    }
  }
  surahMentionCache = { at: now, map };
  return map;
}
// مقالاتٌ تصلح لأي سورةٍ كخطوةٍ تالية، تُستخدم فقط عند نقص الروابط الموضوعية.
const SURAH_FALLBACK_SLUGS = ['reading-a-surah-in-one-sitting', 'tadabbur-questions-for-a-surah', 'how-to-read-tafsir-al-muyassar', 'tadabbur-journal'];
function articlesForSurah(id, limit = 3, now = Date.now()) {
  const published = getPublishedArticles(now);
  if (!published.length) return [];
  const bySlug = new Map(published.map(a => [a.slug, a]));
  const picked = (SURAH_ARTICLE_HINTS[id] || []).map(slug => bySlug.get(slug)).filter(Boolean);
  const push = list => {
    for (const article of list) {
      if (picked.length >= limit) return;
      if (!picked.some(x => x.slug === article.slug)) picked.push(article);
    }
  };
  const name = stripTashkeel(chapters[id - 1].name.replace(/^سورة\s*/, ''));
  // حدّ الكلمة مهم: أسماء مثل «ق» و«ص» و«ن» تطابق أي عنوانٍ يحوي الحرف نفسه.
  const namePattern = new RegExp('(?:^|[^\\u0621-\\u064A])' + escapeRegExp(name) + '(?:[^\\u0621-\\u064A]|$)');
  // الأولوية لمقالٍ عنوانه عن السورة نفسها: هو الصفحة التي يقصدها الباحث باسمها،
  // ولا يصحّ أن يُزاح عنها بمقالٍ أحدث يذكر السورة في متنه فقط.
  const titledFirst = article => namePattern.test(stripTashkeel(article.title)) ? 1 : 0;
  const mentions = (surahMentionIndex(now).get(id) || []).slice()
    .sort((a, b) => titledFirst(b) - titledFirst(a) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  // ١) مقالاتٌ تذكر السورة نصًّا — الأقرب موضوعًا
  push(mentions);
  // ٢) ثم المقالات التي تحمل اسم السورة في العنوان أو الملخص
  if (picked.length < limit) {
    push(published.filter(a => namePattern.test(stripTashkeel(a.title + ' ' + a.summary))));
  }
  // ٣) ثم خطواتُ قراءةٍ عامة بدل اختيارٍ عشوائي
  if (picked.length < limit) push(SURAH_FALLBACK_SLUGS.map(slug => bySlug.get(slug)).filter(Boolean));
  return [...new Map(picked.map(a => [a.slug, a])).values()].slice(0, limit);
}
function surahJournalLinks(id, now = Date.now()) {
  const items = articlesForSurah(id, 4, now);
  if (!items.length) return '';
  return `<section class="surah-journal" id="surah-journal" aria-labelledby="surah-journal-title"><div class="surah-journal-head"><div><span class="section-kicker"><span>✦</span> مِنْ مَجَلَّةِ سَنا</span><h2 id="surah-journal-title">اقرأ بعد التلاوة</h2></div><a href="/articles" class="text-link">جميع المقالات ${icon('arrowLeft','',15)}</a><a class="text-link surah-journal-hub" href="/articles/surahs#surah-${id}">كل ما كُتب عن السورة ${icon('arrowLeft','',15)}</a></div><div class="surah-journal-feature">${(() => { const lead = items[0]; return `<a class="surah-journal-card" href="/articles/${esc(lead.slug)}">${cardImage(lead, '(max-width:600px) 92vw, 38vw')}<span class="surah-journal-card-copy"><span class="surah-journal-eyebrow">${esc(lead.category)} · ${ar(lead.minutes)} دقائق قراءة</span><strong>${esc(lead.title)}</strong><span class="surah-journal-summary">${esc(lead.summary)}</span><span class="surah-journal-cta">اقرأ المقال ${icon('arrowLeft','',15)}</span></span></a>`; })()}<ul>${items.slice(1).map(a => `<li><a href="/articles/${esc(a.slug)}"><span>${esc(a.category)}</span><strong>${esc(a.title)}</strong>${icon('arrowLeft','',14)}</a></li>`).join('')}</ul></div></section>`;
}
// Meta descriptions must not end mid-word: trim at the last space and add an ellipsis.
function clipText(value, max = 155) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[،,؛;]$/, '') + '…';
}
function articleDate(value) {
  return new Intl.DateTimeFormat('ar-EG', {year:'numeric',month:'long',day:'numeric',timeZone:'Africa/Cairo'}).format(new Date(value));
}
// Every cover has a 640px companion generated next to the 1280px original, so
// phones download roughly a third of the bytes.
function cardImage(article, sizes, priority = false) {
  const small = article.image.replace(/\.webp$/, '-640.webp');
  return `<img src="${esc(article.image)}" srcset="${esc(small)} 640w, ${esc(article.image)} 1280w" sizes="${esc(sizes)}" alt="" width="1280" height="714" loading="${priority ? 'eager' : 'lazy'}"${priority ? ' fetchpriority="high"' : ''} decoding="async">`;
}
function articleCard(article, featured = false) {
  return `<article class="journal-card${featured ? ' journal-card-featured' : ''}"><a class="journal-card-image" href="/articles/${esc(article.slug)}" tabindex="-1" aria-hidden="true">${cardImage(article, '(max-width:600px) 92vw, (max-width:1100px) 46vw, 30vw')}</a><div class="journal-card-copy"><div class="journal-card-meta"><span>${esc(article.category)}</span><span class="meta-divider">•</span><time datetime="${esc(article.publishedAt)}">${esc(articleDate(article.publishedAt))}</time></div><h3><a href="/articles/${esc(article.slug)}">${esc(article.title)}</a></h3><p>${esc(article.summary)}</p><a class="journal-card-link" href="/articles/${esc(article.slug)}" aria-label="اقرأ: ${esc(article.title)}">اقرأ المقال ${icon('arrowLeft','',16)}</a></div></article>`;
}
function homeArticleSection(now = Date.now()) {
  const list = getPublishedArticles(now);
  const article = list[0];
  if (!article) return '';
  const more = []; const seenCats = new Set([article.category]);
  for (const a of list.slice(1)) { if (more.length === 3) break; if (seenCats.has(a.category)) continue; seenCats.add(a.category); more.push(a); }
  const moreHtml = more.length ? `<ul class="home-journal-more" aria-label="أحدث المقالات">${more.map((a, i) => `<li><a href="/articles/${esc(a.slug)}"><span class="hj-index">${ar(i + 2)}</span><span class="hj-body"><span class="hj-eyebrow">${esc(a.category)} <i>·</i> ${ar(a.minutes)} دقائق قراءة</span><strong>${esc(a.title)}</strong></span>${icon('arrowLeft', '', 15)}</a></li>`).join('')}</ul>` : '';
  return `<section class="home-journal" aria-labelledby="home-journal-title"><div class="section-heading"><div><span class="section-kicker"><span>✦</span> مَجَلَّةُ سَنا</span><h2 id="home-journal-title">للقراءة بقلبٍ حاضر<span class="gold-dot">.</span></h2><p>أفكار وأدلة عملية ترافق رحلتك مع القرآن.</p></div><a class="text-link" href="/articles">جميع المقالات ${icon('arrowLeft','',18)}</a></div><a class="home-journal-card" href="/articles/${esc(article.slug)}">${cardImage(article, '(max-width:600px) 92vw, 35vw')}<div><span class="home-journal-eyebrow">${esc(article.category)} <i>·</i> ${esc(articleDate(article.publishedAt))}</span><h3>${esc(article.title)}</h3><p>${esc(article.summary)}</p><span class="home-journal-link">اقرأ المقال ${icon('arrowLeft','',16)}</span></div></a>${moreHtml}</section>`;
}
// Editorial hubs exist only for categories that actually carry at least three
// published articles; thinner categories stay as plain labels to avoid thin pages.
const CATEGORY_HUBS = [
  { slug: 'reading-guide', name: 'دليل القراءة', intro: 'أدلة القراءة في سَنا تجيب عن سؤال واحد: كيف تجعل للقرآن وقتًا ثابتًا في يومك دون أن يصبح عبئًا؟ هنا خطط الورد اليومي، وتهيئة مكان القراءة، والتعامل مع الهاتف والمقاطعات، والآداب العملية للجلسة. ابدأ بأي مقال، ثم جرّب خطوة واحدة منه اليوم، لأن القراءة التي تتغير فعلًا هي التي تبدأ صغيرة ومحددة.' },
  { slug: 'memorization', name: 'الحفظ والمراجعة', intro: 'الحفظ مشروع طويل يحتاج خطة لا حماسًا مؤقتًا. في هذا القسم تجد تقسيم الصفحة على أسبوع، وطريقة التكرار والاسترجاع، وجدول الفواصل الزمنية الذي يحمي ما حفظت، وخطة المراجعة الأسبوعية، وطرق التمييز بين الآيات المتشابهة. الأفكار كلها قابلة للتطبيق بمصحف ودفتر وقلم.' },
  { slug: 'tadabbur', name: 'تدبر', intro: 'التدبر ليس تفسيرًا، بل ملاحظة شخصية تُعرض على التفسير وأهل العلم. هنا أسئلة عملية تُطرح قبل القراءة وأثناءها وبعدها، وطريقة لقراءة سورة كاملة وفهم محورها، ودفتر بسيط يحوّل ما فهمته إلى سطور تعود إليها. لا تحتاج أداة معقدة، بل جلسة قصيرة ونية واضحة.' },
  { slug: 'family', name: 'الأسرة', intro: 'تعويد الأسرة على القرآن يحتاج لطفًا واستمرارًا أكثر مما يحتاج مواعظ. هذه المقالات تتناول حلقة قرآن صغيرة في البيت، وكيف تتعامل مع تأخر الطفل في الحفظ دون الضغط، وكيف يصبح الاستماع والتكرار لعبة أسرية. كل نصيحة هنا يمكن أن تبدأ هذا الأسبوع بجلسة من خمس دقائق.' },
  { slug: 'listening', name: 'الاستماع', intro: 'الاستماع باب واسع للقرآن في أوقات لا تستطيع فيها القراءة. هنا دليل لاستخدام التلاوات والانتقال بين السور والآيات، وطريقة لتحويل وقت الطريق إلى جلسة استماع، وكيف تختار القارئ الذي يناسب هدفك في الحفظ أو التدبر أو الاستماع أثناء التنقل.' },
  { slug: 'tafsir', name: 'التفسير', intro: 'التفسير المختصر طريق آمن لفهم الآية بلا تعقيد، والترجمة جسر لغير العربي لا بديل عن النص. في هذا القسم تجد كيف تقرأ التفسير الميسّر خطوة بخطوة، والفرق بين الترجمة والتفسير، وأخطاء شائعة تحدث عند فهم الآية من ترجمة منفصلة، مع تنبيه دائم إلى الرجوع لأهل العلم في المسائل العملية.' }
];
function categoryArticles(name, now = Date.now()) {
  return getPublishedArticles(now).filter(a => a.category === name);
}
function activeCategoryHubs(now = Date.now()) {
  return CATEGORY_HUBS.filter(hub => categoryArticles(hub.name, now).length >= 3);
}
function categoryHubBySlug(slug) {
  return CATEGORY_HUBS.find(hub => hub.slug === slug) || null;
}
function categoryPage(hub, origin, now = Date.now()) {
  const items = categoryArticles(hub.name, now), pageUrl = origin + '/articles/category/' + hub.slug;
  const cards = items.map((article, index) => articleCard(article, index === 0)).join('');
  const body = `<div class="shell journal-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/articles">المقالات</a><span>›</span><span>${esc(hub.name)}</span></nav><header class="category-hero"><span class="section-kicker"><span>✦</span> تَصْنِيف</span><h1>${esc(hub.name)}<span class="gold-dot">.</span></h1><p>${esc(hub.intro)}</p><span class="journal-count">${ar(items.length)} ${items.length === 1 ? 'مقال' : 'مقالات'} في هذا التصنيف</span></header><section class="journal-grid" aria-label="مقالات ${esc(hub.name)}">${cards}</section><nav class="category-back" aria-label="تصنيفات المجلة"><a href="/articles">كل المقالات ${icon('arrowLeft','',16)}</a></nav></div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'CollectionPage','@id':pageUrl,url:pageUrl,name:hub.name,inLanguage:'ar',description:hub.intro,isPartOf:{'@type':'WebSite',name:'سَنا للقرآن الكريم',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'المقالات',item:origin+'/articles'},{'@type':'ListItem',position:3,name:hub.name,item:pageUrl}]}
  ]};
  return layout({title:`${hub.name} | مجلة سَنا`,description:clipText(hub.intro,150),body,active:'articles',url:pageUrl,schema});
}
function categoryChips(now = Date.now()) {
  const hubs = activeCategoryHubs(now);
  if (!hubs.length) return '';
  return `<nav class="category-chips" aria-label="تصنيفات المجلة"><span>التصنيفات</span>${hubs.map(hub => `<a href="/articles/category/${hub.slug}">${esc(hub.name)} <i>${ar(categoryArticles(hub.name, now).length)}</i></a>`).join('')}</nav>`;
}
function meritStrip() {
  const ids = Object.keys(surahGuides).filter(id => surahGuides[id].merit).map(Number).sort((a, b) => a - b);
  if (!ids.length) return '';
  return '<span>✦ فَضْلٌ مَنْقُول</span><div>' + ids.map(id => '<a href="/surah/' + id + '">سورة ' + esc(chapters[id - 1].name) + '</a>').join('') + '</div>';
}
const POPULAR_CLUSTERS = ['kahf', 'yasin', 'mulk', 'rahman', 'baqarah', 'fatiha', 'ikhlas', 'muawwidhat', 'king-night', 'juz-30'];
function popularSearches() {
  const list = POPULAR_CLUSTERS.map(id => keywordClusters.find(c => c.id === id)).filter(Boolean);
  if (!list.length) return '';
  return '<nav class="popular-searches" aria-label="أكثر ما يُبحث عنه"><span>الأَكْثَرُ طَلَبًا</span><div>' + list.map(c => '<a href="' + esc(c.target) + '">' + esc(c.query) + '</a>').join('') + '</div></nav>';
}
function keyAyahStrip() {
  const picks = [[2,255,'آية الكرسي'],[2,286,'خواتيم البقرة'],[13,28,'طمأنينة الذكر'],[18,10,'دعاء الكهف'],[21,87,'دعاء يونس'],[39,53,'لا تقنطوا'],[65,3,'حسبك الله'],[94,5,'مع العسر يسر']];
  const links = picks.filter(([s,a]) => AYAH_INDEX.has(s + ':' + a)).map(([s,a,label]) => `<a href="/ayah/${s}/${a}">${label}</a>`).join('');
  if (!links) return '';
  return `<nav class="merit-strip" aria-label="آيات يبحث عنها الناس"><span>آيَاتٌ مَشْهُودَة</span><div>${links}<a href="/ayah">فهرس الآيات</a></div></nav>`;
}
function surahsPage(origin) {
  const pageUrl = origin + '/surahs';
  const body = `<div class="shell subpage-shell surahs-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>فهرس السور</span></nav><header class="surahs-hero"><span class="section-kicker"><span>✦</span> الْقُرْآنُ الْكَرِيم</span><h1>فهرس سور القرآن الكريم<span class="gold-dot">.</span></h1><p>كل سور القرآن الكريم المئة والأربع عشرة مرتّبة بحسب ترتيب المصحف، من سورة الفاتحة إلى سورة الناس. ابحث بالاسم أو الرقم، أو صفِّ السور المكية والمدنية، ثم افتح السورة للقراءة والاستماع والتفسير.</p><div class="surahs-stats"><span><strong>${ar(114)}</strong> سورة</span><span><strong>${ar(6236)}</strong> آية</span><span><strong>${ar(chapters.filter(c => c.revelation === 'مكية').length)}</strong> مكية</span><span><strong>${ar(chapters.filter(c => c.revelation === 'مدنية').length)}</strong> مدنية</span></div><nav class="merit-strip" aria-label="سور ورد في فضلها نصّ حديثي">${meritStrip()}</nav>${popularSearches()}${keyAyahStrip()}</header><div class="directory-search directory-search-page">${icon('search','',19)}<label class="sr-only" for="surah-search">ابحث عن سورة</label><input type="search" id="surah-search" placeholder="ابحث عن سورة أو رقمها..." autocomplete="off"><kbd>⌕</kbd></div><div class="directory-tabs" role="group" aria-label="تصفية السور"><button type="button" class="filter-tab active" data-filter="all" aria-pressed="true">جميع السور <span>${ar(114)}</span></button><button type="button" class="filter-tab" data-filter="مكية" aria-pressed="false">السور المكية</button><button type="button" class="filter-tab" data-filter="مدنية" aria-pressed="false">السور المدنية</button></div><div class="surah-list" id="surah-list">${chapters.map(surahCard).join('')}</div><p class="empty-filter" id="surah-empty" hidden>لم نجد سورة بهذا الاسم. جرّب كلمة أخرى.</p><div class="directory-more"><button class="button button-outline" id="show-all" type="button" hidden>عرض جميع السور ${icon('down','',17)}</button></div><nav class="category-back" aria-label="روابط أخرى"><a href="/listen">صفحة الاستماع ${icon('arrowLeft','',16)}</a><a href="/juz/30">جزء عمّ ${icon('arrowLeft','',16)}</a><a href="/guides">أدلة السور ${icon('arrowLeft','',16)}</a><a href="/articles">مجلة سَنا ${icon('arrowLeft','',16)}</a></nav></div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'CollectionPage','@id':pageUrl,url:pageUrl,name:'فهرس سور القرآن الكريم',inLanguage:'ar',isPartOf:{'@type':'WebSite','@id':origin+'/#website',name:'سَنا للقرآن الكريم',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'فهرس السور',item:pageUrl}]},
    {'@type':'ItemList','@id':pageUrl+'#surahs',numberOfItems:114,itemListElement:chapters.map((c, i) => ({'@type':'ListItem',position:i+1,url:`${origin}/surah/${c.number}`,name:`سورة ${c.name}`}))}
  ]};
  return layout({title:'فهرس سور القرآن الكريم كاملة بالترتيب | سَنا',active:'surahs',description:'فهرس سور القرآن الكريم الـ١١٤ مرتّبة كما في المصحف، مع البحث بالاسم أو الرقم وتصفية المكية والمدنية، وعدد آيات كل سورة ونوعها.',body,url:pageUrl,schema});
}
function listenPage(origin) {
  const pageUrl = origin + '/listen';
  const popular = [[18,"الكهف","نور الجمعة"],[36,"يس","قلب القرآن"],[67,"الملك","قبل النوم"],[55,"الرحمن","تذكير بالنعم"],[1,"الفاتحة","أساس كل صلاة"],[112,"الإخلاص","ثلث القرآن"],[56,"الواقعة","تذكير بالآخرة"],[78,"النبأ","خبر عظيم"]];
  const reciters = [["afs","مشاري العفاسي","م",""],["maher","ماهر المعيقلي","م"," avatar-sand"],["basit","عبد الباسط عبد الصمد","ع"," avatar-olive"]];
  const cards = popular.map(([id, name, tag]) => {
    const c = chapters[id - 1];
    return `<article class="listen-card"><div class="listen-card-top"><span class="listen-card-id">${ar(id)}</span><div><h3>سورة ${esc(name)}</h3><p>${esc(c.revelation)} · ${ayahCount(c.ayahCount)} · ${esc(tag)}</p></div></div><div class="listen-card-actions"><button type="button" class="button button-dark button-small" data-play-surah="${id}" data-reciter="afs">${icon('play','',14)} استمع</button><a class="text-link" href="/surah/${id}">اقرأ السورة ${icon('arrowLeft','',15)}</a></div></article>`;
  }).join('');
  const reciterList = reciters.map(([key, name, letter, cls]) => `<button class="reciter-card" type="button" data-play-surah="18" data-reciter="${key}"><span class="reciter-avatar${cls}">${letter}</span><span class="reciter-details"><strong>${esc(name)}</strong><small>سورة الكهف · تلاوة قرآنية</small></span><span class="reciter-play">${icon('play','',16)}</span></button>`).join('');
  const body = `<div class="shell subpage-shell listen-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>الاستماع</span></nav><header class="surahs-hero"><span class="section-kicker"><span>✦</span> صَوْتٌ يَصِلُ إِلَى الْقَلْب</span><h1>الاستماع إلى التلاوات<span class="gold-dot">.</span></h1><p>اختر قارئًا وابدأ بسورة، أو افتح أي سورة للاستماع إليها كاملة أو آية آية. المشغّل يعمل في المتصفح ويحتاج اتصالًا بالإنترنت، والتلاوات معروضة من مصادرها الأصلية مع ذكرها.</p></header><section class="listen-pick" aria-labelledby="reciters-title"><div class="section-heading"><div><span class="section-kicker"><span>✦</span> اِخْتَرْ صَوْتًا</span><h2 id="reciters-title">ابدأ بسورة الكهف<span class="gold-dot">.</span></h2></div></div><div class="reciters">${reciterList}<span class="audio-source">التلاوات من MP3Quran · تتطلب اتصالًا بالإنترنت</span></div></section><section class="listen-grid-section" aria-labelledby="popular-title"><div class="section-heading"><div><span class="section-kicker"><span>✦</span> سُوَرٌ يَرْجِعُ إِلَيْهَا الْكَثِير</span><h2 id="popular-title">سور تُستحبّ لها العودة<span class="gold-dot">.</span></h2><p>اضغط «استمع» لتبدأ التلاوة، أو اقرأ السورة كاملة مع التفسير.</p></div><a class="text-link" href="/surahs">كل السور ${icon('arrowLeft','',16)}</a></div><div class="listen-grid">${cards}</div></section><section class="listen-howto" aria-labelledby="howto-title"><h2 id="howto-title">كيف تستمع بفائدة؟</h2><ul><li><strong>للحفظ:</strong> استمع للآية ثم أعدها ثلاث مرات، ثم اقرأها دون نظر.</li><li><strong>للتدبر:</strong> اختر مقطعًا قصيرًا، وتوقف عند تفسير آية واحدة في جلسة واحدة.</li><li><strong>في الطريق:</strong> الزم قارئًا واحدًا أسبوعين، واختر تلاوة واضحة لا سريعة.</li></ul><p>لمزيد من التفصيل اقرأ في المجلة: <a href="/articles/choose-the-right-recitation">كيف تختار القارئ الذي يناسب هدفك</a> و<a href="/articles/listen-to-quran-while-commuting">الاستماع في الطريق والعمل</a>.</p></section></div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'CollectionPage','@id':pageUrl,url:pageUrl,name:'الاستماع إلى تلاوات القرآن',inLanguage:'ar',isPartOf:{'@type':'WebSite','@id':origin+'/#website',name:'سَنا للقرآن الكريم',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'الاستماع',item:pageUrl}]}
  ]};
  return layout({title:'الاستماع إلى القرآن الكريم: تلاوات وسور مختارة | سَنا',active:'listen',description:'استمع إلى تلاوات القرآن الكريم بصوت مشاري العفاسي وماهر المعيقلي وعبد الباسط، مع سور مختارة للاستماع وقراءتها كاملة.',body,url:pageUrl,schema});
}
const LEARN_STAGES = [
  {
    title: 'البداية: أول أسبوع مع المصحف',
    intro: 'لمن يفتح المصحف بجدية أول مرة: من أي سورة تبدأ، وكيف تفهم رموز الصفحة قبل أن تقرأها، وكيف تنهي أول صفحة كاملة بلا تعثّر.',
    action: { href: '/surah/1', label: 'ابدأ بسورة الفاتحة' },
    slugs: ['first-mushaf-beginner', 'quran-surahs-directory-guide', 'mushaf-structure-marks', 'mushaf-waqf-signs', 'waqf-and-ibtida-basics', 'istiaadha-and-basmalah', 'tajweed-colored-mushaf', 'quran-ayahs-and-words-count', 'maratib-al-qiraah', 'understanding-quran-without-arabic', 'mosque-recitation-etiquette', 'first-month-with-quran-new-muslim', 'choosing-a-mushaf-edition'],
  },
  {
    title: 'الاستمرار: وردٌ لا ينقطع',
    intro: 'المرحلة التي يسقط فيها أكثر القرّاء: كيف تحوّل القراءة إلى عادة يومية صغيرة، وكيف تعود بعد الانقطاع دون أن تعوّض الشهور في أسبوع.',
    action: { href: '/articles/quran-khatm-plan', label: 'احسب خطتك' },
    slugs: ['daily-quran-reading-plan', 'resume-quran-after-break', 'quran-khatm-plan', 'focus-while-reading-quran', 'ramadan-khatm-without-rush', 'ward-while-travelling', 'ward-after-fajr', 'surah-al-kahf-on-friday', 'reading-quran-on-phone', 'handling-the-mushaf'],
  },
  {
    title: 'الحفظ والمراجعة',
    intro: 'الحفظ عمل مُرتّب لا موهبة: تقطيع الآية، تثبيت المقطع، مراجعة موزّعة على أيام تعيد ما حفظته إلى الواجهة قبل أن ينسحب.',
    action: { href: '/articles/memorize-a-page-in-a-week', label: 'ابدأ بحفظ صفحة' },
    slugs: ['memorize-a-page-in-a-week', 'memorize-long-ayah', 'weekly-review-plan-for-memorization', 'when-to-revise-memorized-parts', 'memorize-after-thirty', 'silent-or-loud-reading', 'forgetting-ayah-in-prayer', 'memorizing-al-baqarah-plan', 'memorization-error-log', 'writing-your-memorization', 'ai-recitation-tools', 'memorizing-juz-amma-plan', 'khushu-before-takbir', 'memorize-with-a-partner', 'tajweed-makharij-practice', 'recitation-mistakes-beginners', 'memorize-two-pages-daily'],
  },
  {
    title: 'الفهم: التفسير والتدبر',
    intro: 'بعد أن تثبت القراءة يأتي سؤال المعنى: أي تفسير يبدأ به المبتدئ، وكيف يقرأ آية واحدة بتدبّر لا يستغرق أكثر من خمس دقائق.',
    action: { href: '/surah/18', label: 'اقرأ سورة الكهف' },
    slugs: ['types-of-tafsir-beginner', 'how-to-read-tafsir-al-muyassar', 'tadabbur-journal', 'five-minute-tadabbur', 'surah-al-rahman-gratitude', 'ayat-al-kursi-explained', 'surah-yusuf-story', 'asbab-al-nuzul', 'names-of-the-quran', 'longest-and-shortest-ayah', 'why-translation-of-meanings', 'surah-al-mulk-structure', 'fatiha-tafsir-verse-by-verse', 'makki-madani-why-it-matters', 'quran-parables-how-to-read', 'divine-names-in-quran', 'quran-oaths-explained', 'quran-stories-purpose', 'surah-al-waqiah-wealth'],
  },
  {
    title: 'الاستماع والأسرة',
    intro: 'أن تجعل للقرآن صوتًا في البيت: اختيار القارئ، والاستماع الفعّال لا الخلفي، وخطة عشر دقائق لتعليم الأطفال السور القصيرة.',
    action: { href: '/listen', label: 'افتح صفحة الاستماع' },
    slugs: ['choose-the-right-recitation', 'active-listening-full-surah', 'short-surahs-for-kids', 'family-quran-circle-at-home', 'thirty-nights-with-the-mushaf', 'child-reads-alone', 'reciting-before-people', 'family-group-reading', 'noon-sakinah-and-tanween', 'madd-rules-basics', 'choosing-quran-podcast', 'teaching-tajweed-to-children', 'listening-with-translation', 'family-quran-quiz', 'why-recitations-differ', 'teen-quran-habit', 'listen-while-working'],
  },
];
function learnStageArticles(stage, now = Date.now()) {
  const published = getPublishedArticles(now);
  const bySlug = new Map(published.map(a => [a.slug, a]));
  return stage.slugs.map(slug => bySlug.get(slug)).filter(Boolean);
}
function learnPage(origin, now = Date.now()) {
  const pageUrl = origin + '/learn';
  const stages = LEARN_STAGES.map(stage => ({ ...stage, articles: learnStageArticles(stage, now) }));
  const total = stages.reduce((n, st) => n + st.articles.length, 0);
  const items = stages.map((stage, index) => `<li class="learn-stage" id="stage-${index + 1}"><div class="learn-stage-head"><span class="learn-num">${ar(index + 1).padStart(2, '٠')}</span><div><h2>${esc(stage.title)}</h2><p>${esc(stage.intro)}</p></div></div><ul class="learn-articles">${stage.articles.map(a => `<li><a href="/articles/${esc(a.slug)}"><span>${esc(a.category)} · ${ar(a.minutes)} د</span><strong>${esc(a.title)}</strong></a></li>`).join('')}</ul><a class="learn-action" href="${esc(stage.action.href)}">${esc(stage.action.label)} ${icon('arrowLeft', '', 16)}</a></li>`).join('');
  const body = `<div class="shell subpage-shell learn-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>مسار التعلّم</span></nav><header class="learn-hero"><span class="section-kicker"><span>✦</span> مَسَارُ التَّعَلُّم</span><h1>من أول صفحة<br><em>إلى وردٍ لا ينقطع.</em></h1><p>خمس مراحل مرتّبة تأخذك من فتح المصحف أول مرة إلى وردٍ يومي وحفظٍ ومراجعة وفهمٍ للآية. كل مرحلة أربع مقالات قصيرة، وخطوة عملية واحدة تبدأ بها الآن.</p><div class="learn-stats"><span><strong>${ar(stages.length)}</strong> مراحل</span><span><strong>${ar(total)}</strong> مقالًا</span><span><strong>${ar(114)}</strong> سورة تنتظرك</span></div><div class="learn-actions"><a class="button button-dark" href="/articles/first-mushaf-beginner">ابدأ من المرحلة الأولى ${icon('arrowLeft','',17)}</a><a class="text-link" href="/surahs">تصفّح فهرس السور ${icon('arrowLeft','',16)}</a></div></header><ol class="learn-path" aria-label="مراحل مسار التعلّم">${items}</ol><section class="learn-cta"><div><strong>المسار ليس برنامجًا، بل ترتيب.</strong><p>خذ مرحلة واحدة كل أسبوعين، ولا تنتقل قبل أن تصير عادة. القراءة القليلة الثابتة أنفع من برنامج كبير ينتهي بعد أيام.</p></div><a class="button button-cream" href="/listen">استمع الآن ${icon('arrowLeft','',16)}</a></section></div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'LearningResource','@id':pageUrl+'#path',url:pageUrl,name:'مسار التعلّم مع القرآن الكريم',description:'مسار من خمس مراحل يأخذ المبتدئ من أول صفحة في المصحف إلى ورد يومي وحفظ ومراجعة وفهم للآية.',inLanguage:'ar',isPartOf:{'@type':'WebSite','@id':origin+'/#website',name:'سَنا للقرآن الكريم',url:origin+'/'},teaches:'القراءة اليومية للقرآن، والحفظ والمراجعة، والتفسير والتدبر، والاستماع'},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'مسار التعلّم',item:pageUrl}]},
    {'@type':'ItemList','@id':pageUrl+'#articles',numberOfItems:total,itemListElement:stages.flatMap(st => st.articles).map((a, index) => ({'@type':'ListItem',position:index+1,url:origin+'/articles/'+a.slug,name:a.title}))}
  ]};
  return layout({title:'مسار التعلّم: من أول صفحة إلى ورد يومي | سَنا',description:'مسار من خمس مراحل لتعلّم القراءة اليومية للقرآن: البداية مع المصحف، والاستمرار، والحفظ والمراجعة، والتفسير والتدبر، والاستماع والأسرة.',body,active:'learn',url:pageUrl,schema,type:'website'});
}
function juzSpan(b) {
  const first = chapters[b.first.s - 1], last = chapters[b.last.s - 1];
  if (b.first.s === b.last.s) return { short: `${first.name} ${ar(b.first.a)}`, long: `سورة ${first.name} من الآية ${ar(b.first.a)} إلى الآية ${ar(b.last.a)}` };
  return { short: `${first.name} ${ar(b.first.a)}`, long: `من سورة ${first.name} عند الآية ${ar(b.first.a)} إلى سورة ${last.name} عند الآية ${ar(b.last.a)}` };
}
function juzPage(n, origin) {
  const b = juzBounds[String(n)];
  const pageUrl = origin + '/juz/' + n;
  const span = juzSpan(b);
  const rows = b.surahs.map(part => {
    const c = chapters[part.number - 1];
    const whole = part.from === 1 && part.to === c.ayahCount;
    const count = part.to - part.from + 1;
    return `<li><a class="juz-card" href="/surah/${c.number}#ayah-${part.from}"><span class="juz-card-num">${ar(c.number)}</span><span class="juz-card-body"><strong>سورة ${esc(c.name)}</strong><small>${whole ? 'السورة كاملة في هذا الجزء' : `الآيات ${ar(part.from)}–${ar(part.to)}`} · ${esc(c.revelation)} · ${ar(count)} آية هنا</small><em>${whole ? `${ar(c.ayahCount)} آية` : `أول آية هنا: الآية ${ar(part.from)}`}</em></span></a></li>`;
  }).join('');
  const prev = n > 1 ? { n: n - 1, label: 'الجزء السابق' } : null;
  const next = n < 30 ? { n: n + 1, label: 'الجزء التالي' } : null;
  const body = `<div class="shell subpage-shell juz-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/juz">الأجزاء الثلاثون</a><span>›</span><span>الجزء ${ar(n)}</span></nav><header class="surahs-hero"><span class="section-kicker"><span>✦</span> الْجُزْءُ ${ar(n)} مِنْ ثَلَاثِينَ</span><h1>الجزء ${ar(n)} من القرآن الكريم<span class="gold-dot">.</span></h1><p>${esc(span.long)}. يضمّ هذا الجزء ${ar(b.ayahs)} آية و${ar(b.words)} كلمة موزّعة على ${ar(b.surahs.length)} ${b.surahs.length === 1 ? 'سورة' : b.surahs.length === 2 ? 'سورتين' : 'سور'}، مرتّبة كما في المصحف. افتح أي سورة للقراءة من أول آية في الجزء، أو تنقّل إلى الجزء السابق أو التالي.</p><div class="surahs-stats"><span><strong>${ar(n)}</strong> من ٣٠</span><span><strong>${ar(b.ayahs)}</strong> آية</span><span><strong>${ar(b.words)}</strong> كلمة</span><span><strong>${ar(b.surahs.length)}</strong> ${b.surahs.length === 1 ? 'سورة' : 'سور'}</span></div></header><ol class="juz-grid" aria-label="سور الجزء ${ar(n)}">${rows}</ol><nav class="juz-pager" aria-label="التنقل بين الأجزاء">${prev ? `<a href="/juz/${prev.n}">${icon('arrowRight', '', 17)}<span><small>${prev.label}</small><strong>الجزء ${ar(prev.n)}</strong></span></a>` : '<span></span>'}${next ? `<a href="/juz/${next.n}"><span><small>${next.label}</small><strong>الجزء ${ar(next.n)}</strong></span>${icon('arrowLeft', '', 17)}</a>` : '<span></span>'}</nav><nav class="category-back" aria-label="روابط أخرى"><a href="/juz">الأجزاء الثلاثون ${icon('arrowLeft', '', 16)}</a><a href="/juz/30">جزء عمّ ${icon('arrowLeft', '', 16)}</a><a href="/surahs">فهرس السور ${icon('arrowLeft', '', 16)}</a><a href="/guides">أدلة السور ${icon('arrowLeft', '', 16)}</a></nav></div>`;
  const schema = {'@context': 'https://schema.org', '@graph': [
    {'@type': 'CollectionPage', '@id': pageUrl, url: pageUrl, name: `الجزء ${n} من القرآن الكريم`, inLanguage: 'ar', isPartOf: {'@type': 'WebSite', '@id': origin + '/#website', name: 'سَنا للقرآن الكريم', url: origin + '/'}},
    {'@type': 'BreadcrumbList', itemListElement: [{'@type': 'ListItem', position: 1, name: 'الرئيسية', item: origin + '/'}, {'@type': 'ListItem', position: 2, name: 'الأجزاء الثلاثون', item: origin + '/juz'}, {'@type': 'ListItem', position: 3, name: `الجزء ${n}`, item: pageUrl}]},
    {'@type': 'ItemList', '@id': pageUrl + '#surahs', numberOfItems: b.surahs.length, itemListElement: b.surahs.map((part, i) => ({'@type': 'ListItem', position: i + 1, url: origin + '/surah/' + part.number, name: 'سورة ' + chapters[part.number - 1].name}))}
  ]};
  return layout({title: `الجزء ${ar(n)} من القرآن: ${span.short} · ${ar(b.ayahs)} آية | سَنا`, description: `الجزء ${ar(n)} من القرآن الكريم ${span.long.split('،')[0]}؛ ${ar(b.ayahs)} آية و${ar(b.words)} كلمة في ${ar(b.surahs.length)} ${b.surahs.length === 1 ? 'سورة' : 'سور'}، مرتّبة كما في المصحف مع روابط القراءة.`, body, active: 'surahs', url: pageUrl, schema, type: 'website'});
}
function juzIndexPage(origin) {
  const pageUrl = origin + '/juz';
  const numbers = Object.keys(juzBounds).map(Number).sort((a, b) => a - b);
  const totalAyahs = numbers.reduce((sum, n) => sum + juzBounds[String(n)].ayahs, 0);
  const cards = numbers.map(n => {
    const b = juzBounds[String(n)], span = juzSpan(b);
    return `<li><a class="juz-card" href="/juz/${n}"><span class="juz-card-num">${ar(n)}</span><span class="juz-card-body"><strong>الجزء ${ar(n)}</strong><small>يبدأ عند ${esc(span.short)}</small><em>${ar(b.ayahs)} آية · ${ar(b.words)} كلمة · ${ar(b.surahs.length)} ${b.surahs.length === 1 ? 'سورة' : 'سور'}</em></span></a></li>`;
  }).join('');
  const body = `<div class="shell subpage-shell juz-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/surahs">فهرس السور</a><span>›</span><span>الأجزاء الثلاثون</span></nav><header class="surahs-hero"><span class="section-kicker"><span>✦</span> الْأَجْزَاءُ الثَّلَاثُون</span><h1>أجزاء القرآن الكريم الثلاثون<span class="gold-dot">.</span></h1><p>المصحف مقسوم إلى ثلاثين جزءًا لتسهيل القراءة والتوزيع على أيام الشهر. كل جزء يبدأ عند آية معلومة وينتهي قبل بداية الجزء التالي، وقد حسبنا لكل جزء عدد آياته وكلماته والسور التي يمرّ بها، ثم ربطنا كل سورة بأول آية لها في الجزء.</p><div class="surahs-stats"><span><strong>٣٠</strong> جزءًا</span><span><strong>${ar(totalAyahs)}</strong> آية</span><span><strong>${ar(114)}</strong> سورة</span><span><strong>${ar(numbers.filter(n => juzBounds[String(n)].surahs.length > 1).length)}</strong> جزءًا يمتدّ في أكثر من سورة</span></div></header><ol class="juz-grid" aria-label="أجزاء القرآن الثلاثون">${cards}</ol><nav class="category-back" aria-label="روابط أخرى"><a href="/surahs">فهرس السور ${icon('arrowLeft', '', 16)}</a><a href="/guides">أدلة السور ${icon('arrowLeft', '', 16)}</a><a href="/learn">مسار التعلّم ${icon('arrowLeft', '', 16)}</a></nav></div>`;
  const schema = {'@context': 'https://schema.org', '@graph': [
    {'@type': 'CollectionPage', '@id': pageUrl, url: pageUrl, name: 'أجزاء القرآن الكريم الثلاثون', inLanguage: 'ar', isPartOf: {'@type': 'WebSite', '@id': origin + '/#website', name: 'سَنا للقرآن الكريم', url: origin + '/'}},
    {'@type': 'BreadcrumbList', itemListElement: [{'@type': 'ListItem', position: 1, name: 'الرئيسية', item: origin + '/'}, {'@type': 'ListItem', position: 2, name: 'فهرس السور', item: origin + '/surahs'}, {'@type': 'ListItem', position: 3, name: 'الأجزاء الثلاثون', item: pageUrl}]},
    {'@type': 'ItemList', '@id': pageUrl + '#juz', numberOfItems: numbers.length, itemListElement: numbers.map((n, i) => ({'@type': 'ListItem', position: i + 1, url: origin + '/juz/' + n, name: 'الجزء ' + n}))}
  ]};
  return layout({title: 'أجزاء القرآن الكريم الثلاثون: البدايات وعدد الآيات | سَنا', description: 'الأجزاء الثلاثون للمصحف مع بداية كل جزء وعدد آياته وكلماته والسور التي يمرّ بها، وروابط مباشرة إلى أول آية في كل جزء.', body, active: 'surahs', url: pageUrl, schema, type: 'website'});
}
function topicsPage(origin) {
  const pageUrl = origin + '/topics';
  const blocks = topics.map(t => {
    const links = t.surahs.map(id => `<a href="/surah/${id}#surah-about">سورة ${esc(chapters[id - 1].name)}</a>`).join('');
    const rest = t.total > t.surahs.length ? `<span class="topic-more">و${ar(t.total - t.surahs.length)} سورة أخرى في الموضوع نفسه</span>` : '';
    return `<section class="topic-block" id="topic-${t.slug}" aria-labelledby="topic-${t.slug}-h"><div class="topic-head"><h2 id="topic-${t.slug}-h">${esc(t.name)}</h2><a class="topic-count" href="#topic-${t.slug}">${ar(t.total)} سورة</a></div><p class="topic-intro">${esc(t.intro)}</p><div class="topic-links">${links}${rest}</div></section>`;
  }).join('');
  const nav = topics.map(t => `<a href="#topic-${t.slug}">${esc(t.name)}</a>`).join('');
  const body = `<div class="shell subpage-shell topics-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/guides">أدلة السور</a><span>›</span><span>الموضوعات</span></nav><header class="surahs-hero"><span class="section-kicker"><span>✦</span> الْقُرْآنُ بِحَسَبِ الْمَوْضُوع</span><h1>موضوعات القرآن الكريم<span class="gold-dot">.</span></h1><p>مدخلٌ موضوعي إلى المصحف: ثمانية عشر موضوعًا استُخرجت من محاور أدلة السور الـ${ar(403)}، ولكل موضوع مقدمةٌ قصيرة تُبيّن كيف يعالجه القرآن، ثم السور التي تناولته. اضغط أي سورة لتهبط على مقطع «عن السورة» فيها.</p><div class="surahs-stats"><span><strong>${ar(topics.length)}</strong> موضوعًا</span><span><strong>${ar(topics.reduce((n, t) => n + t.surahs.length, 0))}</strong> رابطًا إلى السور</span><span><strong>${ar(114)}</strong> سورة موزّعة</span></div></header><nav class="topic-nav" aria-label="انتقال إلى الموضوعات">${nav}</nav>${blocks}<nav class="category-back" aria-label="روابط أخرى"><a href="/guides">أدلة السور ${icon('arrowLeft', '', 16)}</a><a href="/surahs">فهرس السور ${icon('arrowLeft', '', 16)}</a><a href="/juz">الأجزاء الثلاثون ${icon('arrowLeft', '', 16)}</a></nav></div>`;
  const schema = {'@context': 'https://schema.org', '@graph': [
    {'@type': 'CollectionPage', '@id': pageUrl, url: pageUrl, name: 'موضوعات القرآن الكريم', inLanguage: 'ar', dateModified: '2026-10-29', isPartOf: {'@type': 'WebSite', '@id': origin + '/#website', name: 'سَنا للقرآن الكريم', url: origin + '/'}},
    {'@type': 'BreadcrumbList', itemListElement: [{'@type': 'ListItem', position: 1, name: 'الرئيسية', item: origin + '/'}, {'@type': 'ListItem', position: 2, name: 'أدلة السور', item: origin + '/guides'}, {'@type': 'ListItem', position: 3, name: 'الموضوعات', item: pageUrl}]},
    {'@type': 'ItemList', '@id': pageUrl + '#topics', numberOfItems: topics.length, itemListElement: topics.map((t, i) => ({'@type': 'ListItem', position: i + 1, url: pageUrl + '#topic-' + t.slug, name: t.name}))}
  ]};
  return layout({title: 'موضوعات القرآن الكريم: ثمانية عشر موضوعًا مع سوره | سَنا', description: 'مدخل موضوعي إلى القرآن الكريم: الصبر والرحمة والتوحيد والصلاة والأسرة والمال والعدل والقصص والآخرة والدعاء والأخلاق والجماعة والوحي والجهاد وأهل الكتاب والدنيا والطمأنينة والعلم — كل موضوع بمقدمة وسوره.', body, active: 'surahs', url: pageUrl, schema, type: 'website'});
}
function guidesPage(origin, now = Date.now()) {
  const pageUrl = origin + '/guides';
  const ids = Object.keys(surahGuides).map(Number).sort((a, b) => a - b);
  const lastUpdated = ids.map(n => surahGuides[String(n)].updatedAt || '').sort().at(-1);
  const meritCount = ids.filter(n => surahGuides[String(n)].merit).length;
  const avgThemes = Math.round(ids.reduce((sum, n) => sum + surahGuides[String(n)].themes.length, 0) / ids.length);
  const coverage = ids.length === chapters.length ? 'صار لنا دليلٌ تحريريّ على كل سورة من سور المصحف، وكلّ دليل يفتح مباشرة على مقطع «عن السورة» في صفحتها، مع النص الكامل والتلاوة والتفسير.' : 'صار لنا الآن دليلٌ على ' + ar(ids.length) + ' سورة من أصل ١١٤، وكلّ دليل يفتح مباشرة على مقطع «عن السورة» في صفحتها، مع النص الكامل والتلاوة والتفسير.';
  const card = n => {
    const c = chapters[n - 1], guide = surahGuides[String(n)];
    return `<li><a class="guide-card" href="/surah/${n}#surah-about"><span class="guide-card-num">${ar(n)}</span><span class="guide-card-body"><strong>سورة ${esc(c.name)}</strong><small>${esc(c.revelation)} · ${ar(c.ayahCount)} آية · ${ar(surahStatsFor(n).words)} كلمة</small><span class="guide-card-themes">${guide.themes.slice(0, 2).map(t => `<em>${esc(t)}</em>`).join('')}</span>${guide.merit ? '<span class="guide-card-merit">✦ فضلٌ منقول</span>' : ''}</span></a></li>`;
  };
  const juz30ids = ids.filter(n => chapters[n - 1].juz === 30);
  const restIds = ids.filter(n => chapters[n - 1].juz !== 30);
  const body = `<div class="shell subpage-shell guides-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/surahs">فهرس السور</a><span>›</span><span>أدلة السور</span></nav><header class="surahs-hero"><span class="section-kicker"><span>✦</span> الْمُحْتَوَى التَّحْرِيرِيّ</span><h1>أدلة سور القرآن الكريم<span class="gold-dot">.</span></h1><p>دليل موجز لكل سورة كُتب لنا: يشرح محاورها الكبرى، وينبّه على ما يُستحبّ فيها إذا ثبت نصّه، ويقترح طريقة عملية للقراءة. ${coverage}</p><div class="surahs-stats"><span><strong>${ar(ids.length)}</strong> دليلًا</span><span><strong>${ar(avgThemes)}</strong> محاور في المتوسط</span><span><strong>${ar(meritCount)}</strong> بسورة فضلٍ منقول</span><span>آخر تحديث <strong>${esc(articleDate(lastUpdated))}</strong></span></div></header><section class="guide-section"><div class="guide-section-head"><h2>جزء عمّ أولًا<span class="gold-dot">.</span></h2><p>سور الجزء الثلاثين كاملةً (${ar(juz30ids.length)} سورة) صار لكل واحدة منها دليل تحريري — وهي الأقرب لمن يبدأ الحفظ أو يبحث عن سورة قصيرة يقرؤها في الصلاة.</p></div><ol class="guide-grid" aria-label="أدلة سور الجزء الثلاثين">${juz30ids.map(card).join('')}</ol></section><section class="guide-section"><div class="guide-section-head"><h2>وبقية المصحف<span class="gold-dot">.</span></h2><p>من الفاتحة إلى الناس، مرتّبة على ترتيب المصحف.</p></div><ol class="guide-grid" aria-label="أدلة باقي سور القرآن">${restIds.map(card).join('')}</ol></section><section class="learn-cta"><div><strong>دليل السورة بداية، لا نهاية.</strong><p>افتح مسار التعلّم لترى كيف تُبنى الورد اليومي خطوة بخطوة، أو ابدأ بجزء عمّ كامل بترتيبه.</p></div><a class="button button-cream" href="/learn">مسار التعلّم ${icon('arrowLeft', '', 16)}</a></section><nav class="category-back" aria-label="روابط أخرى"><a href="/surahs">فهرس السور كاملًا ${icon('arrowLeft', '', 16)}</a><a href="/juz/30">جزء عمّ ${icon('arrowLeft', '', 16)}</a><a href="/articles">مجلة سَنا ${icon('arrowLeft', '', 16)}</a></nav></div>`;
  const schema = {'@context': 'https://schema.org', '@graph': [
    {'@type': 'CollectionPage', '@id': pageUrl, url: pageUrl, name: 'أدلة سور القرآن الكريم', inLanguage: 'ar', dateModified: lastUpdated, isPartOf: {'@type': 'WebSite', '@id': origin + '/#website', name: 'سَنا للقرآن الكريم', url: origin + '/'}},
    {'@type': 'BreadcrumbList', itemListElement: [{'@type': 'ListItem', position: 1, name: 'الرئيسية', item: origin + '/'}, {'@type': 'ListItem', position: 2, name: 'فهرس السور', item: origin + '/surahs'}, {'@type': 'ListItem', position: 3, name: 'أدلة السور', item: pageUrl}]},
    {'@type': 'ItemList', '@id': pageUrl + '#guides', numberOfItems: ids.length, itemListElement: ids.map((n, i) => ({'@type': 'ListItem', position: i + 1, url: origin + '/surah/' + n, name: 'سورة ' + chapters[n - 1].name}))}
  ]};
  return layout({title: `أدلة سور القرآن الكريم: ${ar(ids.length)} دليلًا لمحاور كل سورة | سَنا`, description: `أدلة تحريرية لـ${ids.length} سورة من القرآن الكريم: محاور كل سورة، وفضلٌ منقول بنصّه عند ثبوته، ونصيحة عملية للقراءة، مع رابط مباشر إلى السورة.`, body, active: 'surahs', url: pageUrl, schema, type: 'website'});
}
function juzAmmaPage(origin, now = Date.now()) {
  const pageUrl = origin + '/juz/30';
  const list = chapters.filter(c => c.juz === 30);
  const totalVerses = list.reduce((n, c) => n + c.ayahCount, 0);
  const totalWords = list.reduce((n, c) => n + surahStatsFor(c.number).words, 0);
  const cards = list.map(c => {
    const guide = surahGuides[String(c.number)];
    return `<li><a class="juz-card" href="/surah/${c.number}"><span class="juz-card-num">${ar(c.number)}</span><span class="juz-card-body"><strong>سورة ${esc(c.name)}</strong><small>${esc(c.revelation)} · ${ar(c.ayahCount)} آية · ${ar(surahStatsFor(c.number).words)} كلمة</small>${guide ? `<em>${esc(guide.themes[0])}</em>` : ''}</span></a></li>`;
  }).join('');
  const body = `<div class="shell subpage-shell juz-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/surahs">فهرس السور</a><span>›</span><span>جزء عمّ</span></nav><header class="surahs-hero"><span class="section-kicker"><span>✦</span> الْجُزْءُ الثَّلَاثُونَ</span><h1>جزء عمّ: سور الجزء الثلاثين<span class="gold-dot">.</span></h1><p>الجزء الثلاثون هو آخر أجزاء المصحف، ويُسمّى «جزء عمّ» لأن أول سورة فيه تبدأ بلفظ «عمّ». يضم ${ar(list.length)} سورة قصيرة من سورة النبأ إلى سورة الناس، وهي أكثر السور حفظًا وقراءةً في الصلاة، وفيها ${ar(totalVerses)} آية و${ar(totalWords)} كلمة. تُقرأ على ترتيبها كما في المصحف، ويصلح البدء بها لمن يفتح المصحف أول مرة، ولكل سورة في الجزء دليلٌ تحريري يشرح محاورها وفضلها المنقول.</p><div class="surahs-stats"><span><strong>${ar(list.length)}</strong> سورة</span><span><strong>${ar(totalVerses)}</strong> آية</span><span><strong>${ar(totalWords)}</strong> كلمة</span><span><strong>${ar(Math.min(...list.map(c => c.ayahCount)))}</strong> آيات في أقصر سورة</span><span><strong>${ar(list.filter(c => surahGuides[String(c.number)]).length)}</strong> دليلًا تحريريًّا</span></div></header><ol class="juz-grid" aria-label="سور الجزء الثلاثين بالترتيب">${cards}</ol><section class="learn-cta"><div><strong>تريد أن تحفظ الجزء كله؟</strong><p>ابدأ بسطر واحد في اليوم: صفحة صغيرة تُكرَّر خير من جلسة طويلة تنقطع. اقرأ دليل الحفظ والمراجعة، وابدأ من أقصر سورة.</p></div><a class="button button-cream" href="/articles/memorize-a-page-in-a-week">دليل الحفظ ${icon('arrowLeft','',16)}</a></section><nav class="category-back" aria-label="روابط أخرى"><a href="/surahs">فهرس السور كاملًا ${icon('arrowLeft','',16)}</a><a href="/guides">أدلة السور ${icon('arrowLeft','',16)}</a><a href="/learn">مسار التعلّم ${icon('arrowLeft','',16)}</a></nav></div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'CollectionPage','@id':pageUrl,url:pageUrl,name:'جزء عمّ: سور الجزء الثلاثين',inLanguage:'ar',isPartOf:{'@type':'WebSite','@id':origin+'/#website',name:'سَنا للقرآن الكريم',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'فهرس السور',item:origin+'/surahs'},{'@type':'ListItem',position:3,name:'جزء عمّ',item:pageUrl}]},
    {'@type':'ItemList','@id':pageUrl+'#surahs',numberOfItems:list.length,itemListElement:list.map((c, i) => ({'@type':'ListItem',position:i+1,url:origin+'/surah/'+c.number,name:'سورة '+c.name}))}
  ]};
  return layout({title:'جزء عمّ مكتوب: سور الجزء الثلاثين بالترتيب | سَنا',description:`سور الجزء الثلاثين (${list.length} سورة) من النبأ إلى الناس، مرتّبة كما في المصحف مع عدد آياتها وكلماتها وروابط القراءة والاستماع والتفسير لكل سورة.`,body,active:'surahs',url:pageUrl,schema,type:'website'});
}
const ARTICLES_PER_PAGE = 24;
// صفحة المجلة الأولى على /articles، وما بعدها على /articles/page/N.
// كل صفحة تُعرَّف بنفسها (canonical ذاتي) وتربط الصفحة السابقة والتالية،
// وهذا ما تعتمده Google في المحتوى المرقّم بدل نسبة كل الصفحات إلى صفحة واحدة.
function articlesPage(origin, now = Date.now(), page = 1) {
  const published = getPublishedArticles(now);
  const pages = Math.max(1, Math.ceil(published.length / ARTICLES_PER_PAGE));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  const from = (current - 1) * ARTICLES_PER_PAGE;
  const slice = published.slice(from, from + ARTICLES_PER_PAGE);
  const pageUrl = current === 1 ? origin + '/articles' : origin + '/articles/page/' + current;
  const href = n => (n === 1 ? '/articles' : '/articles/page/' + n);
  const cards = slice.length
    ? slice.map((article, index) => articleCard(article, current === 1 && index === 0)).join('')
    : '<div class="journal-empty"><span>✧</span><h2>قريبًا في مجلة سَنا</h2><p>نعدّ لك مساحة لمقالات وأدلة ترافق قراءتك.</p><a href="/">العودة للرئيسية</a></div>';
  const pagerNumbers = Array.from({ length: pages }, (_, i) => i + 1)
    .filter(n => n === 1 || n === pages || Math.abs(n - current) <= 2)
    .reduce((acc, n) => {
      if (acc.length && n - acc[acc.length - 1].n > 1) acc.push({ gap: true });
      acc.push({ n });
      return acc;
    }, []);
  const pager = pages > 1
    ? '<nav class="journal-pager" aria-label="صفحات المقالات">' +
      (current > 1 ? '<a class="pager-step" href="' + href(current - 1) + '" rel="prev">' + icon('arrowRight', '', 15) + ' الأحدث</a>' : '<span class="pager-step is-disabled">الأحدث</span>') +
      '<span class="pager-numbers">' +
      pagerNumbers.map(item => item.gap
        ? '<span class="pager-gap" aria-hidden="true">…</span>'
        : (item.n === current
          ? '<span class="pager-number is-current" aria-current="page">' + ar(item.n) + '</span>'
          : '<a class="pager-number" href="' + href(item.n) + '">' + ar(item.n) + '</a>')).join('') +
      '</span>' +
      (current < pages ? '<a class="pager-step" href="' + href(current + 1) + '" rel="next">الأقدم ' + icon('arrowLeft', '', 15) + '</a>' : '<span class="pager-step is-disabled">الأقدم</span>') +
      '</nav>'
    : '';
  const countLabel = pages > 1
    ? ar(published.length) + ' مقالة · الصفحة ' + ar(current) + ' من ' + ar(pages)
    : ar(published.length) + (published.length === 1 ? ' مقال منشور' : ' مقالات منشورة');
  const heading = current === 1 ? 'مقالات وأدلة' : 'مقالات وأدلة — الصفحة ' + ar(current) + ' من ' + ar(pages);
  // صفحات الأرشيف المرقّمة مُفهرسة ومُعلنة في الخريطة، فكل صفحة تحتاج عنوان h1 واحدًا.
  const headingTag = current === 1 ? 'h2' : 'h1';
  const body = '<div class="shell journal-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span>' +
    (current === 1 ? '<span>المقالات</span>' : '<a href="/articles">المقالات</a><span>›</span><span>الصفحة ' + ar(current) + '</span>') +
    '</nav>' +
    (current === 1
      ? '<section class="journal-hero"><div class="journal-hero-copy"><span class="journal-kicker"><i>✦</i> مَجَلَّةُ سَنا</span><h1>للقراءة<br><em>حكايةٌ أخرى.</em></h1><p>مساحة هادئة لأدلة ومقالات تساعدك على القراءة، والاستماع، والعودة إلى كتاب الله كل يوم.</p><span class="journal-hero-tag"><span>✧</span> آيةٌ بعد آية، نتعلّم</span></div><div class="journal-hero-art" aria-hidden="true"><span class="journal-art-ring ring-one"></span><span class="journal-art-ring ring-two"></span><div class="journal-art-center">✳<small>سَنا</small></div><span class="journal-art-note">اقْرَأْ وَتَدَبَّرْ</span></div></section>'
      : '') +
    '<div class="journal-list-head"><div><span class="section-kicker"><span>✦</span> فِي الْمَجَلَّة</span><' + headingTag + '>' + heading + '<span class="gold-dot">.</span></' + headingTag + '><p>خطوات بسيطة، لرحلة قراءة أكثر حضورًا.</p></div><span class="journal-count">' + countLabel + '</span></div>' +
    (current === 1 ? categoryChips(now) + '<a class="journal-hub-link" href="/articles/surahs">تصفّح المجلة بحسب السورة ✦</a>' : '') +
    '<section class="journal-grid" aria-label="المقالات المنشورة">' + cards + '</section>' + pager +
    '<aside class="journal-disclosure"><span class="disclosure-icon">✧</span><div><strong>عن محتوى المجلة</strong><p>أُعدّت هذه المقالات بمساعدة الذكاء الاصطناعي، وهي أدلة عامة لا تغني عن الرجوع إلى المصادر الموثوقة وأهل العلم في المسائل المتخصصة. صور المقالات توضيحية: بعضها مولّد بالذكاء الاصطناعي وبعضها غلافٌ تصميمي من إعداد سَنا.</p></div></aside></div>';
  const breadcrumbItems = current === 1
    ? [{ '@type': 'ListItem', position: 1, name: 'الرئيسية', item: origin + '/' }, { '@type': 'ListItem', position: 2, name: 'المقالات', item: pageUrl }]
    : [{ '@type': 'ListItem', position: 1, name: 'الرئيسية', item: origin + '/' }, { '@type': 'ListItem', position: 2, name: 'المقالات', item: origin + '/articles' }, { '@type': 'ListItem', position: 3, name: 'الصفحة ' + ar(current), item: pageUrl }];
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': pageUrl, url: pageUrl, name: current === 1 ? 'مجلة سَنا: مقالات وأدلة للقراءة' : 'مجلة سَنا: الصفحة ' + ar(current), inLanguage: 'ar', isPartOf: { '@type': 'WebSite', name: 'سَنا للقرآن الكريم', url: origin + '/' } },
    { '@type': 'BreadcrumbList', itemListElement: breadcrumbItems },
    { '@type': 'ItemList', '@id': pageUrl + '#articles', numberOfItems: slice.length, itemListElement: slice.map((a, index) => ({ '@type': 'ListItem', position: index + 1, url: origin + '/articles/' + a.slug, name: a.title })) }
  ] };
  const title = current === 1 ? 'مجلة سَنا | مقالات وأدلة للقراءة في القرآن' : 'مجلة سَنا — الصفحة ' + ar(current) + ' من ' + ar(pages) + ' | مقالات وأدلة للقراءة في القرآن';
  return layout({ title, description: 'مقالات وأدلة عملية لقراءة القرآن الكريم والاستماع إليه، واستخدام أدوات سَنا.', body, active: 'articles', url: pageUrl, schema, prev: current > 1 ? origin + href(current - 1) : undefined, next: current < pages ? origin + href(current + 1) : undefined });
}
function articlesPageCount(now = Date.now()) {
  return Math.max(1, Math.ceil(getPublishedArticles(now).length / ARTICLES_PER_PAGE));
}
// اختيار «قد يعجبك أيضًا» بالصلة الموضوعية: الباب نفسه أولًا، ثم تقاطع
// الروابط المفيدة، ثم تشابه كلمات العنوان. الهدف ربط موضوعي لا ترتيب زمني.
function relatedArticlesFor(article, now = Date.now(), limit = 2) {
  const words = title => new Set(String(title).replace(/[«»؟:،.\-()]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  const mine = words(article.title);
  const myLinks = new Set((article.related || []).map(r => r.href));
  return getPublishedArticles(now)
    .filter(a => a.slug !== article.slug)
    .map(a => {
      let score = 0;
      if (a.category === article.category) score += 4;
      score += (a.related || []).filter(r => myLinks.has(r.href)).length * 2;
      for (const w of words(a.title)) if (mine.has(w)) score += 1;
      return { a, score };
    })
    .sort((x, y) => y.score - x.score || Date.parse(y.a.publishedAt) - Date.parse(x.a.publishedAt))
    .slice(0, limit)
    .map(x => x.a);
}
// فتحة إعلانية واحدة داخل الصفحة: لافتة فقط، بلا نوافذ منبثقة وبلا عامل خدمة.
// السكربت يُحمَّل من app.js عبر data-ad-script فلا يعطّل الرسم الأول للصفحة.
function adSlot(name) {
  const slot = adsConfig && adsConfig.slots && adsConfig.slots[name];
  if (!adsConfig || adsConfig.enabled !== true || !slot || typeof slot.script !== 'string') return '';
  const url = slot.script.trim();
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return '';
  return `<aside class="ad-slot" aria-label="مساحة إعلانية"><span class="ad-slot-label">${esc(slot.label || 'إعلان')}</span><div class="ad-slot-body" data-ad-script="${esc(url)}"></div><p class="ad-slot-note">مساحة إعلانية لا تؤثر في تحرير المحتوى.</p></aside>`;
}
function surahLinkBlock(article) {
  const mentions = surahMentions(article);
  if (!mentions.length) return '';
  return '<aside class="article-surah-links" aria-label="سور يذكرها هذا المقال"><span class="article-surah-label">سُوَرٌ يَذْكُرُهَا هَذَا الْمَقَال</span><div>' +
    mentions.map(c => '<a href="/surah/' + c.number + '">سورة ' + esc(c.name) + '</a>').join('') +
    '<button class="article-surah-listen" type="button" data-play-surah="' + mentions[0].number + '" data-reciter="afs" aria-label="استمع إلى سورة ' + esc(mentions[0].name) + '">' + icon('play', '', 14) + ' استمع إلى سورة ' + esc(mentions[0].name) + '</button>' +
    '<a class="article-surah-hub" href="/articles/surahs#surah-' + mentions[0].number + '">كل مقالات السورة</a>' +
    '</div></aside>';
}
// صفحة محورٍ تربط المقالات بالسور: مدخلٌ واحد لكل مقالٍ يذكر سورةً بعينها،
// فيصير لكل سورة عنوانٌ جامع بدل أن تتناثر مقالاتها في الأرشيف.
function surahArticleGroups(now = Date.now()) {
  const groups = new Map();
  for (const article of getPublishedArticles(now)) {
    for (const chapter of surahMentions(article, 4)) {
      if (!groups.has(chapter.number)) groups.set(chapter.number, { chapter, articles: [] });
      groups.get(chapter.number).articles.push(article);
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.articles.length - a.articles.length || a.chapter.number - b.chapter.number);
}
// صفحة أسئلة مباشرة: كل سؤالٍ جوابه في فقرتين، وهذا الشكل هو ما تقتبسه
// محركات الإجابة عندما يسأل الناس عن القرآن. كل جواب ينتهي برابطٍ إلى المصدر الداخلي.
const QuranQuestions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'questions.json'), 'utf8'));
function questionsPage(origin) {
  const pageUrl = origin + '/questions';
  const topics = [...new Set(QuranQuestions.map(item => item.topic))];
  const nav = topics.map(topic => '<a href="#' + encodeURIComponent(topic).replace(/%/g, 'q') + '">' + esc(topic) + '</a>').join('');
  const sections = topics.map(topic => {
    const items = QuranQuestions.filter(item => item.topic === topic);
    return '<section class="qa-group" id="' + encodeURIComponent(topic).replace(/%/g, 'q') + '"><h2>' + esc(topic) + '<span class="gold-dot">.</span></h2><ol class="qa-list">' +
      items.map(item => {
        const index = QuranQuestions.indexOf(item) + 1;
        return '<li class="qa-item" id="q-' + index + '"><h3><a href="#q-' + index + '">' + esc(item.q) + '</a></h3><p>' + esc(item.a) + '</p><div class="qa-links">' + item.links.map(l => '<a href="' + esc(l.href) + '">' + esc(l.label) + ' ' + icon('arrowLeft', '', 14) + '</a>').join('') + '</div></li>';
      }).join('') + '</ol></section>';
  }).join('');
  const body = '<div class="shell subpage-shell qa-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>أسئلة سريعة</span></nav>' +
    '<header class="surahs-hero"><span class="section-kicker"><span>✦</span> أَسْئِلَةٌ تُسْأَلُ كَثِيرًا</span><h1>أسئلة سريعة عن القرآن<span class="gold-dot">.</span></h1>' +
    '<p>إجاباتٌ قصيرة ومباشرة عن أكثر ما يُسأل عنه: أعداد السور والآيات، وأول ما نزل، ومعنى الرسم العثماني، والفرق بين الترجمة والتفسير. كل إجابةٍ في فقرتين، وفي نهايتها رابطٌ إلى صفحةٍ في الموقع تُوسّع ما أجملناه.</p>' +
    '<div class="surahs-stats"><span><strong>' + ar(QuranQuestions.length) + '</strong> سؤالًا</span><span><strong>' + ar(topics.length) + '</strong> محاور</span><span><strong>' + ar(114) + '</strong> سورة للقراءة</span></div></header>' +
    '<nav class="topic-nav qa-nav" aria-label="محاور الأسئلة">' + nav + '</nav>' + sections +
    '<nav class="category-back" aria-label="روابط أخرى"><a href="/articles">مجلة سَنا ' + icon('arrowLeft', '', 16) + '</a><a href="/surahs">فهرس السور ' + icon('arrowLeft', '', 16) + '</a><a href="/learn">مسار التعلّم ' + icon('arrowLeft', '', 16) + '</a><a href="/topics">الموضوعات ' + icon('arrowLeft', '', 16) + '</a></nav></div>';
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'FAQPage', '@id': pageUrl, url: pageUrl, name: 'أسئلة سريعة عن القرآن الكريم', inLanguage: 'ar', isPartOf: { '@type': 'WebSite', '@id': origin + '/#website', name: 'سَنا للقرآن الكريم', url: origin + '/' }, mainEntity: QuranQuestions.map(item => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })) },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'الرئيسية', item: origin + '/' }, { '@type': 'ListItem', position: 2, name: 'أسئلة سريعة', item: pageUrl }] }
  ] };
  return layout({ title: 'أسئلة سريعة عن القرآن الكريم: ' + ar(QuranQuestions.length) + ' سؤالًا وإجابة | سَنا', description: 'إجابات قصيرة عن أكثر الأسئلة تكرارًا حول القرآن: عدد السور والآيات والأجزاء، أول ما نزل، الرسم العثماني، الفرق بين الترجمة والتفسير، والقراءات.', body, active: 'articles', url: pageUrl, schema, type: 'website' });
}
function surahArticleHub(origin, now = Date.now()) {
  const allGroups = surahArticleGroups(now);
  const groups = allGroups.filter(group => group.articles.length >= 2);
  const singles = allGroups.filter(group => group.articles.length === 1);
  const pageUrl = origin + '/articles/surahs';
  const totalLinks = allGroups.reduce((n, g) => n + g.articles.length, 0);
  const nav = allGroups.map(g => '<a href="#surah-' + g.chapter.number + '">' + esc(g.chapter.name) + ' <i>' + ar(g.articles.length) + '</i></a>').join('');
  const sections = groups.map(g => '<section class="hub-surah" id="surah-' + g.chapter.number + '"><div class="hub-surah-head"><div><span class="hub-surah-num">' + ar(g.chapter.number) + '</span><h2>سورة ' + esc(g.chapter.name) + '<span class="gold-dot">.</span></h2><p>' + esc(g.chapter.revelation) + ' · ' + ayahCount(g.chapter.ayahCount) + ' · الجزء ' + ar(g.chapter.juz) + '</p></div><a class="hub-surah-read" href="/surah/' + g.chapter.number + '">اقرأ السورة ' + icon('arrowLeft', '', 15) + '</a></div><ul class="hub-surah-list">' +
    g.articles.map(a => '<li><a href="/articles/' + esc(a.slug) + '"><span>' + esc(a.category) + ' · ' + ar(a.minutes) + ' د</span><strong>' + esc(a.title) + '</strong><em>' + esc(a.summary) + '</em></a></li>').join('') +
    '</ul></section>').join('');
  const singleList = singles.length ? '<section class="hub-singles" aria-labelledby="hub-singles-title"><div class="guide-section-head"><h2 id="hub-singles-title">إشارات أخرى<span class="gold-dot">.</span></h2><p>سورٌ ذُكرت في مقالٍ واحد، ولكل واحدةٍ منها مدخلها الخاص هنا.</p></div><ul>' + singles.map(g => '<li id="surah-' + g.chapter.number + '"><a class="hub-single-name" href="/surah/' + g.chapter.number + '">سورة ' + esc(g.chapter.name) + '</a><a class="hub-single-article" href="/articles/' + esc(g.articles[0].slug) + '">' + esc(g.articles[0].title) + '</a></li>').join('') + '</ul></section>' : '';
  const body = '<div class="shell subpage-shell hub-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/articles">المقالات</a><span>›</span><span>المقالات بحسب السورة</span></nav>' +
    '<header class="surahs-hero"><span class="section-kicker"><span>✦</span> مَدْخَلٌ وَاحِدٌ لِكُلِّ سُورَة</span><h1>المقالات بحسب السورة<span class="gold-dot">.</span></h1>' +
    '<p>كل مقالٍ في مجلة سَنا يذكر سورةً بالاسم نجمع هنا روابطه تحتها، فتصير لك لكل سورةٍ مكتبةٌ صغيرة: تدبّر بنيتها، وخطة حفظها، وكيف تُقرأ في الصلاة والبيت. هذه الصفحة لا تستبدل صفحة السورة، بل تُوصلك إليها وهي الخطوة التالية بعد كل مقال.</p>' +
    '<div class="surahs-stats"><span><strong>' + ar(allGroups.length) + '</strong> سورة</span><span><strong>' + ar(totalLinks) + '</strong> رابط مقال</span><span><strong>' + ar(114) + '</strong> سورة في المصحف</span></div></header>' +
    '<nav class="hub-nav" aria-label="انتقال إلى السور">' + nav + '</nav>' + sections + singleList +
    '<nav class="category-back" aria-label="روابط أخرى"><a href="/articles">كل المقالات ' + icon('arrowLeft', '', 16) + '</a><a href="/surahs">فهرس السور ' + icon('arrowLeft', '', 16) + '</a><a href="/guides">أدلة السور ' + icon('arrowLeft', '', 16) + '</a><a href="/learn">مسار التعلّم ' + icon('arrowLeft', '', 16) + '</a></nav></div>';
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': pageUrl, url: pageUrl, name: 'المقالات بحسب السورة', description: 'مدخل يجمع مقالات مجلة سَنا تحت كل سورة من سور القرآن الكريم.', inLanguage: 'ar', isPartOf: { '@type': 'WebSite', '@id': origin + '/#website', name: 'سَنا للقرآن الكريم', url: origin + '/' } },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'الرئيسية', item: origin + '/' }, { '@type': 'ListItem', position: 2, name: 'المقالات', item: origin + '/articles' }, { '@type': 'ListItem', position: 3, name: 'المقالات بحسب السورة', item: pageUrl }] },
    { '@type': 'ItemList', '@id': pageUrl + '#surahs', numberOfItems: allGroups.length, itemListElement: allGroups.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: 'سورة ' + g.chapter.name, url: origin + '/surah/' + g.chapter.number })) }
  ] };
  return layout({ title: 'المقالات بحسب السورة: ' + ar(allGroups.length) + ' سورة في مجلة سَنا', description: 'مقالات مجلة سَنا مجمّعة تحت كل سورة تذكرها: تدبّر البنية، وخطط الحفظ، وطرق القراءة — ' + ar(groups.length) + ' سورة و' + ar(totalLinks) + ' رابطًا.', body, active: 'articles', url: pageUrl, schema, type: 'website' });
}
// مقالات أخرى تقرأ السورة نفسها: شبكة ربط داخلية مشتقة من فهرس السور، بلا صيانة يدوية.
function sameSurahMore(article, now = Date.now()) {
  const mentions = surahMentions(article);
  if (!mentions.length) return '';
  const skip = new Set([article.slug]);
  for (const r of article.related || []) { const m = /^\/articles\/([a-z0-9-]+)$/.exec(r.href || ''); if (m) skip.add(m[1]); }
  const picks = [];
  for (const c of mentions) {
    for (const a of articlesForSurah(c.number, 6, now)) {
      if (picks.length >= 3) break;
      if (skip.has(a.slug) || picks.some(x => x.slug === a.slug)) continue;
      picks.push({ article: a, chapter: c });
    }
  }
  if (!picks.length) return '';
  const names = picks.map(p => p.chapter.name).filter((n, i, arr) => arr.indexOf(n) === i);
  return '<section class="article-same-surah" aria-labelledby="same-surah-title"><div class="same-surah-head"><h2 id="same-surah-title">اقرأ أيضًا عن سورة ' + names.map(esc).join(' و') + '</h2><a class="text-link" href="/articles/surahs#surah-' + picks[0].chapter.number + '">كل مقالات السورة ' + icon('arrowLeft','',15) + '</a></div><ul>' +
    picks.map(p => '<li><a href="/articles/' + esc(p.article.slug) + '"><span>' + esc(p.article.category) + ' · ' + ar(p.article.minutes) + ' دقائق</span><strong>' + esc(p.article.title) + '</strong></a></li>').join('') +
    '</ul></section>';
}

// مقالات من التصنيف نفسه: تقوّي صفحات المراكز الستة وتمنع انحصار الربط في السورة.
function sameCategoryMore(article, now = Date.now()) {
  const skip = new Set([article.slug]);
  for (const r of article.related || []) { const m = /^\/articles\/([a-z0-9-]+)$/.exec(r.href || ''); if (m) skip.add(m[1]); }
  for (const c of surahMentions(article)) for (const a of articlesForSurah(c.number, 6, now)) skip.add(a.slug);
  const hub = CATEGORY_HUBS.find(h => h.name === article.category);
  const picks = getPublishedArticles(now)
    .filter(a => a.category === article.category && !skip.has(a.slug))
    .sort((x, y) => Date.parse(y.publishedAt) - Date.parse(x.publishedAt))
    .slice(0, 3);
  if (!picks.length) return '';
  const hubHref = hub ? '/articles/category/' + hub.slug : '/articles';
  return '<section class="article-same-category" aria-labelledby="same-category-title"><div class="same-category-head"><h2 id="same-category-title">المزيد في تصنيف «' + esc(article.category) + '»</h2><a class="text-link" href="' + hubHref + '">كل مقالات التصنيف ' + icon('arrowLeft', '', 15) + '</a></div><div class="same-category-grid">' +
    picks.map(a => '<a href="/articles/' + esc(a.slug) + '"><span>' + ar(a.minutes) + ' دقائق قراءة</span><strong>' + esc(a.title) + '</strong></a>').join('') +
    '</div></section>';
}

// أسئلة سريعة داخل المقال: تُعرض أسفل النص وتُصدَر كـFAQPage في البيانات المنظمة.
// محركات الإجابة تنتقي سؤالًا وجوابًا قصيرين أكثر مما تنتقي مقالًا كاملًا،
// والقارئ يجد خلاصةً قبل أن يغادر.
function articleFaqBlock(article) {
  const items = Array.isArray(article.faq) ? article.faq : [];
  if (!items.length) return '';
  return `<section class="article-faq" id="faq"><div class="faq-head"><span class="section-kicker"><span>✦</span> خُلَاصَةٌ فِي سُؤَال</span><h2>أسئلة سريعة<span class="gold-dot">.</span></h2></div>${items.map((item, index) => `<details class="faq-item"${index === 0 ? ' open' : ''}><summary><span>${esc(item.q)}</span><span class="faq-plus" aria-hidden="true"></span></summary><div class="faq-answer"><p>${esc(item.a)}</p></div></details>`).join('')}</section>`;
}
function articlePage(article, origin, now = Date.now()) {
  const pageUrl = origin + '/articles/' + article.slug;
  const parts = article.sections.map((section, index) => `<section class="article-section" id="section-${index + 1}"><h2>${esc(section.heading)}</h2>${section.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}${section.list ? `<ul>${section.list.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}</section>`).join('');
  const outline = article.sections.map((section, index) => `<a href="#section-${index + 1}"><span>${ar(index + 1).padStart(1,'٠')}</span>${esc(section.heading)}</a>`).join('');
  const sources = article.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} <span aria-hidden="true">↗</span></a></li>`).join('');
  const relatedLinks = article.related.map(r => `<a href="${esc(r.href)}">${esc(r.label)} ${icon('arrowLeft','',16)}</a>`).join('');
  const ordered = getPublishedArticles(now).slice().sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  const position = ordered.findIndex(a => a.slug === article.slug);
  const older = position > 0 ? ordered[position - 1] : null;
  const newer = position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : null;
  const prevNext = (older || newer) ? `<nav class="article-pager" aria-label="التنقل بين المقالات">${older ? `<a class="article-pager-link" href="/articles/${esc(older.slug)}">${icon('arrowRight','',16)}<span><small>المقال السابق</small><strong>${esc(older.title)}</strong></span></a>` : '<span></span>'}${newer ? `<a class="article-pager-link article-pager-next" href="/articles/${esc(newer.slug)}"><span><small>المقال التالي</small><strong>${esc(newer.title)}</strong></span>${icon('arrowLeft','',16)}</a>` : '<span></span>'}</nav>` : '';
  // صورة الغلاف هي عنصر LCP في صفحة المقال؛ إعلانها في <head> يبدأ تحميلها قبل تحليل الجسم.
  const coverPreload = '<link rel="preload" as="image" href="' + esc(article.image) + '" imagesrcset="' + esc(article.image.replace(/\.webp$/, '-640.webp')) + ' 640w, ' + esc(article.image) + ' 1280w" imagesizes="(max-width:900px) 96vw, 1024px" fetchpriority="high">';
  const next = relatedArticlesFor(article, now, 2);
  const relatedArticles = next.length ? `<section class="article-more"><div class="section-heading"><div><span class="section-kicker"><span>✦</span> تَابِعِ الْقِرَاءَة</span><h2>قد يعجبك أيضًا<span class="gold-dot">.</span></h2></div><a href="/articles" class="text-link">جميع المقالات ${icon('arrowLeft','',17)}</a></div><div class="article-more-grid">${next.map(a => articleCard(a)).join('')}</div></section>` : `<div class="article-bottom-cta"><div><strong>لا تتوقف رحلتك هنا.</strong><p>اكتشف سور القرآن الكريم وابدأ القراءة من حيث تحب.</p></div><a class="button button-dark" href="/surahs">فهرس السور ${icon('arrowLeft','',16)}</a></div>`;
  const body = `<div class="shell article-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><a href="/articles">المقالات</a><span>›</span><span>${esc(article.title)}</span></nav><div class="reading-progress" id="reading-progress" aria-hidden="true"><span></span></div><article class="editorial-article"><header class="article-header"><div class="article-topline"><a href="/articles">مَجَلَّةُ سَنا</a><span>✦</span>${(() => { const hub = CATEGORY_HUBS.find(h => h.name === article.category && categoryArticles(h.name, now).length >= 3); return hub ? `<a href="/articles/category/${hub.slug}">${esc(article.category)}</a>` : `<span>${esc(article.category)}</span>`; })()}</div><h1>${esc(article.title)}</h1><p>${esc(article.summary)}</p><div class="article-byline"><span class="article-author-mark">س</span><div><strong>سَنا</strong><span>أُعدّ بمساعدة الذكاء الاصطناعي</span></div><span class="byline-divider"></span><time datetime="${esc(article.publishedAt)}">${esc(articleDate(article.publishedAt))}</time><span class="byline-dot">•</span><span>${ar(article.minutes)} دقائق قراءة تقريبًا</span></div></header><figure class="article-cover"><img src="${esc(article.image)}" srcset="${esc(article.image.replace(/\.webp$/, '-640.webp'))} 640w, ${esc(article.image)} 1280w" sizes="(max-width:900px) 96vw, 1024px" alt="${esc(article.imageAlt)}" width="1280" height="714" fetchpriority="high" decoding="async"><figcaption>${esc(article.imageNote || 'صورة توضيحية مولّدة بالذكاء الاصطناعي')}</figcaption></figure><div class="article-layout"><div class="article-prose"><p class="article-lead">${esc(article.lead)}</p>${surahLinkBlock(article)}${parts}${articleFaqBlock(article)}${adSlot('article-end')}<section class="article-links"><h2>روابط مفيدة من سَنا</h2><div>${relatedLinks}</div></section><section class="article-sources"><h2>المصادر والمراجع</h2><ul>${sources}</ul><p>محتوى إرشادي عام أُعدّ بمساعدة الذكاء الاصطناعي، ولا يغني عن الرجوع إلى أهل العلم والمصادر المتخصصة.</p></section></div><aside class="article-sidebar"><div class="article-toc"><span>فِي هَذَا الْمَقَال</span><nav aria-label="محتويات المقال">${outline}</nav></div><div class="article-side-note"><span>✧</span><strong>آيةٌ بعد آية.</strong><p>مساحة لقراءة القرآن والاستماع إليه بتأنٍّ.</p><a href="/surah/1">ابدأ بسورة الفاتحة ${icon('arrowLeft','',15)}</a></div></aside></div></article>${prevNext}${relatedArticles}${sameSurahMore(article, now)}${sameCategoryMore(article, now)}</div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'Article','@id':pageUrl+'#article',speakable:{'@type':'SpeakableSpecification',cssSelector:['.article-header h1','.article-lead']},mainEntityOfPage:{'@type':'WebPage','@id':pageUrl},headline:article.title,description:article.summary,image:[new URL(article.image,origin).href],datePublished:article.publishedAt,dateModified:article.publishedAt,articleSection:article.category,about:surahMentions(article).map(c=>({'@type':'Thing','@id':origin+'/surah/'+c.number,name:'سورة '+c.name,url:origin+'/surah/'+c.number})),keywords:[article.category].concat(surahMentions(article).map(c=>'سورة '+c.name)).join(', '),wordCount:article.sections.flatMap(x => x.paragraphs).join(' ').trim().split(/\s+/).length,inLanguage:'ar',author:{'@type':'Organization',name:'سَنا',url:origin+'/'},publisher:{'@type':'Organization',name:'سَنا',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'المقالات',item:origin+'/articles'},{'@type':'ListItem',position:3,name:article.title,item:pageUrl}]},
    ...(Array.isArray(article.faq) && article.faq.length ? [{'@type':'FAQPage','@id':pageUrl+'#faq',mainEntity:article.faq.map(item=>({'@type':'Question',name:item.q,acceptedAnswer:{'@type':'Answer',text:item.a}}))}] : [])
  ]};
  return layout({title:(article.title.length > 58 ? article.title : `${article.title} | مجلة سَنا`),description:article.summary,body,active:'articles',url:pageUrl,schema,image:article.image,type:'article',publishedAt:article.publishedAt,preload:coverPreload});
}
// البحث في المجلة كان يقف عند العنوان والملخص والمقدمة، فيفشل في العثور على
// مقالٍ يعرف صاحبه أنه يذكر كلمةً بعينها في متنه. هنا يُبنى نصٌّ كامل مرةً واحدة
// لكل مقال (مع الأسئلة السريعة)، ويُستخرج منه مقتطفٌ حول موضع الإصابة.
let searchTextCache = { size: -1, map: new Map() };
function searchTextFor(article) {
  // الفهرس يُبنى مرة واحدة لكل مجموعة مقالات، لا في كل طلب بحث.
  if (searchTextCache.size !== validatedArticles.length) {
    searchTextCache = { size: validatedArticles.length, map: new Map(validatedArticles.map(a => [a.slug, articleSearchText(a)])) };
  }
  return searchTextCache.map.get(article.slug) || articleSearchText(article);
}
function articleSearchText(article) {
  return normalize([article.title, article.summary, article.lead]
    .concat(article.sections.flatMap(section => [section.heading].concat(section.paragraphs)))
    .concat((article.faq || []).flatMap(item => [item.q, item.a]))
    .join(' '));
}
function articleSnippet(article, needle) {
  const parts = [article.lead].concat(article.sections.flatMap(s => s.paragraphs))
    .concat((article.faq || []).map(item => item.a));
  const hit = parts.find(text => normalize(text).includes(needle));
  if (!hit) return { text: article.summary, matched: false };
  const index = normalize(hit).indexOf(needle);
  const start = Math.max(0, index - 60);
  const slice = hit.slice(start, start + 190).trim();
  return { text: (start > 0 ? '… ' : '') + slice + (start + 190 < hit.length ? ' …' : ''), matched: true };
}
function searchPage(query, origin) {
 const cleaned = query.trim().slice(0, 120), q = normalize(cleaned).replace(/^سور[ةه]\s+/, '');
 const chapterMatches = q ? searchable.filter(c => c.norm.includes(q)).slice(0, 12) : [];
 const matches = [];
 const articleHits = q && q.length >= 3
   ? getPublishedArticles()
       .map(a => ({ a, head: normalize([a.title, a.summary, a.lead].join(' ')), full: searchTextFor(a) }))
       .filter(item => item.full.includes(q))
       // العنوان أولًا، ثم المتن — لا يُقدَّم مقالٌ عابر على عنوانٍ مطابق
       .sort((x, y) => Number(y.head.includes(q)) - Number(x.head.includes(q)))
       .slice(0, 8)
       .map(item => ({ ...item.a, snippet: articleSnippet(item.a, q), headHit: item.head.includes(q) }))
   : [];
 if (q && q.length >= 2) for (const c of searchable) { for (const v of c.verses) { if (v.norm.includes(q)) { matches.push({c,v}); if(matches.length >= 40) break; } } if(matches.length>=40) break; }
 const body=`<div class="shell subpage-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>البحث</span></nav><div class="subpage-title"><span class="section-kicker"><span>✦</span> ابْحَثْ فِي كِتَابِ الله</span><h1>البحث في القرآن<span class="gold-dot">.</span></h1><p>ابحث باسم السورة، أو بكلمة من الآية، أو في مقالات المجلة.</p></div><form class="page-search" action="/search" method="get">${icon('search')}<label class="sr-only" for="page-search-input">كلمة البحث</label><input id="page-search-input" name="q" value="${esc(cleaned)}" placeholder="ابحث عن سورة أو آية..." required><button class="button button-dark">بحث ${icon('arrowLeft','',16)}</button></form>${q?`<p class="search-summary">نتائج البحث عن <strong>«${esc(cleaned)}»</strong>${matches.length===40?' · أول ٤٠ آية':''}</p>`:''}${articleHits.length?`<div class="results-header"><h2>من المجلة</h2><span>${ar(articleHits.length)} مقال</span></div><ul class="search-articles">${articleHits.map(a=>`<li><a href="/articles/${esc(a.slug)}"><span>${esc(a.category)} · ${ar(a.minutes)} دقائق قراءة${a.headHit?'':' · تطابق داخل النص'}</span><strong>${esc(a.title)}</strong><small>${esc(a.snippet && a.snippet.matched ? a.snippet.text : a.summary)}</small></a></li>`).join('')}</ul>`:''}${chapterMatches.length?`<div class="results-header"><h2>السور</h2></div><div class="surah-list result-surahs">${chapterMatches.map(surahCard).join('')}</div>`:''}${matches.length?`<div class="results-header"><h2>الآيات</h2><span>${ar(matches.length)} نتيجة${matches.length===40?' أو أكثر':''}</span></div><div class="verse-results">${matches.map(({c,v})=>`<a class="verse-result" href="/surah/${c.number}#ayah-${v.num}"><div><strong>سورة ${esc(c.name)}</strong><span>الآية ${ar(v.num)} ${icon('arrowLeft','',16)}</span></div><p lang="ar">${esc(v.text)}</p></a>`).join('')}</div>`:''}${q && !chapterMatches.length && !matches.length && !articleHits.length?`<div class="empty-state">${icon('search','',28)}<h2>لم نجد نتائج مطابقة</h2><p>جرّب كلمة مختلفة أو ابحث باسم سورة.</p><a href="/surahs" class="button button-outline">استكشف السور ${icon('arrowLeft','',16)}</a></div>`:''}</div>`;
 return layout({title:'البحث في القرآن الكريم | سَنا',description:'ابحث في سور القرآن الكريم وآياته.',body,url:origin+'/search',noindex:true});
}
function bookmarksPage(origin) {
 const body=`<div class="shell subpage-shell bookmarks-page"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>الآيات المحفوظة</span></nav><div class="subpage-title"><span class="section-kicker"><span>✦</span> مِمَّا لَامَسَ قَلْبَكَ</span><h1>آياتك المحفوظة<span class="gold-dot">.</span></h1><p>آيات اخترت الاحتفاظ بها، لتعود إليها متى أحببت.</p></div><div id="bookmarks-list"><noscript><div class="empty-state">يرجى تفعيل JavaScript لعرض الآيات المحفوظة على جهازك.</div></noscript></div><p class="local-note">${icon('info','',17)} تُحفظ العلامات على هذا المتصفح فقط، ولا تُرفع إلى خادم.</p></div>`;
 return layout({title:'الآيات المحفوظة | سَنا',description:'آياتك المحفوظة للعودة إليها على هذا الجهاز.',body,url:origin+'/bookmarks',noindex:true});
}
function aboutPage(origin) {
  const pageUrl = origin + '/about';
  const body = `<div class="shell subpage-shell about-shell"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span>›</span><span>عن سَنا</span></nav><header class="about-hero"><span class="section-kicker"><span>✦</span> عَنْ سَنا</span><h1>موقعٌ هادئ، و<span class="gold-dot">سياسةٌ واضحة.</span></h1><p>سَنا موقع عربي لقراءة القرآن الكريم كاملًا بالرسم العثماني، والاستماع إلى التلاوات، وقراءة التفسير الميسّر لكل آية، مع مجلة مقالات وأدلة عن القراءة والحفظ والتدبر. هذه الصفحة تشرح من نحن، وكيف يُعدّ المحتوى، وما لا نقدّمه.</p></header>
<section class="about-block" id="content-policy"><h2>كيف تُعدّ مقالات المجلة؟</h2><p>تُكتب مقالات المجلة بمساعدة نماذج ذكاء اصطناعي، ثم تمرّ على فحوص تقنية آلية قبل النشر: اكتمال الحقول، وطول النص، ووجود صورة حقيقية على الخادم، وروابط داخلية آمنة، ومصدرين على الأقل ببروتوكول HTTPS. المقال الذي لا يجتاز هذه الفحوص لا يظهر في الموقع أصلًا. ويُذكر في كل مقال أنه أُعدّ بمساعدة الذكاء الاصطناعي، وأن صورته توضيحية.</p><p>هذه فحوص بنيوية لا تحقّق من صحة كل معنى أو حكم. لذلك نلتزم بالمدى الآمن: المقالات إرشادية في القراءة والتنظيم والتقنية، ولا تُقرّر أحكامًا شرعية، ويُحال القارئ في المسائل العملية إلى أهل العلم والمصادر المتخصصة.</p></section>
<section class="about-block" id="limits"><h2>ما لا تجده في سَنا</h2><ul><li>لا نُصدر فتاوى ولا أحكامًا شرعية، ولا نُغني عن سؤال أهل العلم.</li><li>لا نعرض إعلانات ولا نطلب تسجيل حساب، ولا نبيع بيانات.</li><li>لا نضمن ظهورًا في محرك بحث أو مساعد ذكي؛ نُهيّئ المحتوى تقنيًا، والترتيب قرار المحركات.</li></ul></section>
<section class="about-block" id="sources"><h2>المصادر والتراخيص</h2><p>نحن لا نملك النص القرآني ولا التلاوات ولا التفسير، بل نعرضها من مصادرها مع الإشارة إليها:</p><ul><li><strong>النص القرآني بالرسم العثماني:</strong> <a href="https://tanzil.net/" target="_blank" rel="noopener noreferrer">مشروع تنزيل</a>، ويُعرض النص دون تحريف مع الاحتفاظ بإشعار الترخيص.</li><li><strong>تلاوات الآيات:</strong> <a href="https://everyayah.com/" target="_blank" rel="noopener noreferrer">EveryAyah</a>، و<strong>تلاوات السور:</strong> <a href="https://www.mp3quran.net/" target="_blank" rel="noopener noreferrer">MP3Quran</a>.</li><li><strong>التفسير الميسّر:</strong> عبر واجهة <a href="https://alquran.cloud/" target="_blank" rel="noopener noreferrer">AlQuran Cloud</a>، ويمكن مقارنة التفاسير في <a href="https://tafsir.app/" target="_blank" rel="noopener noreferrer">Tafsir.app</a>.</li></ul><p>الصور التوضيحية في المجلة إمّا مولّدة بالذكاء الاصطناعي وإمّا أغلفة تصميمية بأسماء السور، ولا تمثّل مصاحف حقيقية ولا نصوصًا قرآنية مقروءة.</p></section>
<section class="about-block" id="corrections"><h2>التصحيح والتحديث</h2><p>إذا وجدت خطأً في مقال أو في وصف أداة، فافتح بلاغًا في المستودع العام للمشروع على <a href="https://github.com/Ansygroup/sana-quran" target="_blank" rel="noopener noreferrer">GitHub</a>. نراجع البلاغ، ونصحّح النص، ونعيد نشر الموقع. وإذا كان الخطأ في نص قرآني أو تفسير، فالمرجع أولًا هو المصدر الأصلي المذكور أعلاه.</p></section>
<section class="about-block" id="privacy"><h2>الخصوصية وما يُحفظ على جهازك</h2><p>لا توجد حسابات ولا تسجيل دخول. تُحفظ الآيات المحفوظة وآخر موضع قراءة والمظهر الليلي في متصفحك وحده (localStorage)، ولا تُرسل إلى خادمنا. لا نستخدم أدوات تتبّع أو إعلانات. تُسجَّل زيارات الموقع لدى مزوّد الاستضافة (Vercel) لأغراض التشغيل والأمان.</p></section>
<section class="about-block" id="contact"><h2>التواصل</h2><p>أسرع طريق للتواصل هو <a href="https://github.com/Ansygroup/sana-quran/issues" target="_blank" rel="noopener noreferrer">بلاغ في GitHub</a>. اذكر الصفحة، وما تتوقع أن يكون، وما تراه الآن.</p></section>
<nav class="category-back" aria-label="روابط"><a href="/articles">تصفّح المجلة ${icon('arrowLeft','',16)}</a><a href="/">ابدأ القراءة ${icon('arrowLeft','',16)}</a></nav></div>`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'AboutPage','@id':pageUrl,url:pageUrl,name:'عن سَنا وسياسة التحرير',inLanguage:'ar',isPartOf:{'@type':'WebSite',name:'سَنا للقرآن الكريم',url:origin+'/'},about:{'@type':'Organization','@id':origin+'/#organization',name:'سَنا للقرآن الكريم',url:origin+'/'}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'عن سَنا',item:pageUrl}]}
  ]};
  return layout({title:'عن سَنا وسياسة التحرير | سَنا',description:'كيف تُعدّ مقالات سَنا، وما مصادر النص القرآني والتلاوات والتفسير، وما لا يقدّمه الموقع، وكيف تُبلَّغ التصحيحات. سياسة تحرير واضحة.',body,active:'about',url:pageUrl,schema});
}
function notFound(origin) {
 return layout({title:'الصفحة غير موجودة | سَنا',description:'الصفحة التي تبحث عنها غير متاحة.',url:origin+'/',noindex:true,body:`<div class="shell subpage-shell"><div class="empty-state"><span class="empty-ornament">✺</span><h1>هذه الصفحة غير موجودة</h1><p>يمكنك العودة إلى فهرس السور ومتابعة القراءة.</p><a href="/" class="button button-dark">العودة للرئيسية ${icon('arrowLeft','',17)}</a></div></div>`});
}
const tafsirCache = new Map();
function getOrigin(req) {
  const configuredSiteUrl = process.env.SITE_URL || (process.env.VERCEL ? 'https://sana-quran-nu.vercel.app' : '');
  if (configuredSiteUrl) { try { const u = new URL(configuredSiteUrl); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (_) {} }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  const safeHost = /^[a-z0-9.\-:\[\]]+$/i.test(host) ? host : 'localhost:3000';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : (safeHost.startsWith('localhost') || safeHost.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${safeHost}`;
}
function sitemapXml(origin, now = Date.now()) {
  const root = `<url><loc>${esc(origin + '/')}</loc></url><url><loc>${esc(origin + '/about')}</loc></url><url><loc>${esc(origin + '/surahs')}</loc></url><url><loc>${esc(origin + '/listen')}</loc></url><url><loc>${esc(origin + '/learn')}</loc></url><url><loc>${esc(origin + '/juz/30')}</loc></url><url><loc>${esc(origin + '/juz')}</loc></url>` + Object.keys(juzBounds).filter(n => n !== '30').map(n => `<url><loc>${esc(origin + '/juz/' + n)}</loc></url>`).join('') + `<url><loc>${esc(origin + '/guides')}</loc></url><url><loc>${esc(origin + '/topics')}</loc></url><url><loc>${esc(origin + '/ayah')}</loc></url>`;
  const surahs = chapters.map(c => { const guide = surahGuides[String(c.number)]; const lastmod = guide && guide.updatedAt ? `<lastmod>${esc(guide.updatedAt)}</lastmod>` : ''; return `<url><loc>${esc(origin + `/surah/${c.number}`)}</loc>${lastmod}</url>`; }).join('');
  const hubLastmod = (getPublishedArticles(now)[0] || {}).publishedAt || '';
  const index = `<url><loc>${esc(origin + '/articles')}</loc>${hubLastmod ? `<lastmod>${esc(hubLastmod)}</lastmod>` : ''}</url>` + (() => { const total = articlesPageCount(now); let out = ''; for (let n = 2; n <= total; n++) out += `<url><loc>${esc(origin + '/articles/page/' + n)}</loc>${hubLastmod ? `<lastmod>${esc(hubLastmod)}</lastmod>` : ''}</url>`; return out; })() + `<url><loc>${esc(origin + '/questions')}</loc></url>` + `<url><loc>${esc(origin + '/articles/surahs')}</loc>${hubLastmod ? `<lastmod>${esc(hubLastmod)}</lastmod>` : ''}</url>` + activeCategoryHubs(now).map(hub => `<url><loc>${esc(origin + '/articles/category/' + hub.slug)}</loc><lastmod>${esc(categoryArticles(hub.name, now)[0].publishedAt)}</lastmod></url>`).join('');
  // Covers are declared as image sitemap entries so search engines can associate
  // each illustration with its article page.
  const entries = getPublishedArticles(now).map(a => `<url><loc>${esc(origin + '/articles/' + a.slug)}</loc><lastmod>${esc(a.publishedAt)}</lastmod><image:image><image:loc>${esc(new URL(a.image, origin).href)}</image:loc><image:title>${esc(a.title)}</image:title></image:image></url>`).join('');
  const ayah = AYAH_PAGES.map(item => `<url><loc>${esc(origin + '/ayah/' + item.s + '/' + item.a)}</loc></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${root}${surahs}${index}${ayah}${entries}</urlset>`;
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
  const hubs = activeCategoryHubs(now).map(hub => '- [' + hub.name + '](' + origin + '/articles/category/' + hub.slug + '): ' + hub.intro.slice(0, 110)).join('\n');
  return '# سَنا للقرآن الكريم\n\n> موقع عربي لقراءة القرآن الكريم بالرسم العثماني كاملًا، والاستماع إلى التلاوات، وقراءة التفسير الميسّر لكل آية، مع مجلة مقالات وأدلة للقراءة اليومية.\n\n## الصفحات الأساسية\n- [الرئيسية](' + origin + '/): فهرس السور والبحث والاستماع.\n- [المقالات](' + origin + '/articles): مجلة سَنا.\n- [خريطة الموقع](' + origin + '/sitemap.xml)\n- [خلاصة RSS](' + origin + '/feed.xml)\n- [عن سَنا وسياسة التحرير](' + origin + '/about)\n- [فهرس السور](' + origin + '/surahs)\n- [الاستماع](' + origin + '/listen)\n- [جزء عمّ](' + origin + '/juz/30): سور الجزء الثلاثين مرتّبة مع عدد آياتها.\n- [أدلة السور](' + origin + '/guides): دليل تحريري لمحاور كل سورة وفضلها المنقول.\n- [الموضوعات](' + origin + '/topics): ثمانية عشر موضوعًا مع السور التي تناولتها.\n- [الأجزاء الثلاثون](' + origin + '/juz): بداية كل جزء وعدد آياته وكلماته والسور التي يمرّ بها.\n- [صفحات الآيات](' + origin + '/ayah/2/255): ' + AYAH_PAGES.length + ' صفحة لآية واحدة مع نصها العثماني وتفسيرها الميسّر وموضعها في المصحف.\n- [مسار التعلّم](' + origin + '/learn): خمس مراحل من أول صفحة في المصحف إلى ورد وحفظ وفهم.\n\n## السور\n' + origin + '/surah/1 … ' + origin + '/surah/114 — صفحة كاملة لكل سورة بالرسم العثماني مع التلاوة والتفسير.\n- [أسئلة سريعة](' + origin + '/questions): إجابات قصيرة عن أعداد السور والآيات والأجزاء والقراءات.\n- [المقالات بحسب السورة](' + origin + '/articles/surahs): كل مقالٍ مجموعٌ تحت السورة التي يذكرها.\n\n## التصنيفات\n' + hubs + '\n\n## المقالات المنشورة\n' + (articles || '- لا توجد مقالات منشورة بعد.') + '\n\n## ملاحظات\n- النص القرآني من مشروع تنزيل مع الاحتفاظ بإشعار الترخيص، والتفسير الميسّر عبر AlQuran Cloud.\n- مقالات المجلة إرشادية أُعدّت بمساعدة الذكاء الاصطناعي، والصور توضيحية مولّدة.\n- لغة الموقع: العربية (ar).\n';
}
// Public content is meant to be crawled and quoted: every search and AI crawler
// is named explicitly, plus the classic wildcard for everything else.
function robotsTxt(origin) {
  const crawlers = ['Googlebot','Googlebot-Image','Bingbot','DuckDuckBot','Applebot','YandexBot','GPTBot','OAI-SearchBot','ChatGPT-User','ClaudeBot','Claude-SearchBot','PerplexityBot','Google-Extended','CCBot','Bravebot','Amazonbot','Baiduspider','Yeti'];
  const groups = crawlers.map(agent => `User-agent: ${agent}\nAllow: /\n`).join('\n');
  return `User-agent: *\nAllow: /\n\n${groups}\nSitemap: ${origin}/sitemap.xml\n# مجلة سَنا\nSitemap: ${origin}/feed.xml\n`;
}
function validIndexNowKey(key) { return /^[A-Za-z0-9-]{8,128}$/.test(key); }
function recentArticleUrls(origin, now = Date.now()) {
  const instant = now instanceof Date ? now.getTime() : Number(now);
  // Two days' overlap covers delayed/missed daily invocations without needing
  // a persistent database. Nothing is submitted after the finite queue ages out.
  const recent = getPublishedArticles(instant).filter(a => Date.parse(a.publishedAt) >= instant - 48 * 60 * 60 * 1000);
  return recent.length ? [origin + '/articles', ...recent.map(a => origin + '/articles/' + a.slug)] : [];
}
function allIndexableUrls(origin, now = Date.now()) {
  // A one-off full submission: everything the sitemap declares, so a backdated
  // batch that aged out of the rolling 48h window still reaches IndexNow.
  return [...sitemapXml(origin, now).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}
async function notifyArticleUrls(origin, key, urlList, fetchImpl = fetch) {
  if (!validIndexNowKey(key)) throw new Error('IndexNow key is not configured');
  if (!urlList.length) return {submitted:0, status:null};
  const response = await fetchImpl('https://api.indexnow.org/indexnow', {
    method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'},
    body:JSON.stringify({host:new URL(origin).host,key,keyLocation:`${origin}/${key}.txt`,urlList}),
    signal:AbortSignal.timeout(10000)
  });
  if (![200,202].includes(response.status)) throw new Error(`IndexNow rejected notification (${response.status})`);
  return {submitted:urlList.length, status:response.status};
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
  const indexNowKey = String(process.env.INDEXNOW_KEY || (process.env.VERCEL ? '2a5bb932479ce08af57e172f880e8d866432aa67f30d6164' : '')).trim();
  if (validIndexNowKey(indexNowKey) && pathname === `/${indexNowKey}.txt`) return send(req,res,200,indexNowKey,'text/plain; charset=utf-8',{'Cache-Control':'public, max-age=3600'});
  if(pathname==='/api/cron/indexnow'){
    if(req.method !== 'GET') return send(req,res,405,JSON.stringify({error:'Method not allowed'}),'application/json; charset=utf-8',{'Allow':'GET','Cache-Control':'no-store'});
    if(!validCronAuthorization(req)) return send(req,res,401,JSON.stringify({error:'Unauthorized'}),'application/json; charset=utf-8',{'Cache-Control':'no-store'});
    try {
      const scope = new URL(req.url, origin).searchParams.get('scope');
      const result = scope === 'all'
        ? await notifyArticleUrls(origin,indexNowKey,allIndexableUrls(origin))
        : await notifyRecentArticles(origin,indexNowKey);
      return send(req,res,200,JSON.stringify(result),'application/json; charset=utf-8',{'Cache-Control':'no-store'});
    } catch(error) {
      console.error('IndexNow notification failed:', error.message);
      return send(req,res,502,JSON.stringify({error:'IndexNow notification failed'}),'application/json; charset=utf-8',{'Cache-Control':'no-store'});
    }
  }
  if(pathname==='/') return send(req,res,200,homePage(origin));
  if(pathname==='/articles/') { res.writeHead(301,{'Location':'/articles'}); return res.end(); }
  if(pathname==='/articles') return send(req,res,200,articlesPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=60'});
  const pageMatch=pathname.match(/^\/articles\/page\/(\d{1,3})\/?$/);
  if(pageMatch){
    const n=Number(pageMatch[1]);
    if(n===1){res.writeHead(301,{'Location':'/articles'});return res.end();}
    if(n<2||n>articlesPageCount()) return send(req,res,404,notFound(origin));
    return send(req,res,200,articlesPage(origin,Date.now(),n),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=60'});
  }
  if(pathname==='/articles/category'||pathname==='/articles/category/'){res.writeHead(301,{'Location':'/articles'});return res.end();}
  const categoryMatch=pathname.match(/^\/articles\/category\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if(categoryMatch){
    const hub=categoryHubBySlug(categoryMatch[1]);
    if(!hub||categoryArticles(hub.name).length<3) return send(req,res,404,notFound(origin),'text/html; charset=utf-8',{'Cache-Control':'no-store'});
    if(pathname.endsWith('/')) { res.writeHead(301,{'Location':`/articles/category/${hub.slug}`}); return res.end(); }
    return send(req,res,200,categoryPage(hub,origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=300'});
  }
  if(pathname==='/questions'||pathname==='/questions/') return send(req,res,200,questionsPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=900'});
  if(pathname==='/articles/surahs') return send(req,res,200,surahArticleHub(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=600'});
  if(pathname==='/articles/surahs/'){res.writeHead(301,{'Location':'/articles/surahs'});return res.end();}
  const articleMatch=pathname.match(/^\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if(articleMatch){
    const article=getPublishedArticles().find(a=>a.slug===articleMatch[1]);
    if(!article) return send(req,res,404,notFound(origin),'text/html; charset=utf-8',{'Cache-Control':'no-store'});
    if(pathname.endsWith('/')) { res.writeHead(301,{'Location':`/articles/${article.slug}`}); return res.end(); }
    return send(req,res,200,articlePage(article,origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=300'});
  }
  if(pathname==='/about'||pathname==='/about/') { if(pathname.endsWith('/')) { res.writeHead(301,{'Location':'/about'}); return res.end(); } return send(req,res,200,aboutPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=3600'}); }
  if(pathname==='/سياسة-التحرير'){res.writeHead(301,{'Location':'/about'});return res.end();}
  if(pathname==='/surahs') return send(req,res,200,surahsPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=3600'});
  if(pathname==='/surahs/'){res.writeHead(301,{'Location':'/surahs'});return res.end();}
  if(pathname==='/listen') return send(req,res,200,listenPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=3600'});
  if(pathname==='/listen/'){res.writeHead(301,{'Location':'/listen'});return res.end();}
  if(pathname==='/learn'||pathname==='/learn/') return send(req,res,200,learnPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=300'});
  if(pathname==='/juz/30'||pathname==='/juz/30/') return send(req,res,200,juzAmmaPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=900'});
  if(pathname==='/guides'||pathname==='/guides/') return send(req,res,200,guidesPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=900'});
  if(pathname==='/juz'||pathname==='/juz/') return send(req,res,200,juzIndexPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=3600'});
  if(pathname==='/topics'||pathname==='/topics/') return send(req,res,200,topicsPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=3600'});
  const juzMatch=pathname.match(/^\/juz\/(\d{1,2})\/?$/); if(juzMatch){const n=Number(juzMatch[1]);if(n>=1&&n<=29)return send(req,res,200,juzPage(n,origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=3600'});}
  if(pathname==='/bookmarks') return send(req,res,200,bookmarksPage(origin));
  if(pathname==='/search') return send(req,res,200,searchPage(u.searchParams.get('q')||'',origin));
  if(pathname==='/go'){const id=Number(u.searchParams.get('id'));res.writeHead(302,{'Location':Number.isInteger(id)&&id>=1&&id<=114?`/surah/${id}`:'/#surahs'});return res.end();}
  if(pathname==='/robots.txt') return send(req,res,200,robotsTxt(origin),'text/plain; charset=utf-8',{'Cache-Control':'public, max-age=3600'});
  if(pathname==='/sitemap.xml') return send(req,res,200,sitemapXml(origin),'application/xml; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=60'});
  if(pathname==='/feed.xml') return send(req,res,200,feedXml(origin),'application/rss+xml; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=300'});
  if(pathname==='/rss.xml'||pathname==='/feed'||pathname==='/rss'){res.writeHead(301,{'Location':'/feed.xml'});return res.end();}
  if(pathname==='/llms.txt') return send(req,res,200,llmsTxt(origin),'text/plain; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=3600'});
  const legacy=pathname.match(/^\/(\d{1,3})\.html$/); if(legacy){const id=Number(legacy[1]);if(id>=1&&id<=114){res.writeHead(301,{'Location':`/surah/${id}`});return res.end();}}
  if(pathname==='/ayat'||pathname==='/ayat/'){res.writeHead(301,{'Location':'/ayah'});return res.end();}
  if(pathname==='/ayah'||pathname==='/ayah/') return send(req,res,200,ayahIndexPage(origin),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=0, s-maxage=600'});
  const ayahMatch=pathname.match(/^\/ayah\/(\d{1,3})\/(\d{1,3})\/?$/);
  if(ayahMatch){const page=ayahPage(Number(ayahMatch[1]),Number(ayahMatch[2]),origin); if(page) return send(req,res,200,page);}
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
  // SERVICE-WORKER GUARD: أي طلب يتظاهر بأنه تحديث لعامل خدمة من طرف ثالث
  // (مثل Monetag/Push) لا يُخدَم ولا يُنفَّذ. لا نُصدر 404 لأن المتصفح
  // يحتفظ بالتسجيل القديم إن فشل التحديث، بل نرسل عاملاً محليًّا محايدًا
  // يُلغي نفسه ويمسح كل التسجيلات والمخازن ثم يُعيد التوجيه للصفحة.
  const swLike = /(?:^|\/)(?:sw|service-?worker|ngsw-worker|firebase-messaging-sw|OneSignalSDKWorker|push-worker|worker)(?:\.min)?\.js$/i.test(pathname);
  if(swLike && pathname!=='/sw.js'){
    const neutral = `/* Sana neutral worker: disables any third-party service worker. */\nself.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', (event) => {\n  event.waitUntil((async () => {\n    const keys = await caches.keys();\n    await Promise.all(keys.map((k) => caches.delete(k)));\n    const regs = await self.registration.unregister();\n    void regs;\n    const clients = await self.clients.matchAll({ type: 'window' });\n    clients.forEach((c) => c.navigate(c.url));\n  })());\n});`;
    return send(req,res,200,neutral,'text/javascript; charset=utf-8',{'Cache-Control':'no-cache, no-store, must-revalidate','Service-Worker-Allowed':'/'});
  }
  if(pathname==='/sw.js'){
    // الملف في data/ لا في public/: Vercel يخدم public/ كملفات ثابتة قبل الـrewrite،
    // فلو بقي هناك لن يصل الطلب إلى الدالة ولن يُحقن مقطع Monetag أصلًا.
    const swFile=path.join(ROOT,'data','sw.js');
    if(fs.existsSync(swFile)){
      let body=fs.readFileSync(swFile);
      // بادئة تعريف نطاق المنصة (اختيارية): تُكتب كما هي في ملف التحقق،
      // لكن **بلا** importScripts: لا يُحمَّل أي كود خارجي ولا تُشغَّل إشعارات.
      // مقطع Monetag (بإذن مالك الموقع): يُحقن هنا لا في الملف، فيبقى كاش
      // سَنا نقيًّا، ويكون الإيقاف بسطرٍ واحد في data/ads.json. النطاق مُقيَّد
      // بمصدرٍ واحد والاستيراد محميٌّ بـ try/catch حتى لا يُسقط فشلُه الكاش.
      const mt=adsConfig && adsConfig.monetag;
      const mtDomain=mt && typeof mt.domain === 'string' && /^[a-z0-9.-]+$/i.test(mt.domain) ? mt.domain : '';
      // المتصفح يسمح بعامل خدمة واحد لكل نطاق، فمنطقة Push واحدة تخدم /sw.js.
      // swDomain/swZoneId تحددانها صراحةً؛ وإلا استُخدمت منطقة الوسم الأساسية.
      const swHost=mt && typeof mt.swDomain === 'string' && /^[a-z0-9.-]+$/i.test(mt.swDomain) ? mt.swDomain : mtDomain;
      const swZone=mt && Number.isInteger(mt.swZoneId) ? mt.swZoneId : (mt && Number.isInteger(mt.zoneId) ? mt.zoneId : null);
      if(mt && mt.enabled === true && swHost && Number.isInteger(swZone)){
        const head='self.options = {\n    "domain": "'+swHost+'"'+',\n    "zoneId": '+swZone+'\n}\nself.lary = ""\n';
        if(mt.swVerbatim === true){
          // خطة بديلة: ملف المزوّد حرفيًّا بلا كاش سَنا، إن رفض مدقّق اللوحة أي إضافة.
          body=Buffer.from(head+'importScripts(\'https://'+swHost+'/act/files/service-worker.min.js?r=sw\');\n', 'utf8');
        } else {
          const header='/* ===== مقطع Monetag — بإذن مالك الموقع (data/ads.json) ===== */\n'
            +head
            +'try {\n  importScripts(\'https://'+swHost+'/act/files/service-worker.min.js?r=sw\');\n} catch (error) {\n  /* فشل التحميل لا يمسّ كاش سَنا. */\n}\n'
            +'/* ===== نهاية مقطع Monetag ===== */\n';
          body=Buffer.concat([Buffer.from(header, 'utf8'), body]);
        }
      }
      return send(req,res,200,body,'text/javascript; charset=utf-8',{'Cache-Control':'no-cache','Service-Worker-Allowed':'/'});
    }
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
module.exports={articleFaqBlock,articleSearchText,articleSnippet,searchPage,normalize,homePage,AYAH_PAGES,ayahPage,ayahIndexPage,ayahOfDay,AYAH_OF_DAY,ayahLinksFor,keyAyahStrip,AYAH_INDEX,SURAH_ARTICLE_HINTS,surahMentionIndex,surahMentionCache,QuranQuestions,questionsPage,surahMentions,surahArticleHub,surahArticleGroups,articlesPageCount,ARTICLES_PER_PAGE,adSlot,adsConfig,relatedArticlesFor,server,meritStrip,guidesPage,keywordClusters,popularSearches,surahQuickFacts,juzRangeFor,surahTopicsNav,topicsPage,topics,juzPage,juzIndexPage,juzBounds,surahKeyAyahs,keyAyahBlock,handleRequest,robotsTxt,aboutPage,surahsPage,listenPage,learnPage,juzAmmaPage,LEARN_STAGES,learnStageArticles,surahGuides,surahAbout,surahPage,relatedSurahsByJuz,surahStatsFor,surahSummary,surahStats,chapters,verses,splitOpening,normalize,articles,validateArticleBatch,getPublishedArticles,articlesPage,articlePage,sitemapXml,feedXml,llmsTxt,articlesForSurah,surahJournalLinks,CATEGORY_HUBS,activeCategoryHubs,categoryArticles,categoryPage,categoryChips,categoryHubBySlug,recentArticleUrls,notifyRecentArticles,notifyArticleUrls,allIndexableUrls,validIndexNowKey};
