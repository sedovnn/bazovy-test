#!/usr/bin/env node
/* Приёмочный тест судьи — раздел 7 правил.

     ANTHROPIC_API_KEY=sk-… node tools/приёмка_судьи.js
     ANTHROPIC_API_KEY=sk-… node tools/приёмка_судьи.js v1.3   # только один тест

   Гонит эталонные ответы через промпт того теста, к которому они написаны,
   и печатает таблицу уровней. Проверяет два условия правил:

     1. Порядок: «переформулировщик с опорой» выше «исполнителя»,
        «исполнитель» выше «детализатора» — по сумме четырёх основных уровней.
     2. «Переформулировщик без опоры» — не выше 3 по ГА-1 и МК-1.
     3. Если в файле проставлены ручные уровни — расхождение не больше 1.

   Запускается руками после каждой правки обёртки промпта. Стоит денег:
   один прогон = 8 вызовов судьи (по 4 на тест).

   ФАЙЛ С ТЕКСТАМИ: spec/тексты_для_Егора_*.md. Разметка, которую скрипт ждёт:

     # …любой заголовок…
     ## Тест v1.3
     ### Исполнитель
     **Ответ 1.** …текст одним абзацем…
     **Ответ 2.** …текст одним абзацем…
     Ожидаемые уровни: МК-1 2, ГА-1 2, ПР-1 3, ПП-1 3     ← строка необязательна
     ### Детализатор
     …
     ### Переформулировщик с опорой
     …
     ### Переформулировщик без опоры
     …
     ## Тест v2.1
     …

   Имена ролей сверяются по началу строки, регистр не важен. Если разметка
   в файле другая — правится РАЗБОР ниже, а не файл: файл пишут люди.
*/

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const РОЛИ = [
  { key: 'исполнитель', title: 'Исполнитель' },
  { key: 'детализатор', title: 'Детализатор' },
  { key: 'переформулировщик с опорой', title: 'Переформулировщик с опорой' },
  { key: 'переформулировщик без опоры', title: 'Переформулировщик без опоры' },
];

const КЛЮЧ = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.MODEL || 'claude-sonnet-5';

/* ---------- промпты ---------- */

function loadPrompts() {
  const src = fs.readFileSync(path.join(ROOT, 'apps-script', 'judge_prompts.gs'), 'utf8');
  const box = {};
  new Function('exports', src + '\nexports.JUDGE_PROMPTS = JUDGE_PROMPTS;')(box);
  return box.JUDGE_PROMPTS;
}

/* ---------- РАЗБОР файла с эталонными ответами ---------- */

function findFile() {
  const dir = path.join(ROOT, 'spec');
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).filter(n => /^тексты_для_Егора.*\.md$/i.test(n));
  return hit.length === 1 ? path.join(dir, hit[0]) : null;
}

function parseReference(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  let testId = null;

  for (const chunk of text.split(/\n(?=#{2,3}\s)/)) {
    const head = chunk.split('\n')[0];
    const m = /^##\s+Тест\s+(v[\d.]+)/i.exec(head);
    if (m) { testId = m[1]; out[testId] = out[testId] || {}; continue; }

    const r = /^###\s+(.+?)\s*$/.exec(head);
    if (!r || !testId) continue;

    const name = r[1].trim().toLowerCase();
    const role = РОЛИ.filter(x => name.startsWith(x.key))[0];
    if (!role) continue;

    const body = chunk.slice(head.length);
    const a1 = /\*\*Ответ\s*1\.?\*\*\s*([\s\S]*?)(?=\*\*Ответ\s*2|Ожидаемые уровни|$)/i.exec(body);
    const a2 = /\*\*Ответ\s*2\.?\*\*\s*([\s\S]*?)(?=Ожидаемые уровни|$)/i.exec(body);
    if (!a1 || !a2) {
      throw new Error(`${path.basename(file)}: у роли «${r[1]}» теста ${testId} ` +
                      'не нашлись оба ответа в виде «**Ответ 1.** …» и «**Ответ 2.** …»');
    }

    const manual = {};
    const lv = /Ожидаемые уровни:\s*(.+)/i.exec(body);
    if (lv) {
      for (const pair of lv[1].split(/[,;]/)) {
        const q = /([А-Я]{2}-\d)\s*[:\s]\s*([1-5])/.exec(pair);
        if (q) manual[q[1]] = Number(q[2]);
      }
    }

    out[testId][role.key] = {
      title: role.title,
      a1: a1[1].trim().replace(/\s+/g, ' '),
      a2: a2[1].trim().replace(/\s+/g, ' '),
      manual: manual,
    };
  }
  return out;
}

/* ---------- вызов судьи ---------- */

async function judge(prompt, a1, a2) {
  const body = {
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'disabled' },
    system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user',
                 content: `<ответ1>\n${a1}\n</ответ1>\n<ответ2>\n${a2}\n</ответ2>` }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': КЛЮЧ,
               'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${raw.slice(0, 300)}`);
  const text = JSON.parse(raw).content.map(c => c.text || '').join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

/* ---------- прогон ---------- */

const ABIL = ['МК-1', 'ГА-1', 'ПР-1', 'ПП-1'];

function pad(s, n) { return String(s) + ' '.repeat(Math.max(0, n - String(s).length)); }

async function main() {
  const prompts = loadPrompts();
  const file = findFile();

  if (!file) {
    console.log('Эталонных текстов нет.\n');
    console.log('Скрипт ждёт файл spec/тексты_для_Егора_*.md — 4 ответа на каждый тест:');
    РОЛИ.forEach(r => console.log('  · ' + r.title));
    console.log('\nРазметка описана в шапке этого файла. Пока файла нет,');
    console.log('проверить судью нечем: критерий раздела 7 правил — воспроизведение');
    console.log('порядка на этих четырёх, а не качество отдельного разбора.');
    process.exit(2);
  }

  if (!КЛЮЧ) {
    console.log('Нет ключа. Запуск: ANTHROPIC_API_KEY=sk-… node tools/приёмка_судьи.js');
    process.exit(2);
  }

  const only = process.argv[2];
  const ref = parseReference(file);
  let bad = 0;

  for (const testId of Object.keys(ref)) {
    if (only && testId !== only) continue;
    const prompt = prompts[testId];
    if (!prompt) { console.log(`\n${testId}: промпта судьи нет, пропускаю`); bad++; continue; }

    console.log(`\nТест ${testId} · промпт ${prompt.version}`);
    console.log('  ' + pad('роль', 32) + ABIL.map(a => pad(a, 6)).join('') + 'сумма');

    const sums = {};
    const levels = {};
    for (const role of РОЛИ) {
      const item = ref[testId][role.key];
      if (!item) { console.log('  ' + pad(role.title, 32) + '— текста нет'); bad++; continue; }

      const verdict = await judge(prompt.text, item.a1, item.a2);
      const got = ABIL.map(a => (verdict[a] && verdict[a].level) || 0);
      const sum = got.reduce((x, y) => x + y, 0);
      sums[role.key] = sum;
      levels[role.key] = got;

      console.log('  ' + pad(role.title, 32) + got.map(v => pad(v || '—', 6)).join('') + sum);

      // расхождение с ручными уровнями — не больше 1
      ABIL.forEach((a, i) => {
        const want = item.manual[a];
        if (want && Math.abs(want - got[i]) > 1) {
          console.log(`      ПЛОХО  ${a}: судья ${got[i]}, руками ${want} — расхождение больше 1`);
          bad++;
        }
      });
    }

    const с = sums['переформулировщик с опорой'];
    const и = sums['исполнитель'];
    const д = sums['детализатор'];
    const без = levels['переформулировщик без опоры'];

    if (с !== undefined && и !== undefined && д !== undefined) {
      const ok = с > и && и > д;
      console.log('  ' + (ok ? 'ok   ' : 'ПЛОХО') +
                  `  порядок: с опорой ${с} > исполнитель ${и} > детализатор ${д}`);
      if (!ok) bad++;
    }
    if (без) {
      const га = без[ABIL.indexOf('ГА-1')], мк = без[ABIL.indexOf('МК-1')];
      const ok = га <= 3 && мк <= 3;
      console.log('  ' + (ok ? 'ok   ' : 'ПЛОХО') +
                  `  без опоры не выше 3: ГА-1 ${га}, МК-1 ${мк}`);
      if (!ok) bad++;
    }
  }

  console.log(bad ? `\nПРОВАЛЕНО: ${bad}` : '\nСудья воспроизводит порядок.');
  process.exit(bad ? 1 : 0);
}

if (require.main === module) {
  main().catch(err => { console.error('Сломалось: ' + err.message); process.exit(1); });
} else {
  // чтобы разбор файла можно было проверить без вызовов судьи
  module.exports = { parseReference, РОЛИ };
}
