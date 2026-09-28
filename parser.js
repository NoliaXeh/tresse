/* Tresse — lecture des journaux : formats d'horodatage, niveaux, identifiants.
   Aucune dépendance ; fonctionne dans le navigateur comme sous Node. */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const HEAD = 160;
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function fracMs(f) { return f ? Number('0.' + f) * 1000 : 0; }

  // Décalage explicite en minutes, ou null si la ligne n'en donne pas.
  function zoneMin(z) {
    if (!z) return null;
    if (z === 'Z' || z === 'UTC' || z === 'GMT') return 0;
    const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(z);
    if (!m) return null;
    const v = Number(m[2]) * 60 + Number(m[3] || 0);
    return m[1] === '-' ? -v : v;
  }

  // Composantes calendaires -> millisecondes epoch.
  // zone : décalage lu dans la ligne ; tz : réglage de la source ('local' ou minutes).
  function epoch(y, mo, d, h, mi, s, ms, zone, tz) {
    if (zone == null && tz !== 'local') zone = tz;
    if (zone == null) return new Date(y, mo, d, h, mi, s).getTime() + ms;
    return Date.UTC(y, mo, d, h, mi, s) - zone * 60000 + ms;
  }

  function refDate(c) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.date || '');
    if (m) return [+m[1], m[2] - 1, +m[3]];
    const n = new Date();
    return [n.getFullYear(), n.getMonth(), n.getDate()];
  }

  const FORMATS = [
    {
      id: 'iso', label: 'ISO 8601',
      re: /(\d{4})[-\/](\d{2})[-\/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(?:\s?(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)(?![\d:]))?/,
      read(m, c) {
        const z = zoneMin(m[8]);
        return { t: epoch(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], fracMs(m[7]), z, c.tz), zoned: z != null };
      },
    },
    {
      id: 'clf', label: 'Apache / Nginx',
      re: /\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:\s([+-]\d{4}))?\]/,
      read(m, c) {
        const mo = MON[m[2].toLowerCase()];
        if (mo == null) return null;
        const z = zoneMin(m[8]);
        return { t: epoch(+m[3], mo, +m[1], +m[4], +m[5], +m[6], fracMs(m[7]), z, c.tz), zoned: z != null };
      },
    },
    {
      id: 'eu', label: 'JJ/MM/AAAA hh:mm:ss',
      re: /(?<!\d)(\d{2})[\/.](\d{2})[\/.](\d{4})[ T,]+(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?/,
      read(m, c) {
        return { t: epoch(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6], fracMs(m[7]), null, c.tz), zoned: false };
      },
    },
    {
      // Redis : « pid:rôle JJ Mon AAAA hh:mm:ss.mmm <niveau> message », niveau parmi . - * #
      id: 'redis', label: 'Redis (JJ Mon AAAA hh:mm:ss)',
      re: /(?<!\d)(\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?!\d)(?: ([.*#-])(?= ))?/,
      read(m, c) {
        const mo = MON[m[2].toLowerCase()];
        if (mo == null) return null;
        return {
          t: epoch(+m[3], mo, +m[1], +m[4], +m[5], +m[6], fracMs(m[7]), null, c.tz), zoned: false,
          level: { '.': 'debug', '-': 'debug', '*': 'info', '#': 'warn' }[m[8]],
        };
      },
    },
    {
      id: 'klog', label: 'klog (Kubernetes, glog)', needs: 'year',
      re: /^([IWEF])(\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{1,9})/,
      read(m, c) {
        const [y] = refDate(c);
        return {
          t: epoch(y, m[2] - 1, +m[3], +m[4], +m[5], +m[6], fracMs(m[7]), null, c.tz), zoned: false,
          level: { I: 'info', W: 'warn', E: 'error', F: 'error' }[m[1]],
        };
      },
    },
    {
      id: 'syslog', label: 'Syslog (BSD)', needs: 'year',
      re: /^(?:<\d+>\d?\s*)?([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?!\d)/,
      read(m, c) {
        const mo = MON[m[1].toLowerCase()];
        if (mo == null) return null;
        const [y] = refDate(c);
        return { t: epoch(y, mo, +m[2], +m[3], +m[4], +m[5], fracMs(m[6]), null, c.tz), zoned: false };
      },
    },
    {
      id: 'epoch', label: 'Timestamp Unix',
      re: /^\s*\[?(\d{13}(?:\.\d+)?|\d{10}(?:\.\d{1,9})?)(?!\d)/,
      read(m) {
        const v = Number(m[1]);
        return { t: m[1].indexOf('.') === 13 || /^\d{13}/.test(m[1]) ? v : v * 1000, zoned: true };
      },
    },
    {
      id: 'time', label: 'Heure seule', needs: 'date',
      re: /^\[?(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(?!\d)/,
      read(m, c) {
        const [y, mo, d] = refDate(c);
        return { t: epoch(y, mo, d, +m[1], +m[2], +m[3], fracMs(m[4]), null, c.tz), zoned: false };
      },
    },
  ];

  const JSON_FMT = { id: 'json', label: 'JSON (un évènement par ligne)' };
  const ALL = [JSON_FMT].concat(FORMATS);
  const TIME_KEYS = ['@timestamp', 'timestamp', 'time', 'ts', 'datetime', 'date', 't', 'eventTime', 'asctime'];
  const LEVEL_KEYS = ['level', 'severity', 'lvl', 'levelname', 'log.level', 'loglevel'];

  const LEVEL_RE = /\b(fatal|panic|emerg(?:ency)?|alert|crit(?:ical)?|severe|error|err|warn(?:ing)?|notice|info|debug|dbg|trace|verbose)\b/i;

  function normLevel(w) {
    w = String(w).toLowerCase();
    if (/^(fatal|panic|emerg|alert|crit|severe|error|err)/.test(w)) return 'error';
    if (w.startsWith('warn')) return 'warn';
    if (/^(notice|info)/.test(w)) return 'info';
    if (/^(debug|dbg|trace|verbose)/.test(w)) return 'debug';
    return null;
  }

  function numLevel(n) { return n >= 50 ? 'error' : n >= 40 ? 'warn' : n >= 30 ? 'info' : 'debug'; }

  function numEpoch(v) {
    if (v > 1e17) return v / 1e6;
    if (v > 1e14) return v / 1e3;
    if (v > 1e11) return v;
    return v * 1000;
  }

  function tryFormat(fmt, line, c) {
    if (fmt === JSON_FMT) return readJson(line, c);
    const m = fmt.re.exec(line.length > HEAD ? line.slice(0, HEAD) : line);
    if (!m) return null;
    const r = fmt.read(m, c);
    if (!r || !isFinite(r.t)) return null;
    r.end = m.index + m[0].length;
    return r;
  }

  function timeValue(v, c) {
    if (typeof v === 'number') return { t: numEpoch(v), zoned: true };
    if (typeof v !== 'string') return null;
    if (/^\d+(\.\d+)?$/.test(v)) return { t: numEpoch(Number(v)), zoned: true };
    for (const f of FORMATS) {
      if (f.id === 'time' || f.id === 'epoch') continue;
      const r = tryFormat(f, v, c);
      if (r) return r;
    }
    return null;
  }

  function readJson(line, c) {
    const s = line.trimStart();
    if (s.charCodeAt(0) !== 123) return null;
    let o;
    try { o = JSON.parse(s); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    let r = null;
    for (const k of TIME_KEYS) {
      if (o[k] != null && (r = timeValue(o[k], c))) break;
    }
    if (!r) return null;
    let level = null;
    for (const k of LEVEL_KEYS) {
      const v = o[k];
      if (v == null) continue;
      level = typeof v === 'number' ? numLevel(v) : normLevel(v);
      if (level) break;
    }
    return { t: r.t, zoned: r.zoned, level, end: 0 };
  }

  function findLevel(fmt, line, end) {
    if (fmt.id === 'clf') {
      const m = /"\s(\d{3})\s/.exec(line);
      if (m) { const s = +m[1]; return s >= 500 ? 'error' : s >= 400 ? 'warn' : 'info'; }
    }
    const seg = line.slice(end, end + 120);
    const m = LEVEL_RE.exec(seg);
    if (m) return normLevel(m[1]);
    if (/\bLOG:/.test(seg)) return 'info';
    return null;
  }

  function detect(lines, c) {
    const score = new Array(ALL.length).fill(0);
    let n = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      if (++n > 400) break;
      for (let i = 0; i < ALL.length; i++) if (tryFormat(ALL[i], line, c)) score[i]++;
    }
    let best = -1, bs = 0;
    for (let i = 0; i < ALL.length; i++) if (score[i] > bs) { best = i; bs = score[i]; }
    return best < 0 ? null : ALL[best];
  }

  /* ---------- Identifiants partagés ---------- */

  const ID_RES = [
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, false],
    [/\b(?:[a-z][a-z0-9]*?[_.-]?)?(?:id|ref|trace|span|txn|req)["']?\s*[:=]\s*["']?([\w.:-]{3,64})/gi, true],
    [/\b[a-z]{2,8}[_-](?=[a-z0-9]*\d)[a-z0-9]{4,40}\b/gi, false],
    [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,64}\b/gi, false],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, false],
  ];

  function extractIds(text) {
    const found = [], spans = [];
    for (const [re, group] of ID_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) && found.length < 12) {
        let tok = group ? m[1] : m[0];
        let s = group ? m.index + m[0].length - m[1].length : m.index;
        tok = tok.replace(/[.:-]+$/, '');
        if (!/\d/.test(tok) || tok.length < 3) continue;
        const e = s + tok.length;
        if (spans.some(([a, b]) => s < b && e > a)) continue;
        spans.push([s, e]);
        if (!found.includes(tok)) found.push(tok);
      }
    }
    return found;
  }

  function idKind(tok) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(tok)) return 'uuid';
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(tok)) return 'ip';
    if (/^[0-9a-f]{12,}$/i.test(tok)) return 'hex';
    if (/^\d+$/.test(tok)) return 'num';
    return 'id';
  }

  /* ---------- Source complète ---------- */

  function parseSource(text, opts) {
    const c = { tz: opts && opts.tz != null ? opts.tz : 'local', date: opts && opts.date };
    const lines = text.split(/\r?\n/);
    const fmt = detect(lines, c);
    const entries = [];
    const roll = fmt && fmt.needs === 'date';
    let orphans = 0, zoned = 0, shift = 0, prev = -Infinity, cur = null, nonEmpty = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      nonEmpty++;
      const r = fmt ? tryFormat(fmt, line, c) : null;
      if (r) {
        let t = r.t;
        if (roll) {
          // Journaux sans date : un retour en arrière de plus de 12 h signale un passage à minuit.
          if (t + shift < prev - DAY / 2) shift += DAY;
          t += shift;
          prev = t;
        }
        cur = { t, line, cont: null, level: r.level || findLevel(fmt, line, r.end) || 'other', n: i + 1 };
        if (r.zoned) zoned++;
        entries.push(cur);
      } else if (cur) {
        (cur.cont || (cur.cont = [])).push(line);
      } else {
        orphans++;
      }
    }
    for (const e of entries) e.ids = extractIds(e.cont ? e.line + '\n' + e.cont.join('\n') : e.line);

    return {
      format: fmt ? fmt.id : null,
      formatLabel: fmt ? fmt.label : null,
      needs: fmt && fmt.needs || null,
      zoned: entries.length ? zoned / entries.length : 0,
      entries, orphans, lineCount: nonEmpty,
    };
  }

  const api = { parseSource, extractIds, idKind, formats: ALL.map(f => ({ id: f.id, label: f.label })) };
  root.TresseParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
