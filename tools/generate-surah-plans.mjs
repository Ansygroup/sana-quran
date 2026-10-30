// مولّد خطط السور: ١١٤ مقالة، كل واحدة لسورةٍ مختلفة ببياناتها الحقيقية.
// لا يُكتب الناتج إلى القرآن مباشرة؛ يُحفظ في /tmp/art/surah-plans.json ثم تُقاس جودة القبول.
import fs from 'node:fs';

const root = '/home/user/sana-quran';
const u = await import(root + '/server.js?v=' + Date.now());
const AYAH = JSON.parse(fs.readFileSync(root + '/data/ayat-pages.json', 'utf8'));

const ar = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const clean = s => s.replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim();
const trim = (s, n) => { s = clean(s); if (s.length <= n) return s; const cut = s.slice(0, n); const i = cut.lastIndexOf(' '); return cut.slice(0, i > 40 ? i : n) + '…'; };

const OPENERS = [
  'أكثر ما يُفسد خطة القراءة ليس ضيق الوقت، بل الانتظار حتى يصفو. وهذه خطة صغيرة تعتمد على سبعة أيام فقط، تُجزّأ فيها السورة على أيام، ويبقى لكل يوم وقفة قصيرة.',
  'الخطة الجيدة ليست التي تُنهي السورة بأسرع ما يمكن، بل التي تجعلك تعود غدًا. سبعة أيام كافية لتقرأ سورة كاملة بتمهّل، بشرط أن يكون التقسيم واضحًا من اليوم الأول.',
  'من يبدأ سورةً طويلة بلا تقسيم يتوقف بعد يومين، ومن يقسّمها على أسبوع يُكملها ولو كان يومه مزدحمًا. هذه خطة أسبوع مبنية على عدد آيات السورة لا على الحماس.',
  'قبل أن تبدأ، اعرف حجم ما تقرأ: عدد الآيات والكلمات وزمن التلاوة. الأرقام هنا ليست تفاصيل، بل هي ما يجعل الخطة واقعية بدل أن تكون أمنية.',
  'قراءة سورةٍ كاملة في أسبوع تحتاج قرارين: تقسيمًا ثابتًا في المصحف، ووقتًا ثابتًا في اليوم. ما بعد ذلك تفصيل يمكن تعديله من غير أن تنهار الخطة.'
];
const PLAN_NOTES = [
  'القاعدة: إذا فاتك يومٌ فلا تقضِ يومين في واحد؛ أكمل من حيث توقفت مع خطة قصيرة للأسبوع التالي، فالاستمرار أنفع من التعويض المكدّس.',
  'اجعل التقسيم بالآيات لا بالصفحات، لأن الصفحة قد تنتهي في منتصف آية، وتغيير موضع التوقف كل يوم يشتّت الحفظ البصري.',
  'إن كانت السورة طويلة عليك، فاقسم كل يوم إلى فترتين: قراءة صامتة في الصباح وتلاوة في المساء. الهدف أن تسمعها بصوتك مرة واحدة على الأقل.',
  'علّم على موضع التوقف في مصحفك، ولا تغيّر موضع الابتداء في اليوم التالي. ثبات المواضع يجعل العودة بعد انقطاعٍ أسهل بكثير.',
  'إذا قرأت مع شخصٍ آخر فحدّدا موعدًا ليوم واحد من الأسبوع فقط، يوم الاختلاف والمراجعة؛ الالتقاء اليومي يجعل الخطة هشّة.'
];
const CLOSERS = [
  'بعد الأسبوع لا تبدأ سورةً جديدة فورًا؛ أعِد قراءة الآيات التي توقفت عندها مرة واحدة، واكتب سطرًا واحدًا عمّا فهمت. هذا السطر هو ما يبقى بعد أن تُنسى أرقام الخطة.',
  'انتهاء الخطة نجاح صغير يستحق أن يُسجّل: اكتب في مفكرتك اسم السورة والتاريخ. تراكم هذه السطور، لا الحماس، هو ما يبني عادةً تدوم سنين.',
  'الغاية من التقسيم أن تعود إلى السورة بعد شهرٍ فلا تجدها غريبة. لذلك اختر آيةً واحدة منها واجعلها وردك الخاص كلما مررت بها.',
  'لا تقارن سرعتك بغيرك؛ من يقرأ سورة في أسبوع بوقفةٍ واحدة أفضل من الذي يقطع ختمةً في أسبوعين ولا يتذكر منها شيئًا. المسألة أثرٌ لا عدد.',
  'إن أردت أن تُثبّت الخطة، فأشرك من حولك: اقرأ الآية الأخيرة من يومك بصوت مسموع لأحد أفراد بيتك. الاستماع المشترك يمنح الخطة معنى أسرع من أي تطبيق.',
  'أعد الخطة نفسها بعد شهر دون أن تقرأ السورة كاملة، بل اقرأ فقط الآيات التي علّمت عليها. المراجعة الخفيفة تحفظ ما بنيته في الأسبوع الأول.'
];
const TITLES = [
  n => `سورة ${n}: خطة قراءة في سبعة أيام`,
  n => `كيف تقرأ سورة ${n} في أسبوع دون أن تنقطع؟`,
  n => `سورة ${n} في سبعة أيام: تقسيم عملي ووقفتان`,
  n => `خطة أسبوعٍ لسورة ${n}: من فاتحتها إلى خاتمتها`
];
const ALTS = [
  n => `مصحف مفتوح على صفحة من سورة ${n} بإضاءة هادئة`,
  n => `نسخة مصحف قديمة مع فاصلٍ ورقي عند سورة ${n}`,
  n => `صفحة مصحف مطبوعة بجانب كوب شاي على طاولة خشبية`,
  n => `مصحف مفتوح ونافذة مضاءة في وقت الصباح، إشارة إلى ورد سورة ${n}`
];

const items = [];
for (let id = 1; id <= 114; id++) {
  const c = u.chapters[id - 1];
  const st = u.surahStatsFor(id);
  const guide = u.surahGuides[String(id)] || {};
  const themes = Array.isArray(guide.themes) ? guide.themes.filter(Boolean).slice(0, 3) : [];
  const pool = AYAH.filter(x => x.s === id).sort((a, b) => a.a - b.a);
  if (!pool.length) { console.log('SKIP no ayat', id); continue; }
  const first = pool[0];
  const last = pool[pool.length - 1];
  const mid = pool[Math.floor(pool.length / 2)];

  const perDay = Math.max(1, Math.ceil(c.ayahCount / 7));
  const days = [];
  for (let d = 0; d < 7; d++) {
    const from = d * perDay + 1;
    if (from > c.ayahCount) break;
    const to = Math.min(c.ayahCount, (d + 1) * perDay);
    days.push(`اليوم ${ar(d + 1)}: من الآية ${ar(from)} إلى الآية ${ar(to)} — ${themes[d % Math.max(1, themes.length)] || 'قراءة متصلة بلا وقفة طويلة'}`);
  }
  const order = id % 2 === 0;

  const statsSection = {
    heading: 'قبل أن تبدأ: أرقام السورة',
    paragraphs: [
      `سورة ${c.name} ${c.revelation}، عدد آياتها ${ar(c.ayahCount)} آية، وكلماتها ${ar(st.words)} كلمة. تبدأ في الجزء ${ar(c.juz)} عند الصفحة ${ar(c.page)} من المصحف، وزمن تلاوتها المتوسط ${ar(st.minutes)} ${st.minutes === 1 ? 'دقيقة' : st.minutes === 2 ? 'دقيقتان' : st.minutes <= 10 ? 'دقائق' : 'دقيقة'} تقريبًا.`,
      `هذه الأرقام تشرح لماذا يصلح التقسيم على سبعة أيام: ${ar(perDay)} آية في اليوم هي وحدة الخطة، وفي الأيام الأخيرة تقلّ الحصة تلقائيًا لأن آخر يوم لا يحتاج أكثر من ${ar(Math.max(1, c.ayahCount - perDay * 6))} آية.`
    ]
  };
  const openSection = {
    heading: `الوقفة الأولى: ${themes[0] ? 'مفتاح السورة' : 'افتتاح السورة'}`,
    paragraphs: [
      `تفتح السورة بقوله تعالى: «${clean(first.text)}». وخلاصة تفسيرها الميسّر: ${trim(first.tafsir, 240)}`,
      themes[0] ? `ومن أبرز محاور السورة: ${themes.join('، ')}. اقرأ الآية الأولى وأنت تضع هذا المحور في ذهنك، فالافتتاح عادةً يضع مفتاح ما بعده.` : `اقرأ الآية الأولى مرتين: مرة للفهم، ومرة للاستماع لنفسك وأنت تقرأ.`
    ]
  };
  const closeSection = {
    heading: 'الوقفة الثانية: خاتمة السورة',
    paragraphs: [
      `تُختم السورة بقوله تعالى: «${clean(last.text)}». ويقول التفسير الميسّر في معناها: ${trim(last.tafsir, 230)}`,
      `إذا أتيت خاتمة السورة في اليوم السابع فلا تقرأها وأنت مستعجل؛ الخاتمة موضعُ سؤالٍ طبيعي: هل تغيّر شيء في طريقة قراءتي خلال الأسبوع؟`
    ]
  };
  const planSection = {
    heading: 'تقسيم الأيام السبعة',
    paragraphs: [PLAN_NOTES[id % PLAN_NOTES.length]],
    list: days
  };
  const extraSection = {
    heading: 'وقفةٌ في وسط السورة',
    paragraphs: [
      `الآية ${ar(mid.a)} من السورة تقول: «${clean(mid.text)}». ومعناها في التفسير الميسّر: ${trim(mid.tafsir, 200)}`,
      `اختر هذه الآية لليوم الرابع إن أردت وقفةً وسط الأسبوع؛ الوقفة الوسطى تمنع الخطة من أن تتحول إلى قراءةٍ آلية حتى النهاية.`
    ]
  };
  const close = { heading: 'بعد الأسبوع', paragraphs: [CLOSERS[id % CLOSERS.length]] };

  let sections;
  if (c.ayahCount <= 10) {
    // السور القصيرة: تُقرأ كاملةً في ثلاثة أيام، وتُقتطف آياتها مع تفسيرها،
    // فالمحتوى هنا فريد بالكامل تقريبًا.
    const quoted = pool.slice(0, 5).map(x => `«${clean(x.text)}» — ${trim(x.tafsir, 150)}`);
    const shortPlan = {
      heading: 'خطة ثلاثة أيام لا سبعة',
      paragraphs: [
        `سورة ${c.name} لا تحتاج أسبوعًا: ${ar(c.ayahCount)} آية تُقرأ في جلسة واحدة، لكن التوزيع على ثلاثة أيام يجعل الوقفة أعمق. اليوم الأول للآية ${ar(1)}، والثاني لما بعدها، والثالث لمراجعة السورة كاملة بصوت مسموع.`,
        'القاعدة في السور القصيرة أن تُقرأ كثيرًا لا مرة واحدة؛ التكرار هو ما يثبّتها في الصدر ويجعل معناها حاضرًا عند الحاجة.'
      ],
      list: [
        `اليوم ${ar(1)}: الآيات ${ar(1)}–${ar(Math.min(3, c.ayahCount))} مع قراءة تفسيرها.`,
        `اليوم ${ar(2)}: بقية السورة، ثم إعادة الآية الأولى وحدها ثلاث مرات.`,
        `اليوم ${ar(3)}: السورة كاملة بصوت مسموع من غير نظر إن أمكن.`
      ]
    };
    const quotedSection = {
      heading: 'آيات السورة وتفسيرها',
      paragraphs: [quoted[0]],
      list: quoted.slice(1)
    };
    sections = [statsSection, openSection, quotedSection, shortPlan, closeSection, close];
  } else {
    sections = order
      ? [statsSection, openSection, planSection, extraSection, closeSection, close]
      : [openSection, statsSection, closeSection, planSection, extraSection, close];
  }

  const words = sections.flatMap(s => s.paragraphs).join(' ').split(/\s+/).length;
  items.push({
    slug: `surah-plan-${id}`,
    title: TITLES[id % TITLES.length](c.name),
    category: 'خطط السور',
    summary: `خطة أسبوعية لسورة ${c.name}: ${ar(c.ayahCount)} آية مقسّمة على سبعة أيام، مع وقفتين على افتتاح السورة وخاتمتها وأرقامها كاملة.`,
    lead: OPENERS[id % OPENERS.length],
    imageAlt: ALTS[id % ALTS.length](c.name),
    image: `/articles/surah-plan-${id}.webp`,
    minutes: 4 + (id % 3),
    sections,
    sources: [
      { label: 'مشروع تنزيل — النص القرآني المعتمد', url: 'https://tanzil.net/' },
      { label: 'Quran.com — التفسير الميسّر لكل آية', url: 'https://quran.com/' }
    ],
    related: [
      { label: 'خطة القراءة اليومية', href: '/articles/daily-quran-reading-plan' },
      { label: 'سورة البقرة في أسبوع', href: '/articles/al-baqarah-in-a-week' },
      { label: 'قراءة سورة في جلسة واحدة', href: '/articles/reading-a-surah-in-one-sitting' }
    ],
    publishedAt: new Date(Date.UTC(2026, 9, 29, 11, 0, 0) + id * 60).toISOString().replace('.000Z', 'Z'),
    _words: words
  });
}

fs.mkdirSync('/tmp/art', { recursive: true });
fs.writeFileSync('/tmp/art/surah-plans.json', JSON.stringify(items.map(({ _words, ...a }) => a)) + '\n');
console.log('generated', items.length, '| words min/avg/max', Math.min(...items.map(i => i._words)), Math.round(items.reduce((s, i) => s + i._words, 0) / items.length), Math.max(...items.map(i => i._words)));
console.log('sample title:', items[17].title, '| sections', items[17].sections.length);
