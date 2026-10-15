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

/* Вердикт судьи по одной способности в формате профиля мини-формата. */
function вердикт(level, статусы, цитата, доп) {
  const gates = {};
  ['2', '3', '4', '5'].forEach((k, i) => {
    gates[k] = статусы[i] === 'нет' ? { s: 'нет' } : { s: статусы[i], q: цитата + ' ' + k };
  });
  return Object.assign({ gates, status: 'оценено', level, options: [], flag: false, slogan: false,
                         has: 'Вы назвали ' + цитата + '.', next: 'Покажите, что дальше.',
                         unclear: 'Неясно, ' + цитата + '.' }, доп || {});
}

let fetchMode = 'ok';          // ok | спорно | http500 | мусор | сеть
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
    if (body.max_tokens !== 4000) throw new Error('max_tokens не 4000: разбор по границам длиннее');
    if (!body.thinking || body.thinking.type !== 'disabled') throw new Error('рассуждение не выключено');
    const user = String(body.messages[0].content);
    if (!/<ответ1>[\s\S]*<ответ2>[\s\S]*<ответ3>/.test(user)) throw new Error('судье ушли не все 3 своих комментария');
    const content = body.messages[0].content;
    if (!/^<ответ1>/.test(content) || content.indexOf('<ответ2>') < 0) {
      throw new Error('ответы не обёрнуты в <ответ1>/<ответ2>');
    }
    const text = fetchMode === 'мусор' && fetchCalls === 1
      ? 'Конечно! Вот оценка.'
      : '```json\n' + JSON.stringify({
          'МК-1': fetchMode === 'спорно'
            ? вердикт(null, ['да', 'да', 'спорно', 'нет'], 'сервис', { status: 'ручная проверка', options: [3, 4] })
            : вердикт(4, ['Да', 'да', 'да', 'нет'], 'сервис'),
          'ГА-1': вердикт(2, ['да', 'нет', 'нет', 'нет'], 'отказ'),
          'ПР-1': вердикт(5, ['да', 'да', 'нет', 'да'], 'высвобождаем', { flag: true }),
          'ПП-1': вердикт(3, ['да', 'да', 'нет', 'нет'], 'первый год', { slogan: true }),
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

console.log('\n1. Сессии и выбор кейса');
const кейсДо = CONFIG.tests[0].id, кейсПосле = CONFIG.tests[1].id;
const парный = post({ action: 'createSession', title: 'Поток', stage: 'before', testId: кейсДо });
check('этап «до»: кейс выбрал ведущий', парный.ok && парный.testId === кейсДо, JSON.stringify(парный));
const повтор = post({ action: 'createSession', title: 'Поток', stage: 'after', testId: кейсДо });
check('на «после» тот же кейс, что на «до», не даётся', повтор.ok === false, JSON.stringify(повтор));
const после = post({ action: 'createSession', title: 'Поток', stage: 'after', testId: кейсПосле });
check('на «после» другой кейс — можно', после.ok && после.testId === кейсПосле, JSON.stringify(после));
check('без выбранного кейса сессию не завести',
      post({ action: 'createSession', title: 'X', stage: 'single' }).ok === false);
check('у кейса 6 веток и 3 своих комментария',
      CONFIG.tests.every(t => t.situations.length === 6 && t.free.length === 3));
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
check('оценка шести способностей по тексту снята', r1.map.extra.length === 0);
check('вывод собран из «что есть» и «дальше»',
      r1.map.skills[1].takeaway === 'Вы назвали отказ. Покажите, что дальше.', r1.map.skills[1].takeaway);
check('строка «в тесте выше» есть', r1.map.gaps.length > 0, JSON.stringify(r1.map.gaps));
check('немонотонный ПР-1: L5 с флагом', r1.map.skills[2].level === 5 && r1.map.skills[2].flag === true);

const h = sheets['responses']._rows[0], row = sheets['responses']._rows[1];
check('имя записано', row[h.indexOf('participant')] === 'Катя Иванова');
check('тест записан', row[h.indexOf('test_id')] === судейский.id);
check('оба свободных ответа записаны',
      судейский.free.every(q => String(row[h.indexOf(q.id + '_text')]).length > 0));
check('время по вопросам записано', row[h.indexOf('q1_sec')] === 118);
check('статус записан', row[h.indexOf('МК-1_status')] === 'оценено');
check('разбор по границам записан текстом',
      /1→2: да «сервис 2»/.test(String(row[h.indexOf('МК-1_gates')])) &&
      /4→5: нет/.test(String(row[h.indexOf('МК-1_gates')])), row[h.indexOf('МК-1_gates')]);
check('цитата — верхней пройденной границы', row[h.indexOf('МК-1_quote')] === 'сервис 4');
check('вывод записан', /Вы назвали/.test(String(row[h.indexOf('МК-1_takeaway')])));

console.log('\n2а. Спорная граница — уровень есть всегда (ручной проверки нет)');
fetchMode = 'спорно';
const rr = post({ action: 'submit', code, orderings, answers, submissionId: 'ключ-спорно' });
const буд = rr.map.skills.filter(sk => sk.ability === 'МК-1')[0];
check('модель вернула «ручную проверку» — уровень всё равно стоит, по пройденным границам',
      буд.level === 3 && буд.review === false, JSON.stringify(буд));
check('человек видит и «что есть», и «что дальше»', буд.takeaway === 'Вы назвали сервис. Покажите, что дальше.', буд.takeaway);
check('сомнение помечено флагом', буд.flag === true);
const rowR = sheets['responses']._rows[sheets['responses']._rows.length - 1];
check('в таблице статус «оценено» и уровень',
      rowR[h.indexOf('МК-1_status')] === 'оценено' && String(rowR[h.indexOf('МК-1_level')]) === '3');
check('объяснение спорного — в таблицу', /Неясно, сервис\..*взят по пройденным границам/.test(rowR[h.indexOf('МК-1_unclear')]));
const сводкаR = post({ action: 'summary', code }).summary.skills.filter(sk => sk.ability === 'МК-1')[0];
check('в сводке уточнений нет', сводкаR.review === 0, JSON.stringify(сводкаR));
fetchMode = 'ok';

console.log('\n3. Повторная отправка и открытие карты');
const r2 = post({ action: 'submit', code, orderings, answers, submissionId: 'ключ-1' });
check('повтор узнан', r2.repeat === true);
check('лишняя строка не создана', sheets['responses']._rows.length === 3);   // заголовок + ключ-1 + ключ-спорно
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
const битая = sheets['responses']._rows[sheets['responses']._rows.length - 1];
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
check('посчитаны все отправки', s.summary.count === 4, 'count=' + s.summary.count);   // с проверкой «спорно»
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

console.log('\n9а. Комментарии группы для разбора');
const цит = post({ action: 'quotes', code: code });
check('именная сессия комментариев не отдаёт', цит.ok && цит.named === true);
const анон = post({ action: 'createSession', title: 'Разбор', stage: 'single', testId: судейский.id });
post({ action: 'submit', code: анон.code, orderings: {}, answers, submissionId: 'ц-1' });
const цит2 = post({ action: 'quotes', code: анон.code });
check('по 4 способностям есть комментарии', цит2.ok && цит2.abilities.length === 4 &&
      цит2.abilities.every(a => a.items.length === 1), JSON.stringify(цит2).slice(0, 200));
check('в разборе нет имён и кодов строк', !/row_id|participant|rowId/.test(JSON.stringify(цит2)));

console.log('\n10. Мелочи');
check('неизвестное действие отклонено', post({ action: 'чепуха' }).ok === false);
const версии = JSON.parse(doGet().getContent());
check('doGet отвечает версиями', версии.rules === CONFIG.rulesVersion && версии.tests.length === CONFIG.tests.length,
      JSON.stringify(версии));

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсё сошлось.');
process.exit(fails ? 1 : 0);
