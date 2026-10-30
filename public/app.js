(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const arabicNumber = n => new Intl.NumberFormat('ar-EG').format(n);
  const storage = {
    get(key, fallback = null) { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch (_) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }
  };
  const normalize = s => String(s).normalize('NFKD')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF\u0640\u200B-\u200F\uFEFF]/g, '')
    .replace(/[ٱأإآ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).toLowerCase().trim();
  let toastTimer;
  function toast(message) {
    const el = $('#toast'); if (!el) return;
    el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }
  function showDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }
  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }
  const searchDialog = $('#search-dialog');
  $$('[data-open-search]').forEach(button => button.addEventListener('click', () => {
    showDialog(searchDialog); setTimeout(() => $('#global-search')?.focus(), 30);
  }));
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog); }));
  document.addEventListener('keydown', event => {
    const tag = document.activeElement?.tagName;
    if ((event.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(tag)) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault(); showDialog(searchDialog); setTimeout(() => $('#global-search')?.focus(), 30);
    }
  });
  const menuToggle = $('[data-menu-toggle]');
  const mobileNav = $('#mobile-nav');
  menuToggle?.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen)); mobileNav.hidden = isOpen;
    menuToggle.setAttribute('aria-label', isOpen ? 'فتح القائمة' : 'إغلاق القائمة');
  });
  mobileNav?.addEventListener('click', event => {
    if (event.target.closest('a')) { mobileNav.hidden = true; menuToggle.setAttribute('aria-expanded','false'); menuToggle.setAttribute('aria-label','فتح القائمة'); }
  });
  $$('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('sana-theme', dark ? 'dark' : 'light'); } catch (_) {}
    toast(dark ? 'تم تفعيل الوضع الليلي' : 'تم تفعيل الوضع الفاتح');
  }));

  // The directory is fully present in the server HTML; collapse is progressive enhancement.
  const directory = $('#surah-list');
  if (directory) {
    const cards = $$('[data-surah-card]', directory);
    const input = $('#surah-search'); const more = $('#show-all'); const empty = $('#surah-empty');
    let expanded = false, filter = 'all';
    const update = () => {
      const q = normalize(input.value).replace(/^سور[ةه]\s+/, '');
      const matched = cards.filter(card => (filter === 'all' || card.dataset.surahType === filter) && (!q || normalize(card.dataset.surahName).includes(q)));
      const showLimit = expanded || q ? matched.length : 12;
      const visible = new Set(matched.slice(0, showLimit));
      cards.forEach(card => { card.hidden = !visible.has(card); });
      empty.hidden = matched.length > 0;
      more.hidden = matched.length <= 12 || Boolean(q);
      more.textContent = expanded ? 'عرض عدد أقل ↑' : `عرض جميع السور (${arabicNumber(matched.length)}) ↓`;
    };
    input.addEventListener('input', update);
    more.addEventListener('click', () => { expanded = !expanded; update(); if (!expanded) $('#surahs').scrollIntoView({behavior:'smooth'}); });
    $$('[data-filter]').forEach(button => button.addEventListener('click', () => {
      filter = button.dataset.filter; expanded = false;
      $$('[data-filter]').forEach(b => { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
      update();
    }));
    update();
  }

  // Bookmarks and last reading position stay only on this device.
  const KEY = 'sana-bookmarks-v1';
  const LAST = 'sana-last-read-v1';
  function getSaved() { const data = storage.get(KEY, {}); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; }
  function refreshSavedIcons() {
    const saved = getSaved();
    $$('[data-bookmark-ayah]').forEach(button => {
      const row = button.closest('[data-ayah-row]'); const key = `${row.dataset.surah}:${row.dataset.ayah}`; const on = !!saved[key];
      button.setAttribute('aria-pressed', String(on)); button.setAttribute('title', on ? 'إزالة الحفظ' : 'حفظ الآية');
      button.setAttribute('aria-label', `${on ? 'إزالة حفظ' : 'حفظ'} الآية ${arabicNumber(Number(row.dataset.ayah))}`);
    });
    $$('[data-bookmark-dot]').forEach(dot => { dot.hidden = Object.keys(saved).length === 0; });
  }
  function updateContinue() {
    const last = storage.get(LAST);
    if (!last || !Number.isInteger(last.surah) || !Number.isInteger(last.ayah) || last.surah < 1 || last.surah > 114 || last.ayah < 1) return;
    $$('[data-continue]').forEach(link => {
      link.href = `/surah/${last.surah}#ayah-${last.ayah}`;
      const small = $('small', link); if (small && last.name) small.textContent = `${last.name} · الآية ${arabicNumber(last.ayah)}`;
    });
  }
  refreshSavedIcons(); updateContinue();
  document.addEventListener('click', async event => {
    const bookmark = event.target.closest('[data-bookmark-ayah]');
    if (bookmark) {
      const row = bookmark.closest('[data-ayah-row]'); const s = Number(row.dataset.surah), a = Number(row.dataset.ayah); const key = `${s}:${a}`; const saved = getSaved();
      if (saved[key]) { delete saved[key]; toast('أُزيلت الآية من المحفوظات'); }
      else { saved[key] = {surah:s, ayah:a, name:row.dataset.surahName, text:row.dataset.ayahText}; toast('حُفظت الآية في هذا المتصفح'); }
      if (!storage.set(KEY, saved)) toast('تعذّر الحفظ في هذا المتصفح');
      refreshSavedIcons();
    }
    const copyButton = event.target.closest('[data-copy-ayah]');
    if (copyButton) {
      const row = copyButton.closest('[data-ayah-row]');
      const text = `${row.dataset.ayahText} ﴿${arabicNumber(Number(row.dataset.ayah))}﴾\nسورة ${row.dataset.surahName}`;
      try { await copyText(text); toast('تم نسخ الآية'); } catch (_) { toast('تعذّر النسخ من المتصفح'); }
    }
    const shareButton = event.target.closest('[data-share-ayah]');
    if (shareButton) {
      const row = shareButton.closest('[data-ayah-row]');
      const url = `${location.origin}/surah/${row.dataset.surah}#ayah-${row.dataset.ayah}`;
      try {
        if (navigator.share) await navigator.share({title:`سورة ${row.dataset.surahName}، الآية ${arabicNumber(Number(row.dataset.ayah))}`,text:row.dataset.ayahText,url});
        else { await copyText(url); toast('تم نسخ رابط الآية'); }
      } catch (error) { if (error.name !== 'AbortError') toast('تعذّرت المشاركة في هذا المتصفح'); }
    }
  });
  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(area); area.select();
    const success = document.execCommand('copy'); area.remove(); if (!success) throw new Error('copy failed');
  }
  const rows = $$('[data-ayah-row]');
  if (rows.length) {
    let queued = false;
    const saveVisible = () => {
      queued = false;
      const cutoff = Math.max(120, innerHeight * .35);
      let chosen = rows[0];
      for (const row of rows) { if (row.getBoundingClientRect().top <= cutoff) chosen = row; else break; }
      storage.set(LAST, {surah:Number(chosen.dataset.surah),ayah:Number(chosen.dataset.ayah),name:chosen.dataset.surahName});
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(saveVisible); } };
    addEventListener('scroll', onScroll, {passive:true}); setTimeout(saveVisible, 500);
  }
  function renderBookmarks() {
    const container = $('#bookmarks-list'); if (!container) return;
    const saved = Object.values(getSaved()).filter(x => x && Number.isInteger(x.surah) && Number.isInteger(x.ayah) && typeof x.name === 'string' && typeof x.text === 'string');
    container.replaceChildren();
    if (!saved.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state';
      empty.innerHTML = '<span class="empty-ornament">✧</span><h2>لم تحفظ أي آية بعد</h2><p>عندما تجد آية تلامس قلبك، اضغط علامة الحفظ لتجدها هنا.</p><a href="/surah/18" class="button button-dark">ابدأ القراءة ←</a>';
      container.appendChild(empty); return;
    }
    const list = document.createElement('div'); list.className = 'bookmarks-list';
    saved.sort((a,b) => a.surah-b.surah || a.ayah-b.ayah).forEach(item => {
      const card = document.createElement('article'); card.className = 'saved-card';
      const head = document.createElement('div'); head.className = 'saved-card-head';
      const label = document.createElement('strong'); label.textContent = `سورة ${item.name} · الآية ${arabicNumber(item.ayah)}`;
      const actions = document.createElement('div'); actions.className = 'saved-card-actions';
      const open = document.createElement('a'); open.href = `/surah/${item.surah}#ayah-${item.ayah}`; open.textContent = 'فتح الآية ←';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'إزالة الحفظ';
      remove.addEventListener('click', () => { const all=getSaved(); delete all[`${item.surah}:${item.ayah}`]; storage.set(KEY, all); refreshSavedIcons(); renderBookmarks(); toast('أُزيلت الآية من المحفوظات'); });
      actions.append(open,remove); head.append(label,actions);
      const text = document.createElement('p'); text.lang = 'ar'; text.textContent = item.text;
      card.append(head,text); list.appendChild(card);
    });
    container.appendChild(list);
  }
  renderBookmarks();

  const tafsirDialog = $('#tafsir-dialog'); let tafsirRequest = 0;
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-tafsir-ayah]'); if (!button) return;
    const row = button.closest('[data-ayah-row]'); const id = ++tafsirRequest;
    $('#tafsir-reference').textContent = `سورة ${row.dataset.surahName} · الآية ${arabicNumber(Number(row.dataset.ayah))}`;
    $('#tafsir-content').textContent = 'جارٍ تحميل التفسير الميسّر...'; showDialog(tafsirDialog);
    try {
      const response = await fetch(`/api/tafsir/${row.dataset.surah}/${row.dataset.ayah}`);
      const data = await response.json(); if (!response.ok || !data.text) throw new Error(data.error || 'تعذّر تحميل التفسير.');
      if (id === tafsirRequest) $('#tafsir-content').textContent = data.text;
    } catch (_) { if (id === tafsirRequest) $('#tafsir-content').textContent = 'تعذّر تحميل التفسير. تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.'; }
  });
  let fontSize = Number(storage.get('sana-font-size', 29));
  if (!Number.isFinite(fontSize) || fontSize < 23 || fontSize > 43) fontSize = 29;
  document.documentElement.style.setProperty('--quran-size', `${fontSize}px`);
  $$('[data-font-change]').forEach(button => button.addEventListener('click', () => {
    fontSize = Math.max(23, Math.min(43, fontSize + Number(button.dataset.fontChange)));
    document.documentElement.style.setProperty('--quran-size', `${fontSize}px`); storage.set('sana-font-size', fontSize);
  }));

  // All audio streams are public source URLs; text remains available without a connection.
  const player = $('#audio-player'), audio = $('#audio-element'), progress = $('#player-progress');
  const reciters = {
    afs: {name:'مشاري العفاسي',base:'https://server8.mp3quran.net/afs/'},
    maher: {name:'ماهر المعيقلي',base:'https://server12.mp3quran.net/maher/'},
    basit: {name:'عبد الباسط عبد الصمد',base:'https://server7.mp3quran.net/basit/'}
  };
  let audioState = null;
  const pad3 = n => String(n).padStart(3, '0');
  function durationText(time) {
    if (!Number.isFinite(time)) return '٠:٠٠';
    const m=Math.floor(time/60), s=Math.floor(time%60); return `${arabicNumber(m)}:${String(s).padStart(2,'0').replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[Number(d)])}`;
  }
  function openAudio({surah, ayah = null, name, reciter='afs'}) {
    const info = reciters[reciter] || reciters.afs;
    const url = ayah ? `https://everyayah.com/data/Alafasy_128kbps/${pad3(surah)}${pad3(ayah)}.mp3` : `${info.base}${pad3(surah)}.mp3`;
    audioState = {surah,ayah,name,reciter}; player.hidden = false;
    $('#player-title').textContent = `سورة ${name}${ayah ? ` · الآية ${arabicNumber(ayah)}` : ''}`;
    $('#player-subtitle').textContent = ayah ? 'مشاري العفاسي · EveryAyah' : `${info.name} · MP3Quran`;
    progress.value = '0'; $('#player-current').textContent='٠:٠٠'; $('#player-duration').textContent='٠:٠٠';
    audio.src = url; player.classList.remove('is-paused');
    const promise = audio.play();
    if (promise && promise.catch) promise.catch(() => { player.classList.add('is-paused'); toast('تعذّر تشغيل التلاوة. تحقّق من الاتصال وحاول مجددًا.'); });
  }
  document.addEventListener('click', event => {
    const whole = event.target.closest('[data-play-surah]');
    if (whole) {
      const surah=Number(whole.dataset.playSurah); let name='الكهف';
      const row=$('[data-ayah-row]'); if (row && Number(row.dataset.surah)===surah) name=row.dataset.surahName;
      openAudio({surah,name,reciter:whole.dataset.reciter || 'afs'});
    }
    const ayahButton = event.target.closest('[data-play-ayah]');
    if (ayahButton) { const row=ayahButton.closest('[data-ayah-row]'); openAudio({surah:Number(row.dataset.surah),ayah:Number(row.dataset.ayah),name:row.dataset.surahName}); }
  });
  $('[data-player-toggle]')?.addEventListener('click', () => {
    if (audio.paused) { const p=audio.play(); if(p?.catch)p.catch(() => toast('تعذّر تشغيل التلاوة. تحقّق من الاتصال.')); }
    else audio.pause();
  });
  $('[data-player-close]')?.addEventListener('click', () => { audio.pause(); audio.removeAttribute('src'); audio.load(); player.hidden=true; audioState=null; });
  audio?.addEventListener('play', () => { player.classList.remove('is-paused'); $('[data-player-toggle]').setAttribute('aria-label','إيقاف التلاوة مؤقتًا'); });
  audio?.addEventListener('pause', () => { player.classList.add('is-paused'); $('[data-player-toggle]').setAttribute('aria-label','متابعة التلاوة'); });
  audio?.addEventListener('timeupdate', () => { progress.value = Number.isFinite(audio.duration) && audio.duration ? String(Math.round(audio.currentTime/audio.duration*1000)) : '0'; $('#player-current').textContent=durationText(audio.currentTime); });
  audio?.addEventListener('loadedmetadata', () => { $('#player-duration').textContent=durationText(audio.duration); });
  progress?.addEventListener('input', () => { if (Number.isFinite(audio.duration)) audio.currentTime=Number(progress.value)/1000*audio.duration; });
  audio?.addEventListener('ended', () => {
    if (audioState?.ayah) {
      const next = $(`[data-ayah-row][data-surah="${audioState.surah}"][data-ayah="${audioState.ayah+1}"]`);
      if (next) { openAudio({...audioState,ayah:audioState.ayah+1}); return; }
    }
    player.classList.add('is-paused');
  });
  audio?.addEventListener('error', () => { if (audioState && audio.currentSrc) toast('تعذّر تحميل التلاوة. تحقّق من الاتصال بالإنترنت.'); });
})();

// تسجيل عامل الخدمة: تسريع الزيارات المتكررة وصفحة بديلة عند انقطاع الاتصال.
// لا يعرض إشعارات ولا يحمّل أي سكربت من مصدر خارجي.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}

// تحميل سكربت الإعلان (إن فُعّل في data/ads.json) بعد الرسم الأول، ومرة واحدة لكل فتحة.
// لا يوجد هنا أي نوافذ منبثقة ولا عامل خدمة: لافتة داخل الصفحة فقط.
document.querySelectorAll('.ad-slot-body[data-ad-script]').forEach((slot) => {
  const src = slot.getAttribute('data-ad-script');
  if (!src || !/^https:\/\//.test(src)) return;
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.referrerPolicy = 'no-referrer-when-downgrade';
  slot.appendChild(s);
});

// شريط تقدّم القراءة في صفحات المقالات: يظهر فقط حين يكون العنصر موجودًا.
(() => {
  const bar = document.getElementById('reading-progress');
  if (!bar) return;
  const fill = bar.firstElementChild;
  const article = document.querySelector('.editorial-article');
  if (!fill || !article) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const rect = article.getBoundingClientRect();
    const total = Math.max(1, rect.height - window.innerHeight * 0.7);
    const passed = Math.min(total, Math.max(0, -rect.top + window.innerHeight * 0.2));
    fill.style.width = (passed / total * 100).toFixed(2) + '%';
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
})();
