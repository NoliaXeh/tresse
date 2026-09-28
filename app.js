/* Tresse — interface : fusion, liste virtualisée, tresse, fils communs, calage d'horloge. */
(function () {
  'use strict';

  const P = window.TresseParser;
  const RH = 22;
  const LANE = 10;
  const COLORS = ['#4C7EF3', '#E8773A', '#1FAE7E', '#B05BD6', '#D9A21B', '#1BA5BF', '#D9467A', '#7FA32E'];
  const LEVELS = [['error', 'Erreurs'], ['warn', 'Avert.'], ['info', 'Info'], ['debug', 'Debug'], ['other', 'Autres']];
  const LV_SHORT = { error: 'ERR', warn: 'WARN', info: 'INFO', debug: 'DBG', other: '·' };
  const FORMAT_EXAMPLES = {
    json: '{"level":30,"time":1790596931482,"msg":"…"}',
    iso: '2026-09-28 12:02:11,482 INFO …',
    clf: '81.64.12.9 - - [28/Sep/2026:14:02:11 +0200] "GET /" 200',
    eu: '28/09/2026 12:02:11 WARN …',
    klog: 'I0928 12:02:11.482913 1 main.go:42] …',
    syslog: 'Sep 28 12:02:11 web-1 sshd[812]: …',
    epoch: '1790596931.482 INFO …',
    time: '12:02:11.482 [main] DEBUG …',
  };

  const $ = s => document.querySelector(s);
  const p2 = n => String(n).padStart(2, '0');
  const p3 = n => String(n).padStart(3, '0');
  const nf = n => n.toLocaleString('fr-FR');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inIframe = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  const store = {
    get(k, d) { try { const v = localStorage.getItem('tresse.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tresse.' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  };

  const els = {};
  ['search', 'search-err', 'levels', 'gap', 'display-tz', 'fold', 'btn-next-err', 'braid', 'btn-unzoom', 'summary',
    'viewport', 'spacer', 'rows', 'source-list', 'src-count', 'thread-list', 'thread-filter', 'threads-count', 'journey',
    'detail', 'tab-threads', 'tab-detail', 'panel-threads', 'panel-detail', 'empty', 'work', 'format-list', 'banner',
    'add-dialog', 'add-form', 'add-name', 'add-text', 'add-tz', 'add-files', 'add-cancel', 'file-input', 'drop', 'toast',
    'btn-add', 'btn-copy', 'btn-download', 'btn-demo-fail', 'btn-demo-clear', 'logo',
  ].forEach(id => { els[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

  const state = {
    sources: [], merged: [], filtered: [], rows: [], rowT: new Float64Array(0), rowOf: new Map(),
    tokens: new Map(), shared: [], sharedSet: new Set(),
    q: '', qre: null, levels: new Set(LEVELS.map(l => l[0])),
    range: null, token: null, threadOnly: false,
    selected: null, anchor: null, flash: null,
    displayTz: store.get('displayTz', 'local'), gap: store.get('gap', 5000), fold: false,
    demo: false, span: [0, 0], threadFilter: '',
  };
  let uid = 0, colorIdx = 0, pasteN = 0;

  /* ---------- Temps ---------- */

  const TZ_OPTS = [['local', 'Heure locale du navigateur'], ['0', 'UTC']];
  for (let h = -12; h <= 14; h++) if (h) TZ_OPTS.push([String(h * 60), `UTC${h > 0 ? '+' : '−'}${p2(Math.abs(h))}:00`]);

  function parts(t) {
    const d = new Date(Math.floor(t));
    if (state.displayTz === 'utc') return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()];
    return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];
  }
  function clock(t, ms = true) {
    const p = parts(t);
    return `${p2(p[3])}:${p2(p[4])}:${p2(p[5])}` + (ms ? '.' + p3(p[6]) : '');
  }
  function dayKey(t) { const p = parts(t); return p[0] * 10000 + p[1] * 100 + p[2]; }
  function dayLabel(t) {
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: state.displayTz === 'utc' ? 'UTC' : undefined }).format(new Date(t));
  }
  function zoneLabel(t) {
    if (state.displayTz === 'utc') return 'UTC';
    const o = -new Date(t).getTimezoneOffset();
    return `UTC${o >= 0 ? '+' : '−'}${p2(Math.floor(Math.abs(o) / 60))}:${p2(Math.abs(o) % 60)}`;
  }
  function fullStamp(t) {
    const p = parts(t);
    const us = Math.round((t - Math.floor(t)) * 1000);
    return `${p[0]}-${p2(p[1] + 1)}-${p2(p[2])} ${clock(t)}${us ? p3(us) : ''} ${zoneLabel(t)}`;
  }
  function dur(ms) {
    const a = Math.abs(ms);
    if (a < 1) return Math.round(a * 1000) + ' µs';
    if (a < 1000) return Math.round(a) + ' ms';
    if (a < 60000) return (a / 1000).toLocaleString('fr-FR', { maximumFractionDigits: a < 10000 ? 2 : 1 }) + ' s';
    if (a < 3600000) return Math.floor(a / 60000) + ' min ' + p2(Math.floor(a % 60000 / 1000)) + ' s';
    if (a < 86400000) return Math.floor(a / 3600000) + ' h ' + p2(Math.floor(a % 3600000 / 60000)) + ' min';
    return Math.floor(a / 86400000) + ' j ' + Math.floor(a % 86400000 / 3600000) + ' h';
  }
  const sdur = ms => (ms < 0 ? '−' : '+') + dur(ms);
  function compactDt(dt) {
    if (dt < 1000) return '+' + Math.round(dt) + 'ms';
    if (dt < 60000) return '+' + (dt / 1000).toFixed(dt < 10000 ? 2 : 1) + 's';
    if (dt < 3600000) return '+' + Math.floor(dt / 60000) + 'm' + p2(Math.floor(dt % 60000 / 1000));
    return '+' + Math.floor(dt / 3600000) + 'h' + p2(Math.floor(dt % 3600000 / 60000));
  }
  function relStamp(d) {
    const s = d < 0 ? '−' : '+', a = Math.abs(d);
    if (a < 60000) return s + (a / 1000).toFixed(3) + 's';
    if (a < 3600000) return s + Math.floor(a / 60000) + 'm' + p2(Math.floor(a % 60000 / 1000)) + '.' + p3(Math.floor(a % 1000));
    return s + Math.floor(a / 3600000) + 'h' + p2(Math.floor(a % 3600000 / 60000)) + 'm' + p2(Math.floor(a % 60000 / 1000));
  }
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }

  /* ---------- Sources ---------- */

  function addSource(o) {
    const src = {
      id: ++uid, name: o.name || `source ${uid}`, text: o.text, tz: o.tz || 'local', date: o.date || todayISO(),
      offset: o.offset || 0, visible: true, color: COLORS[colorIdx++ % COLORS.length], demo: !!o.demo,
    };
    parseSrc(src);
    state.sources.push(src);
    return src;
  }

  function parseSrc(src) {
    const r = P.parseSource(src.text, { tz: src.tz === 'local' ? 'local' : Number(src.tz), date: src.date });
    src.parsed = r;
    src.entries = r.entries;
    for (const e of r.entries) e.src = src;
  }

  function visibleSources() { return state.sources.filter(s => s.visible && s.entries.length); }

  function rebuild() {
    state.sources.forEach((s, i) => { s.idx = i; });
    const vis = visibleSources();
    vis.forEach((s, i) => { s.lane = i; });
    const all = [];
    for (const s of vis) for (const e of s.entries) { e.te = e.t + s.offset; all.push(e); }
    all.sort((a, b) => a.te - b.te || a.src.idx - b.src.idx || a.n - b.n);
    state.merged = all;
    state.span = all.length ? [all[0].te, all[all.length - 1].te] : [0, 0];
    if (state.selected && !all.includes(state.selected)) state.selected = null;
    if (state.anchor && !all.includes(state.anchor)) state.anchor = null;
    buildTokens();
    const bg = vis.map((s, i) => `linear-gradient(${s.color}, ${s.color}) ${i * LANE + 3}px 0 / 1px 100% no-repeat`).join(', ');
    els.viewport.style.setProperty('--lanes-bg', bg || 'none');
    els.viewport.style.setProperty('--gut', Math.max(1, vis.length) * LANE + 'px');
    els.empty.hidden = state.sources.length > 0;
    els.work.hidden = state.sources.length === 0;
    els.banner.hidden = !state.demo;
    applyFilters();
  }

  function buildTokens() {
    const m = new Map();
    for (const e of state.merged) {
      for (const tok of e.ids) {
        let r = m.get(tok);
        if (!r) m.set(tok, r = { tok, srcs: new Set(), entries: [], err: false });
        r.srcs.add(e.src);
        r.entries.push(e);
        if (e.level === 'error') r.err = true;
      }
    }
    const shared = [];
    for (const r of m.values()) if (r.srcs.size > 1) { r.kind = P.idKind(r.tok); shared.push(r); }
    shared.sort((a, b) => (b.err - a.err) || b.srcs.size - a.srcs.size || a.entries.length - b.entries.length || a.entries[0].te - b.entries[0].te);
    state.tokens = m;
    state.shared = shared;
    state.sharedSet = new Set(shared.map(r => r.tok));
    if (state.token && !m.has(state.token)) { state.token = null; state.threadOnly = false; }
  }

  /* ---------- Filtres et lignes ---------- */

  function matchText(e) {
    if (state.qre) {
      if (state.qre.test(e.line)) return true;
      return !!e.cont && e.cont.some(l => state.qre.test(l));
    }
    if (e.lc === undefined) e.lc = (e.cont ? e.line + '\n' + e.cont.join('\n') : e.line).toLowerCase();
    return e.lc.includes(state.q);
  }

  function applyFilters() {
    const { levels, range, q } = state;
    const only = state.threadOnly && state.token ? new Set(state.tokens.get(state.token).entries) : null;
    const allLv = levels.size === LEVELS.length;
    const out = [];
    for (const e of state.merged) {
      if (!allLv && !levels.has(e.level)) continue;
      if (range && (e.te < range[0] || e.te > range[1])) continue;
      if (only && !only.has(e)) continue;
      if (q && !matchText(e)) continue;
      out.push(e);
    }
    state.filtered = out;
    buildRows();
    binsKey = '';
    renderAll();
  }

  function buildRows() {
    const rows = [];
    let prev = null, prevDay = null;
    for (const e of state.filtered) {
      const dk = dayKey(e.te);
      if (dk !== prevDay) { rows.push({ k: 'd', t: e.te }); prevDay = dk; }
      else if (prev && state.gap > 0 && e.te - prev.te >= state.gap) rows.push({ k: 'g', t: e.te, dt: e.te - prev.te });
      rows.push({ k: 'e', e, t: e.te, dt: prev ? e.te - prev.te : null });
      if (e.cont && !state.fold) for (let i = 0; i < e.cont.length; i++) rows.push({ k: 'c', e, i, t: e.te });
      prev = e;
    }
    state.rows = rows;
    state.rowT = new Float64Array(rows.length);
    state.rowOf = new Map();
    rows.forEach((r, i) => { state.rowT[i] = r.t; if (r.k === 'e') state.rowOf.set(r.e, i); });
    els.spacer.style.height = rows.length * RH + 'px';
  }

  function renderAll() {
    renderLevels();
    renderSummary();
    renderRows();
    drawBraid();
    renderThreads();
    renderDetail();
    els.btnUnzoom.hidden = !state.range;
  }

  /* ---------- Rendu des lignes ---------- */

  function isWord(c) { return c !== undefined && /[\w]/.test(c); }

  function decorate(text, e) {
    if (text.length > 4000) text = text.slice(0, 4000) + ' …';
    const R = [];
    for (const tok of e.ids) {
      if (!state.sharedSet.has(tok)) continue;
      let k = text.indexOf(tok);
      while (k !== -1 && R.length < 40) {
        if (!isWord(text[k - 1]) && !isWord(text[k + tok.length])) R.push([k, k + tok.length, tok === state.token ? 'tok on' : 'tok', tok]);
        k = text.indexOf(tok, k + tok.length);
      }
    }
    if (state.q) {
      if (state.qre) {
        const re = new RegExp(state.qre.source, state.qre.flags.replace('g', '') + 'g');
        let m, n = 0;
        while ((m = re.exec(text)) && n++ < 30) {
          if (!m[0].length) { re.lastIndex++; continue; }
          R.push([m.index, m.index + m[0].length, 'hl']);
        }
      } else {
        const lc = text.toLowerCase();
        let k = lc.indexOf(state.q), n = 0;
        while (k !== -1 && n++ < 30) { R.push([k, k + state.q.length, 'hl']); k = lc.indexOf(state.q, k + state.q.length); }
      }
    }
    if (!R.length) return esc(text);
    R.sort((a, b) => a[0] - b[0]);
    let out = '', pos = 0;
    for (const [s, en, cls, tok] of R) {
      if (s < pos) continue;
      out += esc(text.slice(pos, s));
      out += tok ? `<mark class="${cls}" data-tok="${esc(tok)}">` : `<mark class="${cls}">`;
      out += esc(text.slice(s, en)) + '</mark>';
      pos = en;
    }
    return out + esc(text.slice(pos));
  }

  function rowHtml(r, i) {
    const top = i * RH;
    if (r.k === 'd') return `<div class="row day" style="top:${top}px"><span class="meta"><span class="gut"></span><span class="label">${esc(dayLabel(r.t))} · ${zoneLabel(r.t)}</span></span></div>`;
    if (r.k === 'g') return `<div class="row gap" style="top:${top}px"><span class="meta"><span class="gut"></span><span class="label">${dur(r.dt)} sans activité</span></span></div>`;
    const e = r.e, s = e.src;
    const cls = ['row', 'lv-' + e.level];
    if (e === state.selected) cls.push('sel');
    if (e === state.anchor) cls.push('anchor');
    if (state.token && e.ids.includes(state.token)) cls.push('hit');
    if (e === state.flash) cls.push('flash');
    if (r.k === 'c') {
      cls.push('cont');
      return `<div class="${cls.join(' ')}" style="top:${top}px;--c:${s.color}" data-r="${i}"><span class="meta"><span class="gut"><i class="seg" style="left:${s.lane * LANE + 2}px;background:${s.color}"></i></span><span class="cells-empty"></span></span><span class="msg">${decorate(e.cont[r.i], e)}</span></div>`;
    }
    const ts = state.anchor ? relStamp(e.te - state.anchor.te) : clock(e.te);
    const dt = r.dt == null ? '' : compactDt(r.dt);
    return `<div class="${cls.join(' ')}" style="top:${top}px;--c:${s.color}" data-r="${i}"><span class="meta"><span class="gut"><i class="dot" style="left:${s.lane * LANE}px;background:${s.color}"></i></span><span class="ts">${ts}</span><span class="dt${r.dt >= 1000 ? ' slow' : ''}">${dt}</span><span class="src-tag">${esc(s.name)}</span><span class="lv">${LV_SHORT[e.level]}</span></span><span class="msg">${decorate(e.line, e)}</span></div>`;
  }

  function renderRows() {
    const vp = els.viewport;
    const h = vp.clientHeight || 400, st = vp.scrollTop;
    const a = Math.max(0, Math.floor(st / RH) - 6);
    const b = Math.min(state.rows.length, Math.ceil((st + h) / RH) + 6);
    let html = '';
    for (let i = a; i < b; i++) html += rowHtml(state.rows[i], i);
    els.rows.innerHTML = html;
  }

  function visibleWindow() {
    const n = state.rows.length;
    if (!n) return null;
    const vp = els.viewport;
    const a = Math.min(n - 1, Math.floor(vp.scrollTop / RH));
    const b = Math.min(n - 1, Math.floor((vp.scrollTop + vp.clientHeight) / RH));
    return [state.rowT[a], state.rowT[b]];
  }

  function rowAtTime(t) {
    const T = state.rowT;
    let lo = 0, hi = T.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] < t) lo = mid + 1; else hi = mid; }
    return Math.min(lo, T.length - 1);
  }

  function scrollToRow(i, flashEntry) {
    const vp = els.viewport;
    const top = i * RH, h = vp.clientHeight;
    if (top < vp.scrollTop + RH * 2 || top > vp.scrollTop + h - RH * 3) vp.scrollTop = Math.max(0, top - h / 3);
    if (flashEntry) {
      state.flash = flashEntry;
      clearTimeout(scrollToRow.timer);
      scrollToRow.timer = setTimeout(() => { state.flash = null; renderRows(); }, 1500);
    }
    renderRows();
    drawBraid();
  }

  function revealEntry(e, flash = true) {
    let i = state.rowOf.get(e);
    if (i == null) {
      // L'entrée est masquée par un filtre : on retire les filtres qui l'excluent.
      state.q = ''; state.qre = null; els.search.value = ''; els.search.classList.remove('bad'); els.searchErr.hidden = true;
      state.levels = new Set(LEVELS.map(l => l[0]));
      if (state.range && (e.te < state.range[0] || e.te > state.range[1])) state.range = null;
      if (state.threadOnly && !(state.token && e.ids.includes(state.token))) state.threadOnly = false;
      applyFilters();
      i = state.rowOf.get(e);
    }
    if (i != null) scrollToRow(i, flash ? e : null);
  }

  /* ---------- Résumé et niveaux ---------- */

  function renderLevels() {
    const cnt = {};
    for (const e of state.merged) cnt[e.level] = (cnt[e.level] || 0) + 1;
    els.levels.innerHTML = LEVELS.filter(([k]) => cnt[k] || k === 'error').map(([k, label]) =>
      `<button type="button" class="chip lv-${k}" data-lv="${k}" aria-pressed="${state.levels.has(k)}"><b>${label}</b><span class="n">${nf(cnt[k] || 0)}</span></button>`).join('');
  }

  function renderSummary() {
    const f = state.filtered, m = state.merged;
    if (!m.length) { els.summary.innerHTML = '<span>Aucune ligne horodatée pour l\'instant.</span>'; return; }
    const nErr = f.reduce((n, e) => n + (e.level === 'error'), 0);
    const a = f.length ? f[0].te : 0, b = f.length ? f[f.length - 1].te : 0;
    let h = `<span><b>${nf(f.length)}</b> entrée${f.length > 1 ? 's' : ''}${f.length !== m.length ? ` sur ${nf(m.length)}` : ''}</span>`;
    if (f.length) h += `<span>${clock(a, false)} → ${clock(b, false)} (${dur(b - a)})</span>`;
    h += `<span class="errn">${nf(nErr)} erreur${nErr > 1 ? 's' : ''}</span>`;
    if (state.range) h += `<span class="pill">Plage ${clock(state.range[0])} → ${clock(state.range[1])}<button type="button" data-clear="range" aria-label="Retirer la plage">×</button></span>`;
    if (state.threadOnly && state.token) h += `<span class="pill">Fil ${esc(short(state.token))}<button type="button" data-clear="thread" aria-label="Afficher tous les fils">×</button></span>`;
    if (state.anchor) h += `<span class="pill">T0 ${clock(state.anchor.te)} · ${esc(state.anchor.src.name)}<button type="button" data-clear="anchor" aria-label="Retirer T0">×</button></span>`;
    els.summary.innerHTML = h;
  }

  const short = t => t.length > 22 ? t.slice(0, 10) + '…' + t.slice(-6) : t;

  /* ---------- La tresse (canvas) ---------- */

  let binsKey = '', bins = null, hoverX = null, drag = null;
  const BRAID = { lane: 18, axis: 22, labelW: 92 };

  function axisRange() {
    if (state.range) return state.range;
    let [a, b] = state.span;
    if (b - a < 1000) { const c = (a + b) / 2; a = c - 500; b = c + 500; }
    return [a, b];
  }

  function computeBins(vis, a, b, nb) {
    const key = [state.filtered.length, a, b, nb, vis.map(s => s.id + ':' + s.offset).join(',')].join('|');
    if (key === binsKey && bins) return bins;
    const counts = vis.map(() => new Float32Array(nb));
    const errs = vis.map(() => new Uint8Array(nb));
    const span = b - a;
    for (const e of state.filtered) {
      if (e.te < a || e.te > b) continue;
      const bi = Math.min(nb - 1, Math.floor((e.te - a) / span * nb));
      counts[e.src.lane][bi]++;
      if (e.level === 'error') errs[e.src.lane][bi] = 1;
    }
    binsKey = key;
    bins = { counts, errs, max: counts.map(c => c.reduce((m, v) => Math.max(m, v), 0)) };
    return bins;
  }

  function niceStep(span, n) {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5, 72e5, 108e5, 216e5, 432e5, 864e5, 1728e5, 6048e5];
    for (const s of steps) if (span / s <= n) return s;
    return steps[steps.length - 1];
  }

  function drawBraid() {
    const cv = els.braid;
    const vis = visibleSources();
    const W = cv.clientWidth;
    if (!W) return;
    const L = W < 520 ? 64 : BRAID.labelW;
    const lanes = Math.max(1, vis.length);
    const H = lanes * BRAID.lane + BRAID.axis;
    if (cv.style.height !== H + 'px') cv.style.height = H + 'px';
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const col = n => css.getPropertyValue(n).trim();
    const INK = col('--ink'), MUTED = col('--muted'), FAINT = col('--faint'), LINE = col('--line-soft'), ACC = col('--accent'), ERR = col('--err');
    const PW = W - L - 6;
    const [a, b] = axisRange();
    const x = t => L + (t - a) / (b - a) * PW;
    const tAt = px => a + (Math.min(Math.max(px, L), L + PW) - L) / PW * (b - a);
    drawBraid.tAt = tAt;
    drawBraid.L = L;

    g.font = '11px ' + col('--mono');
    g.textBaseline = 'middle';

    // Graduations
    const step = niceStep(b - a, Math.max(2, PW / 95));
    const t0 = Math.ceil(a / step) * step;
    g.fillStyle = FAINT;
    g.textAlign = 'center';
    for (let t = t0; t <= b; t += step) {
      const px = Math.round(x(t)) + 0.5;
      g.fillStyle = LINE;
      g.fillRect(px - 0.5, 0, 1, lanes * BRAID.lane);
      g.fillStyle = FAINT;
      const lab = step >= 864e5 ? dayLabel(t).split(' ').slice(1, 3).join(' ') : clock(t, step < 1000);
      g.fillText(lab, Math.min(Math.max(px, L + 30), W - 34), lanes * BRAID.lane + 11);
    }

    if (!vis.length) return;
    const nb = Math.max(1, Math.floor(PW / 3));
    const B = computeBins(vis, a, b, nb);
    const bw = PW / nb;

    vis.forEach((s, li) => {
      const y = li * BRAID.lane;
      g.fillStyle = LINE;
      g.fillRect(L, y + BRAID.lane / 2, PW, 1);
      const c = B.counts[li], mx = Math.log1p(B.max[li] || 1);
      g.fillStyle = s.color;
      for (let i = 0; i < nb; i++) {
        if (!c[i]) continue;
        g.globalAlpha = 0.22 + 0.78 * Math.log1p(c[i]) / mx;
        g.fillRect(L + i * bw, y + 4, Math.max(1, bw - 0.6), BRAID.lane - 8);
      }
      g.globalAlpha = 1;
      g.fillStyle = ERR;
      const er = B.errs[li];
      for (let i = 0; i < nb; i++) if (er[i]) g.fillRect(L + i * bw - 0.5, y + BRAID.lane - 4, Math.max(2, bw), 3);
      g.textAlign = 'left';
      g.fillStyle = MUTED;
      let name = s.name;
      while (name.length > 2 && g.measureText(name).width > L - 18) name = name.slice(0, -2) + '…';
      g.fillStyle = s.color;
      g.beginPath(); g.arc(4, y + BRAID.lane / 2, 3.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = MUTED;
      g.fillText(name, 12, y + BRAID.lane / 2);
    });

    const LH = lanes * BRAID.lane;

    // Fenêtre visible dans la liste
    const w = visibleWindow();
    if (w && !(w[1] < a || w[0] > b)) {
      const x0 = Math.max(L, x(w[0])), x1 = Math.min(L + PW, Math.max(x(w[1]), x0 + 2));
      g.fillStyle = ACC;
      g.globalAlpha = 0.1;
      g.fillRect(x0, 0, x1 - x0, LH);
      g.globalAlpha = 1;
      g.strokeStyle = ACC;
      g.lineWidth = 1;
      g.strokeRect(Math.round(x0) + 0.5, 0.5, Math.max(1, Math.round(x1 - x0) - 1), LH - 1);
    }

    // Occurrences du fil choisi
    if (state.token) {
      const tk = state.tokens.get(state.token);
      if (tk) {
        g.fillStyle = INK;
        for (const e of tk.entries) {
          if (e.te < a || e.te > b || e.src.lane == null || !e.src.visible) continue;
          g.fillRect(Math.round(x(e.te)) - 1, e.src.lane * BRAID.lane + 1, 2, BRAID.lane - 2);
        }
      }
    }

    // T0
    if (state.anchor && state.anchor.te >= a && state.anchor.te <= b) {
      g.strokeStyle = ACC;
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(Math.round(x(state.anchor.te)) + 0.5, 0); g.lineTo(Math.round(x(state.anchor.te)) + 0.5, LH); g.stroke();
      g.setLineDash([]);
    }

    // Sélection en cours
    if (drag && Math.abs(drag.x1 - drag.x0) > 3) {
      const x0 = Math.max(L, Math.min(drag.x0, drag.x1)), x1 = Math.min(L + PW, Math.max(drag.x0, drag.x1));
      g.fillStyle = ACC;
      g.globalAlpha = 0.2;
      g.fillRect(x0, 0, x1 - x0, LH);
      g.globalAlpha = 1;
    }

    // Survol
    if (hoverX != null && hoverX >= L) {
      const px = Math.round(Math.min(hoverX, L + PW)) + 0.5;
      g.strokeStyle = INK;
      g.globalAlpha = 0.5;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, LH); g.stroke();
      g.globalAlpha = 1;
      const lab = clock(tAt(hoverX));
      g.font = '600 11px ' + col('--mono');
      const tw = g.measureText(lab).width + 10;
      const bx = Math.min(Math.max(px - tw / 2, L), W - tw);
      g.fillStyle = INK;
      g.fillRect(bx, LH + 2, tw, 17);
      g.fillStyle = col('--surface');
      g.textAlign = 'center';
      g.fillText(lab, bx + tw / 2, LH + 11);
    }
  }

  let braidQueued = false;
  function scheduleBraid() {
    if (braidQueued) return;
    braidQueued = true;
    requestAnimationFrame(() => { braidQueued = false; drawBraid(); });
  }

  els.braid.addEventListener('pointerdown', ev => {
    if (!state.merged.length || ev.offsetX < (drawBraid.L || 0)) return;
    drag = { x0: ev.offsetX, x1: ev.offsetX };
    els.braid.setPointerCapture(ev.pointerId);
  });
  els.braid.addEventListener('pointermove', ev => {
    hoverX = ev.offsetX;
    if (drag) drag.x1 = ev.offsetX;
    scheduleBraid();
  });
  els.braid.addEventListener('pointerleave', () => { hoverX = null; scheduleBraid(); });
  els.braid.addEventListener('pointerup', ev => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const tAt = drawBraid.tAt;
    if (Math.abs(d.x1 - d.x0) < 4) {
      const i = rowAtTime(tAt(d.x0));
      const r = state.rows[i];
      if (r) scrollToRow(i, r.e || (state.rows[i + 1] && state.rows[i + 1].e));
    } else {
      const t0 = tAt(Math.min(d.x0, d.x1)), t1 = tAt(Math.max(d.x0, d.x1));
      state.range = [t0, t1];
      applyFilters();
      els.viewport.scrollTop = 0;
      renderRows();
    }
    drawBraid();
  });
  els.braid.addEventListener('pointercancel', () => { drag = null; scheduleBraid(); });

  /* ---------- Fils communs ---------- */

  function renderThreads() {
    els.threadsCount.textContent = state.shared.length ? nf(state.shared.length) : '';
    const f = state.threadFilter.toLowerCase();
    const list = f ? state.shared.filter(r => r.tok.toLowerCase().includes(f)) : state.shared;
    const cap = 250;
    let h = list.slice(0, cap).map(r => {
      const dots = [...r.srcs].sort((x, y) => x.idx - y.idx).map(s => `<i style="--c:${s.color}" title="${esc(s.name)}"></i>`).join('');
      return `<li><button type="button" class="${r.tok === state.token ? 'on' : ''}" data-tok="${esc(r.tok)}"><span class="tk">${r.err ? '<span class="e" title="Lié à une erreur"></span>' : ''}${esc(r.tok)}</span><span class="dots">${dots}</span><span class="tn">${r.entries.length}</span></button></li>`;
    }).join('');
    if (list.length > cap) h += `<li class="more">${nf(list.length - cap)} autres fils. Filtrez pour les trouver.</li>`;
    if (!list.length) h = `<li class="more">${state.shared.length ? 'Aucun fil ne correspond.' : 'Aucun identifiant commun à plusieurs sources pour l\'instant.'}</li>`;
    els.threadList.innerHTML = h;
    renderJourney();
  }

  function renderJourney() {
    const tk = state.token && state.tokens.get(state.token);
    if (!tk) { els.journey.innerHTML = ''; return; }
    const first = tk.entries[0].te, last = tk.entries[tk.entries.length - 1].te;
    const steps = tk.entries.slice(0, 120).map((e, i) => {
      const text = e.line.length > 160 ? e.line.slice(0, 160) + '…' : e.line;
      return `<li class="lv-${e.level}" data-j="${i}" style="--c:${e.src.color}"><span class="jd"></span><span class="jt">${compactDt(e.te - first)}</span><span class="jm"><span class="js">${esc(e.src.name)}</span><span class="lvb lv-${e.level}">${LV_SHORT[e.level]}</span><span class="jx">${esc(text)}</span></span></li>`;
    }).join('');
    els.journey.innerHTML = `<section class="journey" aria-label="Parcours du fil">
      <div class="j-top"><span class="tok">${esc(tk.tok)}</span><button type="button" class="ico" id="j-close" aria-label="Fermer le fil">×</button></div>
      <p class="j-sum">${nf(tk.entries.length)} ligne${tk.entries.length > 1 ? 's' : ''} · ${tk.srcs.size} sources · durée ${dur(last - first)}</p>
      <label class="switch"><input type="checkbox" id="j-only" ${state.threadOnly ? 'checked' : ''}> N'afficher que ce fil dans le journal</label>
      <ol class="j-steps">${steps}</ol>
      ${tk.entries.length > 120 ? `<p class="j-sum">120 premières lignes affichées.</p>` : ''}
    </section>`;
  }

  function selectToken(tok) {
    state.token = tok;
    showTab('threads');
    if (state.threadOnly) applyFilters();
    else { renderRows(); drawBraid(); renderThreads(); renderSummary(); }
    const tk = state.tokens.get(tok);
    if (tk) {
      const btn = els.threadList.querySelector(`button[data-tok="${CSS.escape(tok)}"]`);
      if (btn) btn.scrollIntoView({ block: 'nearest' });
      const first = tk.entries.find(e => state.rowOf.has(e)) || tk.entries[0];
      revealEntry(first, false);
    }
  }

  function clearToken() {
    state.token = null;
    const wasOnly = state.threadOnly;
    state.threadOnly = false;
    if (wasOnly) applyFilters(); else { renderRows(); drawBraid(); renderThreads(); renderSummary(); }
  }

  els.threadList.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-tok]');
    if (!b) return;
    if (b.dataset.tok === state.token) clearToken(); else selectToken(b.dataset.tok);
  });
  els.threadFilter.addEventListener('input', () => { state.threadFilter = els.threadFilter.value.trim(); renderThreads(); });
  els.journey.addEventListener('click', ev => {
    if (ev.target.closest('#j-close')) { clearToken(); return; }
    const li = ev.target.closest('li[data-j]');
    if (!li) return;
    const e = state.tokens.get(state.token).entries[+li.dataset.j];
    select(e, false);
    revealEntry(e);
  });
  els.journey.addEventListener('change', ev => {
    if (ev.target.id === 'j-only') { state.threadOnly = ev.target.checked; applyFilters(); els.viewport.scrollTop = 0; renderRows(); drawBraid(); }
  });

  /* ---------- Détail ---------- */

  function showTab(which) {
    const t = which === 'detail';
    els.tabDetail.setAttribute('aria-selected', String(t));
    els.tabThreads.setAttribute('aria-selected', String(!t));
    els.panelDetail.hidden = !t;
    els.panelThreads.hidden = t;
  }
  els.tabThreads.addEventListener('click', () => showTab('threads'));
  els.tabDetail.addEventListener('click', () => showTab('detail'));

  function select(e, openDetail = true) {
    state.selected = e;
    renderDetail();
    if (openDetail) showTab('detail');
    renderRows();
  }

  function renderDetail() {
    const e = state.selected;
    if (!e) { els.detail.innerHTML = '<p class="muted">Cliquez sur une ligne pour voir son détail. Les flèches ↑ ↓ parcourent le journal.</p>'; return; }
    const s = e.src;
    const text = e.cont ? e.line + '\n' + e.cont.join('\n') : e.line;
    const ids = e.ids.map(t => `<button type="button" data-tok="${esc(t)}" class="${state.sharedSet.has(t) ? 'shared' : ''}" title="${state.sharedSet.has(t) ? 'Présent dans plusieurs sources' : 'Présent dans une seule source'}">${esc(t)}</button>`).join('');
    const a = state.anchor;
    let dl = `<dt>Heure</dt><dd>${fullStamp(e.te)}</dd>`;
    if (s.offset) dl += `<dt>Horloge source</dt><dd>${clock(e.t)} (décalage ${s.offset > 0 ? '+' : '−'}${nf(Math.abs(s.offset))} ms)</dd>`;
    if (a && a !== e) dl += `<dt>Depuis T0</dt><dd>${sdur(e.te - a.te)}</dd>`;
    dl += `<dt>Ligne</dt><dd>${nf(e.n)} de ${esc(s.name)}</dd>`;
    let actions = `<button type="button" class="btn small" data-act="anchor">${a === e ? 'Retirer T0' : 'Définir comme T0'}</button>`;
    if (a && a !== e && a.src !== e.src) actions += `<button type="button" class="btn small" data-act="align" title="Décale toute la source « ${esc(s.name)} » pour que cette ligne tombe sur T0">Caler « ${esc(s.name)} » sur T0</button>`;
    actions += `<button type="button" class="btn small ghost" data-act="copy">Copier</button>`;
    els.detail.innerHTML = `<div class="detail">
      <div class="d-head"><span class="tag" style="--c:${s.color}">${esc(s.name)}</span><span class="lvb lv-${e.level}">${LV_SHORT[e.level]}</span></div>
      <dl>${dl}</dl>
      <pre class="d-text">${esc(text)}</pre>
      ${ids ? `<div><p class="muted small">Identifiants repérés</p><div class="d-ids">${ids}</div></div>` : ''}
      <div class="d-actions">${actions}</div>
      ${a && a !== e && a.src !== e.src ? `<p class="d-note">T0 est une ligne de ${esc(a.src.name)}. Si ces deux lignes décrivent le même instant, « Caler » corrige l'écart d'horloge entre les deux sources.</p>` : ''}
      ${!a ? '<p class="d-note">Astuce : définissez T0 sur une ligne, puis choisissez sur une autre source la ligne qui correspond au même instant pour caler leurs horloges.</p>' : ''}
    </div>`;
  }

  els.detail.addEventListener('click', ev => {
    const tb = ev.target.closest('button[data-tok]');
    if (tb) { selectToken(tb.dataset.tok); return; }
    const b = ev.target.closest('button[data-act]');
    if (!b || !state.selected) return;
    const e = state.selected;
    if (b.dataset.act === 'anchor') setAnchor(state.anchor === e ? null : e);
    else if (b.dataset.act === 'align') {
      const delta = Math.round(state.anchor.te - e.te);
      e.src.offset += delta;
      rebuild();
      renderSources();
      revealEntry(e);
      toast(`« ${e.src.name} » décalé de ${delta > 0 ? '+' : '−'}${nf(Math.abs(delta))} ms. Décalage total : ${nf(e.src.offset)} ms.`);
    } else if (b.dataset.act === 'copy') {
      copyText(e.cont ? e.line + '\n' + e.cont.join('\n') : e.line, 'Ligne copiée.');
    }
  });

  function setAnchor(e) {
    state.anchor = e;
    renderSummary(); renderRows(); renderDetail(); drawBraid();
  }

  /* ---------- Panneau des sources ---------- */

  function tzOptions(sel) {
    return TZ_OPTS.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');
  }

  function renderSources() {
    els.srcCount.textContent = state.sources.length ? `${state.sources.length} source${state.sources.length > 1 ? 's' : ''}` : '';
    els.sourceList.innerHTML = state.sources.map(s => {
      const r = s.parsed;
      const meta = r.entries.length
        ? `${nf(r.entries.length)} entrées · ${esc(r.formatLabel)}${r.orphans ? ` · ${nf(r.orphans)} ligne${r.orphans > 1 ? 's' : ''} avant le premier horodatage` : ''}`
        : `<span class="warn-text">Aucun horodatage reconnu dans ${nf(r.lineCount)} lignes.</span>`;
      const zoned = r.zoned > 0.9;
      const tz = zoned
        ? `<label>Fuseau<span class="fixed">lu dans les journaux</span></label>`
        : `<label>Fuseau<select data-act="tz" id="tz-${s.id}">${tzOptions(s.tz)}</select></label>`;
      const date = r.needs ? `<label>${r.needs === 'year' ? 'Année / date' : 'Date'}<input type="date" data-act="date" id="date-${s.id}" value="${s.date}"></label>` : '';
      return `<article class="src${s.visible ? '' : ' off'}" data-id="${s.id}" style="--c:${s.color}">
        <div class="src-top">
          <button type="button" class="swatch" data-act="color" title="Changer la couleur" aria-label="Changer la couleur de ${esc(s.name)}"></button>
          <input class="src-name" data-act="name" id="name-${s.id}" value="${esc(s.name)}" aria-label="Nom de la source" spellcheck="false">
          <button type="button" class="ico" data-act="vis" aria-pressed="${s.visible}" title="${s.visible ? 'Masquer' : 'Afficher'} cette source">${s.visible ? 'Masquer' : 'Afficher'}</button>
          <button type="button" class="ico" data-act="del" title="Retirer cette source">Retirer</button>
        </div>
        <p class="src-meta">${meta}</p>
        ${r.entries.length ? `<div class="src-grid">${tz}${date}</div>
        <div class="offset"><span class="lbl">Décalage d'horloge</span>
          <div class="off-ctl">
            <button type="button" data-act="nudge" data-v="-1000" aria-label="Moins une seconde">−1s</button>
            <button type="button" data-act="nudge" data-v="-100" aria-label="Moins 100 millisecondes">−100</button>
            <input type="number" step="1" data-act="offset" id="off-${s.id}" value="${s.offset}" class="${s.offset ? 'nonzero' : ''}" aria-label="Décalage en millisecondes">
            <span class="unit">ms</span>
            <button type="button" data-act="nudge" data-v="100" aria-label="Plus 100 millisecondes">+100</button>
            <button type="button" data-act="nudge" data-v="1000" aria-label="Plus une seconde">+1s</button>
          </div>
        </div>` : ''}
      </article>`;
    }).join('');
  }

  const srcOf = el => { const c = el.closest('.src'); return c && state.sources.find(s => s.id === +c.dataset.id); };

  els.sourceList.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const s = srcOf(b);
    if (!s) return;
    const act = b.dataset.act;
    if (act === 'color') {
      s.color = COLORS[(COLORS.indexOf(s.color) + 1) % COLORS.length];
      binsKey = '';
      renderSources(); rebuild();
    } else if (act === 'vis') {
      s.visible = !s.visible;
      renderSources(); rebuild();
    } else if (act === 'del') {
      if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.textContent = 'Confirmer';
        setTimeout(() => { if (b.isConnected) { b.classList.remove('confirm'); b.textContent = 'Retirer'; } }, 3000);
        return;
      }
      state.sources = state.sources.filter(x => x !== s);
      if (!state.sources.some(x => x.demo)) state.demo = false;
      renderSources(); rebuild();
      toast(`Source « ${s.name} » retirée.`);
    } else if (act === 'nudge') {
      setOffset(s, s.offset + Number(b.dataset.v));
    }
  });

  els.sourceList.addEventListener('change', ev => {
    const t = ev.target, s = srcOf(t);
    if (!s) return;
    if (t.dataset.act === 'tz') { s.tz = t.value; parseSrc(s); renderSources(); rebuild(); }
    else if (t.dataset.act === 'date') { if (t.value) { s.date = t.value; parseSrc(s); renderSources(); rebuild(); } }
    else if (t.dataset.act === 'offset') setOffset(s, Math.round(Number(t.value) || 0));
  });

  els.sourceList.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.act !== 'name') return;
    const s = srcOf(t);
    s.name = t.value || 'sans nom';
    renderRows(); drawBraid(); renderThreads(); renderDetail(); renderSummary();
  });

  function setOffset(s, v) {
    const keep = state.selected || firstVisibleEntry();
    s.offset = v;
    const inp = document.getElementById('off-' + s.id);
    if (inp) { inp.value = v; inp.classList.toggle('nonzero', !!v); }
    rebuild();
    if (keep) revealEntry(keep, false);
  }

  function firstVisibleEntry() {
    const i = Math.floor(els.viewport.scrollTop / RH);
    for (let k = i; k < Math.min(state.rows.length, i + 40); k++) if (state.rows[k].e) return state.rows[k].e;
    return null;
  }

  /* ---------- Ajout de journaux ---------- */

  function dropDemo() {
    if (!state.demo) return false;
    state.sources = state.sources.filter(s => !s.demo);
    state.demo = false;
    state.token = null; state.threadOnly = false; state.range = null; state.anchor = null; state.selected = null;
    return true;
  }

  function ingest(items) {
    const removed = dropDemo();
    const added = items.map(addSource);
    renderSources();
    rebuild();
    const n = added.reduce((k, s) => k + s.entries.length, 0);
    const bad = added.filter(s => !s.entries.length).map(s => s.name);
    let msg = added.length === 1 ? `« ${added[0].name} » ajoutée : ${nf(n)} entrées.` : `${added.length} sources ajoutées : ${nf(n)} entrées.`;
    if (bad.length) msg += ` Aucun horodatage reconnu dans ${bad.join(', ')}.`;
    if (removed) msg += ' L\'exemple a été retiré.';
    toast(msg);
  }

  async function readFiles(files) {
    const list = [...files];
    if (!list.length) return;
    const items = await Promise.all(list.map(async f => ({ name: f.name.replace(/\.(log|txt|json|jsonl|ndjson)$/i, ''), text: await f.text() })));
    ingest(items);
  }

  els.addTz.innerHTML = tzOptions('local');
  els.btnAdd.addEventListener('click', () => {
    els.addName.value = '';
    els.addText.value = '';
    els.addDialog.showModal();
    els.addText.focus();
  });
  els.addCancel.addEventListener('click', () => els.addDialog.close());
  els.addForm.addEventListener('submit', ev => {
    ev.preventDefault();
    const text = els.addText.value;
    if (!text.trim()) { els.addText.focus(); toast('Collez au moins une ligne de journal.'); return; }
    els.addDialog.close();
    ingest([{ name: els.addName.value.trim() || `source ${state.sources.length + 1}`, text, tz: els.addTz.value }]);
  });
  els.addFiles.addEventListener('change', () => { els.addDialog.close(); readFiles(els.addFiles.files); els.addFiles.value = ''; });
  els.fileInput.addEventListener('change', () => { readFiles(els.fileInput.files); els.fileInput.value = ''; });

  let dragDepth = 0;
  const hasFiles = ev => ev.dataTransfer && [...ev.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', ev => { if (!hasFiles(ev)) return; ev.preventDefault(); dragDepth++; els.drop.hidden = false; });
  window.addEventListener('dragover', ev => { if (hasFiles(ev)) ev.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) els.drop.hidden = true; });
  window.addEventListener('drop', ev => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth = 0;
    els.drop.hidden = true;
    readFiles(ev.dataTransfer.files);
  });

  document.addEventListener('paste', ev => {
    if (ev.target.closest && ev.target.closest('input, textarea, [contenteditable]')) return;
    const text = ev.clipboardData && ev.clipboardData.getData('text');
    if (!text || !text.trim()) return;
    ev.preventDefault();
    ingest([{ name: `collé ${++pasteN}`, text }]);
  });

  /* ---------- Barre d'outils ---------- */

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = els.search.value;
      const m = /^\/(.+)\/([imsu]*)$/.exec(v.trim());
      let bad = false;
      if (m) {
        try { state.qre = new RegExp(m[1], m[2]); state.q = v; } catch (e) { bad = true; }
      } else { state.qre = null; state.q = v.toLowerCase(); }
      if (bad) { state.qre = null; state.q = ''; }
      els.search.classList.toggle('bad', bad);
      els.searchErr.hidden = !bad;
      applyFilters();
      els.viewport.scrollTop = 0;
      renderRows(); drawBraid();
    }, 120);
  });

  els.levels.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-lv]');
    if (!b) return;
    const k = b.dataset.lv;
    if (ev.altKey || ev.metaKey) state.levels = new Set([k]);
    else if (state.levels.has(k)) state.levels.delete(k); else state.levels.add(k);
    if (!state.levels.size) state.levels = new Set(LEVELS.map(l => l[0]));
    applyFilters();
  });

  els.gap.value = String(state.gap);
  els.gap.addEventListener('change', () => { state.gap = Number(els.gap.value); store.set('gap', state.gap); applyFilters(); });
  els.displayTz.value = state.displayTz;
  els.displayTz.addEventListener('change', () => { state.displayTz = els.displayTz.value; store.set('displayTz', state.displayTz); applyFilters(); });
  els.fold.addEventListener('change', () => {
    const keep = firstVisibleEntry();
    state.fold = els.fold.checked;
    buildRows(); renderRows();
    if (keep) revealEntry(keep, false);
  });
  els.btnUnzoom.addEventListener('click', () => { state.range = null; applyFilters(); });

  els.summary.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-clear]');
    if (!b) return;
    const k = b.dataset.clear;
    if (k === 'range') { state.range = null; applyFilters(); }
    else if (k === 'thread') { state.threadOnly = false; applyFilters(); }
    else if (k === 'anchor') setAnchor(null);
  });

  function nextError(dir) {
    const rows = state.rows;
    const vp = els.viewport;
    let i = state.selected && state.rowOf.has(state.selected) ? state.rowOf.get(state.selected) : Math.floor(vp.scrollTop / RH) + (dir > 0 ? 0 : 1);
    for (i += dir; i >= 0 && i < rows.length; i += dir) {
      const r = rows[i];
      if (r.k === 'e' && r.e.level === 'error') { select(r.e); scrollToRow(i, r.e); return; }
    }
    toast(dir > 0 ? 'Plus d\'erreur plus bas.' : 'Plus d\'erreur plus haut.');
  }
  els.btnNextErr.addEventListener('click', () => nextError(1));

  /* ---------- Liste : défilement, clics, clavier ---------- */

  let rowsQueued = false;
  els.viewport.addEventListener('scroll', () => {
    if (rowsQueued) return;
    rowsQueued = true;
    requestAnimationFrame(() => { rowsQueued = false; renderRows(); drawBraid(); });
  }, { passive: true });

  els.rows.addEventListener('click', ev => {
    const m = ev.target.closest('mark[data-tok]');
    if (m) { selectToken(m.dataset.tok); return; }
    const row = ev.target.closest('.row[data-r]');
    if (!row) return;
    const r = state.rows[+row.dataset.r];
    if (r && r.e) select(r.e);
  });
  els.rows.addEventListener('dblclick', ev => {
    const row = ev.target.closest('.row[data-r]');
    const r = row && state.rows[+row.dataset.r];
    if (r && r.e) setAnchor(state.anchor === r.e ? null : r.e);
  });

  function moveSel(dir) {
    const f = state.filtered;
    if (!f.length) return;
    let i = state.selected ? f.indexOf(state.selected) : -1;
    if (i < 0) { const fe = firstVisibleEntry(); i = fe ? f.indexOf(fe) - dir : -1; }
    i = Math.min(f.length - 1, Math.max(0, i + dir));
    select(f[i]);
    scrollToRow(state.rowOf.get(f[i]));
  }

  document.addEventListener('keydown', ev => {
    const t = ev.target;
    if (els.addDialog.open) return;
    if (t.closest && t.closest('input, textarea, select')) {
      if (ev.key === 'Escape' && t === els.search && els.search.value) { els.search.value = ''; els.search.dispatchEvent(new Event('input')); }
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === '/') { ev.preventDefault(); els.search.focus(); }
    else if (ev.key === 'n') nextError(1);
    else if (ev.key === 'N') nextError(-1);
    else if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); moveSel(1); }
    else if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); moveSel(-1); }
    else if (ev.key === 't' && state.selected) setAnchor(state.anchor === state.selected ? null : state.selected);
    else if (ev.key === 'Escape') {
      if (state.token) clearToken();
      else if (state.range) { state.range = null; applyFilters(); }
      else if (state.selected) { state.selected = null; renderRows(); renderDetail(); }
    }
  });

  /* ---------- Export ---------- */

  function viewText() {
    return state.filtered.map(e => {
      const head = `${fullStamp(e.te)} [${e.src.name}] `;
      return head + e.line + (e.cont ? '\n' + e.cont.join('\n') : '');
    }).join('\n') + '\n';
  }

  function copyText(text, done) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? done : 'La copie a été refusée par le navigateur.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(done), fallback);
    else fallback();
  }

  els.btnCopy.addEventListener('click', () => {
    if (!state.filtered.length) { toast('Rien à copier : la vue est vide.'); return; }
    copyText(viewText(), `${nf(state.filtered.length)} entrées copiées, horodatage et source en tête de ligne.`);
  });

  if (inIframe) els.btnDownload.hidden = true;
  els.btnDownload.addEventListener('click', () => {
    if (!state.filtered.length) { toast('Rien à télécharger : la vue est vide.'); return; }
    const url = URL.createObjectURL(new Blob([viewText()], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tresse-fusion.log';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3800);
  }

  /* ---------- Exemple ---------- */

  function loadDemo() {
    for (const o of window.TresseDemo.build()) addSource(Object.assign({ demo: true }, o));
    state.demo = true;
    renderSources();
    rebuild();
  }

  els.btnDemoClear.addEventListener('click', () => {
    dropDemo();
    renderSources();
    rebuild();
  });
  els.btnDemoFail.addEventListener('click', () => {
    const e = state.merged.find(x => x.level === 'error' && x.ids.some(t => t.startsWith('ord_')));
    if (!e) return;
    selectToken(e.ids.find(t => t.startsWith('ord_')));
  });

  /* ---------- Démarrage ---------- */

  function drawLogo() {
    const paths = [0, 1, 2].map(k => {
      let d = '';
      for (let x = 0; x <= 36; x += 1) {
        const y = 12 + 7.5 * Math.sin(x / 36 * Math.PI * 3 + k * Math.PI * 2 / 3);
        d += (x ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(2);
      }
      return `<path d="${d}" fill="none" stroke="${COLORS[k]}" stroke-width="3" stroke-linecap="round"/>`;
    });
    els.logo.innerHTML = paths.join('');
  }

  els.formatList.innerHTML = P.formats.map(f => `<li><b>${esc(f.label)}</b><code>${esc(FORMAT_EXAMPLES[f.id] || '')}</code></li>`).join('');

  const ro = new ResizeObserver(() => { renderRows(); drawBraid(); });
  ro.observe(els.viewport);
  ro.observe(els.braid);
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawBraid());
    new MutationObserver(() => drawBraid()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  drawLogo();
  loadDemo();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => drawBraid());
})();
