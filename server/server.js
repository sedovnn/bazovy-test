/* Сервер базового теста на Selectel.

     POST /api                  — то же, что веб-приложение Apps Script (doPost)
     GET  /api                  — проверка, что сервер жив
     GET  /admin/export.csv?key — все ответы одной таблицей для Excel (ключ ADMIN_KEY)

   Статику (index.html, host.html, css, js, data, assets) отдаёт Caddy;
   для проверки на своей машине её отдаёт и этот сервер, если задан STATIC_DIR.

   Настройки — из окружения (на сервере: /etc/bazovy-test.env):
     PORT, DB_PATH, JUDGE_URL, JUDGE_SECRET, ADMIN_KEY, WORKERS, STATIC_DIR */

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const sheets = require('./sheets');

const ROOT = path.resolve(__dirname, '..');
const env = {
  PORT: Number(process.env.PORT || 8080),
  DB_PATH: process.env.DB_PATH || path.join(ROOT, 'data.sqlite'),
  JUDGE_URL: process.env.JUDGE_URL || '',
  JUDGE_SECRET: process.env.JUDGE_SECRET || '',
  ADMIN_KEY: process.env.ADMIN_KEY || '',
  STATIC_DIR: process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : '',
};
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
  const rows = exportStore.rowsOf(which);
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
      run(body).then(out => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(out);
      });
    });
    return;
  }

  if (url.pathname === '/api' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, service: 'Базовый тест', judge: !!env.JUDGE_URL }));
  }

  if (url.pathname === '/admin/export.csv' || url.pathname === '/admin/sessions.csv') {
    if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
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
