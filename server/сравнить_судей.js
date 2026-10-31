/* Сравнение судей: DeepSeek оценивает сохранённые прохождения заново,
   рядом — уровни, которые уже стоят в базе (Claude). В базу ничего не пишет.
   node server/сравнить_судей.js <база.sqlite> [тест] [сколько]
   Ключ — DEEPSEEK_API_KEY из окружения. Имена не печатаются и никуда не уходят:
   в DeepSeek идут только тексты трёх ответов. */

'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const sheets = require('./sheets');

const [dbPath, onlyTest, limit] = process.argv.slice(2);
const env = Object.assign({}, process.env, { PROVIDER: 'deepseek' });

function fetchSync(url, opt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-'));
  const bodyFile = path.join(dir, 'body'), hdrFile = path.join(dir, 'hdr');
  try {
    fs.writeFileSync(bodyFile, opt.payload || '', { mode: 0o600 });
    const hdr = Object.entries(opt.headers || {}).map(([k, v]) => k + ': ' + v);
    hdr.push('Content-Type: ' + (opt.contentType || 'application/json'));
    fs.writeFileSync(hdrFile, hdr.join('\n') + '\n', { mode: 0o600 });
    const out = execFileSync('curl', ['-sS', '--max-time', '170', '-X', 'POST', '-H', '@' + hdrFile,
                                      '--data-binary', '@' + bodyFile, '-w', '\n%{http_code}', url],
                             { maxBuffer: 32 * 1024 * 1024, timeout: 180000 }).toString('utf8');
    const cut = out.lastIndexOf('\n');
    return { getResponseCode: () => Number(out.slice(cut + 1)), getContentText: () => out.slice(0, cut) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const ctx = {
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => env[k] || null, setProperty() {} }) },
  UrlFetchApp: { fetch: fetchSync },
  Logger: { log() {} },
};
vm.createContext(ctx);
ctx.PROP = ctx.PropertiesService.getScriptProperties();
const GS = path.resolve(__dirname, '..', 'apps-script');
for (const f of ['config.gs', 'judge_prompts.gs', 'judge.gs']) {
  vm.runInContext(fs.readFileSync(path.join(GS, f), 'utf8').replace(/^module\.exports.*$/gm, ''), ctx);
}

const store = sheets.open(dbPath);
const R = store.book.getSheetByName('responses').getDataRange().getValues();
const h = R[0].map(String), g = (r, k) => r[h.indexOf(k)];
const ABIL = ['МК-1', 'ГА-1', 'ПР-1', 'ПП-1'];
let rows = R.slice(1).filter(r => !onlyTest || String(g(r, 'test_id')) === onlyTest)
                    .filter(r => String(g(r, 'judge_status')) === 'ok');
// самые наполненные ответы — первыми (по числу слов в трёх своих комментариях)
const words = r => ['q1', 'q2', 'q3'].reduce((n, q) => n + (Number(g(r, q + '_words')) || 0), 0);
rows.sort((a, b) => words(b) - words(a));
if (limit) rows = rows.slice(0, Number(limit));
const REPEAT = Number(process.env.REPEAT || 1);
rows = rows.flatMap(r => Array(REPEAT).fill(r));

/* RAZBOR=234,352 — подробный разбор этих ответов (по числу слов): тексты и границы
   МК-1 и ГА-1 у Claude (из базы) и у DeepSeek (новый вызов). */
if (process.env.RAZBOR) {
  const pick = process.env.RAZBOR.split(',').map(Number);
  const seen = new Set();
  rows.filter(r => pick.includes(words(r)) && !seen.has(words(r)) && seen.add(words(r))).forEach(r => {
    const test = ctx.CONFIG.tests.find(t => t.id === String(g(r, 'test_id')));
    const texts = test.free.map(q => String(g(r, q.id + '_text') || ''));
    console.log('\n================ ответ на', words(r), 'слов');
    texts.forEach((t, i) => console.log(`\n[Свой комментарий ${i + 1}] ${t}`));
    const t0 = Date.now();
    const v = ctx.judgeAnswers(test.id, texts);
    console.log(`\n(судья думал ${Math.round((Date.now() - t0) / 1000)} с)`);
    for (const a of ['МК-1', 'ГА-1']) {
      console.log(`\n--- ${a}: Claude ${g(r, a + '_level')} · DeepSeek ${v.ok ? v.judge[a].level : 'ошибка ' + v.error}`);
      console.log('Claude, границы:\n' + g(r, a + '_gates'));
      if (g(r, a + '_unclear')) console.log('Claude, сомнение: ' + g(r, a + '_unclear'));
      if (v.ok) {
        const gt = v.judge[a].gates;
        console.log('DeepSeek, границы:\n' + ['2', '3', '4', '5'].map(k => `${k - 1}→${k}: ${gt[k].s}${gt[k].q ? ' «' + gt[k].q + '»' : ''}`).join('\n'));
        if (v.judge[a].unclear) console.log('DeepSeek, сомнение: ' + v.judge[a].unclear);
      }
    }
  });
  process.exit(0);
}

const diff = { same: 0, up: 0, down: 0 };
rows.forEach((r, i) => {
  const test = ctx.CONFIG.tests.find(t => t.id === String(g(r, 'test_id')));
  const texts = test.free.map(q => String(g(r, q.id + '_text') || ''));
  const t0 = Date.now();
  const v = ctx.judgeAnswers(test.id, texts);
  const sec = Math.round((Date.now() - t0) / 1000);
  if (!v.ok) { console.log(`#${i + 1} ${test.id}: DeepSeek ошибка — ${v.error}`); return; }
  const line = ABIL.map(a => {
    const was = Number(g(r, a + '_level')) || null, now = v.judge[a] ? v.judge[a].level : null;
    if (was && now) diff[now === was ? 'same' : now > was ? 'up' : 'down']++;
    return `${a} ${was ?? '—'}→${now ?? '—'}${v.judge[a] && v.judge[a].stronger ? '' : ' (без «сильнее»)'}`;
  }).join(' · ');
  console.log(`#${i + 1} ${test.id} · ${words(r)} слов · ${sec} с · Claude→DeepSeek: ${line}`);
  ABIL.slice(0, 1).forEach(a => { if (v.judge[a]) console.log(`   ${a} сильная сторона: ${v.judge[a].has}`); });
});
console.log(`\nсовпало ${diff.same}, DeepSeek выше ${diff.up}, ниже ${diff.down}`);
