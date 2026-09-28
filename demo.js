/* Tresse — jeu d'exemple : un incident de paiement réparti sur quatre services.
   Entre 12:02:04 et 12:03:12 UTC, un export comptable verrouille la table orders :
   des paiements sont encaissés sans que la commande passe à « payée ».
   L'horloge du worker retarde de 1,8 s. */
(function (root) {
  'use strict';

  function rng(seed) {
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const p2 = n => String(n).padStart(2, '0');
  const p3 = n => String(n).padStart(3, '0');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function utc(t) {
    const d = new Date(Math.round(t));
    return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()];
  }
  const day = p => `${p[0]}-${p2(p[1] + 1)}-${p2(p[2])}`;
  const py = t => { const p = utc(t); return `${day(p)} ${p2(p[3])}:${p2(p[4])}:${p2(p[5])},${p3(p[6])}`; };
  const pgts = t => { const p = utc(t); return `${day(p)} ${p2(p[3])}:${p2(p[4])}:${p2(p[5])}.${p3(p[6])} UTC`; };
  const clf = t => { const p = utc(t + 7200000); return `${p2(p[2])}/${MON[p[1]]}/${p[0]}:${p2(p[3])}:${p2(p[4])}:${p2(p[5])} +0200`; };

  function build() {
    const r = rng(20260928);
    const pick = a => a[Math.floor(r() * a.length)];
    const hex = n => { let s = ''; while (s.length < n) s += '0123456789abcdef'[Math.floor(r() * 16)]; return s; };
    const b62 = n => { let s = ''; while (s.length < n) s += 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[Math.floor(r() * 57)]; return s; };

    const base = Date.UTC(2026, 8, 28, 12, 0, 0);
    const L0 = base + 124310, L1 = base + 192330;
    const SKEW = -1800;
    const out = { nginx: [], api: [], worker: [], pg: [] };
    const push = (k, t, s) => out[k].push([t, s]);
    const job = obj => JSON.stringify(obj);
    const wk = (level, t, o) => job(Object.assign({ level, time: Math.round(t + SKEW), pid: 7, hostname: 'worker-2' }, o));

    const ips = ['81.64.12.9', '92.184.101.3', '176.139.5.40', '90.12.77.201', '86.247.18.66', '37.169.3.12', '78.192.40.7'];
    const uas = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    ];
    const ngx = (t, ip, ua, meth, path, st, bytes, dur, id) =>
      push('nginx', t, `${ip} - - [${clf(t)}] "${meth} ${path} HTTP/1.1" ${st} ${bytes} "-" "${ua}" rt=${(dur / 1000).toFixed(3)} req_id=${id}`);

    let order = 48207, pgpid = 48190;

    function products(t, id, ip, ua) {
      const dur = 9 + Math.floor(r() * 38);
      const page = 1 + Math.floor(r() * 6);
      push('api', t + dur - 1, `${py(t + dur - 1)} INFO [http] req=${id} GET /api/products?page=${page} 200 ${dur}ms`);
      ngx(t + dur, ip, ua, 'GET', `/api/products?page=${page}`, 200, 4000 + Math.floor(r() * 9000), dur, id);
    }

    function cart(t, id, ip, ua) {
      const dur = 14 + Math.floor(r() * 30);
      const u = 1000 + Math.floor(r() * 9000);
      push('api', t + 2, `${py(t + 2)} INFO [cart] req=${id} add sku=SKU-${1000 + Math.floor(r() * 9000)} qty=1 user_id=${u}`);
      push('api', t + dur - 1, `${py(t + dur - 1)} INFO [http] req=${id} POST /api/cart 201 ${dur}ms`);
      ngx(t + dur, ip, ua, 'POST', '/api/cart', 201, 312, dur, id);
    }

    function checkout(t, id, ip, ua) {
      const oid = 'ord_' + (++order);
      const u = 1000 + Math.floor(r() * 9000);
      const cents = 1990 + Math.floor(r() * 12) * 1000;
      const ch = 'ch_' + b62(14);
      push('api', t + 3, `${py(t + 3)} INFO [checkout] req=${id} start user_id=${u} order=${oid} amount=${(cents / 100).toFixed(2)} EUR`);
      const wc = t + 110 + r() * 40;
      push('worker', wc, wk(30, wc, { req_id: id, order_id: oid, amount: cents, msg: 'charge.create' }));
      const cap = wc + 520 + r() * 320;
      push('worker', cap, wk(30, cap, { req_id: id, order_id: oid, charge_id: ch, msg: 'charge.captured' }));
      const upd = cap + 15;

      if (upd < L0 || upd >= L1) {
        const done = upd + 8 + r() * 20;
        push('api', done, `${py(done)} INFO [checkout] req=${id} order=${oid} paid charge=${ch} in ${Math.round(done - t)}ms`);
        ngx(done + 2, ip, ua, 'POST', '/api/checkout', 200, 188, done + 2 - t, id);
        return;
      }

      const pid = ++pgpid;
      if (upd + 1000 < L1) {
        push('pg', upd + 1000, `${pgts(upd + 1000)} [${pid}] app=api LOG:  process ${pid} still waiting for RowExclusiveLock on relation 16421 of database 16384 after 1000.${p3(Math.floor(r() * 999))} ms`);
      }
      if (L1 - upd < 8000) {
        const done = L1 + 6 + r() * 25;
        push('api', done, `${py(done)} WARNING [checkout] req=${id} order=${oid} paid charge=${ch} in ${Math.round(done - t)}ms (slow)`);
        ngx(done + 2, ip, ua, 'POST', '/api/checkout', 200, 188, done + 2 - t, id);
        return;
      }
      push('api', upd + 5000, `${py(upd + 5000)} WARNING [db] req=${id} UPDATE orders still waiting after 5000ms order=${oid}`);
      const fail = upd + 8000;
      push('pg', fail, `${pgts(fail)} [${pid}] app=api ERROR:  canceling statement due to lock timeout`);
      push('pg', fail + 0.2, `${pgts(fail)} [${pid}] app=api STATEMENT:  UPDATE orders SET status = 'paid', charge_id = '${ch}' WHERE id = '${oid}'`);
      push('api', fail + 4, [
        `${py(fail + 4)} ERROR [checkout] req=${id} order=${oid} charge=${ch} captured but order update failed`,
        'Traceback (most recent call last):',
        '  File "/app/checkout/service.py", line 142, in finalize',
        '    await db.execute(MARK_PAID, order_id, charge_id)',
        '  File "/app/.venv/lib/python3.12/site-packages/asyncpg/connection.py", line 350, in execute',
        '    return await self._protocol.query(query, timeout)',
        'asyncpg.exceptions.LockNotAvailableError: canceling statement due to lock timeout',
      ].join('\n'));
      ngx(fail + 9, ip, ua, 'POST', '/api/checkout', 500, 97, fail + 9 - t, id);
      push('worker', fail + 70, wk(40, fail + 70, { req_id: id, order_id: oid, charge_id: ch, reason: 'order_not_paid', msg: 'reconcile.enqueued' }));
    }

    for (let t = base + 380; t < base + 300000; t += 260 + r() * 900) {
      const id = hex(16), ip = pick(ips), ua = pick(uas), k = r();
      if (k < 0.2) checkout(t, id, ip, ua);
      else if (k < 0.36) cart(t, id, ip, ua);
      else products(t, id, ip, ua);
    }

    for (let t = base + 4000; t < base + 300000; t += 10000) {
      const locked = t > L0 && t < L1 + 20000;
      push('worker', t, wk(20, t, { msg: 'queue.poll', queue: 'payments', depth: locked ? 2 + Math.floor(r() * 9) : Math.floor(r() * 2) }));
    }
    for (let t = base + 7000; t < base + 300000; t += 15000) {
      push('api', t, `${py(t)} DEBUG [cache] products hit_ratio=${(0.88 + r() * 0.1).toFixed(2)} size=2481`);
    }

    push('pg', base + 31004, `${pgts(base + 31004)} [412] LOG:  checkpoint starting: time`);
    push('pg', base + 57918, `${pgts(base + 57918)} [412] LOG:  checkpoint complete: wrote 1843 buffers (11.2%); 0 WAL file(s) added, 0 removed, 1 recycled; write=26.790 s, sync=0.041 s, total=26.914 s`);
    push('pg', L0 - 14, `${pgts(L0 - 14)} [51200] app=export-compta LOG:  statement: BEGIN`);
    push('pg', L0, `${pgts(L0)} [51200] app=export-compta LOG:  statement: LOCK TABLE orders IN ACCESS EXCLUSIVE MODE`);
    push('pg', L0 + 3, `${pgts(L0 + 3)} [51200] app=export-compta LOG:  statement: COPY (SELECT * FROM orders WHERE created_at >= '2026-09-01') TO STDOUT WITH CSV HEADER`);
    push('pg', L1 - 2, `${pgts(L1 - 2)} [51200] app=export-compta LOG:  duration: 68017.412 ms  statement: COPY (SELECT * FROM orders WHERE created_at >= '2026-09-01') TO STDOUT WITH CSV HEADER`);
    push('pg', L1, `${pgts(L1)} [51200] app=export-compta LOG:  statement: COMMIT`);
    push('pg', base + 281440, `${pgts(base + 281440)} [51388] LOG:  automatic vacuum of table "shop.public.cart_items": index scans: 1, pages: 0 removed, 212 remain`);

    const text = k => out[k].sort((a, b) => a[0] - b[0]).map(x => x[1]).join('\n') + '\n';
    return [
      { name: 'nginx', text: text('nginx'), tz: 'local', date: '2026-09-28' },
      { name: 'api', text: text('api'), tz: '0', date: '2026-09-28' },
      { name: 'worker', text: text('worker'), tz: 'local', date: '2026-09-28' },
      { name: 'postgres', text: text('pg'), tz: 'local', date: '2026-09-28' },
    ];
  }

  root.TresseDemo = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TresseDemo;
})(typeof window !== 'undefined' ? window : globalThis);
