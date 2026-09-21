/* Прогон apps-script/*.gs в Node на заглушках Google-сервисов.
   Запуск: node tools/прогон_бэкенда.js
   Проверяет маршрутизацию, подсчёт, запись, агрегат, открытие карты,
   повторную отправку и — главное — что падение судьи не роняет отправку. */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

/* ---------- заглушки ---------- */

const props = { ANTHROPIC_API_KEY: 'тест-ключ', MODEL: 'claude-sonnet-5' };
const sheets = {};

function makeSheet(name) {
  const rows = [];
  return {
    name,
    appendRow: r => rows.push(r.slice()),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getRange: (row, col, nRows, nCols) => ({
      getValues: () => {
        const out = [];
        for (let r = row; r < row + (nRows || 1); r++) {
          out.push((rows[r - 1] || []).slice(col - 1, col - 1 + (nCols || 1)));
        }
        return out;
      },
      setValue: v => { rows[row - 1][col - 1] = v; },
      setValues: vals => { vals[0].forEach((v, i) => { rows[row - 1][col - 1 + i] = v; }); },
      createTextFinder: needle => ({
        matchEntireCell: () => ({
          findNext: () => {
            for (let r = row; r < row + (nRows || 1); r++) {
              if (rows[r - 1] && String(rows[r - 1][col - 1]) === String(needle)) {
                return { getRow: () => r };
              }
            }
            return null;
          },
        }),
      }),
    }),
    getLastColumn: () => (rows.length ? rows[0].length : 0),
    getLastRow: () => rows.length,
    deleteRow: n => { rows.splice(n - 1, 1); },
    setFrozenRows: () => {},
    _rows: rows,
  };
}

const book = {
  getId: () => 'книга-заглушка',
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = makeSheet(n)),
  getSheets: () => Object.values(sheets),
  deleteSheet: () => {},
};

let fetchMode = 'ok';          // ok | http500 | мусор | сеть
let fetchCalls = 0;

global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
  }),
};
global.SpreadsheetApp = { create: () => book, openById: () => book };
global.Utilities = { getUuid: () => 'uuid-' + (++global._uuid) };
global._uuid = 0;
global.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: t => ({ setMimeType: () => ({ getContent: () => t }) }),
};
global.Logger = { log: m => console.log('  [Logger] ' + m) };
global.LockService = {
  getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
};

global.UrlFetchApp = {
  fetch: (url, opt) => {
    fetchCalls++;
    if (fetchMode === 'сеть') throw new Error('соединение оборвалось');
    if (fetchMode === 'http500') {
      return { getResponseCode: () => 500, getContentText: () => '{"error":{"message":"overloaded"}}' };
    }
    const body = JSON.parse(opt.payload);
    if (!Array.isArray(body.system) || !body.system[0].cache_control) {
      throw new Error('system должен быть блоком с cache_control');
    }
    if ('temperature' in body) throw new Error('temperature эта модель не принимает — 400');
    if (body.max_tokens !== 2000) throw new Error('max_tokens не 2000, как в спеке');
    if (!body.thinking || body.thinking.type !== 'disabled') throw new Error('рассуждение не выключено');
    const content = body.messages[0].content;
    if (!/^<ответ1>/.test(content) || content.indexOf('<ответ2>') < 0) {
      throw new Error('ответы не обёрнуты в <ответ1>/<ответ2>');
    }
    const text = fetchMode === 'мусор' && fetchCalls === 1
      ? 'Конечно! Вот оценка.'
      : '```json\n' + JSON.stringify({
          'МК-1': { level: 4, quote: 'сервис', why: 'Уровень 4 пройден', flag: false, slogan: false },
          'ГА-1': { level: 2, quote: 'отказ', why: 'Уровень 2 пройден', flag: false, slogan: false },
          'ПР-1': { level: 5, quote: 'высвобождаем', why: 'Уровень 5 пройден', flag: true, slogan: false },
          'ПП-1': { level: 3, quote: 'первый год', why: 'Уровень 3 пройден', flag: false, slogan: true },
          extra: { 'АК-1': { level: 4, quote: 'китайская цена' } },
          feedback: 'Видно направление, не хватает связи этапов.',
        }) + '\n```';
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ content: [{ type: 'text', text }] }),
    };
  },
};

/* ---------- загрузка ---------- */

for (const f of ['config.gs', 'keys.gs', 'scoring.gs', 'judge_prompts.gs', 'judge.gs', 'Code.gs']) {
  (0, eval)(fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8')
             .replace(/^module\.exports.*$/gm, ''));
}

/* ---------- прогон ---------- */

let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { fails++; console.log('  ПЛОХО ' + name + (extra ? '  → ' + extra : '')); }
}
function post(payload) {
  return JSON.parse(doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
}

const судейский = CONFIG.tests.filter(t => JUDGE_PROMPTS[t.id])[0];

/* Меток реплик в тесте руками не знает никто: они собираются из хеша текста.
   Идеальную расстановку выводим из ключа — сортируем метки по уровню вниз. */
function идеал(testId, sid) {
  const key = KEYS[testId][sid];
  return Object.keys(key).sort((a, b) => key[b] - key[a]);
}
const ИДЕАЛ = идеал(судейский.id, судейский.situations[0]);
const orderings = {};
судейский.situations.forEach((sid, i) => {
  const пр = идеал(судейский.id, sid);
  orderings[sid] = i === 5 ? пр.slice().reverse() : пр;   // последняя — наоборот
});
const answers = {};
судейский.free.forEach((q, i) => { answers[q.id] = 'Ответ номер ' + (i + 1) + '. '.repeat(20); });

console.log('\n1. Сессии и привязка теста к этапу');
const парный = post({ action: 'createSession', title: 'Поток', stage: 'before' });
check('этап «до» получил свой тест', парный.testId === CONFIG.stages[0].test, парный.testId);
const после = post({ action: 'createSession', title: 'Поток', stage: 'after' });
check('этап «после» получил другой тест', после.testId !== парный.testId, после.testId);
check('у этапа без пары тест обязателен',
      post({ action: 'createSession', title: 'X', stage: 'single' }).ok === false);
const свой = post({ action: 'createSession', title: 'Своя команда', stage: 'single',
                    testId: судейский.id, identify: true });
check('ведущий выбрал тест сам', свой.testId === судейский.id);
check('именная сессия отдаёт признак', post({ action: 'checkSession', code: свой.code }).identify === true);
check('код сессии отдаёт тест', post({ action: 'checkSession', code: свой.code }).testId === судейский.id);
const code = свой.code;

console.log('\n2. Отправка — судья отвечает');
fetchMode = 'ok'; fetchCalls = 0;
const r1 = post({ action: 'submit', code, orderings, answers, durationSec: 700,
                  participant: 'Катя Иванова', submissionId: 'ключ-1',
                  times: { intro: 30, q1: 118, q2: 96 } });
check('judge_status = ok', r1.judge_status === 'ok', r1.judge_error);
check('судья вызван один раз', fetchCalls === 1, 'вызовов ' + fetchCalls);
check('пять навыков в карте', r1.map.skills.length === 5);
check('АК: 6 из 6, зона «выбирает»', r1.map.skills[0].score === 6 && r1.map.skills[0].zone === 'выбирает');
check('слабый навык: 0 из 3, «не видит»',
      r1.map.skills.some(s => s.score === 0 && s.zone === 'не видит'));
check('уровень ГА-1 доехал', r1.map.skills[1].level === 2);
check('флаг ПР-1 сохранён', r1.map.skills[2].flag === true);
check('признак лозунга сохранён', r1.map.skills[4].slogan === true);
check('дополнительная способность записана', r1.map.extra.length === 1 && r1.map.extra[0].code === 'АК-1');
check('строка «в расстановке выше» есть', r1.map.gaps.length > 0, JSON.stringify(r1.map.gaps));

const h = sheets['responses']._rows[0], row = sheets['responses']._rows[1];
check('имя записано', row[h.indexOf('participant')] === 'Катя Иванова');
check('тест записан', row[h.indexOf('test_id')] === судейский.id);
check('оба свободных ответа записаны',
      судейский.free.every(q => String(row[h.indexOf(q.id + '_text')]).length > 0));
check('время по вопросам записано', row[h.indexOf('q1_sec')] === 118);
check('дополнительные способности в колонке', String(row[h.indexOf('extra')]).indexOf('АК-1') >= 0);

console.log('\n3. Повторная отправка и открытие карты');
const r2 = post({ action: 'submit', code, orderings, answers, submissionId: 'ключ-1' });
check('повтор узнан', r2.repeat === true);
check('вторая строка не создана', sheets['responses']._rows.length === 2);
const r3 = post({ action: 'result', rowId: r1.rowId });
check('карта открылась по адресу', r3.ok === true && r3.map.skills.length === 5);
check('та же карта', JSON.stringify(r3.map.skills.map(s => s.score)) ===
                    JSON.stringify(r1.map.skills.map(s => s.score)));
check('несуществующая карта отклонена', post({ action: 'result', rowId: 'нет' }).error === 'no_result');

console.log('\n4. Судья падает — отправка устояла');
fetchMode = 'http500';
const r4 = post({ action: 'submit', code, orderings, answers, submissionId: 'ключ-2' });
check('отправка не упала', r4.ok === true);
check('judge_status = error', r4.judge_status === 'error');
check('карта расстановок вернулась', r4.map.skills[0].score === 6);
check('уровней нет', r4.map.skills[1].level === null);
const битая = sheets['responses']._rows[2];
check('тексты ответов сохранены',
      судейский.free.every(q => String(битая[h.indexOf(q.id + '_text')]).length > 0));

console.log('\n5. Неразборчивый JSON — один повтор');
fetchMode = 'мусор'; fetchCalls = 0;
const r5 = post({ action: 'submit', code, orderings, answers, submissionId: 'ключ-3' });
check('со второй попытки разобрано', r5.judge_status === 'ok', r5.judge_error);
check('повтор был ровно один', fetchCalls === 2, 'вызовов ' + fetchCalls);

console.log('\n6. Повторная оценка');
fetchMode = 'ok';
const r6 = post({ action: 'rejudge', rowId: r4.rowId });
check('rejudge отработал', r6.ok === true && r6.judge_status === 'ok', r6.error);
check('расстановка не тронута', r6.map.skills[0].score === 6);

console.log('\n7. Тест без промпта судьи');
const безСудьи = CONFIG.tests.filter(t => !JUDGE_PROMPTS[t.id])[0];
if (безСудьи) {
  const s2 = post({ action: 'createSession', title: 'Без судьи', stage: 'single', testId: безСудьи.id });
  const ord2 = {};
  безСудьи.situations.forEach(sid => { ord2[sid] = идеал(безСудьи.id, sid); });
  const ans2 = {};
  безСудьи.free.forEach(q => { ans2[q.id] = 'текст'; });
  const r7 = post({ action: 'submit', code: s2.code, orderings: ord2, answers: ans2 });
  check('тест проходится и без промпта', r7.ok === true);
  check('расстановки посчитаны', r7.map.skills[0].score === 6);
  check('судья честно сообщает, что промпта нет',
        r7.judge_status === 'error' && /нет промпта/.test(r7.judge_error), r7.judge_error);
} else {
  console.log('  — все тесты с промптами, проверять нечего');
}

console.log('\n8. Агрегат');
const s = post({ action: 'summary', code });
check('посчитаны все отправки', s.summary.count === 3, 'count=' + s.summary.count);
check('сводка знает тест', s.summary.test === судейский.id);
check('группа разложена по общей шкале',
      s.summary.skills.every(sk => sk.buckets.reduce((a, b) => a + b, 0) === s.summary.count));
check('имён и текстов в сводке нет',
      JSON.stringify(s.summary).indexOf('Катя') < 0 && JSON.stringify(s.summary).indexOf('Ответ номер') < 0);

console.log('\n9. Сравнение «до/после» по названию группы');
fetchMode = 'ok';
// в обе сессии «Потока» кладём по отправке, чтобы было что сравнивать
const ordДо = {};
CONFIG.tests.filter(t => t.id === парный.testId)[0].situations
  .forEach(sid => { ordДо[sid] = идеал(парный.testId, sid); });
const ordПосле = {};
CONFIG.tests.filter(t => t.id === после.testId)[0].situations
  .forEach((sid, i) => {
    const пр = идеал(после.testId, sid);
    // в «после» одна ситуация с перестановкой соседей — чтобы карты различались
    ordПосле[sid] = i % 2 ? [пр[1], пр[0], пр[2], пр[3]] : пр;
  });
post({ action: 'submit', code: парный.code, orderings: ordДо, answers: {}, submissionId: 'п-1' });
post({ action: 'submit', code: после.code, orderings: ordПосле, answers: {}, submissionId: 'п-2' });

const cmp = post({ action: 'compare', code: парный.code });
check('нашлись обе сессии группы', cmp.sessions.length === 2, JSON.stringify(cmp.sessions.map(x => x.stage)));
check('порядок — сначала «до»', cmp.sessions[0].stage === 'before' && cmp.sessions[1].stage === 'after');
check('у сессий разные тесты', cmp.sessions[0].testId !== cmp.sessions[1].testId);
check('в каждой посчитан свой агрегат',
      cmp.sessions.every(x => x.summary.count === 1 && x.summary.skills.length === CONFIG.skills.length));
check('сравнение не тащит имён и текстов',
      JSON.stringify(cmp).indexOf('Катя') < 0 && JSON.stringify(cmp).indexOf('Ответ номер') < 0);
const cmpОдин = post({ action: 'compare', code });
check('у одиночной группы сравнивать нечего', cmpОдин.sessions.length === 1, cmpОдин.sessions.length);

console.log('\n10. Мелочи');
check('неизвестное действие отклонено', post({ action: 'чепуха' }).ok === false);
const версии = JSON.parse(doGet().getContent());
check('doGet отвечает версиями', версии.rules === CONFIG.rulesVersion && версии.tests.length === CONFIG.tests.length,
      JSON.stringify(версии));

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсё сошлось.');
process.exit(fails ? 1 : 0);
