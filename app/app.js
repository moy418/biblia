/* Lumbrera — versión web. Sin dependencias salvo Leaflet para el mapa. */
'use strict';

// ---------- Estado ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('biblia.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('biblia.' + k, JSON.stringify(v)); } catch {} }
};
let LANG = store.get('lang', (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en');
let C = null;                      // contenido del idioma actual
const bibleCache = {};             // `${lang}/${book}` -> capítulos
const P = {                        // progreso
  week: store.get('week', 1),
  days: store.get('days', {}),     // "semana-día": fecha
  done: store.get('done', []),     // semanas terminadas
  marks: store.get('marks', {}),   // "libro-cap-vers": 1
  dates: store.get('dates', [])    // días con lectura (yyyy-mm-dd)
};
const save = () => { for (const k of ['week', 'days', 'done', 'marks', 'dates']) store.set(k, P[k]); };
const L = (es, en) => LANG === 'es' ? es : en;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');

// ---------- Utilidades de datos ----------
const yearLabel = y => y < 0 ? `${-y} ${L('a. C.', 'BC')}` : `${y} ${L('d. C.', 'AD')}`;
const clock = s => s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const bookName = i => C.books[i]?.name ?? '';
const passageLabel = p => `${bookName(p[0])} ${p[1] === p[2] ? p[1] : `${p[1]}–${p[2]}`}`;
const covers = (p, b, c) => p[0] === b && p[1] <= c && c <= p[2];
const week = n => C.weeks[Math.min(Math.max(n, 1), C.weeks.length) - 1];
const byId = (arr, id) => arr.find(x => x.id === id);
function chapterList(w) { const out = []; for (const [b, a, z] of w.passages) for (let c = a; c <= z; c++) out.push([b, c]); return out; }
function weekDays(w) {
  const ch = chapterList(w), n = ch.length, days = [];
  for (let i = 0; i < 7; i++) days.push(ch.slice(Math.floor(i * n / 7), Math.floor((i + 1) * n / 7)));
  return days;
}
function describe(refs) {
  if (!refs.length) return L('Repaso', 'Review');
  const groups = [];
  for (const [b, c] of refs) { const g = groups[groups.length - 1]; if (g && g[0] === b && g[2] === c - 1) g[2] = c; else groups.push([b, c, c]); }
  return groups.map(passageLabel).join('; ');
}
const eraIndex = w => Math.max(0, C.eras.findIndex(e => w.id >= e.first && w.id <= e.last));
const isDayDone = (w, d) => !!P.days[`${w}-${d}`];
function nextDay(w) { for (let d = 0; d < 7; d++) if (!isDayDone(w, d)) return d; return 6; }
function streak() {
  const set = new Set(P.dates); let n = 0; const d = new Date();
  if (!set.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function markDay(w, d, on = true) {
  const k = `${w}-${d}`;
  if (on) { P.days[k] = Date.now(); const t = new Date().toISOString().slice(0, 10); if (!P.dates.includes(t)) P.dates.push(t); }
  else delete P.days[k];
  const all = [0, 1, 2, 3, 4, 5, 6].every(i => isDayDone(w, i));
  P.done = P.done.filter(x => x !== w); if (all) P.done.push(w);
  save();
}
const artFor = w => C.art.filter(a => a.weeks.includes(w.id));
const artIn = (b, c) => C.art.filter(a => a.passages.some(p => covers(p, b, c)));
const scenesFor = w => C.films.flatMap(f => f.fragments.filter(x => x.weeks.includes(w.id)).map(x => ({ film: f, frag: x })));
const scenesIn = (b, c) => C.films.flatMap(f => f.fragments.filter(x => x.start > 0 && x.passages.some(p => covers(p, b, c))).map(x => ({ film: f, frag: x })));
const parallelsFor = w => C.parallels.filter(p => p.weeks.includes(w.id));
const parallelsIn = (b, c) => C.parallels.filter(p => p.passages.some(q => covers(q, b, c)));
const artImg = (a, big) => (big ? a.img1280 : a.img500) || `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(a.file)}?width=${big ? 1280 : 500}`;
const sceneThumb = id => `img/scene-${id}.jpg`;
const sceneSrc = (film, frag) => frag.clip ? `clips/scene-${frag.id}.mp4` : film.url;

// ---------- Red ----------
async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); }
async function loadContent() { C = await json(`data/content_${LANG}.json`); document.documentElement.lang = LANG; }
async function chapter(b, c) {
  const k = `${LANG}/${b}`;
  if (!bibleCache[k]) bibleCache[k] = await json(`data/bible/${LANG}/${b}.json`);
  return bibleCache[k][c - 1] || [];
}
const wikiMem = {};
async function wiki(q, lang = LANG) {
  const k = `${lang}|${q}`; if (wikiMem[k]) return wikiMem[k];
  const cached = store.get('wiki.' + k, null); if (cached) return (wikiMem[k] = cached);
  const u = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: q, gsrlimit: '1', prop: 'extracts|pageimages|info', exintro: '1', explaintext: '1', exsentences: '5', piprop: 'thumbnail', pithumbsize: '960', inprop: 'url' });
  try {
    const r = await json(u); const p = r.query && Object.values(r.query.pages)[0];
    if (!p) return null;
    const v = { title: p.title, text: p.extract || '', img: p.thumbnail?.source || null, url: p.fullurl };
    store.set('wiki.' + k, v); return (wikiMem[k] = v);
  } catch { return null; }
}
async function heroImage(title) {
  const k = 'hero.' + title; const c = store.get(k, null); if (c) return c;
  const u = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', origin: '*', titles: title, redirects: '1', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '1280' });
  try { const r = await json(u); const p = Object.values(r.query.pages)[0]; const s = p?.thumbnail?.source; if (s) store.set(k, s); return s; } catch { return null; }
}

// ---------- Interfaz base ----------
const ICONS = {
  hoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/></svg>',
  atlas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
  historia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  fuentes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M8 7h8M8 11h6"/></svg>',
  progreso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6a6 6 0 1 0 6 6"/><circle cx="12" cy="12" r="2"/></svg>'
};
function renderTabs(active) {
  const tabs = [['hoy', L('Hoy', 'Today')], ['atlas', 'Atlas'], ['historia', L('Historia', 'History')], ['fuentes', L('Fuentes', 'Sources')], ['progreso', L('Progreso', 'Progress')]];
  $('#tabs').innerHTML = tabs.map(([k, t]) => `<a href="#/${k}" class="${k === active ? 'on' : ''}" aria-current="${k === active ? 'page' : 'false'}">${ICONS[k]}<span>${t}</span></a>`).join('');
}
function setTitle(t, back) { $('#title').textContent = t; $('#back').hidden = !back; document.title = t === 'Lumbrera' ? L('Lumbrera — Biblia Reina-Valera 1909', 'Lumbrera — chronological Bible') : `${t} · Lumbrera`; }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }

// Hoja inferior
const sheet = $('#sheet');
function openSheet(html, after) {
  $('.sheet-body', sheet).innerHTML = html; sheet.hidden = false; document.body.style.overflow = 'hidden';
  $('.sheet-panel', sheet).scrollTop = 0; after && after($('.sheet-body', sheet));
}
function closeSheet() { const v = $('video', sheet); v && v.pause(); sheet.hidden = true; document.body.style.overflow = ''; }
$('.sheet-backdrop', sheet).onclick = closeSheet; $('.sheet-close', sheet).onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#zoom').hidden) closeZoom(); else closeSheet(); } });

// ---------- Visor con zoom ----------
const zoomEl = $('#zoom'), zimg = $('img', zoomEl);
let Z = { s: 1, x: 0, y: 0, min: 1 };
function applyZ() { zimg.style.transform = `translate(${Z.x}px,${Z.y}px) scale(${Z.s})`; }
function fitZ() {
  const W = zoomEl.clientWidth, H = zoomEl.clientHeight, iw = zimg.naturalWidth || 1, ih = zimg.naturalHeight || 1;
  Z.min = Math.min(W / iw, H / ih); Z.s = Z.min; Z.x = (W - iw * Z.s) / 2; Z.y = (H - ih * Z.s) / 2;
  zimg.style.left = '0'; zimg.style.top = '0'; applyZ();
}
function openZoom(src, cap) {
  zimg.src = src; $('.zoom-cap', zoomEl).innerHTML = cap + `<div style="opacity:.7;font-size:12px;margin-top:2px">${L('Pellizca o toca dos veces para ampliar · puedes girar el teléfono', 'Pinch or double-tap to zoom · you can rotate your phone')}</div>`;
  zoomEl.hidden = false; zimg.onload = fitZ; if (zimg.complete) fitZ();
}
function closeZoom() { zoomEl.hidden = true; zimg.src = ''; }
$('.zoom-close', zoomEl).onclick = closeZoom;
window.addEventListener('resize', () => { if (!zoomEl.hidden) fitZ(); });
(() => {
  const pts = new Map(); let start = null, lastTap = 0;
  const zoomAt = (cx, cy, ns) => { ns = Math.min(Math.max(ns, Z.min), Z.min * 10); Z.x = cx - (cx - Z.x) * ns / Z.s; Z.y = cy - (cy - Z.y) * ns / Z.s; Z.s = ns; applyZ(); };
  zoomEl.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    zoomEl.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = Date.now(); if (pts.size === 1 && now - lastTap < 300) { Z.s > Z.min * 1.05 ? fitZ() : zoomAt(e.clientX, e.clientY, Z.min * 3); lastTap = 0; } else lastTap = now;
    start = snap();
  });
  zoomEl.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); const s = snap();
    if (!start) return;
    if (pts.size === 2 && start.d) { const ns = start.s * s.d / start.d; Z.s = start.s; Z.x = start.x; Z.y = start.y; zoomAt(start.cx, start.cy, ns); Z.x += s.cx - start.cx; Z.y += s.cy - start.cy; applyZ(); }
    else if (pts.size === 1 && Z.s > Z.min * 1.01) { Z.x = start.x + s.cx - start.cx; Z.y = start.y + s.cy - start.cy; applyZ(); }
  });
  const up = e => { pts.delete(e.pointerId); start = pts.size ? snap() : null; if (Z.s < Z.min * 1.01) fitZ(); };
  zoomEl.addEventListener('pointerup', up); zoomEl.addEventListener('pointercancel', up);
  zoomEl.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Z.s * (e.deltaY < 0 ? 1.15 : 0.87)); }, { passive: false });
  function snap() { const a = [...pts.values()]; const cx = a.reduce((s, p) => s + p.x, 0) / a.length, cy = a.reduce((s, p) => s + p.y, 0) / a.length; const d = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0; return { cx, cy, d, s: Z.s, x: Z.x, y: Z.y }; }
})();

// ---------- Componentes ----------
const artTile = a => h`<button class="tile" data-art="${a.id}"><div class="img"><img loading="lazy" src="${esc(artImg(a))}" alt=""></div><div class="t">${esc(a.title)}</div><div class="s">${esc(a.artist)} · ${esc(a.year)}</div></button>`;
const sceneTile = ({ film, frag }) => h`<button class="tile" data-scene="${frag.id}"><div class="img"><img loading="lazy" src="${sceneThumb(frag.id)}" alt="" onerror="this.style.display='none'"><div class="play"><span>▶</span></div><span class="badge">${frag.start > 0 ? `${clock(frag.start)} · ${Math.round((frag.end - frag.start) / 60)} min` : L('Película', 'Film')}</span></div><div class="t">${esc(frag.title)}</div><div class="s">${esc(film.title)} (${film.year})</div></button>`;
const weekRows = ws => `<div class="list">${ws.map(n => { const w = week(n); return `<a href="#/hoy" data-week="${n}"><b style="min-width:28px">${n}</b><span><div>${esc(w.reading)}</div><div class="small muted">${esc(w.era)}</div></span><span class="chev">›</span></a>`; }).join('')}</div>`;
function bindCommon(root) {
  root.querySelectorAll('[data-art]').forEach(b => b.onclick = () => showArt(byId(C.art, b.dataset.art)));
  root.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => { const s = C.films.flatMap(f => f.fragments.map(x => ({ film: f, frag: x }))).find(s => s.frag.id === b.dataset.scene); showScene(s); });
  root.querySelectorAll('[data-week]').forEach(a => a.onclick = () => { P.week = +a.dataset.week; save(); closeSheet(); });
  root.querySelectorAll('[data-god]').forEach(b => b.onclick = () => showGod(byId(C.gods, b.dataset.god)));
  root.querySelectorAll('[data-extra]').forEach(b => b.onclick = () => showExtra(byId(C.extras, b.dataset.extra)));
  root.querySelectorAll('[data-parallel]').forEach(b => b.onclick = () => showParallel(byId(C.parallels, b.dataset.parallel)));
  root.querySelectorAll('[data-place]').forEach(b => b.onclick = () => showPlace(byId(C.places, b.dataset.place)));
  root.querySelectorAll('[data-read]').forEach(b => b.onclick = () => { closeSheet(); location.hash = `#/leer/${b.dataset.read}`; });
}

// ---------- Hojas de detalle ----------
function showArt(a) {
  openSheet(h`<div class="art-hero"><img src="${esc(artImg(a, true))}" alt="${esc(a.title)}"></div>
    <h2 style="margin-top:14px">${esc(a.title)}</h2><p class="muted">${esc(a.artist)} · ${esc(a.year)}</p><p>${esc(a.note)}</p>
    <div class="section-title">${L('Pasaje que ilustra', 'Passage it illustrates')}</div>
    <div class="list">${a.passages.map(p => `<button data-read="${p[0]}/${p[1]}">📖 ${esc(passageLabel(p))}<span class="chev">›</span></button>`).join('')}</div>
    ${a.weeks.length ? `<div class="section-title">${L('En tu plan', 'In your plan')}</div>${weekRows(a.weeks)}` : ''}
    <p class="small muted">${L('Obra de dominio público. Imagen de Wikimedia Commons', 'Public-domain work. Image from Wikimedia Commons')}${a.credit ? ' · ' + esc(a.credit) : ''}. <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(a.article.replace(/ /g, '_'))}" target="_blank" rel="noopener">Wikipedia ↗</a></p>`,
    el => { bindCommon(el); $('.art-hero', el).onclick = () => openZoom(artImg(a, true), `<b>${esc(a.title)}</b><br>${esc(a.artist)} · ${esc(a.year)}`); });
}
function showScene(s) {
  const { film, frag } = s, whole = frag.start === 0, local = !!frag.clip;
  const src = sceneSrc(film, frag) + (whole || local ? '' : `#t=${frag.start},${frag.end}`);
  const gods = frag.gods.map(id => byId(C.gods, id)).filter(Boolean), xs = frag.extras.map(id => byId(C.extras, id)).filter(Boolean);
  openSheet(h`<video controls playsinline preload="metadata" poster="${sceneThumb(frag.id)}" src="${esc(src)}"></video>
    <div id="endbox" class="card" hidden style="margin-top:10px;text-align:center"><b>${L('Fin de la escena', 'End of the scene')}</b><div class="row" style="justify-content:center;margin-top:10px"><button class="btn secondary" id="replay">${L('Repetir', 'Replay')}</button>${local ? '' : `<button class="btn" id="cont">${L('Seguir viendo', 'Keep watching')}</button>`}</div></div>
    <h2 style="margin-top:14px">${esc(frag.title)}</h2>
    <p class="muted">${esc(film.title)} (${film.year}) · ${esc(film.director)}${whole ? '' : ` · ${clock(frag.start)}–${clock(frag.end)}`}</p>
    <p>${esc(frag.note)}</p>
    ${frag.passages.length ? `<div class="section-title">${L('Compáralo con la Biblia', 'Compare it with the Bible')}</div><div class="list">${frag.passages.map(p => `<button data-read="${p[0]}/${p[1]}">📖 ${esc(passageLabel(p))}<span class="chev">›</span></button>`).join('')}</div>` : ''}
    ${gods.length || xs.length ? `<div class="section-title">${L('Relacionado', 'Related')}</div><div class="list">${gods.map(g => `<button data-god="${g.id}">🔥 ${esc(g.name)}<span class="chev">›</span></button>`).join('')}${xs.map(x => `<button data-extra="${x.id}">📜 ${esc(x.name)}<span class="chev">›</span></button>`).join('')}</div>` : ''}
    <div class="section-title">${L('Sobre la película', 'About the film')}</div><div class="card"><p>${esc(film.note)}</p><a href="${esc(film.page)}" target="_blank" rel="noopener">Internet Archive ↗</a></div>
    <p class="small muted">${L('Película muda de dominio público. Es una interpretación artística: puede añadir o cambiar detalles del texto bíblico.', 'A public-domain silent film. It is an artistic interpretation and may add to or change details of the biblical text.')}</p>`,
    el => {
      bindCommon(el);
      const v = $('video', el), box = $('#endbox', el); let limit = !whole && !local;
      v.addEventListener('loadedmetadata', () => { if (!whole && !local && v.currentTime < frag.start - 1) v.currentTime = frag.start; });
      v.addEventListener('timeupdate', () => { if (limit && v.currentTime >= frag.end) { v.pause(); box.hidden = false; } });
      v.addEventListener('ended', () => { box.hidden = false; });
      $('#replay', el).onclick = () => { box.hidden = true; v.currentTime = local ? 0 : frag.start; v.play(); };
      const c = $('#cont', el); if (c) c.onclick = () => { box.hidden = true; limit = false; v.play(); };
      v.play().catch(() => {});
    });
}
async function wikiCard(el, q, lang) {
  const w = await wiki(q, lang); if (!w || !el.isConnected) return;
  el.innerHTML = h`<div class="card wiki">${w.img ? `<img loading="lazy" src="${esc(w.img)}" alt="">` : ''}<h3>${esc(w.title)}</h3><p class="small">${esc(w.text)}</p><a href="${esc(w.url)}" target="_blank" rel="noopener">${L('Leer en Wikipedia', 'Read on Wikipedia')} ↗</a></div>`;
}
function showGod(g) {
  const ws = C.weeks.filter(w => w.godKeys.includes(g.id)).map(w => w.id);
  const sc = C.films.flatMap(f => f.fragments.filter(x => x.gods.includes(g.id)).map(x => ({ film: f, frag: x })));
  openSheet(h`<h2>${esc(g.name)}</h2><p class="muted">${esc(g.people)} · ${esc(g.region)}</p>
    <div class="card"><h3>${L('Qué era este dios falso', 'What this false god was')}</h3><p>${esc(g.what)}</p></div>
    <div class="card"><h3>${L('En la Biblia', 'In the Bible')}</h3><p>${esc(g.bible)}</p></div>
    <div class="card"><h3>${L('Hoy', 'Today')}</h3><p>${esc(g.today)}</p></div>
    ${sc.length ? `<div class="section-title">${L('En el cine', 'On film')}</div><div class="rail">${sc.map(sceneTile).join('')}</div>` : ''}
    ${ws.length ? `<div class="section-title">${L('Aparece en tu plan', 'Appears in your plan')}</div>${weekRows(ws)}` : ''}
    <div id="gw"></div>`, el => { bindCommon(el); wikiCard($('#gw', el), g.wiki); });
}
function showExtra(x) {
  const ev = C.parallels.filter(p => p.extras.includes(x.id));
  openSheet(h`<h2>${esc(x.name)}</h2><p class="muted">${esc(x.catName)} · ${esc(x.date)}</p>
    <div class="card"><h3>${L('Qué es', 'What it is')}</h3><p>${esc(x.what)}</p></div>
    <div class="card"><h3>${L('Relación con tu lectura', 'How it relates to your reading')}</h3><p>${esc(x.rel)}</p></div>
    ${x.canon ? `<div class="card"><h3>${L('¿Por qué no está en tu Biblia?', 'Why isn’t it in your Bible?')}</h3><p>${esc(x.canon)}</p></div>` : ''}
    ${ev.length ? `<div class="section-title">${L('Cuenta los mismos eventos que', 'Tells the same events as')}</div><div class="list">${ev.map(p => `<button data-parallel="${p.id}"><span><b>${esc(p.title)}</b><div class="small muted">${p.passages.map(passageLabel).join(' · ')}</div></span><span class="chev">›</span></button>`).join('')}</div>` : ''}
    ${x.weeks.length ? `<div class="section-title">${L('Léelo junto a', 'Read it alongside')}</div>${weekRows(x.weeks)}` : ''}
    <div id="xw"></div>`, el => { bindCommon(el); wikiCard($('#xw', el), x.wiki); });
}
function showParallel(p) {
  const xs = p.extras.map(id => byId(C.extras, id)).filter(Boolean);
  openSheet(h`<h2>${esc(p.title)}</h2><p>${esc(p.note)}</p>
    <div class="section-title">${L('En la Biblia', 'In the Bible')}</div>
    <div class="list">${p.passages.map(q => `<button data-read="${q[0]}/${q[1]}">📖 ${esc(passageLabel(q))}<span class="chev">›</span></button>`).join('')}</div>
    <p class="small muted">${L('Lee cada relato y compara qué detalles añade u omite cada autor.', 'Read each account and compare what each author adds or leaves out.')}</p>
    ${xs.length ? `<div class="section-title">${L('En otros escritos', 'In other writings')}</div><div class="list">${xs.map(x => `<button data-extra="${x.id}">📜 ${esc(x.name)}<span class="chev">›</span></button>`).join('')}</div>` : ''}
    ${p.weeks.length ? `<div class="section-title">${L('En tu plan', 'In your plan')}</div>${weekRows(p.weeks)}` : ''}`, bindCommon);
}
function showPlace(pl) {
  const ws = C.weeks.filter(w => w.places.includes(pl.id) || w.route.includes(pl.id)).map(w => w.id);
  openSheet(h`<h2>${esc(pl.name)}</h2><p class="muted">${L('Hoy', 'Today')}: ${esc(pl.today)}</p><div id="pw"><p class="muted">…</p></div>
    ${ws.length ? `<div class="section-title">${L('Aparece en tu plan', 'Appears in your plan')}</div>${weekRows(ws)}` : ''}
    <a class="btn secondary block" target="_blank" rel="noopener" href="https://maps.apple.com/?ll=${pl.lat},${pl.lon}&z=10&t=k">${L('Abrir en Mapas', 'Open in Maps')} ↗</a>`,
    el => { bindCommon(el); wikiCard($('#pw', el), pl.wiki); });
}
function showTreeNode(n, parent) {
  openSheet(h`<h2>${esc(n.name)}</h2>
    <div class="list">${n.tag ? `<div><span class="muted">${L('Hoy / papel', 'Today / role')}</span><span style="margin-left:auto">${esc(n.tag)}</span></div>` : ''}${parent ? `<div><span class="muted">${L('Desciende de', 'Descends from')}</span><span style="margin-left:auto">${esc(parent.name)}</span></div>` : ''}${n.promise ? `<div style="color:var(--accent)">★ ${L('Parte de la línea de la promesa, de Adán a Jesús', 'Part of the line of the promise, from Adam to Jesus')}</div>` : ''}</div>
    ${n.note ? `<div class="card"><p>${esc(n.note)}</p></div>` : ''}
    ${n.children ? `<div class="section-title">${L('Descendientes', 'Descendants')}</div><div class="list">${n.children.map(k => `<div><span><b>${esc(k.name)}</b>${k.tag ? `<div class="small muted">${esc(k.tag)}</div>` : ''}</span></div>`).join('')}</div>` : ''}
    ${n.weeks.length ? `<div class="section-title">${L('Léelo en tu plan', 'Read it in your plan')}</div>${weekRows(n.weeks)}` : ''}`, bindCommon);
}

// ---------- Hoy ----------
async function viewHoy(el) {
  setTitle('Lumbrera', false);
  const w = week(P.week), ei = eraIndex(w), days = weekDays(w), nd = nextDay(w.id), doneCount = days.filter((_, i) => isDayDone(w.id, i)).length;
  const places = w.places.map(id => byId(C.places, id)).filter(Boolean);
  const gods = w.godKeys.map(id => byId(C.gods, id)).filter(Boolean);
  const extras = w.extras.map(id => byId(C.extras, id)).filter(Boolean);
  const arts = artFor(w), scenes = scenesFor(w), pars = parallelsFor(w);
  el.innerHTML = h`
  <section class="hero" aria-label="${L('Semana', 'Week')} ${w.id}">
    <div class="nav"><button id="prevW" aria-label="${L('Semana anterior', 'Previous week')}">‹</button><button id="nextW" aria-label="${L('Semana siguiente', 'Next week')}">›</button></div>
    <span class="era">${esc(C.eras[ei]?.name || w.era)}</span>
    <h2>${esc(w.reading)}</h2>
    <div class="meta">${L('Semana', 'Week')} ${w.id} ${L('de', 'of')} 52 · ${w.chapters} ${L('capítulos', 'chapters')} · ${yearLabel(w.year)}</div>
  </section>
  <div class="card">
    <div class="row"><h3 style="margin:0">${L('Lectura de hoy', 'Today’s reading')}</h3><span class="muted small" style="margin-left:auto">${doneCount}/7 · 🔥 ${streak()}</span></div>
    <div class="days">${days.map((d, i) => `<button class="day ${isDayDone(w.id, i) ? 'done' : ''} ${i === nd && !isDayDone(w.id, i) ? 'today' : ''}" data-day="${i}" aria-label="${L('Día', 'Day')} ${i + 1}: ${esc(describe(d))}">${isDayDone(w.id, i) ? '✓' : i + 1}</button>`).join('')}</div>
    <p class="muted small">${L('Día', 'Day')} ${nd + 1}: ${esc(describe(days[nd]))}</p>
    <a class="btn block" href="#/leer/w/${w.id}/${nd}">📖 ${doneCount === 7 ? L('Repasar', 'Review') : L('Continuar lectura', 'Continue reading')}</a>
  </div>
  ${w.summary ? `<div class="card"><h3>${L('Para entender esta semana', 'To understand this week')}</h3><p>${esc(w.summary)}</p></div>` : ''}
  ${arts.length ? `<div class="section-title">🎨 ${L('El arte de tu lectura', 'Art for your reading')}</div><div class="rail">${arts.map(artTile).join('')}</div>` : ''}
  ${scenes.length ? `<div class="section-title">🎬 ${L('En el cine', 'On film')}</div><div class="rail">${scenes.map(sceneTile).join('')}</div>` : ''}
  ${places.length ? `<div class="section-title">📍 ${L('Regiones de hoy', 'Today’s regions')}</div><div class="card tight"><div id="wmap" style="height:240px"></div></div><div class="card"><p>${esc(w.region)}</p><div class="chips">${places.map(p => `<button class="chip" data-place="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
  ${pars.length ? `<div class="section-title">🔀 ${L('Contado en varios libros', 'Told in several books')}</div><div class="list">${pars.map(p => `<button data-parallel="${p.id}"><span><b>${esc(p.title)}</b><div class="small muted">${p.passages.map(passageLabel).join(' · ')}</div></span><span class="chev">›</span></button>`).join('')}</div>` : ''}
  <div class="section-title">👪 ${L('Familia', 'Family')}</div><div class="card"><p>${esc(w.family)}</p><a href="#/historia/familia">${L('Ver árbol genealógico', 'See family tree')} ›</a></div>
  ${gods.length || w.gods ? `<div class="section-title">🔥 ${L('dioses falsos', 'false gods')}</div><div class="card"><p>${esc(w.gods)}</p>${gods.length ? `<div class="chips">${gods.map(g => `<button class="chip" data-god="${g.id}">${esc(g.name.split(' (')[0])}</button>`).join('')}</div>` : ''}</div>` : ''}
  ${extras.length ? `<div class="section-title">📜 ${L('Otros escritos', 'Other writings')}</div><div class="list">${extras.map(x => `<button data-extra="${x.id}"><span><b>${esc(x.name)}</b><div class="small muted">${esc(x.catName)} · ${esc(x.date)}</div></span><span class="chev">›</span></button>`).join('')}</div>` : ''}
  ${w.note ? `<div class="card"><p>${esc(w.note)}</p></div>` : ''}`;
  bindCommon(el);
  $('#prevW').onclick = () => { if (P.week > 1) { P.week--; save(); render(); } };
  $('#nextW').onclick = () => { if (P.week < 52) { P.week++; save(); render(); } };
  el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { location.hash = `#/leer/w/${w.id}/${b.dataset.day}`; });
  if (w.media?.[0]) heroImage(w.media[0]).then(src => { if (src && $('.hero')) { const i = new Image(); i.className = 'bg'; i.alt = ''; i.src = src; i.onload = () => $('.hero')?.prepend(i); } });
  if (places.length) whenLeaflet(() => {
    const m = L_map('wmap', { zoomControl: false, attributionControl: true, dragging: !matchMedia('(pointer:coarse)').matches, scrollWheelZoom: false });
    const pts = places.map(p => [p.lat, p.lon]);
    places.forEach(p => window.L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#1f3a8a', fillOpacity: 1 }).addTo(m).bindTooltip(p.name, { permanent: places.length <= 5, direction: 'top' }).on('click', () => showPlace(p)));
    const route = w.route.map(id => byId(C.places, id)).filter(Boolean).map(p => [p.lat, p.lon]);
    if (route.length > 1) window.L.polyline(route, { color: '#e8590c', weight: 4, dashArray: '8 6' }).addTo(m);
    m.fitBounds(window.L.latLngBounds(pts.concat(route)).pad(0.4), { maxZoom: 7 });
  });
}
function whenLeaflet(fn) { if (window.L && window.L.map) fn(); else setTimeout(() => whenLeaflet(fn), 60); }
function L_map(id, opts) {
  const m = window.L.map(id, opts);
  window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' }).addTo(m);
  window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, opacity: 0.85 }).addTo(m);
  return m;
}

// ---------- Lector ----------
async function viewReader(el, parts) {
  let refs, title, w = null, day = null;
  if (parts[0] === 'w') { w = week(+parts[1]); day = +parts[2]; refs = weekDays(w)[day]; title = `${L('Día', 'Day')} ${day + 1} · ${L('Semana', 'Week')} ${w.id}`; if (!refs.length) refs = chapterList(w).slice(-1); }
  else { const b = +parts[0], c = +parts[1]; refs = [[b, c]]; title = `${bookName(b)} ${c}`; }
  setTitle(title, true);
  el.innerHTML = `<p class="muted">${L('Cargando…', 'Loading…')}</p>`;
  const texts = await Promise.all(refs.map(([b, c]) => chapter(b, c)));
  const gl = C.glossary.map(g => g.term).filter(t => t.length > 2).sort((a, b) => b.length - a.length);
  const glRe = gl.length ? new RegExp(`(^|[^\\p{L}])(${gl.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=[^\\p{L}]|$)`, 'giu') : null;
  const verseHTML = (t) => { let s = esc(t); if (glRe) s = s.replace(glRe, (m, a, term) => `${a}<span class="gl" data-gl="${esc(term.toLowerCase())}">${term}</span>`); return s; };
  let html = `<div class="reader">`;
  refs.forEach(([b, c], i) => {
    html += `<h2>${esc(bookName(b))} ${c}</h2>`;
    for (const p of parallelsIn(b, c)) {
      const others = p.passages.filter(q => !covers(q, b, c)).map(passageLabel);
      html += `<button class="banner" data-parallel="${p.id}"><span style="font-size:20px">🔀</span><span><b>${L('Mismo evento', 'Same event')}: ${esc(p.title)}</b>${others.length ? `${L('También en', 'Also in')} ${esc(others.join(', '))}` : ''}${p.extras.length ? ` · ${L('y en', 'and in')} ${p.extras.length} ${L(p.extras.length === 1 ? 'escrito antiguo' : 'escritos antiguos', p.extras.length === 1 ? 'ancient writing' : 'ancient writings')}` : ''}</span></button>`;
    }
    const arts = artIn(b, c), sc = scenesIn(b, c);
    if (arts.length || sc.length) html += `<div class="strip">${arts.map(a => `<button data-art="${a.id}"><img loading="lazy" src="${esc(artImg(a))}" alt=""><span><div class="t">${esc(a.title)}</div><div class="s">${esc(a.artist)}</div></span></button>`).join('')}${sc.map(s => `<button data-scene="${s.frag.id}"><img loading="lazy" src="${sceneThumb(s.frag.id)}" alt=""><span><div class="t">▶ ${esc(s.frag.title)}</div><div class="s">${esc(s.film.title)} (${s.film.year})</div></span></button>`).join('')}</div>`;
    html += '<p>' + texts[i].map((t, v) => `<span class="v ${P.marks[`${b}-${c}-${v + 1}`] ? 'sel' : ''}" data-v="${b}-${c}-${v + 1}"><sup>${v + 1}</sup>${verseHTML(t)}</span> `).join('') + '</p>';
  });
  html += `</div><p class="small muted">${esc(C.bibleName)} · ${L('dominio público', 'public domain')}</p>`;
  if (w) {
    const done = isDayDone(w.id, day);
    html += `<button class="btn block" id="markDay" style="margin-top:16px">${done ? '✓ ' + L('Leído', 'Read') : L('Marcar como leído', 'Mark as read')}</button>
      <div class="reader-nav">${day > 0 ? `<a class="btn secondary" href="#/leer/w/${w.id}/${day - 1}">‹ ${L('Día', 'Day')} ${day}</a>` : '<span></span>'}${day < 6 ? `<a class="btn secondary" href="#/leer/w/${w.id}/${day + 1}">${L('Día', 'Day')} ${day + 2} ›</a>` : '<span></span>'}</div>`;
  } else {
    const [[b, c]] = refs, n = C.books[b].chapters;
    html += `<div class="reader-nav">${c > 1 ? `<a class="btn secondary" href="#/leer/${b}/${c - 1}">‹ ${c - 1}</a>` : '<span></span>'}${c < n ? `<a class="btn secondary" href="#/leer/${b}/${c + 1}">${c + 1} ›</a>` : '<span></span>'}</div>`;
  }
  el.innerHTML = html;
  bindCommon(el);
  el.querySelectorAll('.gl').forEach(s => s.onclick = e => {
    e.stopPropagation(); const g = C.glossary.find(x => x.term.toLowerCase() === s.dataset.gl);
    if (g) openSheet(`<h2>${esc(g.term)}</h2><p>${esc(g.definition)}</p><p class="small muted">${L('Glosario de la Reina-Valera 1909', 'Glossary')}</p>`);
  });
  el.querySelectorAll('.v').forEach(s => s.onclick = () => verseActions(s));
  const mb = $('#markDay'); if (mb) mb.onclick = () => {
    const was = isDayDone(w.id, day); markDay(w.id, day, !was);
    if (!was) { toast(L('¡Día completado!', 'Day completed!')); if (day < 6) location.hash = `#/leer/w/${w.id}/${day + 1}`; else location.hash = '#/hoy'; } else render();
  };
  window.scrollTo(0, 0);
}
function verseActions(s) {
  const [b, c, v] = s.dataset.v.split('-').map(Number), text = s.textContent.replace(/^\d+/, '').trim(), ref = `${bookName(b)} ${c}:${v}`;
  const marked = !!P.marks[s.dataset.v];
  openSheet(h`<h2>${esc(ref)}</h2><p class="reader" style="font-size:18px">${esc(text)}</p>
    <div class="list"><button id="va-mark">${marked ? L('Quitar resaltado', 'Remove highlight') : '🖍️ ' + L('Resaltar', 'Highlight')}</button><button id="va-copy">📋 ${L('Copiar', 'Copy')}</button>${navigator.share ? `<button id="va-share">📤 ${L('Compartir', 'Share')}</button>` : ''}</div>`, el => {
    $('#va-mark', el).onclick = () => { if (marked) delete P.marks[s.dataset.v]; else P.marks[s.dataset.v] = 1; save(); s.classList.toggle('sel', !marked); closeSheet(); };
    $('#va-copy', el).onclick = async () => { try { await navigator.clipboard.writeText(`«${text}» — ${ref} (${C.bibleName})`); toast(L('Copiado', 'Copied')); } catch {} closeSheet(); };
    const sh = $('#va-share', el); if (sh) sh.onclick = () => { navigator.share({ text: `«${text}» — ${ref}` }).catch(() => {}); closeSheet(); };
  });
}

// ---------- Atlas ----------
function viewAtlas(el) {
  setTitle('Atlas', false);
  el.innerHTML = `<div id="map"></div><p class="small muted" style="margin-top:8px">${L('Toca un lugar para ver dónde queda hoy y en qué semanas aparece.', 'Tap a place to see where it is today and which weeks it appears in.')}</p>`;
  whenLeaflet(() => {
    const m = L_map('map', { zoomControl: true });
    const w = week(P.week), cur = new Set([...w.places, ...w.route]);
    C.places.forEach(p => window.L.circleMarker([p.lat, p.lon], { radius: cur.has(p.id) ? 9 : 6, color: '#fff', weight: 2, fillColor: cur.has(p.id) ? '#e8590c' : '#1f3a8a', fillOpacity: 1 }).addTo(m).bindTooltip(p.name, { direction: 'top' }).on('click', () => showPlace(p)));
    m.fitBounds(window.L.latLngBounds(C.places.map(p => [p.lat, p.lon])).pad(0.05));
  });
}

// ---------- Historia: línea del tiempo ----------
const TL = { ppy: store.get('ppy', 2.5), min: -2150, max: 110 };
function viewHistoria(el, parts) {
  const pane = parts[0] === 'familia' ? 'familia' : 'tiempo';
  setTitle(L('Historia', 'History'), false);
  el.innerHTML = `<div class="seg"><button data-p="tiempo" class="${pane === 'tiempo' ? 'on' : ''}">${L('Línea del tiempo', 'Timeline')}</button><button data-p="familia" class="${pane === 'familia' ? 'on' : ''}">${L('Familias', 'Families')}</button></div><div id="hp"></div>`;
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => location.hash = `#/historia/${b.dataset.p}`);
  pane === 'tiempo' ? timeline($('#hp')) : familyTree($('#hp'));
}
function tlColor(it) {
  if (it.kind === 'good') return '#2a8c45'; if (it.kind === 'bad') return '#b8292e';
  return { era: '#404d9e', empire: '#a86114', prophet: '#7f38a8' }[it.lane] || '#0d7379';
}
function timeline(el) {
  const T = C.timeline, rowH = 30, gap = 5, laneGap = 14, top = 24;
  const tw = s => s.length * 7.2 + 14, X = y => (y - TL.min) * TL.ppy;
  const lanes = T.lanes.map(lane => {
    const ends = [], placed = [];
    T.items.filter(i => i.lane === lane.id).sort((a, b) => a.start - b.start).forEach(it => {
      const end = Math.max(it.end, it.start + Math.ceil((tw(it.name) + 8) / TL.ppy));
      let r = ends.findIndex(e => e + 2 <= it.start); if (r < 0) { ends.push(end); r = ends.length - 1; } else ends[r] = end;
      placed.push({ it, r });
    });
    return { ...lane, placed, rows: Math.max(ends.length, 1) };
  });
  let y = top; lanes.forEach(l => { l.top = y; l.h = l.rows * (rowH + gap) - gap; y += l.h + laneGap; });
  const H = y, W = X(TL.max);
  const wk = week(P.week);
  el.innerHTML = h`
    <div class="row" style="margin-bottom:10px"><div class="tl-year" id="tlYear"></div><span style="margin-left:auto"></span><button class="btn secondary" id="zo">−</button><button class="btn secondary" id="zi">+</button></div>
    <div class="tl-wrap"><div class="tl-labels">${lanes.map(l => `<div style="height:${l.h}px;margin-bottom:${laneGap}px">${esc(l.name)}</div>`).join('')}</div>
      <div class="tl-scroll" id="tls"><div class="tl-canvas" style="width:${W}px;height:${H}px;margin:0 50%"></div></div>
      <div class="tl-cursor"></div></div>
    <div class="legend"><span><i style="background:#2a8c45"></i>${L('Rey fiel', 'Faithful king')}</span><span><i style="background:#b8292e"></i>${L('Rey infiel', 'Unfaithful king')}</span><span><i style="background:var(--accent)"></i>${L('Tu semana', 'Your week')}</span><span><i style="background:orange"></i>${L('Evento', 'Event')}</span></div>
    <div id="tlSel"></div>
    <div class="card"><h3 id="tlInTitle"></h3><div id="tlIn"></div></div>
    <p class="small muted">${L('Fechas aproximadas. Los reinados siguen la cronología de Thiele; «fiel» o «infiel» es el juicio que da el libro de Reyes.', 'Approximate dates. Reigns follow Thiele’s chronology; “faithful” or “unfaithful” is the verdict given in Kings.')}</p>`;
  const cv = $('.tl-canvas', el); let s = '';
  for (let yy = -2100; yy <= 100; yy += 100) s += `<div class="tl-tick" style="left:${X(yy)}px"><span>${yearLabel(yy)}</span></div>`;
  T.events.forEach(ev => s += `<div style="position:absolute;left:${X(ev.year)}px;top:${top}px;bottom:0;width:2px;background:orange;opacity:.6"></div>`);
  lanes.forEach(l => l.placed.forEach(({ it, r }) => {
    const w = Math.max((it.end - it.start) * TL.ppy, 6), t = l.top + r * (rowH + gap), fits = w >= tw(it.name);
    s += `<button class="tl-bar" data-it="${it.id}" style="left:${X(it.start)}px;top:${t}px;width:${w}px;background:${tlColor(it)}" aria-label="${esc(it.name)}, ${yearLabel(it.start)}–${yearLabel(it.end)}">${fits ? esc(it.name) : ''}</button>`;
    if (!fits) s += `<div class="tl-out" style="left:${X(it.start) + w + 4}px;top:${t + 7}px">${esc(it.name)}</div>`;
  }));
  s += `<div style="position:absolute;left:${X(wk.year) - 1.5}px;top:${top}px;bottom:0;width:3px;background:var(--accent)"></div>`;
  cv.innerHTML = s;
  const sc = $('#tls', el);
  const update = () => {
    const yr = Math.round(TL.min + sc.scrollLeft / TL.ppy), cy = Math.min(Math.max(yr, TL.min), TL.max);
    $('#tlYear').textContent = yearLabel(cy); $('#tlInTitle').textContent = `${L('En', 'In')} ${yearLabel(cy)}`;
    const act = T.items.filter(i => i.start <= cy && cy <= Math.max(i.end, i.start + 1));
    const evs = T.events.filter(e => Math.abs(e.year - cy) <= 20);
    $('#tlIn').innerHTML = act.length || evs.length ? `<div class="list" style="margin:0">${act.map(i => `<button data-it="${i.id}"><i style="width:6px;height:34px;border-radius:3px;background:${tlColor(i)}"></i><span><b>${esc(i.name)}</b><div class="small muted">${esc(T.lanes.find(l => l.id === i.lane)?.name || '')} · ${yearLabel(i.start)} – ${yearLabel(i.end)}</div></span><span class="chev">›</span></button>`).join('')}${evs.map(e => `<a href="#/hoy" data-week="${e.week}">⭐ <span><b>${esc(e.name)}</b><div class="small muted">${yearLabel(e.year)}</div></span><span class="chev">${L('Semana', 'Week')} ${e.week}</span></a>`).join('')}</div>` : `<p class="muted">${L('Desliza la línea del tiempo para ver quién gobernaba y quién profetizaba.', 'Scroll the timeline to see who ruled and who prophesied.')}</p>`;
    bindTl($('#tlIn'));
  };
  const bindTl = root => { root.querySelectorAll('[data-it]').forEach(b => b.onclick = () => selectIt(T.items.find(i => i.id === b.dataset.it))); bindCommon(root); };
  const selectIt = it => {
    $('#tlSel').innerHTML = h`<div class="card"><div class="row"><i style="width:6px;height:44px;border-radius:3px;background:${tlColor(it)}"></i><span><h3 style="margin:0">${esc(it.name)}</h3><div class="small muted">${yearLabel(it.start)} – ${yearLabel(it.end)}</div>${it.kind === 'good' ? `<div class="small">${L('Hizo lo recto ante Dios, según Reyes.', 'Did what was right before God, according to Kings.')}</div>` : it.kind === 'bad' ? `<div class="small">${L('Hizo lo malo ante Dios, según Reyes.', 'Did evil before God, according to Kings.')}</div>` : ''}</span></div><a class="btn block" style="margin-top:12px" href="#/hoy" data-week="${it.week}">📖 ${L('Leer en la semana', 'Read in week')} ${it.week}</a></div>`;
    bindCommon($('#tlSel'));
  };
  bindTl(cv);
  sc.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  const goYear = yr => { sc.scrollLeft = X(yr); update(); };
  const zoom = f => { const yr = TL.min + sc.scrollLeft / TL.ppy; TL.ppy = Math.min(Math.max(TL.ppy * f, 0.8), 10); store.set('ppy', TL.ppy); timeline(el); $('#tls').scrollLeft = (yr - TL.min) * TL.ppy; };
  $('#zi', el).onclick = () => zoom(1.6); $('#zo', el).onclick = () => zoom(0.6);
  requestAnimationFrame(() => goYear(Math.max(TL.focus ?? wk.year, -2090))); TL.focus = undefined;
}

// ---------- Historia: árbol ----------
const TREE = { collapsed: new Set(store.get('collapsed', [])), promiseOnly: false, s: 1, x: 0, y: 0 };
function familyTree(el) {
  const nodeW = 136, nodeH = 64, colW = 150, rowH = 110, m = 24;
  const pos = {}, edges = [], vis = [], hidden = {}, parent = {}; let nx = 0, md = 0;
  const place = (n, d) => {
    vis.push(n); md = Math.max(md, d);
    const all = n.children || []; let kids = TREE.collapsed.has(n.id) ? [] : all; if (TREE.promiseOnly) kids = kids.filter(k => k.promise);
    if (all.length > kids.length) hidden[n.id] = all.length - kids.length;
    let x; if (!kids.length) { x = nx; nx += colW; } else { const xs = kids.map(k => { parent[k.id] = n; return place(k, d + 1); }); x = (xs[0] + xs[xs.length - 1]) / 2; }
    pos[n.id] = { x: x + m + nodeW / 2, y: d * rowH + m + nodeH / 2 };
    kids.forEach(k => edges.push([n.id, k.id, n.promise && k.promise]));
    return x;
  };
  C.tree.forEach(r => place(r, 0));
  const W = Math.max(nx - colW, 0) + nodeW + m * 2, H = md * rowH + nodeH + m * 2, wk = P.week;
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  edges.forEach(([a, b, pr]) => { const A = pos[a], B = pos[b], y1 = A.y + nodeH / 2, y2 = B.y - nodeH / 2, mid = (y1 + y2) / 2; svg += `<path d="M${A.x},${y1} V${mid} H${B.x} V${y2}" fill="none" stroke="${pr ? 'var(--accent)' : 'var(--muted)'}" stroke-opacity="${pr ? 1 : .5}" stroke-width="${pr ? 4 : 2}" stroke-linejoin="round"/>`; });
  vis.forEach(n => {
    const p = pos[n.id], x = p.x - nodeW / 2, y = p.y - nodeH / 2, hasK = (n.children || []).length;
    const name = n.name.length > 20 ? n.name.slice(0, 19) + '…' : n.name;
    svg += `<g class="tree-node ${n.promise ? 'promise' : ''} ${n.weeks.includes(wk) ? 'week' : ''}" data-n="${n.id}" style="cursor:pointer"><rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="14"/><text x="${p.x}" y="${p.y - (n.tag ? 4 : -4)}" text-anchor="middle">${esc(name)}</text>${n.tag ? `<text class="tag" x="${p.x}" y="${p.y + 14}" text-anchor="middle">${esc(n.tag.length > 22 ? n.tag.slice(0, 21) + '…' : n.tag)}</text>` : ''}</g>`;
    if (hasK) svg += `<g data-t="${n.id}" style="cursor:pointer"><rect x="${p.x - 18}" y="${y + nodeH - 9}" width="36" height="20" rx="10" fill="var(--muted)"/><text x="${p.x}" y="${y + nodeH + 5}" text-anchor="middle" fill="#fff" font-size="12" font-weight="700" font-family="sans-serif">${hidden[n.id] ? '+' + hidden[n.id] : '−'}</text></g>`;
  });
  svg += '</svg>';
  el.innerHTML = `<div class="legend"><span><i style="background:var(--accent)"></i>${L('Línea de la promesa', 'Line of the promise')}</span><span><i style="background:none;border:2px solid var(--warn)"></i>${L('Tu semana', 'Your week')}</span></div>
    <div class="tree-wrap" id="tw">${svg}<div class="tree-ctrl"><button id="tp" aria-label="${L('Solo la línea de la promesa', 'Only the line of the promise')}">${TREE.promiseOnly ? '★' : '☆'}</button><button id="tz1" aria-label="+">+</button><button id="tz2" aria-label="−">−</button><button id="tf" aria-label="${L('Ir a tu semana', 'Go to your week')}">◎</button></div></div>
    <p class="small muted" style="margin-top:8px">${L('Arrastra para moverte, pellizca para ampliar. Toca una persona para ver quién es; toca + / − para abrir o cerrar ramas.', 'Drag to move, pinch to zoom. Tap a person to see who they are; tap + / − to open or close branches.')}</p>`;
  const wrap = $('#tw', el), s = $('svg', wrap);
  const apply = () => s.style.transform = `translate(${TREE.x}px,${TREE.y}px) scale(${TREE.s})`;
  const focus = () => {
    const f = vis.filter(n => n.weeks.includes(wk)).sort((a, b) => pos[b.id].y - pos[a.id].y)[0] || vis.find(n => n.id === 'abraham') || vis[0];
    const p = pos[f.id]; TREE.x = wrap.clientWidth / 2 - p.x * TREE.s; TREE.y = wrap.clientHeight / 2 - p.y * TREE.s; apply();
  };
  if (!TREE.init) { TREE.init = true; requestAnimationFrame(focus); } else apply();
  const pts = new Map(); let st = null, moved = false;
  const snap = () => { const a = [...pts.values()]; return { cx: a.reduce((s, p) => s + p.x, 0) / a.length, cy: a.reduce((s, p) => s + p.y, 0) / a.length, d: a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0, s: TREE.s, x: TREE.x, y: TREE.y }; };
  const zoomAt = (cx, cy, ns) => { const r = wrap.getBoundingClientRect(); cx -= r.left; cy -= r.top; ns = Math.min(Math.max(ns, .3), 2.4); TREE.x = cx - (cx - TREE.x) * ns / TREE.s; TREE.y = cy - (cy - TREE.y) * ns / TREE.s; TREE.s = ns; apply(); };
  wrap.addEventListener('pointerdown', e => { if (e.target.closest('.tree-ctrl')) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); st = snap(); moved = false; });
  wrap.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !st) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); const n = snap();
    if (Math.hypot(n.cx - st.cx, n.cy - st.cy) > 6 || pts.size > 1) { moved = true; if (!wrap.hasPointerCapture(e.pointerId)) wrap.setPointerCapture(e.pointerId); }
    if (pts.size === 2 && st.d) { TREE.s = st.s; TREE.x = st.x; TREE.y = st.y; zoomAt(st.cx, st.cy, st.s * n.d / st.d); TREE.x += n.cx - st.cx; TREE.y += n.cy - st.cy; apply(); }
    else if (pts.size === 1 && moved) { TREE.x = st.x + n.cx - st.cx; TREE.y = st.y + n.cy - st.cy; apply(); }
  });
  const up = e => {
    const wasTap = !moved && pts.size === 1; pts.delete(e.pointerId); st = pts.size ? snap() : null;
    if (!wasTap) return;
    const t = e.target.closest('[data-t]'), n = e.target.closest('[data-n]');
    if (t) { const id = t.dataset.t; TREE.promiseOnly && !(findNode(id).children || []).every(k => k.promise) ? (TREE.promiseOnly = false, TREE.collapsed.delete(id)) : TREE.collapsed.has(id) ? TREE.collapsed.delete(id) : TREE.collapsed.add(id); store.set('collapsed', [...TREE.collapsed]); familyTree(el); }
    else if (n) { const node = findNode(n.dataset.n); showTreeNode(node, parent[node.id]); }
  };
  wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', e => { pts.delete(e.pointerId); st = null; });
  wrap.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, TREE.s * (e.deltaY < 0 ? 1.12 : .89)); }, { passive: false });
  $('#tz1', el).onclick = () => { const r = wrap.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, TREE.s * 1.3); };
  $('#tz2', el).onclick = () => { const r = wrap.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, TREE.s / 1.3); };
  $('#tf', el).onclick = () => { TREE.collapsed.clear(); TREE.promiseOnly = false; TREE.s = 1; store.set('collapsed', []); TREE.init = false; familyTree(el); };
  $('#tp', el).onclick = () => { TREE.promiseOnly = !TREE.promiseOnly; familyTree(el); };
}
function findNode(id, ns = C.tree) { for (const n of ns) { if (n.id === id) return n; const f = n.children && findNode(id, n.children); if (f) return f; } return null; }

// ---------- Fuentes ----------
function viewFuentes(el, parts) {
  const pane = parts[0] || 'dioses';
  setTitle(L('Fuentes', 'Sources'), false);
  const panes = [['dioses', L('dioses falsos', 'false gods')], ['escritos', L('Escritos', 'Writings')], ['arte', L('Arte', 'Art')], ['cine', L('Cine', 'Film')]];
  el.innerHTML = `<div class="seg">${panes.map(([k, t]) => `<button data-p="${k}" class="${k === pane ? 'on' : ''}">${t}</button>`).join('')}</div><input class="search" type="search" placeholder="${L('Buscar…', 'Search…')}" id="q"><div id="fp"></div>`;
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => location.hash = `#/fuentes/${b.dataset.p}`);
  const draw = q => {
    q = q.toLowerCase().trim(); const has = s => !q || s.toLowerCase().includes(q); const fp = $('#fp');
    if (pane === 'dioses') fp.innerHTML = `<div class="list">${C.gods.filter(g => has(g.name + g.people + g.region)).map(g => `<button data-god="${g.id}">🔥 <span><b>${esc(g.name)}</b><div class="small muted">${esc(g.people)}</div></span><span class="chev">›</span></button>`).join('')}</div>`;
    if (pane === 'escritos') { const cats = [...new Set(C.extras.map(x => x.catName))]; fp.innerHTML = cats.map(c => { const xs = C.extras.filter(x => x.catName === c && has(x.name + x.what)); return xs.length ? `<div class="section-title">${esc(c)}</div><div class="list">${xs.map(x => `<button data-extra="${x.id}"><span><b>${esc(x.name)}</b><div class="small muted">${esc(x.date)}</div></span><span class="chev">›</span></button>`).join('')}</div>` : ''; }).join(''); }
    if (pane === 'arte') fp.innerHTML = `<div class="grid">${C.art.filter(a => has(a.title + a.artist)).map(artTile).join('')}</div><p class="small muted" style="margin-top:12px">${L('Obras de dominio público. Imágenes de Wikimedia Commons.', 'Public-domain works. Images from Wikimedia Commons.')}</p>`;
    if (pane === 'cine') fp.innerHTML = C.films.filter(f => has(f.title + f.director + f.fragments.map(x => x.title).join(' '))).map(f => `<div class="section-title">${esc(f.title)} (${f.year}) · ${esc(f.director)}</div><p class="small muted" style="margin:0 4px 8px">${esc(f.note)}</p><div class="rail">${f.fragments.map(x => sceneTile({ film: f, frag: x })).join('')}</div>`).join('');
    bindCommon(fp);
  };
  $('#q').oninput = e => draw(e.target.value); draw('');
}

// ---------- Progreso ----------
function viewProgreso(el) {
  setTitle(L('Progreso', 'Progress'), false);
  const doneWeeks = P.done.length, days = Object.keys(P.days).length;
  el.innerHTML = h`
    <div class="card"><div class="row" style="justify-content:space-around;text-align:center">
      <div><div class="stat">${doneWeeks}</div><div class="small muted">${L('semanas', 'weeks')}</div></div>
      <div><div class="stat">${days}</div><div class="small muted">${L('días leídos', 'days read')}</div></div>
      <div><div class="stat">🔥 ${streak()}</div><div class="small muted">${L('racha', 'streak')}</div></div></div>
      <div class="progress" style="margin-top:14px"><div style="width:${days / 364 * 100}%"></div></div><p class="small muted" style="margin-top:6px">${Math.round(days / 364 * 100)}% ${L('del plan', 'of the plan')}</p></div>
    <div class="section-title">${L('Plan de 52 semanas', '52-week plan')}</div>
    <div class="list">${C.weeks.map(w => `<a href="#/hoy" data-week="${w.id}"><b style="min-width:28px;color:${P.done.includes(w.id) ? 'var(--good)' : w.id === P.week ? 'var(--accent)' : 'inherit'}">${P.done.includes(w.id) ? '✓' : w.id}</b><span><div>${esc(w.reading)}</div><div class="small muted">${esc(w.era)} · ${yearLabel(w.year)}</div></span><span class="chev">›</span></a>`).join('')}</div>
    <div class="card" style="background:var(--accent-soft)"><h3>📱 ${L('iPhone y Android en camino', 'iPhone and Android on the way')}</h3><p class="small">${L('Esta es la versión web. Estamos trabajando en las versiones avanzadas para iPhone y Android —con todo sin internet, mapas 3D y recordatorios— que también serán siempre gratuitas. Buscamos donaciones para cubrir los costos de las tiendas y el desarrollo.', 'This is the web version. We are building advanced iPhone and Android apps —fully offline, with 3D maps and reminders— that will also always be free. We are looking for donations to cover app-store fees and development.')}</p><a class="btn block" target="_blank" rel="noopener" href="../#apoyar">${L('Quiero apoyar', 'I want to help')}</a></div>
    <div class="section-title">${L('Ajustes', 'Settings')}</div>
    <div class="list"><button id="swLang">🌐 ${L('Idioma: Español', 'Language: English')}<span class="chev">${L('Cambiar', 'Change')}</span></button><button id="install">📲 ${L('Instalar en la pantalla de inicio', 'Install on the home screen')}<span class="chev">›</span></button><button id="reset" style="color:var(--bad)">${L('Reiniciar progreso', 'Reset progress')}</button></div>
    <div class="card small muted"><p>${L('Texto bíblico', 'Bible text')}: ${esc(C.bibleName)} (${L('dominio público', 'public domain')}). ${L('Mapas: Esri. Fotos y artículos: Wikipedia y Wikimedia Commons. Películas: Internet Archive (dominio público).', 'Maps: Esri. Photos and articles: Wikipedia and Wikimedia Commons. Films: Internet Archive (public domain).')}</p><p style="margin:0">${L('Tu progreso se guarda solo en este dispositivo.', 'Your progress is saved only on this device.')}</p></div>`;
  bindCommon(el);
  $('#swLang').onclick = switchLang;
  $('#reset').onclick = () => { if (confirm(L('¿Borrar todo tu progreso?', 'Erase all your progress?'))) { P.days = {}; P.done = []; P.dates = []; P.week = 1; save(); render(); } };
  $('#install').onclick = () => {
    if (window.__installPrompt) { window.__installPrompt.prompt(); return; }
    openSheet(`<h2>${L('Instalar Lumbrera', 'Install Lumbrera')}</h2><div class="card"><p><b>iPhone / iPad (Safari)</b></p><p>1. ${L('Toca el botón Compartir', 'Tap the Share button')} <span style="font-size:20px">⬆︎</span><br>2. ${L('Elige «Agregar a pantalla de inicio»', 'Choose “Add to Home Screen”')}<br>3. ${L('Toca «Agregar»', 'Tap “Add”')}</p></div><div class="card"><p><b>Android (Chrome)</b></p><p>${L('Menú ⋮ → «Instalar app» o «Agregar a pantalla principal».', 'Menu ⋮ → “Install app” or “Add to Home screen”.')}</p></div>`);
  };
}
async function switchLang() { LANG = LANG === 'es' ? 'en' : 'es'; store.set('lang', LANG); await loadContent(); render(); }
$('#langBtn').onclick = switchLang;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; });

// ---------- Router ----------
$('#back').onclick = () => history.length > 1 ? history.back() : (location.hash = '#/hoy');
async function render() {
  if (!C) return;
  const [route, ...parts] = (location.hash.replace(/^#\/?/, '') || 'hoy').split('/');
  const el = $('#view'); closeSheet();
  $('#langBtn').textContent = LANG === 'es' ? 'EN' : 'ES';
  const tab = { leer: 'hoy' }[route] || route;
  renderTabs(['hoy', 'atlas', 'historia', 'fuentes', 'progreso'].includes(tab) ? tab : 'hoy');
  try {
    if (route === 'leer') await viewReader(el, parts);
    else if (route === 'atlas') viewAtlas(el);
    else if (route === 'historia') viewHistoria(el, parts);
    else if (route === 'fuentes') viewFuentes(el, parts);
    else if (route === 'progreso') viewProgreso(el);
    else await viewHoy(el);
  } catch (e) { console.error(e); el.innerHTML = `<div class="empty">${L('Algo salió mal. Revisa tu conexión e inténtalo de nuevo.', 'Something went wrong. Check your connection and try again.')}</div>`; }
  if (route !== 'leer') window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);
document.addEventListener('click', e => { const a = e.target.closest('a[data-week]'); if (a && location.hash === '#/hoy') { e.preventDefault(); P.week = +a.dataset.week; save(); closeSheet(); render(); } });

(async () => {
  await loadContent(); render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
