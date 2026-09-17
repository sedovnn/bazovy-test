/* Прогон apps-script/*.gs в Node на заглушках Google-сервисов.
   Запуск: node tools/прогон_бэкенда.js
   Проверяет маршрутизацию, подсчёт, запись строки, агрегат, повтор оценки
   и — главное — что падение судьи не роняет отправку. */

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
    getDataRange: () => ({
      getValues: () => rows.map(r => r.slice()),
    }),
    getRange: (row, col, nRows, nCols) => ({
      getValues: () => [(rows[row - 1] || []).slice(col - 1, col - 1 + (nCols || 1))],
      setValue: v => { rows[row - 1][col - 1] = v; },
      setValues: vals => {
        vals[0].forEach((v, i) => { rows[row - 1][col - 1 + i] = v; });
      },
    }),
    getLastColumn: () => rows.length ? rows[0].length : 0,
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

let fetchMode = 'ok';           // ok | http500 | мусор | сеть
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
let lockHeld = 0;
global.LockService = {
  getScriptLock: () => ({
    tryLock: () => { lockHeld++; return true; },
    releaseLock: () => { lockHeld--; },
  }),
};

global.UrlFetchApp = {
  fetch: (url, opt) => {
    fetchCalls++;
    if (fetchMode === 'сеть') throw new Error('соединение оборвалось');
    if (fetchMode === 'http500') {
      return { getResponseCode: () => 500, getContentText: () => '{"error":{"message":"overloaded"}}' };
    }
    const body = JSON.parse(opt.payload);
    // проверяем форму запроса
    if (!Array.isArray(body.system) || !body.system[0].cache_control) {
      throw new Error('system должен быть блоком с cache_control');
    }
    if ('temperature' in body) {
      throw new Error('temperature эта модель не принимает — 400');
    }
    if (body.max_tokens !== 1500 || !body.thinking || body.thinking.type !== 'disabled') {
      throw new Error('max_tokens или режим рассуждения не те');
    }
    if (!/^<ответ>\n/.test(body.messages[0].content)) {
      throw new Error('ответ участника не обёрнут в <ответ>');
    }
    const text = fetchMode === 'мусор' && fetchCalls === 1
      ? 'Конечно! Вот оценка: уровень примерно третий.'
      : '```json\n' + JSON.stringify({
          'МК-1': { level: 4, quote: 'сервис ведения', why: 'L4 пройден', flag: false },
          'ГА-1': { level: 2, quote: 'отказываемся', why: 'L2 пройден', flag: false },
          'ПР-1': { level: 5, quote: 'высвобожденные деньги', why: 'L5 пройден', flag: true },
          'ПП-1': { level: 3, quote: 'первый год', why: 'L3 пройден', flag: false },
          feedback: 'Видно направление, не хватает связи этапов.',
        }) + '\n```';
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ content: [{ type: 'text', text }] }),
    };
  },
};

/* ---------- загрузка ---------- */

for (const f of ['config.gs', 'keys.gs', 'scoring.gs', 'judge_prompt.gs', 'judge.gs', 'Code.gs']) {
  const src = fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8');
  // Apps Script складывает файлы в одну область видимости — повторяем это
  (0, eval)(src.replace(/^module\.exports.*$/gm, ''));
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

const ИДЕАЛ = ['E', 'D', 'C', 'B', 'A'];
const orderings = {};
CONFIG.situations.forEach((sid, i) => {
  orderings[sid] = i === 5 ? ['A', 'B', 'C', 'D', 'E'] : ИДЕАЛ.slice();
});
const ответ = 'Через три года сеть становится сервисом ведения курса. '.repeat(20);

console.log('\n1. Создание сессии');
const created = post({ action: 'createSession', title: 'ЕМВА-45', stage: 'baseline' });
check('код из шести символов', /^[A-Z0-9]{6}$/.test(created.code), created.code);
check('лист sessions заведён', !!sheets['sessions']);
const code = created.code;

console.log('\n2. Проверка кода');
check('существующий код принят', post({ action: 'checkSession', code }).ok === true);
check('несуществующий отклонён', post({ action: 'checkSession', code: 'ZZZZZZ' }).error === 'no_session');

console.log('\n3. Отправка — судья отвечает');
fetchMode = 'ok'; fetchCalls = 0;
const времена = { intro: 35, ak1: 74, ak2: 88, ga2: 61, pr2: 95, mk2: 70, pp2: 66, blockB: 305 };
const r1 = post({ action: 'submit', code, stage: 'baseline', orderings, answerText: ответ, durationSec: 640, times: времена });
check('judge_status = ok', r1.judge_status === 'ok', r1.judge_error);
check('судья вызван один раз', fetchCalls === 1, 'вызовов ' + fetchCalls);
check('пять навыков в карте', r1.map.skills.length === 5);
check('АК: 8 из 8, зона «выбирает»', r1.map.skills[0].score === 8 && r1.map.skills[0].zone === 'выбирает');
check('ПП: 0 из 4, зона «не видит»', r1.map.skills[4].score === 0 && r1.map.skills[4].zone === 'не видит');
check('уровень ГА-1 доехал', r1.map.skills[1].level === 2);
check('флаг ПР-1 сохранён', r1.map.skills[2].flag === true);
check('строка «различаю, но не делаю» есть', r1.map.gaps.indexOf('Генерация альтернатив') >= 0, JSON.stringify(r1.map.gaps));
check('строка записана в responses', sheets['responses']._rows.length === 2);
{
  const h = sheets['responses']._rows[0], r = sheets['responses']._rows[1];
  check('время блока Б записано', r[h.indexOf('blockB_sec')] === 305);
  check('время по ситуациям записано', CONFIG.situations.every(sid => r[h.indexOf(sid + '_sec')] > 0));
  check('колонки времени есть в шапке', h.includes('intro_sec') && h.includes('blockB_sec'));
}

console.log('\n4. Отправка — судья падает (HTTP 500)');
fetchMode = 'http500'; fetchCalls = 0;
const r2 = post({ action: 'submit', code, stage: 'baseline', orderings, answerText: ответ, durationSec: 700 });
check('отправка не упала', r2.ok === true);
check('judge_status = error', r2.judge_status === 'error');
check('карта блока А всё равно пришла', r2.map.skills[0].score === 8);
check('уровней блока Б нет', r2.map.skills[1].level === null);
check('строка всё равно сохранена', sheets['responses']._rows.length === 3);
const битаяСтрока = sheets['responses']._rows[2];
const шапка = sheets['responses']._rows[0];
check('текст записки сохранён', битаяСтрока[шапка.indexOf('answer_text')].length > 0);
check('judge_error записан', String(битаяСтрока[шапка.indexOf('judge_error')]).indexOf('API 500') >= 0);

console.log('\n5. Судья вернул не JSON — один повтор');
fetchMode = 'мусор'; fetchCalls = 0;
const r3 = post({ action: 'submit', code, stage: 'baseline', orderings, answerText: ответ, durationSec: 650 });
check('со второй попытки разобрано', r3.judge_status === 'ok', r3.judge_error);
check('повтор был ровно один', fetchCalls === 2, 'вызовов ' + fetchCalls);

console.log('\n6. Повторная оценка');
fetchMode = 'ok'; fetchCalls = 0;
const битыйId = битаяСтрока[шапка.indexOf('row_id')];
const r4 = post({ action: 'rejudge', rowId: битыйId });
check('rejudge отработал', r4.ok === true && r4.judge_status === 'ok', r4.error);
check('уровни появились в карте', r4.map.skills[1].level === 2);
const послеПовтора = sheets['responses']._rows[2];
check('judge_status в строке переписан', послеПовтора[шапка.indexOf('judge_status')] === 'ok');
check('расстановка не тронута', послеПовтора[шапка.indexOf('ak1_score')] === 4);

console.log('\n7. Агрегат');
const s = post({ action: 'summary', code });
check('посчитаны все три отправки', s.summary.count === 3, 'count=' + s.summary.count);
check('зоны разложены', s.summary.skills[0].zones[2] === 3, JSON.stringify(s.summary.skills[0].zones));
check('группа разложена по общей шкале', s.summary.skills[0].buckets[2] === 3, JSON.stringify(s.summary.skills[0].buckets));
check('у слабого навыка группа внизу', s.summary.skills[4].buckets[0] === 3, JSON.stringify(s.summary.skills[4].buckets));
check('сумма по вёдрам = числу прошедших',
      s.summary.skills.every(sk => sk.buckets.reduce((a,b)=>a+b,0) === s.summary.count));
check('средняя по шкале посчитана', typeof s.summary.skills[0].mean === 'number');
check('уровни разложены', s.summary.skills[1].levels[1] === 3, JSON.stringify(s.summary.skills[1].levels));
check('имён и текстов в агрегате нет', JSON.stringify(s.summary).indexOf('сервисом ведения') < 0);

console.log('\n8. Добавление колонки не ломает прежние строки');
{
  const sh = sheets['responses'];
  const былоШирина = sh._rows[0].length;
  const былоСтрок = sh._rows.length;
  appendByHeader(sh, { row_id: 'проверка', session_code: code, новая_колонка: 'значение' });
  const h = sh._rows[0];
  check('колонка дописана в конец', h[h.length - 1] === 'новая_колонка');
  check('прежние строки не сдвинулись',
        sh._rows[1][h.indexOf('session_code')] === code &&
        sh._rows[1][h.indexOf('blockB_sec')] === 305);
  check('новая строка легла по именам',
        sh._rows[былоСтрок][h.indexOf('новая_колонка')] === 'значение' &&
        sh._rows[былоСтрок][h.indexOf('row_id')] === 'проверка');
  sh._rows.pop();
}

console.log('\n9. Мелочи');
check('неизвестное действие отклонено', post({ action: 'чепуха' }).ok === false);
// версии не зашиваем: они меняются при каждой вычитке
const версии = JSON.parse(doGet().getContent());
check('doGet отвечает версиями',
      версии.judge === JUDGE_PROMPT_VERSION && версии.test === CONFIG.testVersion,
      JSON.stringify(версии));

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсё сошлось.');
process.exit(fails ? 1 : 0);
