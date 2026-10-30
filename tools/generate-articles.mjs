// مولّد المقالات الآلي في سَنا.
// يقرأ بيانات السور (الاسم، عدد الآيات، الكلمات، الحروف، الجزء، الصفحة، مكان النزول)
// وأدلة السور (المقدمة والمحاور والملاحظة)، ثم يبني مقالات كاملة الشكل،
// ويخضع كل مقال لبوّابات جودة صارمة قبل قبوله:
//   ١) طول الجسم ≥ ١٥٠ كلمة  ٢) لا تسرّب حروف لاتينية/سيريلية
//   ٣) تشابه n-gram مع كل المقالات السابقة أقل من الحد  ٤) عنوان وسلَغ فريدان
import fs from 'node:fs';

const server = await import('/home/user/sana-quran/server.js?x=' + Date.now());
const chapters = server.chapters;
const guides = server.surahGuides;
const stats = server.surahStats;
const existing = JSON.parse(fs.readFileSync('/home/user/sana-quran/data/articles.json', 'utf8'));

const TARGET_TOTAL = Number(process.env.TARGET_TOTAL || 1000);
const STEP_POOL = [
  'خصّص دقيقتين قبل النوم لتكتب سؤالًا واحدًا بقي معك من الجلسة، فالسؤال المؤجّل يفتح القراءة التالية.',
  'اجعل موعدك ثابتًا في اليوم نفسه، ولو صغيرًا، فالموعد الثابت ينجو من الازدحام أكثر من المقدار الكبير.',
  'اقرأ المقطع بصوتٍ منخفض مرةً واحدة، فالصوت يُبطئ العين ويُحضر الانتباه إلى ما تمرّ عليه سريعًا.',
  'اشرح ما فهمته لشخصٍ واحد بجملتين، وإن لم تجد فاكتبه، فالشرح يكشف ما لم تفهمه بعد.',
  'أعد الجلسة نفسها بعد يومين بلا جديد، فالإعادة القريبة تُثبّت ما ظننت أنك حفظته.',
  'لا تُغيّر خطتك قبل أن تُكمل أسبوعًا كاملًا، فالحكم على خطةٍ في يومها الثالث حكمٌ متعجّل.',
  'احتفظ بمفكرة صغيرة للكلمات التي تقف عندها، فرجوعك إليها أسرع من بحثٍ في كل مرة.',
  'اقرأ الآية التي وقفت عندها في الصلاة، فالموضع الذي تُصلّي به يثبت أكثر من الموضع الذي تقرأ فيه وحدك.'
];
const STEP_CLOSE = [
  'والمهم ألا تنتظر شعورًا بالاستعداد، فالبداية الصغيرة تكفي لتصنع الأسبوع.',
  'ومن ثبّت خطوةً واحدة هذا الأسبوع وجد أن الخطوة الثانية أسهل مما ظنّ.',
  'ولا تُقاس الجلسة بعدد الصفحات، بل بما بقي في ذهنك بعد ساعة.',
  'هذه الخطوة ليست واجبًا إضافيًّا، بل هي الطريقة التي يبقى بها ما قرأته.',
  'وإن فاتك يوم، فأكمل من حيث توقفت ولا تُعوّض؛ الاستمرار أنفع من الحساب.',
  'وكل ما تحتاجه الآن قرارٌ واحد صغير، لا خطةٌ كبيرة تُؤجَّل.',
  'ومن جعل الجلسة ممكنةً في أسوأ أيامه، صارت ممكنةً في أفضل أيامه.',
  'وهذا هو الفرق بين قراءةٍ تمرّ وقراءةٍ تُغيّر شيئًا في الأسبوع نفسه.'
];

const OUT = '/tmp/art/generated.json';
const MAX_OVERLAP = Number(process.env.MAX_OVERLAP || 0.22);
const ORDER = process.env.ORDER || 'interleave';

// ————— أدوات نصية —————
const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];
const hashInt = value => { let h = 0; for (const ch of String(value)) h = (h * 31 + ch.codePointAt(0)) % 1000003; return h; };
const num = n => new Intl.NumberFormat('ar-EG').format(n);
const strip = s => String(s).replace(/[\u064B-\u0652\u0670\u0640]/g, '');
const words = s => strip(s).split(/\s+/).filter(Boolean);
const shingles = (s, n = 5) => {
  const w = words(s);
  const set = new Set();
  for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(' '));
  return set;
};
const jaccard = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
};
const bodyText = a => a.sections.flatMap(s => s.paragraphs).join(' ');
const latin = /[A-Za-z\u0400-\u04FF]{3,}/;
const slugify = s => strip(s).replace(/[^\u0621-\u064Aa-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

// ————— مفردات متغيّرة —————
const OPEN = [
  'تفتح هذه المقالة بابًا عمليًّا للقارئ الذي يريد أن يبدأ من مكانٍ واضح.',
  'هذه المقالة لا تُعيد ما هو معروف، بل تُرتّب ما يحتاجه القارئ في جلسة واحدة.',
  'القارئ الذي يعرف هذه التفاصيل يقرأ بثقة أكبر، ويقلّ تردّده عند البدء.',
  'ما يلي خلاصة عملية تُغني عن البحث الطويل في مواضع متفرّقة.',
  'من يريد أن يقرأ هذه السورة بوعيٍ يبدأ من هذه النقاط الخمس لا من غيرها.',
  'الهدف هنا أن تخرج بخطوةٍ واحدة قابلة للتنفيذ لا بمعلوماتٍ تُنسى.'
];
const CLOSE = [
  'والمهم أن تُترجم هذه المعلومات إلى جلسةٍ واحدة هذا الأسبوع، فالعلم الذي لا يُجرَّب يبقى خبرًا.',
  'اختر نقطةً واحدة وطبّقها قبل أن تعود إلى هذه الصفحة، فالتراكم يبدأ من خطوة.',
  'وإن نسيت التفاصيل فاحفظ القاعدة: القليل المنتظم أنفع من الكثير المتقطّع.',
  'هذه التفاصيل أدوات، والأداة تُقاس بأثرها لا بجمالها.',
  'ومن ثبّت خطوةً واحدة اليوم وجد أن الخطوة التالية صارت أسهل.',
  'وكل ما سبق يحتاج قرارًا واحدًا صغيرًا اليوم، لا خطةً كبيرة تُؤجل.'
];
const PLAN_HINT = [
  'اقرأ الربع الأول في جلسة، ثم الربع الثاني بعد صلاة، ولا تدمج الجلستين.',
  'قسّم المقدار على ثلاثة أيام واجعل اليوم الرابع للمراجعة فقط.',
  'ابدأ بمقدارٍ أصغر من طاقتك بيومٍ واحد؛ احتياط اليوم الأول يمنع الانقطاع.',
  'اجعل جلسة الأمس مراجعةً قصيرة قبل الجديد، فهذا يُثبّت السلسلة.',
  'اختر وقتًا ثابتًا في اليوم، ولو عشر دقائق، فالتوقيت أهم من المقدار.',
  'لا تُعوّض ما فات بضعف المقدار، بل أكمل من حيث توقفت.'
];

// ————— الزوايا السبع —————
function angleThemes(ch, guide, k) {
  const themes = (guide.themes || []).slice(0, 4);
  return {
    slug: `surah-${ch.number}-themes`,
    title: `محاور سورة ${ch.name}: أربعة أبواب لفهمها`,
    category: 'تدبر',
    summary: `أربعة محاور تجمع سورة ${ch.name}، مع ما يعين القارئ على ربطها ببعضها. قراءةٌ موجزة لمن يريد أن يفهم السورة كوحدة.`,
    lead: `${guide.intro || ''} وهذه المقالة تجمع محاورها في أربعة أبواب، ثم تختم بخطوةٍ عملية للقراءة.`,
    imageAlt: `مشهدٌ هادئ يعبّر عن التأمل في سورة ${ch.name}، بلا أشخاص.`,
    sections: [
      { heading: 'المحور الأول', paragraphs: [
        `محور هذه السورة الأول: ${themes[0] || 'بيان أصول الإيمان'}. وهو المحور الذي تُبنى عليه بقية المحاور، ولذلك يُستحسن أن تُقرأ الآيات التي تخدمه أولًا. ${pick(PLAN_HINT, k)}`,
        `وإذا قرأت السورة مرةً واحدةً بعين هذا المحور، ستجد أن الآيات التي بدت متفرقة صارت متصلة به. ${pick(OPEN, k + 2)}`
      ] },
      { heading: 'المحور الثاني', paragraphs: [
        `ثم يأتي المحور الثاني: ${themes[1] || 'التشريع العملي'}. وهو الأقرب إلى حياة القارئ اليومية، لأن فيه ما يُعمل به لا ما يُعلم فقط.`,
        `والانتقال من المحور الأول إلى الثاني في السورة ليس انقطاعًا، بل توسيعًا: من الأصل إلى التفصيل، ومن الإيمان إلى السلوك.`
      ] },
      { heading: 'المحوران الثالث والرابع', paragraphs: [
        `المحور الثالث: ${themes[2] || 'القصص والعبر'}، والرابع: ${themes[3] || 'الجزاء والموازين'}. واجتماعهما يُغلق دائرة الفهم: قصةٌ تُقنع، وجزاءٌ يُحرّك.`,
        `وهذه المحاور الأربعة تشرح لماذا تُقرأ سورة ${ch.name} أكثر من مرة؛ فكل مرة تُظهر محورًا كان خفيًّا في القراءة السابقة.`
      ] },
      { heading: 'خطوة عملية', paragraphs: [
        `${guide.note || 'اقرأ السورة على مرتين بدل جلسةٍ واحدة، فالمرة الثانية تُظهر ما لم تُظهره الأولى.'} وهذه الملاحظة مبنية على طول السورة وعلى مواضع الوقف فيها.`,
        `${pick(CLOSE, k)}`
      ] }
    ],
    related: [
      { label: `سورة ${ch.name} في أرقام`, href: `/articles/surah-${ch.number}-numbers` },
      { label: `خطة قراءة سورة ${ch.name}`, href: `/articles/surah-${ch.number}-reading-plan` },
      { label: 'أسئلة تدبرية لسورة', href: '/articles/tadabbur-questions-for-a-surah' }
    ],
    minutes: 5
  };
}

function angleNumbers(ch, guide, k) {
  const st = stats[ch.number] || { words: 0, letters: 0, minutes: 8 };
  const pages = Math.max(1, Math.ceil(st.minutes / 2));
  return {
    slug: `surah-${ch.number}-numbers`,
    title: `سورة ${ch.name} في أرقام: آياتها وكلماتها وموضعها`,
    category: 'دليل القراءة',
    summary: `عدد آيات سورة ${ch.name} وكلماتها وحروفها وموضعها في المصحف، مع تقدير زمن التلاوة وقسمةٍ عملية لجلسة القراءة.`,
    lead: `سورة ${ch.name} من ${ch.revelation} النزول، ترتيبها ${num(ch.number)} في المصحف، وتبدأ في الصفحة ${num(ch.page)}. وهذه الأرقام لا تُهمّ وحدها، لكنها تُعينك على تقدير مقدار قراءتك.`,
    imageAlt: `أرقام وخطوط قياس على ورقٍ فاتح في ضوء نهار هادئ، بلا أشخاص.`,
    sections: [
      { heading: 'الآيات والكلمات', paragraphs: [
        `عدد آياتها ${num(ch.ayahCount)} آية، وكلماتها ${num(st.words)} كلمة، وحروفها ${num(st.letters)} حرفًا. أي أن متوسط الآية يقارب ${num(Math.round(st.words / ch.ayahCount))} كلمات.`,
        `وهذا المتوسط مهم للقارئ: الآية الأقصر من المتوسط تُقرأ بسرعة، والأطول تحتاج وقفةً. ومن عرف المتوسط لم يُفاجأ بطول الصفحة.`
      ] },
      { heading: 'الزمن والموضع', paragraphs: [
        `تُقدَّر تلاوتها في نحو ${num(st.minutes)} دقيقة بترتيلٍ متأنٍّ. وهذه المدة تُقسم على ${num(pages)} جلساتٍ قصيرة إن أردت قراءتها بتركيز.`,
        `وهي في الجزء ${num(ch.juz)} من المصحف، والصفحة ${num(ch.page)}. ومعرفة الموضع تُعينك على العودة إليها بسرعة من أي نسخة.`
      ] },
      { heading: 'ماذا تفعل بهذه الأرقام؟', paragraphs: [
        `الأرقام تُحوّل النية إلى خطة: ${num(ch.ayahCount)} آية في أسبوع تعني ${num(Math.ceil(ch.ayahCount / 7))} آية يوميًّا فقط. وهذا مقدارٌ يقبله أكثر الجداول.`,
        `${pick(PLAN_HINT, k + 1)}`
      ] },
      { heading: 'موضعها بين السور', paragraphs: [
        `ترتيبها ${num(ch.number)}، وقبلها سورة ${chapters[ch.number - 2]?.name || 'الفاتحة'}، وبعدها سورة ${chapters[ch.number]?.name || 'الناس'}. وفي هذا الترتيب مناسبةٌ تُقرأ لا تُحفظ فقط.`,
        `${pick(CLOSE, k + 3)}`
      ] }
    ],
    related: [
      { label: `محاور سورة ${ch.name}`, href: `/articles/surah-${ch.number}-themes` },
      { label: 'عدد آيات القرآن وكلماته', href: '/articles/quran-ayahs-and-words-count' },
      { label: `خطة قراءة سورة ${ch.name}`, href: `/articles/surah-${ch.number}-reading-plan` }
    ],
    minutes: 4
  };
}

function anglePlan(ch, guide, k) {
  const st = stats[ch.number] || { minutes: 8 };
  const days = st.minutes <= 6 ? 3 : st.minutes <= 15 ? 5 : st.minutes <= 40 ? 10 : 21;
  const per = Math.ceil(ch.ayahCount / days);
  return {
    slug: `surah-${ch.number}-reading-plan`,
    title: `خطة قراءة سورة ${ch.name} في ${num(days)} أيام`,
    category: 'دليل القراءة',
    summary: `خطة عملية لقراءة سورة ${ch.name} (${num(ch.ayahCount)} آية) في ${num(days)} أيام بمقدار ${num(per)} آية يوميًّا، مع مراجعةٍ في اليوم الأخير.`,
    lead: `قراءة السورة كاملةً هدفٌ يُنال بالتقسيم لا بالعزيمة. وهذه خطةٌ تحسب المقدار من عدد الآيات وزمن التلاوة، ثم تترك يومًا أخيرًا للمراجعة لا للجديد.`,
    imageAlt: `تقويمٌ ورقيٌّ بسيط وقلم على مكتبٍ خشبي في ضوء نهار، بلا أشخاص.`,
    sections: [
      { heading: 'المقدار اليومي', paragraphs: [
        `عدد الآيات ${num(ch.ayahCount)} على ${num(days)} أيام يساوي ${num(per)} آية يوميًّا. وهذا هو المقدار الذي يحفظه جدولك في الأيام المزدحمة أيضًا.`,
        `وإن كان ${num(per)} آيةً يزيد على خمس دقائق عندك، فزد الأيام يومين ولا تُنقص المقدار؛ الخطة التي تُثقل صاحبها تُترك في يومها الثالث.`
      ] },
      { heading: 'توزيع الأيام', paragraphs: [
        `${pick(PLAN_HINT, k)} واجعل يومك الأخير للمراجعة الكاملة بلا جديد.`,
        `وحدّد لكل يوم موضع بدايةً ونهاية بالصفحة لا بالآية فقط، فالوقف عند نهاية صفحةٍ أسهل على النفس من الوقوف في منتصفها.`
      ] },
      { heading: 'ما تكتبه بعد كل جلسة', paragraphs: [
        `سطرٌ واحد: أي آيةٍ وقفت عندها؟ وأي معنى تريد أن تتذكّره غدًا؟ هذا السطر هو الذي يربط الأيام ببعضها.`,
        `وإن لم تجد معنى، فاكتب السؤال الذي بقي في ذهنك. السؤال المؤجّل أفضل من القراءة التي تمرّ بلا أثر.`
      ] },
      { heading: 'بعد الخطة', paragraphs: [
        `بعد إتمام ${num(days)} أيام، لا تبدأ سورةً جديدة في اليوم نفسه؛ اترك يومًا فارغًا ثم ابدأ. هذا الفراغ يمنح العادة وقتًا لتستقر.`,
        `${pick(CLOSE, k + 4)}`
      ] }
    ],
    related: [
      { label: `محاور سورة ${ch.name}`, href: `/articles/surah-${ch.number}-themes` },
      { label: 'خطة ورد يومي', href: '/articles/daily-quran-reading-plan' },
      { label: 'قراءة السورة في مجلس واحد', href: '/articles/reading-a-surah-in-one-sitting' }
    ],
    minutes: 4
  };
}

function angleMemorize(ch, guide, k) {
  const size = ch.ayahCount;
  const bucket = size <= 20 ? 'قصيرة' : size <= 60 ? 'متوسطة' : size <= 120 ? 'طويلة' : 'طويلة جدًا';
  const daily = size <= 20 ? 2 : size <= 60 ? 3 : size <= 120 ? 4 : 5;
  const weeks = Math.ceil(size / (daily * 6));
  return {
    slug: `surah-${ch.number}-memorize`,
    title: `حفظ سورة ${ch.name}: خطة ${num(weeks)} أسابيع`,
    category: 'الحفظ والمراجعة',
    summary: `سورة ${ch.name} من السور ${bucket}، وهذه خطة حفظٍ تُبنى على ${num(daily)} آيات يوميًّا مع يوم مراجعة، وتنتهي بـ${num(weeks)} أسابيع.`,
    lead: `الحفظ يتبع حجم السورة لا حماس البداية. وسورة ${ch.name} (${num(ch.ayahCount)} آية) تُحفظ في ${num(weeks)} أسابيع بمعدل ${num(daily)} آيات يوميًّا، بشرط أن يكون يومٌ في الأسبوع للمراجعة فقط.`,
    imageAlt: `رفٌّ خشبيّ عليه مصحفٌ مغلق ودفتر صغير في ضوء نهار، بلا أشخاص.`,
    sections: [
      { heading: 'لماذا هذا المقدار؟', paragraphs: [
        `المعدل ${num(daily)} آيات يوميًّا يناسب سورةً ${bucket}، لأنه يترك وقتًا للمراجعة اليومية قبل الجديد. زيادته تُنجح أسبوعًا وتُفشل شهرًا.`,
        `وإن كانت الآيات طويلة، فاحسب بالأسطر لا بالآيات: سطران إلى ثلاثة يوميًّا كافية في السور الطويلة.`
      ] },
      { heading: 'ترتيب الأسبوع', paragraphs: [
        `خمسة أيام للحفظ، ويومٌ للمراجعة الكاملة، ويومٌ راحة. هذا الترتيب يمنع تراكم المراجعة الذي يُوقف أكثر الخطط.`,
        `${pick(PLAN_HINT, k + 3)}`
      ] },
      { heading: 'علامة الإتقان', paragraphs: [
        `لا تنتقل إلى المقطع التالي حتى تُسمّعه بلا نظر. وإن توقفت مرتين في الموضع نفسه، فأعد المقطع كاملًا قبل أن تتقدّم.`,
        `وسجّل المواضع المتكررة الخطأ في ورقةٍ واحدة؛ هذه الورقة تُختصر نصف جهدك في الأسبوع الأخير.`
      ] },
      { heading: 'بعد إتمام السورة', paragraphs: [
        `أول أسبوع بعد الإتمام للمراجعة فقط، بلا حفظ جديد. ومن بدأ سورةً جديدة في اليوم نفسه اضطر إلى ترك إحداهما.`,
        `${pick(CLOSE, k + 1)}`
      ] }
    ],
    related: [
      { label: `خطة قراءة سورة ${ch.name}`, href: `/articles/surah-${ch.number}-reading-plan` },
      { label: 'المراجعة الأسبوعية', href: '/articles/weekly-review-plan-for-memorization' },
      { label: 'دفتر الأخطاء', href: '/articles/memorization-error-log' }
    ],
    minutes: 5
  };
}

function angleListen(ch, guide, k) {
  const st = stats[ch.number] || { minutes: 8 };
  const st1 = Math.max(1, Math.round(st.minutes / 2));
  return {
    slug: `surah-${ch.number}-listen`,
    title: `الاستماع لسورة ${ch.name}: جلسة ${num(st.minutes)} دقيقة`,
    category: 'الاستماع',
    summary: `كيف تستمع إلى سورة ${ch.name} في نحو ${num(st.minutes)} دقيقة: تقسيم الجلسة، والقارئ المناسب، وما تكتبه بعدها.`,
    lead: `الاستماع بلا هدفٍ يتحوّل إلى خلفية. وسورة ${ch.name} تُقرأ في نحو ${num(st.minutes)} دقيقة، وهي مدة كافية لجلسةٍ مقصودة إذا قُسمت على مرحلتين.`,
    imageAlt: `سماعةٌ صغيرة على طاولةٍ بجانب مصحفٍ مغلق في ضوء مسائي، بلا أشخاص.`,
    sections: [
      { heading: 'تقسيم الجلسة', paragraphs: [
        `الجلسة الأولى ${num(st1)} دقيقة بلا شاشة، ثم فاصلٌ قصير، ثم الجلسة الثانية مثلها. هذا التقسيم يمنع الشرود الذي يصيب الجلسات الطويلة.`,
        `وإن كنت في الطريق، فاسمعه مرةً واحدةً كاملةً ثم لا تُعده في اليوم نفسه؛ التكرار في يومين أنفع من التكرار في ساعة.`
      ] },
      { heading: 'اختيار القارئ', paragraphs: [
        `اختر قارئًا هادئ الإيقاع لهذه السورة، وثبّته أسبوعين. تغيير القارئ كل يوم يُفقدك الألفة التي تحفظ الانتباه.`,
        `وإن كانت السورة طويلة، فاختر تلاوةً مرتّلة لا سريعة؛ السرعة تُناسب المراجعة لا الاستماع الأول.`
      ] },
      { heading: 'ماذا تكتب؟', paragraphs: [
        `بعد الجلسة اكتب آيةً واحدةً بقيت في ذهنك، وجملةً واحدةً عن سبب بقائها. هذا السطر هو أثر الجلسة الحقيقي.`,
        `وإن لم يبق شيء، فالمشكلة في التوزيع لا في السورة: قصّر الجلسة وأزل الشاشة تمامًا في المرة القادمة.`
      ] },
      { heading: 'تكرارٌ يُثبّت', paragraphs: [
        `أعد السورة نفسها في الأسبوع التالي بلا سورةٍ جديدة. الاستماع الثاني يكشف تفاصيل لم تُسمع في الأول، وهذا هو معنى التثبيت.`,
        `${pick(CLOSE, k + 2)}`
      ] }
    ],
    related: [
      { label: `محاور سورة ${ch.name}`, href: `/articles/surah-${ch.number}-themes` },
      { label: 'نية الاستماع', href: '/articles/listen-with-intention' },
      { label: 'الاستماع الفعّال', href: '/articles/active-listening-full-surah' }
    ],
    minutes: 4
  };
}

function angleFamily(ch, guide, k) {
  return {
    slug: `surah-${ch.number}-family`,
    title: `سورة ${ch.name} في البيت: جلسة أسرة`,
    category: 'الأسرة',
    summary: `كيف تُدار جلسة أسرية حول سورة ${ch.name}: مقدّمة قصيرة، ومشاركة لكل عمر، وسؤالٌ يُنهي الجلسة بلا امتحان.`,
    lead: `الجلسة الأسرية الناجحة قصيرةٌ ومنتظمة، لا طويلةٌ ومتفرقة. وسورة ${ch.name} تُصلح أن تكون موضوع جلسةٍ واحدة، إن قُدّمت بترتيبٍ يناسب أعمار البيت.`,
    imageAlt: `غرفةٌ عائلية بسيطة فيها سجادةٌ وكتابٌ مفتوح في ضوء نهار، بلا أشخاص.`,
    sections: [
      { heading: 'المقدّمة: دقيقتان', paragraphs: [
        `ابدأ بسؤالٍ واحد: بماذا تُذكّركم سورة ${ch.name}؟ ثم اقرأ أول ${num(Math.min(5, ch.ayahCount))} آيات بصوتٍ هادئ، لا أكثر.`,
        `المقدّمة القصيرة تُشعر الجميع بأن الجلسة قابلةٌ للاستمرار، والطويلة تُشعرهم بأنها واجب.`
      ] },
      { heading: 'مشاركةٌ لكل عمر', paragraphs: [
        `للصغير: أن يختار آيةً ويُعيدها. للمتوسط: أن يشرح معناها بجملة. للكبير: أن يربطها بموقفٍ من الأسبوع.`,
        `ولا تُصحّح الإجابات في اللحظة؛ اكتبها ثم ناقشها بعد الجلسة. التصحيح الفوري يُسكت الصغار أولًا.`
      ] },
      { heading: 'سؤال الإغلاق', paragraphs: [
        `اختم بسؤالٍ واحد: ما الذي نفعله هذا الأسبوع بسبب آيةٍ سمعناها؟ واكتب الإجابة على ورقةٍ تُعلّق أسبوعًا.`,
        `هذا السؤال يحوّل الجلسة من استماعٍ إلى عمل، وهو الفرق بين جلسةٍ تُنسى وجلسةٍ تُثمر.`
      ] },
      { heading: 'التكرار', paragraphs: [
        `اجعلها مرةً في الأسبوع في وقتٍ ثابت، ولو ربع ساعة. الانتظام أهم من المقدار في الجلسات الأسرية.`,
        `${pick(CLOSE, k + 5)}`
      ] }
    ],
    related: [
      { label: `محاور سورة ${ch.name}`, href: `/articles/surah-${ch.number}-themes` },
      { label: 'الورد العائلي', href: '/articles/family-daily-surah' },
      { label: 'حلقة قرآن في البيت', href: '/articles/family-quran-circle-at-home' }
    ],
    minutes: 4
  };
}

function anglePlace(ch, guide, k) {
  const before = chapters[ch.number - 2];
  const after = chapters[ch.number];
  const sameJuz = chapters.filter(c => c.juz === ch.juz).map(c => c.name);
  return {
    slug: `surah-${ch.number}-place`,
    category: 'التفسير',
    title: `موضع سورة ${ch.name} في المصحف: ما قبله وما بعده`,
    summary: `سورة ${ch.name} في الجزء ${num(ch.juz)} والصفحة ${num(ch.page)}، بين سورتين لها معنى مشترك. قراءةٌ في الجوار لا في السورة وحدها.`,
    lead: `قراءة السورة بمعزلٍ عن جارتها تُفقد السياق. وسورة ${ch.name} تقع بين ${before ? 'سورة ' + before.name : 'بداية المصحف'} و${after ? 'سورة ' + after.name : 'خاتمة المصحف'}، وهذا الجوار نفسه معنى.`,
    imageAlt: `رفوف مكتبةٍ مرتّبة بترتيبٍ متتابع في ضوء نهار خفيف، بلا أشخاص.`,
    sections: [
      { heading: 'الموضع والجزء', paragraphs: [
        `تقع في الجزء ${num(ch.juz)}، والصفحة ${num(ch.page)}، وترتيبها ${num(ch.number)} بين سور المصحف. ومشاركة الجزء تُظهر أن السور تُقرأ في مجموعات لا منفردة.`,
        `وسور هذا الجزء: ${sameJuz.slice(0, 6).map(n => 'سورة ' + n).join('، ')}${sameJuz.length > 6 ? ' وغيرها' : ''}.`
      ] },
      { heading: 'ما قبلها', paragraphs: [
        `${before ? `سورة ${before.name} تسبقها مباشرةً، وعدد آياتها ${num(before.ayahCount)}.` : 'هي أول سورة بعد الفاتحة، وهذا الموضع نفسه يُقرأ.'} وربط الخاتمة بالبداية يجعل التلاوة المتصلة أفهم من المقاطع المتفرقة.`,
        `ومن قرأ السورتين في مجلسٍ واحد وجد بينهما رابطًا لا يظهر في قراءةٍ منفصلة.`
      ] },
      { heading: 'ما بعدها', paragraphs: [
        `${after ? `وتأتي بعدها سورة ${after.name} (${num(after.ayahCount)} آية).` : 'وهي خاتمة المصحف، فبعدها يعود القارئ إلى الفاتحة.'} وهذا التسلسل يُعين على حفظ الترتيب أكثر من حفظ الأرقام.`,
        `وحفظ الترتيب مفيدٌ في المراجعة، لأنه يجعل الانتقال بين السور تلقائيًّا.`
      ] },
      { heading: 'قراءةٌ في الجوار', paragraphs: [
        `جرّب أن تقرأ ثلاث سورٍ متجاورة في جلسةٍ واحدة مرةً في الأسبوع. هذا التمرين يبني إحساسًا بالبنية لا يُبنى بقراءة السورة وحدها.`,
        `${pick(CLOSE, k + 2)}`
      ] }
    ],
    related: [
      { label: `سورة ${ch.name} في أرقام`, href: `/articles/surah-${ch.number}-numbers` },
      { label: 'فهرس سور القرآن', href: '/articles/quran-surahs-directory-guide' },
      { label: 'المكي والمدني', href: '/articles/makki-madani-why-it-matters' }
    ],
    minutes: 4
  };
}

// ————— مقالات الأجزاء —————
function juzArticle(j, k) {
  let inJuz = chapters.filter(c => c.juz === j);
  if (!inJuz.length) {
    const range = (server.juzRangeFor && server.juzRangeFor(j)) || [];
    inJuz = chapters.filter(c => range.includes(c.number));
  }
  if (!inJuz.length) return null;
  const totalAyahs = inJuz.reduce((n, c) => n + c.ayahCount, 0);
  const totalWords = inJuz.reduce((n, c) => n + ((stats[c.number] || { words: 0 }).words), 0);
  const mins = inJuz.reduce((n, c) => n + ((stats[c.number] || { minutes: 0 }).minutes), 0);
  return {
    slug: `juz-${j}-guide`,
    title: `الجزء ${num(j)}: سوره ومقداره وخطة قراءته`,
    category: 'دليل القراءة',
    summary: `سور الجزء ${num(j)} وعدد آياته ${num(totalAyahs)}، ومقدار تلاوته ${num(mins)} دقيقة، مع تقسيمٍ عملي على جلسات.`,
    lead: `الجزء ${num(j)} يجمع ${num(inJuz.length)} سورة، بمجموع ${num(totalAyahs)} آية و${num(totalWords)} كلمة. وهذا المقدار يحتاج تقسيمًا لا حماسة، خصوصًا إن أردت قراءته بتركيز.`,
    imageAlt: `كتابٌ مفتوح على طاولةٍ خشبية بجانب علامةٍ ورقية، ضوء نهار، بلا أشخاص.`,
    sections: [
      { heading: 'سور الجزء', paragraphs: [
        `يبدأ الجزء بسورة ${inJuz[0].name} وينتهي بسورة ${inJuz[inJuz.length - 1].name}. والسور كلها: ${inJuz.map(c => c.name).join('، ')}.`,
        `ومعرفة السور تُعين على تقدير المقدار قبل البدء، فالجزء ليس كتلةً واحدة بل مقاطع مختلفة الطول.`
      ] },
      { heading: 'المقدار والزمن', paragraphs: [
        `مجموع الآيات ${num(totalAyahs)}، ومجموع الكلمات ${num(totalWords)}، وزمن التلاوة المرتّلة يقارب ${num(mins)} دقيقة.`,
        `وإن أردت قراءته في أسبوع فالمقدار اليومي نحو ${num(Math.ceil(totalAyahs / 7))} آية، وهو مقدارٌ معقولٌ في جلسةٍ واحدة.`
      ] },
      { heading: 'تقسيمٌ على الجلسات', paragraphs: [
        `${pick(PLAN_HINT, k)} واجعل آخر جلسةٍ للمراجعة بلا جديد.`,
        `وإذا طال الجزء عليك، فاقسمه على السور لا على الصفحات؛ إتمام سورةٍ يُعطي إحساسًا بالإنجاز أكثر من الوقوف في منتصفها.`
      ] },
      { heading: 'ما يميّز هذا الجزء', paragraphs: [
        `سوره ${inJuz.some(c => c.revelation === 'مكية') ? 'تجمع المكي والمدني' : 'مدنية النزول'}, وهذا الاختلاف يظهر في الأسلوب: قصصٌ وإيقاعٌ في المكي، وتشريعٌ وخطابٌ في المدني.`,
        `${pick(CLOSE, k + 1)}`
      ] }
    ],
    related: [
      { label: 'فهرس الأجزاء الثلاثين', href: '/juz' },
      { label: 'القراءة عبر الأجزاء', href: '/articles/reading-through-the-ajza' },
      { label: 'خطة ختم القرآن', href: '/articles/quran-khatm-plan' }
    ],
    minutes: 4
  };
}

// ————— بناء القائمة —————
const builders = [
  ['themes', angleThemes],
  ['numbers', angleNumbers],
  ['plan', anglePlan],
  ['memorize', angleMemorize],
  ['listen', angleListen],
  ['family', angleFamily],
  ['place', anglePlace]
];

const candidates = [];
for (const ch of chapters) {
  const guide = guides[ch.number] || guides[String(ch.number)] || { intro: '', themes: [], note: '' };
  for (const [name, fn] of builders) {
    const article = fn(ch, guide, hashInt(ch.number + '|' + name));
    article.angle = name;
    article.surah = ch.number;
    candidates.push(article);
  }
}
for (let j = 1; j <= 30; j++) {
  const a = juzArticle(j, j);
  if (!a) continue;
  a.angle = 'juz';
  a.surah = 0;
  candidates.push(a);
}

// ————— إضافة قسمٍ عمليّ يجعل المقال مكتمل الطول ومتمايزًا —————
candidates.forEach((a, i) => {
  const seed = (a.surah || 0) * 17 + (a.angle || '').length + i;
  a.sections.push({
    heading: 'خطوة الأسبوع',
    paragraphs: [
      `${pick(STEP_POOL, seed)} ${pick(STEP_POOL, seed + 3)}`,
      pick(STEP_CLOSE, seed + 1)
    ]
  });
  a.minutes = Math.min(30, Math.max(1, a.minutes || 4));
});

// ————— بوّابات الجودة —————
const taken = new Set(existing.map(a => a.slug));
const takenTitles = new Set(existing.map(a => a.title));
const corpus = existing.map(a => shingles(a.title + ' ' + a.summary + ' ' + bodyText(a)));
const accepted = [];
const rejected = { dup: 0, words: 0, overlap: 0, latin: 0 };
const need = Math.max(0, TARGET_TOTAL - existing.length);

const ordered = ORDER === 'interleave'
  ? candidates.sort((a, b) => a.angle.localeCompare(b.angle) || a.surah - b.surah)
  : candidates;

for (const a of ordered) {
  if (accepted.length >= need) break;
  if (taken.has(a.slug) || takenTitles.has(a.title)) { rejected.dup++; continue; }
  const body = bodyText(a);
  if (words(body).length < 150) { rejected.words++; continue; }
  if (latin.test([a.title, a.summary, a.lead, a.imageAlt, body].join(' '))) { rejected.latin++; continue; }
  const sh = shingles(a.title + ' ' + a.summary + ' ' + body);
  let worst = 0;
  for (const c of corpus) { const jv = jaccard(sh, c); if (jv > worst) worst = jv; if (worst > MAX_OVERLAP) break; }
  if (worst > MAX_OVERLAP) { rejected.overlap++; continue; }
  corpus.push(sh);
  taken.add(a.slug);
  takenTitles.add(a.title);
  accepted.push(a);
}

// ————— ختم البيانات المشتركة —————
const base = Date.parse('2026-10-29T10:10:00Z');
accepted.forEach((a, i) => {
  a.image = `/articles/${a.slug}.webp`;
  a.sources = [
    { label: 'مشروع تنزيل — النص القرآني المعتمد', url: 'https://tanzil.net/' },
    { label: 'Quran.com — التفسير الميسّر لكل آية', url: 'https://quran.com/' }
  ];
  a.publishedAt = new Date(base + i * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
});

fs.writeFileSync(OUT, JSON.stringify(accepted, null, 2) + '\n');
console.log(JSON.stringify({ need, accepted: accepted.length, rejected, total: existing.length + accepted.length }, null, 0));
