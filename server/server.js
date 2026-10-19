/* Сервер базового теста на Selectel.

     POST /api                  — то же, что веб-приложение Apps Script (doPost)
     GET  /api                  — проверка, что сервер жив
     GET  /admin/export.csv?key — все ответы одной таблицей для Excel (ключ ADMIN_KEY
                                  или вход ведущего: ?token=)

   Кабинет ведущего: один логин и пароль (HOST_LOGIN, HOST_PASSWORD_HASH).
   Вход — действие login, в ответ токен на 30 дней. Действия ведущего без
   токена не выполняются; с токеном сервер кладёт в запрос свой HOST_SECRET,
   по нему бэкенд (Code.gs, hostAllowed) пускает к данным группы.

   Статику (index.html, host.html, css, js, data, assets) отдаёт Caddy;
   для проверки на своей машине её отдаёт и этот сервер, если задан STATIC_DIR.

   Настройки — из окружения (на сервере: /etc/bazovy-test.env):
     PORT, DB_PATH, JUDGE_URL, JUDGE_SECRET, ADMIN_KEY, WORKERS, STATIC_DIR,
     HOST_LOGIN, HOST_PASSWORD_HASH (соль:хеш scrypt), HOST_SECRET */

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const crypto = require('node:crypto');
const sheets = require('./sheets');

const ROOT = path.resolve(__dirname, '..');
const env = {
  PORT: Number(process.env.PORT || 8080),
  DB_PATH: process.env.DB_PATH || path.join(ROOT, 'data.sqlite'),
  JUDGE_URL: process.env.JUDGE_URL || '',
  JUDGE_SECRET: process.env.JUDGE_SECRET || '',
  ADMIN_KEY: process.env.ADMIN_KEY || '',
  STATIC_DIR: process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : '',
  HOST_LOGIN: process.env.HOST_LOGIN || '',
  HOST_PASSWORD_HASH: process.env.HOST_PASSWORD_HASH || '',
  HOST_SECRET: process.env.HOST_SECRET || '',
};

/* ---------- вход ведущего ---------- */

// действия, которые видят данные группы или создают сессии, — только после входа
const HOST_ACTIONS = ['listSessions', 'createSession', 'summary', 'compare', 'quotes',
                      'candidates', 'candidateDetail', 'rejudge', 'deleteSession', 'restoreSession'];
const TOKEN_DAYS = 30;

function sign(s) { return crypto.createHmac('sha256', env.HOST_SECRET).update(s).digest('hex'); }

function makeToken() {
  const exp = String(Date.now() + TOKEN_DAYS * 864e5);
  return exp + '.' + sign(exp);
}

function tokenValid(t) {
  if (!env.HOST_SECRET || !t) return false;
  const [exp, mac] = String(t).split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return mac.length === good.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good));
}

function passwordOk(login, password) {
  if (!env.HOST_LOGIN || !env.HOST_PASSWORD_HASH) return false;
  const [salt, hash] = env.HOST_PASSWORD_HASH.split(':');
  const got = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return String(login || '').trim().toLowerCase() === env.HOST_LOGIN.toLowerCase() &&
         crypto.timingSafeEqual(Buffer.from(got), Buffer.from(hash));
}

// перебор пароля: не больше 8 неудачных попыток за 15 минут с одного адреса
const fails = new Map();
function tooMany(ip) {
  const now = Date.now(), list = (fails.get(ip) || []).filter(t => now - t < 15 * 60e3);
  fails.set(ip, list);
  return list.length >= 8;
}
const WORKERS = Number(process.env.WORKERS || 6);

/* ---------- рабочие ---------- */

const pool = [];
const queue = [];
let seq = 0;
const waiting = new Map();

function startWorker(i) {
  const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { env, root: ROOT } });
  w.busy = false;
  w.on('message', ({ id, out }) => {
    const done = waiting.get(id);
    waiting.delete(id);
    w.busy = false;
    if (done) done(out);
    pump();
  });
  w.on('error', e => console.error('рабочий упал:', e));
  w.on('exit', () => { pool[i] = startWorker(i); pump(); });
  return w;
}
sheets.init(env.DB_PATH);
for (let i = 0; i < WORKERS; i++) pool.push(startWorker(i));

function pump() {
  while (queue.length) {
    const w = pool.find(x => x && !x.busy);
    if (!w) return;
    const job = queue.shift();
    w.busy = true;
    waiting.set(job.id, job.done);
    w.postMessage({ id: job.id, body: job.body });
  }
}

function run(body) {
  return new Promise(done => { queue.push({ id: ++seq, body, done }); pump(); });
}

/* ---------- выгрузка ---------- */

function csv(rows) {
  const cell = v => {
    const s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // «;» и BOM — так русский Excel открывает файл сразу по столбцам
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
}

let exportStore = null;
function exportCsv(which) {
  if (!exportStore) exportStore = sheets.open(env.DB_PATH);
  // удалённые сессии и их ответы в выгрузку не идут
  const sess = exportStore.rowsOf('sessions');
  const sh = sess[0] || [], iDel = sh.indexOf('deleted_at'), iCode = sh.indexOf('code');
  const gone = new Set(iDel < 0 ? [] : sess.slice(1).filter(r => r[iDel]).map(r => r[iCode]));
  let rows = exportStore.rowsOf(which);
  if (gone.size && rows.length) {
    const col = rows[0].indexOf(which === 'sessions' ? 'code' : 'session_code');
    rows = [rows[0]].concat(rows.slice(1).filter(r => !gone.has(r[col])));
  }
  const w = exportStore.width(rows);
  return csv(rows.map(r => exportStore.pad(r, w)));
}

/* ---------- статика для проверки на своей машине ---------- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
                '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(env.STATIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.resolve(env.STATIC_DIR))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('нет такой страницы'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------- http ---------- */

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api' && req.method === 'POST') {
    let body = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 1024 * 1024) { res.writeHead(413); res.end(); req.destroy(); return; }
      body += c;
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      const send = obj => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
      };
      let p;
      try { p = JSON.parse(body); } catch (e) { return send({ ok: false, error: 'Не разобрал тело запроса' }); }
      delete p.hostAuth;   // пропуск ведущего ставит только сервер

      if (p.action === 'login') {
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        if (tooMany(ip)) return send({ ok: false, error: 'Слишком много попыток. Подождите 15 минут.' });
        if (!passwordOk(p.login, p.password)) {
          fails.get(ip).push(Date.now());
          return send({ ok: false, error: 'Неверный логин или пароль' });
        }
        return send({ ok: true, token: makeToken() });
      }
      if (p.action === 'checkToken') return send({ ok: tokenValid(p.token) });

      if (HOST_ACTIONS.indexOf(p.action) >= 0) {
        if (!tokenValid(p.token)) return send({ ok: false, error: 'need_login' });
        p.hostAuth = env.HOST_SECRET;
      }
      delete p.token;
      run(JSON.stringify(p)).then(send);
    });
    return;
  }

  if (url.pathname === '/api' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, service: 'Базовый тест', judge: !!env.JUDGE_URL }));
  }

  if (url.pathname === '/admin/export.csv' || url.pathname === '/admin/sessions.csv') {
    const byKey = env.ADMIN_KEY && url.searchParams.get('key') === env.ADMIN_KEY;
    if (!byKey && !tokenValid(url.searchParams.get('token'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('нужен ключ');
    }
    const which = url.pathname === '/admin/sessions.csv' ? 'sessions' : 'responses';
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
                         'Content-Disposition': `attachment; filename="bazovy-test-${which}-${stamp}.csv"` });
    return res.end(exportCsv(which));
  }

  if (env.STATIC_DIR && req.method === 'GET') return serveStatic(req, res);

  res.writeHead(404);
  res.end();
}).listen(env.PORT, '127.0.0.1', () => {
  console.log(`Базовый тест: http://127.0.0.1:${env.PORT}  база ${env.DB_PATH}  рабочих ${WORKERS}`);
});
