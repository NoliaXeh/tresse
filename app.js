/* Tresse — UI: merging, virtualized list, braid, shared threads, clock alignment. */
(function () {
  'use strict';

  const P = window.TresseParser;
  const Q = window.TresseQuery;
  const RH = 22;
  const LANE = 10;
  const COLORS = ['#4C7EF3', '#E8773A', '#1FAE7E', '#B05BD6', '#D9A21B', '#1BA5BF', '#D9467A', '#7FA32E'];
  const LEVELS = [['error', 'Errors'], ['warn', 'Warn'], ['info', 'Info'], ['debug', 'Debug'], ['other', 'Other']];
  const LV_SHORT = { error: 'ERR', warn: 'WARN', info: 'INFO', debug: 'DBG', other: '·' };
  const FORMAT_EXAMPLES = {
    json: '{"level":30,"time":1790596931482,"msg":"…"}',
    iso: '2026-09-28 12:02:11,482 INFO …',
    clf: '81.64.12.9 - - [28/Sep/2026:14:02:11 +0200] "GET /" 200',
    eu: '28/09/2026 12:02:11 WARN …',
    redis: '1:M 28 Sep 2026 12:02:11.482 * Ready to accept connections',
    'redis-old': '1:M 28 Sep 12:02:11.482 # Server initialized',
    klog: 'I0928 12:02:11.482913 1 main.go:42] …',
    syslog: 'Sep 28 12:02:11 web-1 sshd[812]: …',
    epoch: '1790596931.482 INFO …',
    time: '12:02:11.482 [main] DEBUG …',
  };

  const $ = s => document.querySelector(s);
  const p2 = n => String(n).padStart(2, '0');
  const p3 = n => String(n).padStart(3, '0');
  const nf = n => n.toLocaleString('en-US');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inIframe = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  const store = {
    get(k, d) { try { const v = localStorage.getItem('tresse.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tresse.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const els = {};
  ['search', 'search-hl', 'search-msg', 'suggest', 'btn-qhelp', 'qhelp', 'levels', 'gap', 'display-tz', 'fold', 'btn-next-err', 'braid', 'btn-unzoom', 'summary',
    'viewport', 'spacer', 'rows', 'source-list', 'src-count', 'thread-list', 'thread-filter', 'threads-count', 'journey',
    'detail', 'tab-threads', 'tab-detail', 'panel-threads', 'panel-detail', 'empty', 'work', 'format-list', 'banner',
    'add-dialog', 'add-form', 'add-name', 'add-text', 'add-tz', 'add-files', 'add-cancel', 'file-input', 'drop', 'toast',
    'btn-add', 'btn-copy', 'btn-download', 'btn-demo-fail', 'btn-demo-clear', 'logo',
  ].forEach(id => { els[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

  const state = {
    sources: [], merged: [], filtered: [], rows: [], rowT: new Float64Array(0), rowOf: new Map(),
    tokens: new Map(), shared: [], sharedSet: new Set(),
    query: '', qc: null, levels: new Set(LEVELS.map(l => l[0])),
    range: null, token: null, threadOnly: false,
    selected: null, anchor: null, flash: null,
    displayTz: store.get('displayTz', 'local'), gap: store.get('gap', 5000), fold: false,
    demo: false, span: [0, 0], threadFilter: '',
  };
  let uid = 0, colorIdx = 0, pasteN = 0;

  /* ---------- Time ---------- */

  const TZ_OPTS = [['local', 'Browser local time'], ['0', 'UTC']];
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
  function dayLabel(t, short = false) {
    const o = short ? { day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    return new Intl.DateTimeFormat('en-US', Object.assign(o, { timeZone: state.displayTz === 'utc' ? 'UTC' : undefined })).format(new Date(t));
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
    if (a < 60000) return (a / 1000).toLocaleString('en-US', { maximumFractionDigits: a < 10000 ? 2 : 1 }) + ' s';
    if (a < 3600000) return Math.floor(a / 60000) + ' min ' + p2(Math.floor(a % 60000 / 1000)) + ' s';
    if (a < 86400000) return Math.floor(a / 3600000) + ' h ' + p2(Math.floor(a % 3600000 / 60000)) + ' min';
    return Math.floor(a / 86400000) + ' d ' + Math.floor(a % 86400000 / 3600000) + ' h';
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

  /* ---------- Filters and rows ---------- */

  function applyFilters() {
    compileQuery();
    const { levels, range } = state;
    const test = state.qc && state.qc.test;
    const only = state.threadOnly && state.token ? new Set(state.tokens.get(state.token).entries) : null;
    const allLv = levels.size === LEVELS.length;
    const out = [];
    for (const e of state.merged) {
      if (!allLv && !levels.has(e.level)) continue;
      if (range && (e.te < range[0] || e.te > range[1])) continue;
      if (only && !only.has(e)) continue;
      if (test && !test(e)) continue;
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

  /* ---------- Row rendering ---------- */

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
    const hl = state.qc && state.qc.hl;
    if (hl) {
      let n = 0;
      for (const re of hl.res) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) && n++ < 30) {
          if (!m[0].length) { re.lastIndex++; continue; }
          R.push([m.index, m.index + m[0].length, 'hl']);
        }
      }
      if (hl.subs.length) {
        const lc = text.toLowerCase();
        for (const q of hl.subs) {
          let k = lc.indexOf(q);
          while (k !== -1 && n++ < 60) { R.push([k, k + q.length, 'hl']); k = lc.indexOf(q, k + q.length); }
        }
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
    if (r.k === 'g') return `<div class="row gap" style="top:${top}px"><span class="meta"><span class="gut"></span><span class="label">${dur(r.dt)} without activity</span></span></div>`;
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
      // The entry is hidden by a filter: clear the filters that exclude it.
      state.query = ''; els.search.value = ''; paintQuery();
      state.levels = new Set(LEVELS.map(l => l[0]));
      if (state.range && (e.te < state.range[0] || e.te > state.range[1])) state.range = null;
      if (state.threadOnly && !(state.token && e.ids.includes(state.token))) state.threadOnly = false;
      applyFilters();
      i = state.rowOf.get(e);
    }
    if (i != null) scrollToRow(i, flash ? e : null);
  }

  /* ---------- Summary and levels ---------- */

  function renderLevels() {
    const cnt = {};
    for (const e of state.merged) cnt[e.level] = (cnt[e.level] || 0) + 1;
    els.levels.innerHTML = LEVELS.filter(([k]) => cnt[k] || k === 'error').map(([k, label]) =>
      `<button type="button" class="chip lv-${k}" data-lv="${k}" aria-pressed="${state.levels.has(k)}"><b>${label}</b><span class="n">${nf(cnt[k] || 0)}</span></button>`).join('');
  }

  function renderSummary() {
    const f = state.filtered, m = state.merged;
    if (!m.length) { els.summary.innerHTML = '<span>No timestamped lines yet.</span>'; return; }
    const nErr = f.reduce((n, e) => n + (e.level === 'error'), 0);
    const a = f.length ? f[0].te : 0, b = f.length ? f[f.length - 1].te : 0;
    let h = `<span><b>${nf(f.length)}</b> entr${f.length === 1 ? 'y' : 'ies'}${f.length !== m.length ? ` of ${nf(m.length)}` : ''}</span>`;
    if (f.length) h += `<span>${clock(a, false)} → ${clock(b, false)} (${dur(b - a)})</span>`;
    h += `<span class="errn">${nf(nErr)} error${nErr === 1 ? '' : 's'}</span>`;
    if (state.range) h += `<span class="pill">Range ${clock(state.range[0])} → ${clock(state.range[1])}<button type="button" data-clear="range" aria-label="Clear range">×</button></span>`;
    if (state.threadOnly && state.token) h += `<span class="pill">Thread ${esc(short(state.token))}<button type="button" data-clear="thread" aria-label="Show all threads">×</button></span>`;
    if (state.anchor) h += `<span class="pill">T0 ${clock(state.anchor.te)} · ${esc(state.anchor.src.name)}<button type="button" data-clear="anchor" aria-label="Clear T0">×</button></span>`;
    els.summary.innerHTML = h;
  }

  const short = t => t.length > 22 ? t.slice(0, 10) + '…' + t.slice(-6) : t;

  /* ---------- The braid (canvas) ---------- */

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

    // Ticks
    const step = niceStep(b - a, Math.max(2, PW / 95));
    const t0 = Math.ceil(a / step) * step;
    g.fillStyle = FAINT;
    g.textAlign = 'center';
    for (let t = t0; t <= b; t += step) {
      const px = Math.round(x(t)) + 0.5;
      g.fillStyle = LINE;
      g.fillRect(px - 0.5, 0, 1, lanes * BRAID.lane);
      g.fillStyle = FAINT;
      const lab = step >= 864e5 ? dayLabel(t, true) : clock(t, step < 1000);
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

    // Window visible in the list
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

    // Occurrences of the selected thread
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

    // Selection in progress
    if (drag && Math.abs(drag.x1 - drag.x0) > 3) {
      const x0 = Math.max(L, Math.min(drag.x0, drag.x1)), x1 = Math.min(L + PW, Math.max(drag.x0, drag.x1));
      g.fillStyle = ACC;
      g.globalAlpha = 0.2;
      g.fillRect(x0, 0, x1 - x0, LH);
      g.globalAlpha = 1;
    }

    // Hover
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

  /* ---------- Shared threads ---------- */

  function renderThreads() {
    els.threadsCount.textContent = state.shared.length ? nf(state.shared.length) : '';
    const f = state.threadFilter.toLowerCase();
    const list = f ? state.shared.filter(r => r.tok.toLowerCase().includes(f)) : state.shared;
    const cap = 250;
    let h = list.slice(0, cap).map(r => {
      const dots = [...r.srcs].sort((x, y) => x.idx - y.idx).map(s => `<i style="--c:${s.color}" title="${esc(s.name)}"></i>`).join('');
      return `<li><button type="button" class="${r.tok === state.token ? 'on' : ''}" data-tok="${esc(r.tok)}"><span class="tk">${r.err ? '<span class="e" title="Tied to an error"></span>' : ''}${esc(r.tok)}</span><span class="dots">${dots}</span><span class="tn">${r.entries.length}</span></button></li>`;
    }).join('');
    if (list.length > cap) h += `<li class="more">${nf(list.length - cap)} more threads. Filter to find them.</li>`;
    if (!list.length) h = `<li class="more">${state.shared.length ? 'No thread matches.' : 'No identifier shared by several sources yet.'}</li>`;
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
    els.journey.innerHTML = `<section class="journey" aria-label="Thread journey">
      <div class="j-top"><span class="tok">${esc(tk.tok)}</span><button type="button" class="ico" id="j-close" aria-label="Close thread">×</button></div>
      <p class="j-sum">${nf(tk.entries.length)} line${tk.entries.length === 1 ? '' : 's'} · ${tk.srcs.size} sources · duration ${dur(last - first)}</p>
      <label class="switch"><input type="checkbox" id="j-only" ${state.threadOnly ? 'checked' : ''}> Show only this thread in the log</label>
      <ol class="j-steps">${steps}</ol>
      ${tk.entries.length > 120 ? `<p class="j-sum">Showing the first 120 lines.</p>` : ''}
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

  /* ---------- Details ---------- */

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
    if (!e) { els.detail.innerHTML = '<p class="muted">Click a line to see its details. The ↑ ↓ arrows browse the log.</p>'; return; }
    const s = e.src;
    const text = e.cont ? e.line + '\n' + e.cont.join('\n') : e.line;
    const ids = e.ids.map(t => `<button type="button" data-tok="${esc(t)}" class="${state.sharedSet.has(t) ? 'shared' : ''}" title="${state.sharedSet.has(t) ? 'Present in several sources' : 'Present in a single source'}">${esc(t)}</button>`).join('');
    const builtin = new Set(Q.builtins.map(b => b[0]));
    const frow = (k, v) => {
      const term = `${k}:${Q.quote(v)}`;
      const shown = v.length > 90 ? v.slice(0, 90) + '…' : v;
      return `<tr><th>${esc(k)}</th><td title="${esc(v)}">${esc(shown)}</td><td class="f-act">`
        + `<button type="button" data-q="${esc(term)}" title="Only entries with ${esc(term)}" aria-label="Filter on ${esc(term)}">+</button>`
        + `<button type="button" data-q="-${esc(term)}" title="Exclude entries with ${esc(term)}" aria-label="Exclude ${esc(term)}">−</button></td></tr>`;
    };
    const fields = [frow('source', s.name), frow('level', e.level)]
      .concat([...Q.fields(e)].filter(([k]) => !builtin.has(k)).slice(0, 40).map(([k, vs]) => frow(k, vs[0])));
    const a = state.anchor;
    let dl = `<dt>Time</dt><dd>${fullStamp(e.te)}</dd>`;
    if (s.offset) dl += `<dt>Source clock</dt><dd>${clock(e.t)} (offset ${s.offset > 0 ? '+' : '−'}${nf(Math.abs(s.offset))} ms)</dd>`;
    if (a && a !== e) dl += `<dt>Since T0</dt><dd>${sdur(e.te - a.te)}</dd>`;
    dl += `<dt>Line</dt><dd>${nf(e.n)} of ${esc(s.name)}</dd>`;
    let actions = `<button type="button" class="btn small" data-act="anchor">${a === e ? 'Clear T0' : 'Set as T0'}</button>`;
    if (a && a !== e && a.src !== e.src) actions += `<button type="button" class="btn small" data-act="align" title="Shifts the whole “${esc(s.name)}” source so that this line falls on T0">Align “${esc(s.name)}” to T0</button>`;
    actions += `<button type="button" class="btn small ghost" data-act="copy">Copy</button>`;
    els.detail.innerHTML = `<div class="detail">
      <div class="d-head"><span class="tag" style="--c:${s.color}">${esc(s.name)}</span><span class="lvb lv-${e.level}">${LV_SHORT[e.level]}</span></div>
      <dl>${dl}</dl>
      <pre class="d-text">${esc(text)}</pre>
      ${ids ? `<div><p class="muted small">Detected identifiers</p><div class="d-ids">${ids}</div></div>` : ''}
      <div><p class="muted small">Fields: <b>+</b> filters the log on a value, <b>−</b> excludes it</p><table class="d-fields">${fields.join('')}</table></div>
      <div class="d-actions">${actions}</div>
      ${a && a !== e && a.src !== e.src ? `<p class="d-note">T0 is a line from ${esc(a.src.name)}. If these two lines describe the same moment, “Align” corrects the clock drift between the two sources.</p>` : ''}
      ${!a ? '<p class="d-note">Tip: set T0 on a line, then pick the line from another source that matches the same moment to align their clocks.</p>' : ''}
    </div>`;
  }

  els.detail.addEventListener('click', ev => {
    const qb = ev.target.closest('button[data-q]');
    if (qb) { addTerm(qb.dataset.q); return; }
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
      toast(`“${e.src.name}” shifted by ${delta > 0 ? '+' : '−'}${nf(Math.abs(delta))} ms. Total offset: ${nf(e.src.offset)} ms.`);
    } else if (b.dataset.act === 'copy') {
      copyText(e.cont ? e.line + '\n' + e.cont.join('\n') : e.line, 'Line copied.');
    }
  });

  function setAnchor(e) {
    state.anchor = e;
    if (/\bt0:/i.test(state.query)) { applyFilters(); return; }
    renderSummary(); renderRows(); renderDetail(); drawBraid();
  }

  /* ---------- Sources panel ---------- */

  function tzOptions(sel) {
    return TZ_OPTS.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');
  }

  function renderSources() {
    els.srcCount.textContent = state.sources.length ? `${state.sources.length} source${state.sources.length > 1 ? 's' : ''}` : '';
    els.sourceList.innerHTML = state.sources.map(s => {
      const r = s.parsed;
      const meta = r.entries.length
        ? `${nf(r.entries.length)} entr${r.entries.length === 1 ? 'y' : 'ies'} · ${esc(r.formatLabel)}${r.orphans ? ` · ${nf(r.orphans)} line${r.orphans === 1 ? '' : 's'} before the first timestamp` : ''}`
        : `<span class="warn-text">No timestamp recognized in ${nf(r.lineCount)} lines.</span>`;
      const zoned = r.zoned > 0.9;
      const tz = zoned
        ? `<label>Time zone<span class="fixed">read from the logs</span></label>`
        : `<label>Time zone<select data-act="tz" id="tz-${s.id}">${tzOptions(s.tz)}</select></label>`;
      const date = r.needs ? `<label>${r.needs === 'year' ? 'Year / date' : 'Date'}<input type="date" data-act="date" id="date-${s.id}" value="${s.date}"></label>` : '';
      return `<article class="src${s.visible ? '' : ' off'}" data-id="${s.id}" style="--c:${s.color}">
        <div class="src-top">
          <button type="button" class="swatch" data-act="color" title="Change color" aria-label="Change the color of ${esc(s.name)}"></button>
          <input class="src-name" data-act="name" id="name-${s.id}" value="${esc(s.name)}" aria-label="Source name" spellcheck="false">
          <button type="button" class="ico" data-act="vis" aria-pressed="${s.visible}" title="${s.visible ? 'Hide' : 'Show'} this source">${s.visible ? 'Hide' : 'Show'}</button>
          <button type="button" class="ico" data-act="del" title="Remove this source">Remove</button>
        </div>
        <p class="src-meta">${meta}</p>
        ${r.entries.length ? `<div class="src-grid">${tz}${date}</div>
        <div class="offset"><span class="lbl">Clock offset</span>
          <div class="off-ctl">
            <button type="button" data-act="nudge" data-v="-1000" aria-label="Minus one second">−1s</button>
            <button type="button" data-act="nudge" data-v="-100" aria-label="Minus 100 milliseconds">−100</button>
            <input type="number" step="1" data-act="offset" id="off-${s.id}" value="${s.offset}" class="${s.offset ? 'nonzero' : ''}" aria-label="Offset in milliseconds">
            <span class="unit">ms</span>
            <button type="button" data-act="nudge" data-v="100" aria-label="Plus 100 milliseconds">+100</button>
            <button type="button" data-act="nudge" data-v="1000" aria-label="Plus one second">+1s</button>
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
        b.textContent = 'Confirm';
        setTimeout(() => { if (b.isConnected) { b.classList.remove('confirm'); b.textContent = 'Remove'; } }, 3000);
        return;
      }
      state.sources = state.sources.filter(x => x !== s);
      if (!state.sources.some(x => x.demo)) state.demo = false;
      renderSources(); rebuild();
      toast(`Source “${s.name}” removed.`);
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
    s.name = t.value || 'unnamed';
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

  /* ---------- Adding logs ---------- */

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
    const ent = `${nf(n)} entr${n === 1 ? 'y' : 'ies'}`;
    let msg = added.length === 1 ? `“${added[0].name}” added: ${ent}.` : `${added.length} sources added: ${ent}.`;
    if (bad.length) msg += ` No timestamp recognized in ${bad.join(', ')}.`;
    if (removed) msg += ' The sample was removed.';
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
    if (!text.trim()) { els.addText.focus(); toast('Paste at least one log line.'); return; }
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
    ingest([{ name: `pasted ${++pasteN}`, text }]);
  });

  /* ---------- Toolbar ---------- */

  /* ---------- Query ---------- */

  let stats = null, statsFor = null, known = new Map();
  function fieldStats() {
    if (statsFor !== state.merged) { stats = Q.fieldStats(state.merged); statsFor = state.merged; known = new Map(); }
    return stats;
  }
  function hasField(k) {
    if (fieldStats().has(k)) return true;
    if (!known.has(k)) known.set(k, state.merged.some(e => Q.fields(e).has(k)));
    return known.get(k);
  }

  function compileQuery() {
    state.qc = state.query
      ? Q.compile(state.query, { utc: state.displayTz === 'utc', anchor: state.anchor, sources: state.sources, shared: state.sharedSet, hasField })
      : null;
    paintQuery();
  }

  // Colors the query in place: an overlay behind the input's transparent text.
  function paintQuery() {
    const v = els.search.value;
    const cls = new Array(v.length).fill('');
    for (const [a, b, c] of Q.parse(v).spans) for (let i = a; i < b; i++) cls[i] = c;
    const qc = state.qc && state.query === v.trim() ? state.qc : null;
    if (qc) for (const [a, b] of qc.bad) for (let i = a; i < b; i++) cls[i] += ' q-bad';
    let h = '';
    for (let i = 0; i < v.length;) {
      let j = i + 1;
      while (j < v.length && cls[j] === cls[i]) j++;
      h += cls[i] ? `<span class="${cls[i]}">${esc(v.slice(i, j))}</span>` : esc(v.slice(i, j));
      i = j;
    }
    els.searchHl.innerHTML = h + ' ';
    els.searchHl.scrollLeft = els.search.scrollLeft;
    const msgs = qc ? qc.errors.concat(qc.notes) : [];
    els.searchMsg.hidden = !msgs.length;
    els.searchMsg.textContent = msgs.join(' · ');
    els.searchMsg.classList.toggle('err', !!(qc && qc.errors.length));
    els.search.classList.toggle('bad', !!(qc && qc.errors.length));
  }

  let searchTimer;
  function setQuery(v, now) {
    clearTimeout(searchTimer);
    const run = () => {
      state.query = v.trim();
      applyFilters();
      els.viewport.scrollTop = 0;
      renderRows(); drawBraid();
    };
    if (now) run(); else searchTimer = setTimeout(run, 150);
  }

  function remember(q) {
    q = q.trim();
    if (!q || (state.qc && state.query === q && state.qc.errors.length)) return;
    store.set('queries', [q].concat(store.get('queries', []).filter(x => x !== q)).slice(0, 8));
  }

  function applyText(v) {
    els.search.value = v;
    els.search.setSelectionRange(v.length, v.length);
    setQuery(v, true);
    remember(v);
  }

  // Adds `term` to the query (from the detail panel), replacing its opposite if present.
  function addTerm(term) {
    const cur = ` ${els.search.value.trim()} `;
    if (cur.includes(` ${term} `)) { toast('Already in the query.'); return; }
    const opposite = term[0] === '-' ? term.slice(1) : '-' + term;
    const v = (cur.split(` ${opposite} `).join(' ').trim() + ' ' + term).trim();
    applyText(v);
  }

  /* ---------- Suggestions ---------- */

  const EXAMPLES = [
    ['level:>=warn', 'warnings and errors'],
    ['has:stack', 'entries with a stack trace'],
    ['status:>=500', 'HTTP server errors'],
    ['"lock timeout" OR /still waiting/', 'a phrase or a regular expression'],
    ['source:api -level:debug', 'one source, without debug lines'],
  ];
  const sug = { items: [], active: -1, a: 0, b: 0 };
  const nEntries = n => `${nf(n)} entr${n === 1 ? 'y' : 'ies'}`;

  function tokenAtCaret() {
    const v = els.search.value, c = els.search.selectionStart == null ? v.length : els.search.selectionStart;
    let quotes = 0;
    for (let i = 0; i < c; i++) if (v[i] === '"') quotes++;
    let a = quotes % 2 ? v.lastIndexOf('"', c - 1) : c;
    while (a > 0 && !/[\s(]/.test(v[a - 1])) a--;
    let b = c;
    if (!(quotes % 2)) while (b < v.length && !/[\s)]/.test(v[b])) b++;
    return { a, b, text: v.slice(a, c) };
  }

  function fieldNames() {
    const out = Q.builtins.map(([k, d]) => [k, d]);
    const st = [...fieldStats()].filter(([k]) => !Q.builtins.some(b => b[0] === k)).sort((x, y) => y[1].n - x[1].n);
    for (const [k, s] of st) out.push([k, `field · ${nEntries(s.n)}`]);
    return out;
  }

  function valuesFor(f, op) {
    const cnt = {};
    switch (f) {
      case 'source':
        return state.sources.map(s => [s.name, nEntries(s.entries.length)]);
      case 'level':
        for (const e of state.merged) cnt[e.level] = (cnt[e.level] || 0) + 1;
        return Q.levels.filter(l => op ? l !== 'other' : cnt[l]).map(l => [l, op ? '' : nf(cnt[l])]);
      case 'has':
        return [['stack', 'a stack trace or continuation lines'], ['thread', 'an identifier shared with another source'], ['id', 'any identifier']]
          .concat(fieldNames().slice(Q.builtins.length).map(([k, d]) => [k, d]));
      case 'id':
        return state.shared.slice(0, 300).map(r => [r.tok, `${r.srcs.size} sources${r.err ? ' · error' : ''}`]);
      case 'time': case 'after': case 'before': {
        const out = [], f0 = state.filtered;
        if (state.selected) out.push([clock(state.selected.te), 'selected line']);
        if (state.anchor) out.push([clock(state.anchor.te), 'T0']);
        if (f0.length) out.push([clock(f0[0].te, false), 'first entry in view'], [clock(f0[f0.length - 1].te, false), 'last entry in view']);
        if (f === 'time' && f0.length) out.push([`${clock(f0[0].te, false)}..${clock(f0[f0.length - 1].te, false)}`, 'range of the view']);
        return out;
      }
      case 't0':
        return state.anchor ? [['1s', 'within a second of T0'], ['0..5s', 'the 5 seconds after T0'], ['-5s..0', 'the 5 seconds before T0'], ['0', 'after T0 (with >)']] : [];
      case 'msg':
        return [];
      default: {
        const s = fieldStats().get(f);
        return s ? [...s.vals].sort((x, y) => y[1] - x[1]).slice(0, 200).map(([v, n]) => [v, `${nf(n)}×`]) : [];
      }
    }
  }

  function suggestions(force) {
    const v = els.search.value;
    if (!v.trim()) {
      const out = store.get('queries', []).map(q => ({ label: q, hint: 'recent', insert: q, whole: true }));
      for (const [q, hint] of EXAMPLES) if (!out.some(o => o.insert === q)) out.push({ label: q, hint, insert: q, whole: true });
      return { a: 0, b: v.length, items: out.slice(0, 10) };
    }
    const { a, b, text } = tokenAtCaret();
    const neg = text[0] === '-' ? '-' : '';
    const t = text.slice(neg.length);
    const items = [];
    const m = /^([A-Za-z_@][\w.@-]*):(>=|<=|>|<|=)?"?(.*)$/.exec(t);
    if (m) {
      const f = Q.resolveField(m[1]), op = m[2] || '', pre = m[3].toLowerCase();
      const vals = valuesFor(f, op);
      const starts = vals.filter(([x]) => x.toLowerCase().startsWith(pre));
      const inside = pre ? vals.filter(([x]) => !x.toLowerCase().startsWith(pre) && x.toLowerCase().includes(pre)) : [];
      for (const [x, hint] of starts.concat(inside)) {
        if (x.toLowerCase() === pre) continue;
        items.push({ label: `${m[1]}:${op}${x}`, hint, insert: `${neg}${m[1]}:${op}${f === 'time' || f === 't0' ? x : Q.quote(x)} ` });
      }
    } else if ((t && !/^["/(]/.test(t)) || force) {
      const lc = t.toLowerCase();
      for (const [k, hint] of fieldNames()) {
        if (k.startsWith(lc) && k !== lc) items.push({ label: k + ':', hint, insert: neg + k + ':', more: true });
      }
    }
    return { a, b, items: items.slice(0, 12) };
  }

  function openSuggest(force) {
    if (document.activeElement !== els.search) { closeSuggest(); return; }
    const r = suggestions(force);
    sug.items = r.items; sug.a = r.a; sug.b = r.b;
    sug.active = force && r.items.length ? 0 : -1;
    if (!r.items.length) { closeSuggest(); return; }
    renderSuggest();
  }

  function renderSuggest() {
    els.suggest.innerHTML = sug.items.map((s, i) =>
      `<li role="option" id="sg-${i}" data-i="${i}" aria-selected="${i === sug.active}"><code>${esc(s.label)}</code><span>${esc(s.hint || '')}</span></li>`).join('');
    els.suggest.hidden = false;
    els.qhelp.hidden = true;
    els.btnQhelp.setAttribute('aria-expanded', 'false');
    els.search.setAttribute('aria-expanded', 'true');
    if (sug.active >= 0) {
      els.search.setAttribute('aria-activedescendant', 'sg-' + sug.active);
      els.suggest.children[sug.active].scrollIntoView({ block: 'nearest' });
    } else els.search.removeAttribute('aria-activedescendant');
  }

  function closeSuggest() {
    sug.items = [];
    els.suggest.hidden = true;
    els.search.setAttribute('aria-expanded', 'false');
    els.search.removeAttribute('aria-activedescendant');
  }

  function acceptSuggest(i) {
    const s = sug.items[i];
    if (!s) return;
    if (s.whole) { closeSuggest(); applyText(s.insert); paintQuery(); return; }
    const v = els.search.value;
    let rest = v.slice(sug.b);
    if (s.insert.endsWith(' ') && rest[0] === ' ') rest = rest.slice(1);
    const nv = v.slice(0, sug.a) + s.insert + rest;
    const caret = sug.a + s.insert.length;
    els.search.value = nv;
    els.search.setSelectionRange(caret, caret);
    paintQuery();
    if (s.more) { openSuggest(true); setQuery(nv); } else { closeSuggest(); setQuery(nv, true); }
  }

  els.search.addEventListener('input', () => { paintQuery(); setQuery(els.search.value); openSuggest(false); });
  els.search.addEventListener('focus', () => { if (!els.search.value.trim()) openSuggest(false); });
  els.search.addEventListener('blur', () => { closeSuggest(); if (state.query === els.search.value.trim()) remember(state.query); });
  ['scroll', 'keyup', 'click', 'select'].forEach(t => els.search.addEventListener(t, () => { els.searchHl.scrollLeft = els.search.scrollLeft; }));
  els.search.addEventListener('keydown', ev => {
    const open = !els.suggest.hidden && sug.items.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!open) { openSuggest(true); return; }
      const n = sug.items.length;
      sug.active = ev.key === 'ArrowDown' ? (sug.active + 1) % n : (sug.active <= 0 ? n - 1 : sug.active - 1);
      renderSuggest();
    } else if (ev.key === 'Tab' && !ev.shiftKey && open) {
      ev.preventDefault();
      acceptSuggest(Math.max(0, sug.active));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (open && sug.active >= 0) acceptSuggest(sug.active);
      else { closeSuggest(); setQuery(els.search.value, true); remember(els.search.value); }
    } else if (ev.key === 'Escape' && (open || !els.qhelp.hidden)) {
      ev.stopPropagation();
      closeSuggest();
      showHelp(false);
    }
  });
  els.suggest.addEventListener('mousedown', ev => {
    ev.preventDefault();
    const li = ev.target.closest('li[data-i]');
    if (li) acceptSuggest(+li.dataset.i);
  });

  function showHelp(on) {
    els.qhelp.hidden = !on;
    els.btnQhelp.setAttribute('aria-expanded', String(on));
    if (on) closeSuggest();
  }
  els.btnQhelp.addEventListener('click', () => showHelp(els.qhelp.hidden));
  els.qhelp.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-q]');
    if (!b) return;
    showHelp(false);
    applyText(b.dataset.q);
    els.search.focus();
  });
  document.addEventListener('mousedown', ev => {
    if (!els.qhelp.hidden && !ev.target.closest('.search')) showHelp(false);
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
    toast(dir > 0 ? 'No more errors below.' : 'No more errors above.');
  }
  els.btnNextErr.addEventListener('click', () => nextError(1));

  /* ---------- List: scrolling, clicks, keyboard ---------- */

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
      if (ev.key === 'Escape' && t === els.search && els.search.value) { els.search.value = ''; paintQuery(); setQuery('', true); }
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === '/') { ev.preventDefault(); els.search.focus(); }
    else if (ev.key === '?') showHelp(els.qhelp.hidden);
    else if (ev.key === 'n') nextError(1);
    else if (ev.key === 'N') nextError(-1);
    else if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); moveSel(1); }
    else if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); moveSel(-1); }
    else if (ev.key === 't' && state.selected) setAnchor(state.anchor === state.selected ? null : state.selected);
    else if (ev.key === 'Escape') {
      if (!els.qhelp.hidden) showHelp(false);
      else if (state.token) clearToken();
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
      toast(ok ? done : 'The browser refused the copy.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(done), fallback);
    else fallback();
  }

  els.btnCopy.addEventListener('click', () => {
    if (!state.filtered.length) { toast('Nothing to copy: the view is empty.'); return; }
    copyText(viewText(), `${nf(state.filtered.length)} entr${state.filtered.length === 1 ? 'y' : 'ies'} copied, with timestamp and source at the start of each line.`);
  });

  if (inIframe) els.btnDownload.hidden = true;
  els.btnDownload.addEventListener('click', () => {
    if (!state.filtered.length) { toast('Nothing to download: the view is empty.'); return; }
    const url = URL.createObjectURL(new Blob([viewText()], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tresse-merged.log';
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

  /* ---------- Sample ---------- */

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

  /* ---------- Startup ---------- */

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
