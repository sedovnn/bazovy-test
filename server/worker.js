/* Рабочий процесс: исполняет apps-script/*.gs в своём контексте поверх
   таблицы в SQLite. Судья зовётся синхронно (как в Apps Script) — поэтому
   рабочих несколько: пока один ждёт судью 20 секунд, другие отвечают на
   сводки и отправки остальной группы. */

'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sheets = require('./sheets');

const env = workerData.env;
const store = sheets.open(env.DB_PATH);

/* ---------- заглушки сервисов Google ---------- */

const props = { SHEET_ID: 'selectel' };
const ctx = {
  console,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : (env[k] || null)),
      setProperty: (k, v) => { props[k] = v; },
    }),
  },
  SpreadsheetApp: {
    openById: () => store.book,
    create: () => store.book,
  },
  LockService: { getScriptLock: () => store.lock },
  Utilities: { getUuid: () => crypto.randomUUID() },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }),
  },
  Logger: { log: (...a) => console.log(...a) },
};
vm.createContext(ctx);

const GS = path.resolve(workerData.root, 'apps-script');
for (const f of ['config.gs', 'keys.gs', 'scoring.gs', 'Code.gs']) {
  vm.runInContext(fs.readFileSync(path.join(GS, f), 'utf8').replace(/^module\.exports.*$/gm, ''),
                  ctx, { filename: f });
}

/* Судья. PROVIDER=deepseek — судит сам сервер через DeepSeek (из России
   доступен): тот же judge.gs и те же промпты, что в Apps Script, запрос
   уходит через curl. Иначе — как раньше, через Apps Script с Claude: туда
   уходят только тексты трёх ответов и id теста. */
const os = require('node:os');

function fetchSync(url, opt) {
  // тело и заголовок с ключом — во временных файлах (0600), а не в командной строке
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-'));
  const bodyFile = path.join(dir, 'body'), hdrFile = path.join(dir, 'hdr');
  try {
    fs.writeFileSync(bodyFile, opt.payload || '', { mode: 0o600 });
    const hdr = Object.entries(opt.headers || {}).map(([k, v]) => k + ': ' + v);
    hdr.push('Content-Type: ' + (opt.contentType || 'application/json'));
    fs.writeFileSync(hdrFile, hdr.join('\n') + '\n', { mode: 0o600 });
    const out = execFileSync('curl', ['-sS', '--max-time', '170', '-X', (opt.method || 'get').toUpperCase(),
                                      '-H', '@' + hdrFile, '--data-binary', '@' + bodyFile,
                                      '-w', '\n%{http_code}', url],
                             { maxBuffer: 32 * 1024 * 1024, timeout: 180000 }).toString('utf8');
    const cut = out.lastIndexOf('\n');
    const code = Number(out.slice(cut + 1)), text = out.slice(0, cut);
    return { getResponseCode: () => code, getContentText: () => text };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (String(env.PROVIDER || '').toLowerCase() === 'deepseek') {
  ctx.UrlFetchApp = { fetch: fetchSync };
  for (const f of ['judge_prompts.gs', 'judge.gs']) {
    vm.runInContext(fs.readFileSync(path.join(GS, f), 'utf8').replace(/^module\.exports.*$/gm, ''),
                    ctx, { filename: f });
  }
} else {
  ctx.judgePrompt = () => ({ version: 'remote' });
  ctx.judgeAnswers = function (testId, texts) {
    const fail = error => ({ ok: false, judge: null, error, model: '', promptVersion: '' });
    if (!env.JUDGE_URL || !env.JUDGE_SECRET) return fail('Судья не настроен: нет JUDGE_URL или JUDGE_SECRET');
    try {
      const body = JSON.stringify({ action: 'judge', secret: env.JUDGE_SECRET, testId, texts });
      const out = execFileSync('curl', ['-sSL', '--max-time', '150', '-H', 'Content-Type: text/plain;charset=utf-8',
                                        '--data-binary', '@-', env.JUDGE_URL],
                               { input: body, maxBuffer: 16 * 1024 * 1024, timeout: 160000 });
      const res = JSON.parse(out.toString('utf8'));
      if (!res.ok) return fail('Судья: ' + (res.error || 'отказ'));
      return res.verdict;
    } catch (e) {
      return fail('Судья не ответил: ' + String(e.message || e).slice(0, 300));
    }
  };
}

parentPort.on('message', ({ id, body }) => {
  let out;
  try {
    out = ctx.doPost({ postData: { contents: body } }).getContent();
  } catch (e) {
    out = JSON.stringify({ ok: false, error: String(e && e.message || e) });
  } finally {
    store.lock.releaseLock();   // на случай исключения внутри замка
  }
  parentPort.postMessage({ id, out });
});
