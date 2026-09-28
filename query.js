/* Tresse — query language: parsing, evaluation, field extraction.
   No dependencies; runs in the browser as well as under Node.

   Terms are combined with AND; OR binds tighter than AND, so
   `level:error source:api OR source:worker` means errors from api or worker.

     query  := (or | 'AND')*
     or     := unary ('OR' unary)*
     unary  := ('NOT' | '-') unary | '(' query ')' | term
     term   := word | "phrase" | /regex/flags | field ':' [op] value
     op     := > >= < <= =
     value  := word | "phrase" | /regex/flags | a,b,c | lo..hi | glob*       */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const LEVELS = ['error', 'warn', 'info', 'debug', 'other'];
  const LV_RANK = { debug: 0, info: 1, warn: 2, error: 3 };
  const LV_ALIAS = { err: 'error', fatal: 'error', crit: 'error', critical: 'error', warning: 'warn', notice: 'info', dbg: 'debug', trace: 'debug' };
  const ALIAS = { src: 'source', service: 'source', lvl: 'level', severity: 'level', thread: 'id', text: 'msg', message: 'msg', since: 'after', until: 'before' };
  const BUILTINS = [
    ['source', 'source name'],
    ['level', 'error, warn, info, debug, other'],
    ['msg', 'text of the entry, stack trace included'],
    ['id', 'identifier found in the entry'],
    ['time', 'time of day or date'],
    ['after', 'at or after a time'],
    ['before', 'before a time'],
    ['t0', 'offset from T0'],
    ['has', 'stack, thread, id or a field name'],
  ];
  const BUILTIN = new Set(BUILTINS.map(b => b[0]));
  const KEYWORDS = { OR: 'OR', '|': 'OR', '||': 'OR', AND: 'AND', '&&': 'AND', NOT: 'NOT' };
  const OPS = ['>=', '<=', '>', '<', '='];
  const SP = /\s/;
  const FIELD_RE = /^([A-Za-z_@][\w.@-]*):/;

  const resolveField = name => { name = name.toLowerCase(); return ALIAS[name] || name; };
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

  /* ---------- Lexer ---------- */

  function readQuoted(s, i) {
    const q = s[i];
    let v = '', j = i + 1;
    for (; j < s.length; j++) {
      if (s[j] === '\\' && j + 1 < s.length) { v += s[++j]; continue; }
      if (s[j] === q) return { v, end: j + 1, closed: true };
      v += s[j];
    }
    return { v, end: j, closed: false };
  }

  // /body/flags, only if the closing slash is followed by flags and then a boundary:
  // `/api/cart` stays a plain word.
  function readRegex(s, i) {
    for (const crossSpace of [false, true]) {
      for (let j = i + 1; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (!crossSpace && SP.test(s[j])) break;
        if (s[j] !== '/') continue;
        const m = /^[imsu]*(?=[\s)]|$)/.exec(s.slice(j + 1));
        if (m && j > i + 1) return { src: s.slice(i + 1, j), flags: m[0], end: j + 1 + m[0].length };
      }
    }
    return null;
  }

  // A bare word ends at a space or at a closing parenthesis it did not open: `execute(x)` is one word.
  function wordEnd(s, i) {
    let d = 0, j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (SP.test(c)) break;
      if (c === '(') d++;
      else if (c === ')') { if (!d) break; d--; }
    }
    return j;
  }

  function readValue(s, j) {
    const c = s[j];
    if (c === '"' || c === "'") {
      const q = readQuoted(s, j);
      return { kind: 'text', value: q.v, quoted: true, unclosed: !q.closed, end: q.end, cls: 'q-str' };
    }
    if (c === '/') {
      const r = readRegex(s, j);
      if (r) return { kind: 're', src: r.src, flags: r.flags, end: r.end, cls: 'q-re' };
    }
    const end = wordEnd(s, j);
    return { kind: 'text', value: s.slice(j, end), quoted: false, end, cls: 'q-val' };
  }

  function lex(s) {
    const toks = [], spans = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (SP.test(c)) { i++; continue; }
      if (c === '(' || c === ')') {
        toks.push({ t: c, at: i, end: i + 1 });
        spans.push([i, i + 1, 'q-op']);
        i++;
        continue;
      }
      if (c === '-' && i + 1 < s.length && !SP.test(s[i + 1]) && s[i + 1] !== ')') {
        toks.push({ t: 'NOT', at: i, end: i + 1 });
        spans.push([i, i + 1, 'q-op']);
        i++;
        continue;
      }
      const fm = FIELD_RE.exec(s.slice(i, i + 80));
      if (fm) {
        let j = i + fm[0].length;
        spans.push([i, j, 'q-field']);
        let op = '';
        for (const o of OPS) if (s.startsWith(o, j)) { op = o; break; }
        if (op) { spans.push([j, j + op.length, 'q-op']); j += op.length; }
        const v = readValue(s, j);
        if (v.end > j) spans.push([j, v.end, v.cls]);
        toks.push(Object.assign({ t: 'term', field: resolveField(fm[1]), name: fm[1], op, at: i, raw: s.slice(i, v.end) }, v));
        i = v.end;
        continue;
      }
      const v = readValue(s, i);
      const word = s.slice(i, v.end);
      if (!v.quoted && KEYWORDS[word]) {
        toks.push({ t: KEYWORDS[word], at: i, end: v.end });
        spans.push([i, v.end, 'q-op']);
      } else {
        toks.push(Object.assign({ t: 'term', field: null, op: '', at: i, raw: word }, v));
        if (v.cls !== 'q-val') spans.push([i, v.end, v.cls]);
      }
      i = v.end;
    }
    return { toks, spans };
  }

  /* ---------- Parser ---------- */

  function parse(s) {
    const { toks, spans } = lex(s);
    const errors = [];
    let p = 0;
    const peek = () => toks[p];
    const stop = tk => !tk || tk.t === ')' || tk.t === 'OR' || tk.t === 'AND';

    function andExpr() {
      const kids = [];
      for (let tk = peek(); tk && tk.t !== ')'; tk = peek()) {
        if (tk.t === 'AND' || tk.t === 'OR') { p++; continue; }
        const k = orExpr();
        if (k) kids.push(k);
      }
      return kids.length > 1 ? { t: 'and', kids } : kids[0] || null;
    }
    function orExpr() {
      const kids = [];
      let k = unary();
      if (k) kids.push(k);
      while (peek() && peek().t === 'OR') {
        p++;
        if (stop(peek())) break;
        k = unary();
        if (k) kids.push(k);
      }
      return kids.length > 1 ? { t: 'or', kids } : kids[0] || null;
    }
    function unary() {
      const tk = toks[p++];
      if (tk.t === 'NOT') {
        if (stop(peek())) return null;
        const k = unary();
        return k && { t: 'not', kid: k };
      }
      if (tk.t === '(') {
        const k = andExpr();
        if (peek() && peek().t === ')') p++;
        else errors.push('Missing closing parenthesis');
        return k;
      }
      return tk;
    }

    let ast = andExpr();
    while (p < toks.length) {
      errors.push('Unexpected closing parenthesis');
      p++;
      const more = andExpr();
      if (more) ast = ast ? { t: 'and', kids: [ast, more] } : more;
    }
    return { ast, spans, errors };
  }

  /* ---------- Values ---------- */

  function num(v) {
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i.exec(v);
    return m ? parseFloat(m[1]) : null;
  }

  function splitRange(v) {
    const k = v.indexOf('..');
    return k < 0 ? null : [v.slice(0, k), v.slice(k + 2)];
  }

  function glob(x) {
    const r = new RegExp('^' + x.split('*').map(escRe).join('.*') + '$', 'is');
    return v => r.test(v);
  }

  function exact(x) {
    const lc = x.toLowerCase();
    return v => v.toLowerCase() === lc;
  }

  function one(x, quoted) { return !quoted && x.includes('*') ? glob(x) : exact(x); }

  function compare(op, x) {
    const qn = num(x);
    return v => {
      let d;
      if (qn != null) { const n = num(v); if (n == null) return false; d = n - qn; }
      else d = v.localeCompare(x, undefined, { sensitivity: 'base' });
      return op === '>' ? d > 0 : op === '>=' ? d >= 0 : op === '<' ? d < 0 : d <= 0;
    };
  }

  // String matcher for a term's value: regex, comparison, range, list, glob or exact.
  function matcher(tk, re) {
    if (re) return v => re.test(v);
    const val = tk.value;
    if (tk.op && tk.op !== '=') return compare(tk.op, val);
    if (!tk.quoted && !tk.op) {
      const rg = splitRange(val);
      if (rg) {
        const lo = rg[0] ? compare('>=', rg[0]) : null, hi = rg[1] ? compare('<=', rg[1]) : null;
        return v => (!lo || lo(v)) && (!hi || hi(v));
      }
      if (val.includes(',')) {
        const ms = val.split(',').filter(Boolean).map(x => one(x, false));
        return v => ms.some(m => m(v));
      }
    }
    return one(val, tk.quoted);
  }

  function isPlain(tk, re) {
    return !re && !tk.op && (tk.quoted || !/[*,]|\.\./.test(tk.value));
  }

  // Time of day (12:02, 12:02:04.250) or date (2026-09-28, 2026-09-28T12:02),
  // as a [lo, hi) interval whose width follows the precision that was typed.
  function parseWhen(v, utc) {
    let m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?$/.exec(v);
    if (m) {
      const ms = m[4] ? +(m[4] + '00').slice(0, 3) : 0;
      const lo = ((+m[1] * 60 + +m[2]) * 60 + (+m[3] || 0)) * 1000 + ms;
      const w = m[4] ? 10 ** (3 - m[4].length) : m[3] != null ? 1000 : 60000;
      return { tod: true, lo, hi: lo + w };
    }
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?)?$/.exec(v);
    if (m) {
      const at = utc ? Date.UTC : (...a) => new Date(...a).getTime();
      const y = +m[1], mo = m[2] - 1, d = +m[3];
      if (m[4] == null) return { tod: false, lo: at(y, mo, d), hi: at(y, mo, d + 1) };
      const ms = m[7] ? +(m[7] + '00').slice(0, 3) : 0;
      const lo = at(y, mo, d, +m[4], +m[5], +(m[6] || 0), ms);
      const w = m[7] ? 10 ** (3 - m[7].length) : m[6] != null ? 1000 : 60000;
      return { tod: false, lo, hi: lo + w };
    }
    return null;
  }

  function todFn(utc) {
    if (utc) return t => ((t % DAY) + DAY) % DAY;
    return t => {
      const d = new Date(t);
      return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + (t - Math.floor(t / 1000) * 1000);
    };
  }

  function duration(v) {
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(ms|s|sec|m|min|h)?$/i.exec(v);
    if (!m) return null;
    return parseFloat(m[1]) * { ms: 1, s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000 }[(m[2] || 's').toLowerCase()];
  }

  function quote(v) {
    v = String(v);
    if (/^[^\s()"',*<>=\/][^\s()"',*]*$/.test(v) && !v.includes('..')) return v;
    return '"' + v.replace(/["\\]/g, '\\$&') + '"';
  }

  /* ---------- Entry fields ---------- */

  function lcOf(e) {
    if (e.lc === undefined) e.lc = (e.cont ? e.line + '\n' + e.cont.join('\n') : e.line).toLowerCase();
    return e.lc;
  }

  function testRe(re, e) {
    if (re.test(e.line)) return true;
    return !!e.cont && e.cont.some(l => re.test(l));
  }

  const KV_RE = /(?:^|[\s,;(\[{|])([A-Za-z_@][\w.@-]*)=("(?:[^"\\]|\\.)*"|'[^']*'|[^\s,;)\]}|]+)/g;
  const CLF_RE = /^(\S+) \S+ (\S+) \[[^\]]+\] "(\S+) (\S+)[^"]*" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?/;

  function flatten(o, pre, add, depth) {
    if (o && typeof o === 'object' && !Array.isArray(o) && depth < 4) {
      for (const k in o) flatten(o[k], pre ? pre + '.' + k : k, add, depth + 1);
    } else if (pre) {
      add(pre, o && typeof o === 'object' ? JSON.stringify(o) : o);
    }
  }

  // Fields of an entry: JSON keys (nested as a.b), key=value pairs, and the parts of an access log line.
  function fields(e) {
    if (e.kv) return e.kv;
    const kv = new Map();
    const add = (k, v) => {
      k = k.toLowerCase();
      let a = kv.get(k);
      if (!a) kv.set(k, a = []);
      if (a.length < 20) a.push(String(v));
    };
    const line = e.line.length > 4000 ? e.line.slice(0, 4000) : e.line;
    if (line.trimStart()[0] === '{') {
      try { flatten(JSON.parse(line), '', add, 0); } catch (err) { /* not JSON after all */ }
    }
    const clf = CLF_RE.exec(line);
    if (clf) {
      add('ip', clf[1]); add('method', clf[3]); add('path', clf[4]); add('status', clf[5]);
      if (clf[6] !== '-') add('bytes', clf[6]);
      if (clf[7] && clf[7] !== '-') add('referer', clf[7]);
      if (clf[8]) add('ua', clf[8]);
    }
    KV_RE.lastIndex = 0;
    let m;
    while ((m = KV_RE.exec(line))) {
      let v = m[2];
      if (v[0] === '"' || v[0] === "'") v = v.slice(1, -1);
      add(m[1], v);
    }
    e.kv = kv;
    return kv;
  }

  // Keys and their most frequent values, on a sample of at most `max` entries.
  function fieldStats(entries, max = 20000) {
    const stats = new Map();
    const step = Math.max(1, Math.floor(entries.length / max));
    for (let i = 0; i < entries.length; i += step) {
      for (const [k, vs] of fields(entries[i])) {
        let s = stats.get(k);
        if (!s) stats.set(k, s = { n: 0, vals: new Map() });
        s.n++;
        for (const v of vs) if (v.length <= 120 && (s.vals.size < 500 || s.vals.has(v))) s.vals.set(v, (s.vals.get(v) || 0) + 1);
      }
    }
    return stats;
  }

  /* ---------- Compilation ---------- */

  // ctx: { utc, anchor, sources, shared: Set, hasField(key) }
  // Returns { test: (entry) => bool, or null to keep everything; hl; errors; notes; spans; bad }.
  function compile(str, ctx) {
    ctx = ctx || {};
    const { ast, spans, errors } = parse(str);
    const notes = [], bad = [];
    const hl = { subs: [], res: [] };
    const hasField = ctx.hasField || (() => true);
    const tod = todFn(!!ctx.utc);

    function term(tk, neg) {
      const fail = msg => { errors.push(msg); bad.push([tk.at, tk.end]); return null; };
      if (tk.unclosed) errors.push('Missing closing quote');
      let re = null;
      if (tk.kind === 're') {
        try { re = new RegExp(tk.src, tk.flags); } catch (err) { return fail(`Invalid regular expression /${tk.src}/`); }
      }
      const f = tk.field;
      const text = (value, r) => {
        if (r) {
          if (!neg) hl.res.push(new RegExp(r.source, r.flags + 'g'));
          return e => testRe(r, e);
        }
        if (!value) return null;
        const lc = value.toLowerCase();
        if (!neg) hl.subs.push(lc);
        return e => lcOf(e).includes(lc);
      };
      const hlPlain = () => { if (!neg && isPlain(tk, re) && tk.value.length > 1) hl.subs.push(tk.value.toLowerCase()); };

      if (!f) return text(tk.value, re);
      if (!re && !tk.quoted && tk.value === '') {
        if (BUILTIN.has(f)) { notes.push(`${tk.name}: needs a value`); return null; }
        return text(tk.raw); // "LOG:" and the like
      }

      switch (f) {
        case 'msg':
          return text(tk.value, re);

        case 'source': {
          let m = matcher(tk, re);
          const srcs = ctx.sources || [];
          if (srcs.length && !srcs.some(s => m(s.name))) {
            if (isPlain(tk, re)) {
              m = glob('*' + tk.value + '*');
              if (!srcs.some(s => m(s.name))) notes.push(`No source named “${tk.value}”`);
            } else notes.push(`No source matches “${tk.raw.slice(tk.name.length + 1)}”`);
          }
          return e => m(e.src.name);
        }

        case 'level': {
          if (re) return e => re.test(e.level);
          const lv = x => { x = x.toLowerCase(); x = LV_ALIAS[x] || x; return LEVELS.includes(x) ? x : null; };
          const unknown = x => fail(`Unknown level “${x}”: use error, warn, info, debug or other`);
          if (tk.op && tk.op !== '=') {
            const l = lv(tk.value);
            if (!l || l === 'other') return unknown(tk.value);
            const r = LV_RANK[l], op = tk.op;
            return e => {
              const k = LV_RANK[e.level];
              if (k == null) return false;
              return op === '>' ? k > r : op === '>=' ? k >= r : op === '<' ? k < r : k <= r;
            };
          }
          const names = tk.quoted ? [tk.value] : tk.value.split(',').filter(Boolean);
          const set = new Set();
          for (const x of names) { const l = lv(x); if (!l) return unknown(x); set.add(l); }
          return e => set.has(e.level);
        }

        case 'id': {
          const m = matcher(tk, re);
          hlPlain();
          return e => e.ids.some(m);
        }

        case 'has': {
          const k = tk.value.toLowerCase();
          if (k === 'stack' || k === 'trace') return e => !!e.cont;
          if (k === 'thread') { const sh = ctx.shared || new Set(); return e => e.ids.some(t => sh.has(t)); }
          if (k === 'id') return e => e.ids.length > 0;
          if (!hasField(k)) notes.push(`No field “${tk.value}” in these logs`);
          return e => fields(e).has(k);
        }

        case 'time': case 'after': case 'before': {
          const hint = 'use 12:02, 12:02:04.250, 2026-09-28 or 2026-09-28T12:02';
          const rg = f === 'time' && !tk.op && !tk.quoted ? splitRange(tk.value) : null;
          if (rg) {
            const a = rg[0] ? parseWhen(rg[0], ctx.utc) : null, b = rg[1] ? parseWhen(rg[1], ctx.utc) : null;
            if (rg[0] && !a) return fail(`Unrecognized time “${rg[0]}”: ${hint}`);
            if (rg[1] && !b) return fail(`Unrecognized time “${rg[1]}”: ${hint}`);
            if (!a && !b) return null;
            if (a && b && a.tod !== b.tod) return fail('Both ends of a time range must be times of day, or both dates');
            const x = (a || b).tod ? e => tod(e.te) : e => e.te;
            const L = a ? a.lo : -Infinity, H = b ? b.hi : Infinity;
            if (a && b && a.tod && L >= H) return e => { const v = x(e); return v >= L || v < H; }; // across midnight
            return e => { const v = x(e); return v >= L && v < H; };
          }
          const w = parseWhen(tk.value, ctx.utc);
          if (!w) return fail(`Unrecognized time “${tk.value}”: ${hint}`);
          const op = f === 'after' ? '>=' : f === 'before' ? '<' : tk.op;
          const x = w.tod ? e => tod(e.te) : e => e.te;
          if (op === '>') return e => x(e) > w.lo;
          if (op === '>=') return e => x(e) >= w.lo;
          if (op === '<') return e => x(e) < w.lo;
          if (op === '<=') return e => x(e) < w.hi;
          return e => { const v = x(e); return v >= w.lo && v < w.hi; };
        }

        case 't0': {
          if (!ctx.anchor) return fail('t0: needs a T0 line (press t or double-click a line)');
          const a = ctx.anchor.te;
          const hint = 'use 500ms, 2s, 1.5m or 1h';
          const rg = !tk.op ? splitRange(tk.value) : null;
          if (rg) {
            const lo = rg[0] ? duration(rg[0]) : -Infinity, hi = rg[1] ? duration(rg[1]) : Infinity;
            if (lo == null || hi == null) return fail(`Unrecognized duration in “${tk.value}”: ${hint}`);
            return e => { const d = e.te - a; return d >= lo && d <= hi; };
          }
          const v = duration(tk.value);
          if (v == null) return fail(`Unrecognized duration “${tk.value}”: ${hint}`);
          const op = tk.op;
          if (op === '>') return e => e.te - a > v;
          if (op === '>=') return e => e.te - a >= v;
          if (op === '<') return e => e.te - a < v;
          if (op === '<=') return e => e.te - a <= v;
          return e => Math.abs(e.te - a) <= Math.abs(v);
        }

        default: {
          if (!hasField(f)) {
            notes.push(`No field “${tk.name}” in these logs: searched as text`);
            return text(tk.raw);
          }
          const m = matcher(tk, re);
          hlPlain();
          return e => { const vs = fields(e).get(f); return !!vs && vs.some(m); };
        }
      }
    }

    function build(node, neg) {
      if (!node) return null;
      if (node.t === 'and' || node.t === 'or') {
        const fs = node.kids.map(k => build(k, neg)).filter(Boolean);
        if (fs.length < 2) return fs[0] || null;
        return node.t === 'and'
          ? e => { for (const f of fs) if (!f(e)) return false; return true; }
          : e => { for (const f of fs) if (f(e)) return true; return false; };
      }
      if (node.t === 'not') {
        const f = build(node.kid, !neg);
        return f && (e => !f(e));
      }
      return term(node, neg);
    }

    const test = build(ast, false);
    return { test, hl, errors: [...new Set(errors)], notes: [...new Set(notes)], spans, bad };
  }

  const api = {
    parse, compile, fields, fieldStats, quote, resolveField,
    builtins: BUILTINS, levels: LEVELS,
  };
  root.TresseQuery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
