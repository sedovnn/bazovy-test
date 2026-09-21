/* Базовый тест «Карта стратегических навыков» — веб-приложение.

   Действия через doPost:
     createSession  — завести сессию, вернуть код
     checkSession   — проверить код перед началом теста
     submit         — принять расстановки и два ответа, посчитать, позвать судью,
                      записать строку, вернуть карту
     result         — открыть сохранённую карту по её адресу
     summary        — агрегат по коду сессии (без имён и текстов)
     compare        — сводки всех сессий с тем же названием группы: «до» и «после»
                      рядом
     rejudge        — повторно оценить свободные ответы сохранённой строки

   Таблица создаётся сама при первом обращении. Ключ Anthropic живёт в свойствах
   скрипта и в браузер не попадает никогда.

   Свойства скрипта (Настройки проекта → Свойства скрипта):
     ANTHROPIC_API_KEY — обязательное
     MODEL             — необязательное, по умолчанию claude-sonnet-5
     SHEET_ID          — id вашей таблицы; если не задать, скрипт заведёт свою */

var PROP = PropertiesService.getScriptProperties();

var SHEET_SESSIONS = 'sessions';
var SHEET_RESPONSES = 'responses';

/* ---------- маршрутизация ---------- */

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'Не разобрал тело запроса' });
  }

  try {
    switch (payload.action) {
      case 'createSession': return json(createSession(payload));
      case 'checkSession':  return json(checkSession(payload));
      case 'submit':        return json(submit(payload));
      case 'result':        return json(result(payload));
      case 'summary':       return json(summary(payload));
      case 'compare':       return json(compare(payload));
      case 'rejudge':       return json(rejudge(payload));
      default:              return json({ ok: false, error: 'Неизвестное действие: ' + payload.action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

/* GET отвечает коротко — чтобы можно было проверить, что приложение опубликовано. */
function doGet() {
  var tests = CONFIG.tests.map(function (t) {
    return t.id + (judgePrompt(t.id) ? '' : ' (без судьи)');
  });
  return json({ ok: true, service: 'Базовый тест', rules: CONFIG.rulesVersion, tests: tests });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function testById(id) {
  for (var i = 0; i < CONFIG.tests.length; i++) {
    if (CONFIG.tests[i].id === id) return CONFIG.tests[i];
  }
  return null;
}

function stageById(id) {
  for (var i = 0; i < CONFIG.stages.length; i++) {
    if (CONFIG.stages[i].id === id) return CONFIG.stages[i];
  }
  return null;
}

/* ---------- таблица ---------- */

function book() {
  var id = PROP.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* пересоздадим ниже */ }
  }
  var ss = SpreadsheetApp.create('Базовый тест — данные');
  PROP.setProperty('SHEET_ID', ss.getId());
  setupSheets(ss, true);
  return ss;
}

function sheet(name) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) { setupSheets(ss, false); sh = ss.getSheetByName(name); }
  return sh;
}

/* isNew = таблицу только что завёл сам скрипт. Пустой лист по умолчанию убираем
   ТОЛЬКО в этом случае: если таблицу завёл человек, удалять в ней листы нельзя. */
function setupSheets(ss, isNew) {
  if (!ss.getSheetByName(SHEET_SESSIONS)) {
    var s = ss.insertSheet(SHEET_SESSIONS);
    s.appendRow(['code', 'title', 'stage', 'test_id', 'identify', 'created_at']);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_RESPONSES)) {
    var r = ss.insertSheet(SHEET_RESPONSES);
    r.appendRow(responseHeader());
    r.setFrozenRows(1);
  }
  if (!isNew) return;
  var first = ss.getSheetByName('Лист1') || ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
}

/* Заголовок листа responses собирается из конфига — состав задаёт спека. */
function responseHeader() {
  var head = ['row_id', 'submission_id', 'session_code', 'stage', 'test_id', 'participant',
              'submitted_at', 'duration_sec'];

  var sits = CONFIG.tests[0].situations;
  sits.forEach(function (sid) { head.push(sid + '_order', sid + '_score'); });
  CONFIG.skills.forEach(function (sk) { head.push(sk.id + '_score', sk.id + '_zone'); });

  head.push('intro_sec');
  sits.forEach(function (sid) { head.push(sid + '_sec'); });
  CONFIG.tests[0].free.forEach(function (q) { head.push(q.id + '_sec'); });

  CONFIG.tests[0].free.forEach(function (q) { head.push(q.id + '_text', q.id + '_words'); });

  CONFIG.abilities.forEach(function (a) {
    head.push(a.id + '_level', a.id + '_flag', a.id + '_slogan', a.id + '_quote', a.id + '_why');
  });
  head.push('extra', 'feedback', 'judge_status', 'judge_error', 'judge_model',
            'judge_prompt_version', 'rules_version');
  return head;
}

/* Кладёт строку по именам колонок и дописывает недостающие в конец.
   Так добавление колонки не сдвигает уже накопленные строки. */
function appendByHeader(sh, values) {
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
               .map(function (h) { return String(h); });

  var missing = [];
  for (var key in values) {
    if (Object.prototype.hasOwnProperty.call(values, key) && head.indexOf(key) < 0) missing.push(key);
  }
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    head = head.concat(missing);
  }

  var row = head.map(function (name) {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : '';
  });
  sh.appendRow(row);
}

/* Замок на запись: группа отправляет ответы почти одновременно, без него
   две записи могут наложиться. */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(30000); } catch (e) {}
  try { fn(); } finally { if (got) lock.releaseLock(); }
}

/* ---------- сессии ---------- */

function makeCode() {
  // без 0/O и 1/I: код диктуют вслух и вводят с телефона
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
  for (var i = 0; i < 6; i++) out += abc.charAt(Math.floor(Math.random() * abc.length));
  return out;
}

function createSession(p) {
  var title = String(p.title || '').slice(0, 200);
  var stageId = String(p.stage || CONFIG.stages[0].id);
  var stage = stageById(stageId);
  if (!stage) return { ok: false, error: 'Неизвестный этап: ' + stageId };

  /* Привязка теста к этапу жёсткая: «до» и «после» обязаны быть разными тестами,
     правила запрещают давать один и тот же дважды. Выбор есть только у этапа
     без пары — там тест называет ведущий. */
  var testId = stage.choose ? String(p.testId || '') : stage.test;
  var test = testById(testId);
  if (!test) return { ok: false, error: 'Не выбран тест для этапа «' + stage.name + '»' };

  // Именная сессия — решение ведущего на каждый прогон, а не свойство продукта.
  var identify = p.identify === true || p.identify === 'да';
  var sh = sheet(SHEET_SESSIONS);

  var existing = {};
  sh.getDataRange().getValues().slice(1).forEach(function (row) { existing[row[0]] = true; });

  var code = makeCode();
  var guard = 0;
  while (existing[code] && guard++ < 50) code = makeCode();

  withLock(function () {
    appendByHeader(sh, { code: code, title: title, stage: stageId, test_id: testId,
                         identify: identify ? 'да' : '', created_at: new Date().toISOString() });
  });
  return { ok: true, code: code, title: title, stage: stageId, testId: testId, identify: identify };
}

function findSession(code) {
  var sh = sheet(SHEET_SESSIONS);
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h); });
  var iCode = head.indexOf('code');
  for (var i = 1; i < values.length; i++) {
    if (values[i][iCode] !== code) continue;
    function col(name) {
      var c = head.indexOf(name);
      return c >= 0 ? values[i][c] : '';
    }
    return { code: code, title: col('title'), stage: col('stage'),
             testId: String(col('test_id') || ''), identify: String(col('identify')) === 'да' };
  }
  return null;
}

function checkSession(p) {
  var code = String(p.code || '').toUpperCase();
  var s = findSession(code);
  if (!s) return { ok: false, error: 'no_session' };
  return { ok: true, title: s.title, stage: s.stage, testId: s.testId, identify: s.identify };
}

/* ---------- отправка ---------- */

function submit(p) {
  var code = String(p.code || '').toUpperCase();
  var session = findSession(code);
  if (!session) return { ok: false, error: 'no_session' };

  var test = testById(session.testId);
  if (!test) return { ok: false, error: 'В сессии не указан тест' };

  /* Повторная отправка после обрыва не должна ни плодить строки, ни оплачивать
     судью заново. Ключ приходит от фронта и живёт одну попытку прохождения. */
  var submissionId = String(p.submissionId || '').slice(0, 64);
  if (submissionId) {
    var already = findSubmission(submissionId);
    if (already) return already;
  }

  // Имя принимаем только у именной сессии: иначе анонимность зависела бы
  // от того, что прислал браузер.
  var participant = session.identify ? String(p.participant || '').trim().slice(0, 120) : '';

  var orderings = p.orderings || {};
  var answers = p.answers || {};

  // 1. Расстановки считаем всегда и первыми: они не зависят от судьи.
  var map = buildMap(CONFIG.skills, test, orderings, null);

  // 2. Судья. Его падение не должно ронять отправку.
  var texts = test.free.map(function (q) { return String(answers[q.id] || ''); });
  var verdict = { ok: false, judge: null, error: 'не вызывался', model: '', promptVersion: '' };
  if (texts.join('').trim()) verdict = judgeAnswers(test.id, texts[0], texts[1]);

  if (verdict.ok) map = buildMap(CONFIG.skills, test, orderings, verdict.judge);

  // 3. Строка сохраняется в любом случае.
  var rowId = Utilities.getUuid();
  withLock(function () {
    writeResponse({
      rowId: rowId, submissionId: submissionId, code: code, stage: session.stage,
      testId: test.id, participant: participant,
      durationSec: Number(p.durationSec || 0), times: p.times || {},
      orderings: orderings, answers: answers, map: map, verdict: verdict, test: test
    });
  });

  return {
    ok: true, rowId: rowId, testId: test.id, map: map,
    judge: verdict.ok ? verdict.judge : null,
    judge_status: verdict.ok ? 'ok' : 'error',
    judge_error: verdict.ok ? '' : verdict.error,
    feedback: verdict.ok ? (verdict.judge.feedback || '') : ''
  };
}

function writeResponse(d) {
  var sh = sheet(SHEET_RESPONSES);
  var v = {};

  v.row_id = d.rowId;
  v.submission_id = d.submissionId || '';
  v.session_code = d.code;
  v.stage = d.stage;
  v.test_id = d.testId;
  v.participant = d.participant || '';
  v.submitted_at = new Date().toISOString();
  v.duration_sec = d.durationSec;

  d.test.situations.forEach(function (sid) {
    v[sid + '_order'] = (d.orderings[sid] || []).join(' ');
    v[sid + '_score'] = d.map.perSituation[sid] === undefined ? '' : d.map.perSituation[sid];
  });
  d.map.skills.forEach(function (sk) {
    v[sk.id + '_score'] = sk.score;
    v[sk.id + '_zone'] = sk.zone;
  });

  var t = d.times || {};
  v.intro_sec = t.intro === undefined ? '' : t.intro;
  d.test.situations.forEach(function (sid) { v[sid + '_sec'] = t[sid] === undefined ? '' : t[sid]; });
  d.test.free.forEach(function (q) {
    v[q.id + '_sec'] = t[q.id] === undefined ? '' : t[q.id];
    var text = String((d.answers || {})[q.id] || '');
    v[q.id + '_text'] = text;
    v[q.id + '_words'] = countWords(text);
  });

  CONFIG.abilities.forEach(function (a) {
    var got = d.verdict.ok && d.verdict.judge[a.id] ? d.verdict.judge[a.id] : null;
    v[a.id + '_level'] = got ? got.level : '';
    v[a.id + '_flag'] = got ? (got.flag ? 'да' : '') : '';
    v[a.id + '_slogan'] = got ? (got.slogan ? 'да' : '') : '';
    v[a.id + '_quote'] = got ? (got.quote || '') : '';
    v[a.id + '_why'] = got ? (got.why || '') : '';
  });

  // дополнительные способности — одной колонкой, их состав меняется от ответа к ответу
  var extra = (d.verdict.ok && d.verdict.judge.extra) ? d.verdict.judge.extra : {};
  var parts = [];
  for (var code in extra) {
    if (Object.prototype.hasOwnProperty.call(extra, code)) {
      parts.push(code + ' L' + extra[code].level);
    }
  }
  v.extra = parts.join(', ');

  v.feedback = d.verdict.ok ? (d.verdict.judge.feedback || '') : '';
  v.judge_status = d.verdict.ok ? 'ok' : 'error';
  v.judge_error = d.verdict.ok ? '' : String(d.verdict.error || '');
  v.judge_model = d.verdict.model || '';
  v.judge_prompt_version = d.verdict.promptVersion || '';
  v.rules_version = CONFIG.rulesVersion;

  appendByHeader(sh, v);
}

/* Расстановка в таблице записана метками через пробел. У строк, записанных
   до перехода на метки, стояли четыре буквы подряд — читаем и такие, чтобы
   старые карты открывались по ссылке. */
function parseOrder(raw) {
  var s = String(raw || '').trim();
  if (!s) return [];
  if (s.indexOf(' ') < 0 && s.length === 4) return s.split('');
  return s.split(/\s+/);
}

function countWords(text) {
  var t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/* ---------- чтение сохранённой строки ---------- */

function findSubmission(submissionId) {
  return readResponse('submission_id', submissionId);
}

/* Открыть сохранённую карту по её адресу: index.html?r=<row_id>. */
function result(p) {
  var rowId = String(p.rowId || '').slice(0, 64);
  if (!rowId) return { ok: false, error: 'no_result' };
  return readResponse('row_id', rowId) || { ok: false, error: 'no_result' };
}

/* Собирает ответ по строке таблицы. Судья повторно не вызывается.
   Строка ищется поиском по столбцу: в таблице лежат тексты ответов,
   и вычитывание всего листа не укладывалось в тайм-аут. */
function readResponse(column, value) {
  var sh = sheet(SHEET_RESPONSES);
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h); });
  var iKey = head.indexOf(column);
  if (iKey < 0) return null;

  var rowNum = -1;
  try {
    var hit = sh.getRange(2, iKey + 1, Math.max(1, sh.getLastRow() - 1), 1)
                .createTextFinder(value).matchEntireCell(true).findNext();
    if (hit) rowNum = hit.getRow();
  } catch (e) { /* упадём в перебор ниже */ }

  if (rowNum < 0) {
    var col1 = sh.getRange(2, iKey + 1, Math.max(1, sh.getLastRow() - 1), 1).getValues();
    for (var k = 0; k < col1.length; k++) {
      if (String(col1[k][0]) === value) { rowNum = k + 2; break; }
    }
  }
  if (rowNum < 0) return null;

  var row = sh.getRange(rowNum, 1, 1, lastCol).getValues()[0];
  function col(name) {
    var c = head.indexOf(name);
    return c >= 0 ? row[c] : '';
  }

  /* Строка от прежней версии теста: подставлять сегодняшний тест нельзя —
     метки реплик другие, карта собралась бы из нулей и выглядела бы как
     результат человека. Лучше честно сказать, что карты нет. */
  var test = testById(String(col('test_id') || ''));
  if (!test) return { ok: false, error: 'old_test' };

  var orderings = {};
  test.situations.forEach(function (sid) {
    orderings[sid] = parseOrder(String(col(sid + '_order') || ''));
    if (!orderings[sid].length) delete orderings[sid];
  });

  var status = String(col('judge_status') || '');
  var judge = null;
  if (status === 'ok') {
    judge = { feedback: String(col('feedback') || ''), extra: {} };
    CONFIG.abilities.forEach(function (a) {
      var lvl = Number(col(a.id + '_level') || 0);
      if (lvl >= 1 && lvl <= 5) {
        judge[a.id] = { level: lvl, flag: String(col(a.id + '_flag')) === 'да',
                        slogan: String(col(a.id + '_slogan')) === 'да',
                        quote: String(col(a.id + '_quote') || ''),
                        why: String(col(a.id + '_why') || '') };
      }
    });
  }

  return {
    ok: true, repeat: true, rowId: String(col('row_id') || ''),
    stage: String(col('stage') || ''), testId: test.id,
    map: buildMap(CONFIG.skills, test, orderings, judge),
    judge: judge, judge_status: status || 'error',
    judge_error: String(col('judge_error') || ''),
    feedback: judge ? (judge.feedback || '') : ''
  };
}

/* ---------- повторная оценка ---------- */

function rejudge(p) {
  var sh = sheet(SHEET_RESPONSES);
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h); });
  var idCol = head.indexOf('row_id');

  var rowNum = -1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][idCol] === p.rowId) { rowNum = i + 1; break; }
  }
  if (rowNum < 0) return { ok: false, error: 'Строка не найдена' };

  var row = values[rowNum - 1];
  function col(name) {
    var c = head.indexOf(name);
    return c >= 0 ? row[c] : '';
  }

  /* Строка от прежней версии теста: подставлять сегодняшний тест нельзя —
     метки реплик другие, карта собралась бы из нулей и выглядела бы как
     результат человека. Лучше честно сказать, что карты нет. */
  var test = testById(String(col('test_id') || ''));
  if (!test) return { ok: false, error: 'old_test' };
  var texts = test.free.map(function (q) { return String(col(q.id + '_text') || ''); });
  if (!texts.join('').trim()) return { ok: false, error: 'В строке нет свободных ответов' };

  var verdict = judgeAnswers(test.id, texts[0], texts[1]);

  CONFIG.abilities.forEach(function (a) {
    var got = verdict.ok && verdict.judge[a.id] ? verdict.judge[a.id] : null;
    set(sh, rowNum, head, a.id + '_level', got ? got.level : '');
    set(sh, rowNum, head, a.id + '_flag', got ? (got.flag ? 'да' : '') : '');
    set(sh, rowNum, head, a.id + '_slogan', got ? (got.slogan ? 'да' : '') : '');
    set(sh, rowNum, head, a.id + '_quote', got ? (got.quote || '') : '');
    set(sh, rowNum, head, a.id + '_why', got ? (got.why || '') : '');
  });
  set(sh, rowNum, head, 'feedback', verdict.ok ? (verdict.judge.feedback || '') : '');
  set(sh, rowNum, head, 'judge_status', verdict.ok ? 'ok' : 'error');
  set(sh, rowNum, head, 'judge_error', verdict.ok ? '' : String(verdict.error || ''));
  set(sh, rowNum, head, 'judge_model', verdict.model || '');
  set(sh, rowNum, head, 'judge_prompt_version', verdict.promptVersion || '');

  var orderings = {};
  test.situations.forEach(function (sid) {
    orderings[sid] = parseOrder(String(col(sid + '_order') || ''));
    if (!orderings[sid].length) delete orderings[sid];
  });

  return {
    ok: true, map: buildMap(CONFIG.skills, test, orderings, verdict.ok ? verdict.judge : null),
    judge: verdict.ok ? verdict.judge : null,
    judge_status: verdict.ok ? 'ok' : 'error',
    judge_error: verdict.ok ? '' : verdict.error,
    feedback: verdict.ok ? (verdict.judge.feedback || '') : ''
  };
}

function set(sh, rowNum, head, name, value) {
  var col = head.indexOf(name);
  if (col >= 0) sh.getRange(rowNum, col + 1).setValue(value);
}

/* ---------- агрегат ---------- */

function summary(p) {
  var code = String(p.code || '').toUpperCase();
  var session = findSession(code);
  var sh = sheet(SHEET_RESPONSES);
  var values = sh.getDataRange().getValues();
  return { ok: true, session: session,
           summary: summarize(values, code, session && session.testId) };
}

/* Сравнение «до/после». Группа опознаётся по названию: ведущий заводит две
   сессии с одним названием и разными этапами, здесь они сходятся.
   Совпадение по названию — нарочно простое: своего справочника групп у нас нет. */
function compare(p) {
  var code = String(p.code || '').toUpperCase();
  var own = findSession(code);
  if (!own) return { ok: false, error: 'no_session' };

  var title = String(own.title || '').trim();
  if (!title) return { ok: true, title: '', sessions: [] };

  var sess = sheet(SHEET_SESSIONS).getDataRange().getValues();
  var sHead = sess[0].map(function (h) { return String(h); });
  var iCode = sHead.indexOf('code'), iTitle = sHead.indexOf('title');
  var iStage = sHead.indexOf('stage'), iTest = sHead.indexOf('test_id');

  var values = sheet(SHEET_RESPONSES).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < sess.length; i++) {
    if (String(sess[i][iTitle] || '').trim() !== title) continue;
    var c = String(sess[i][iCode]);
    var testId = String(sess[i][iTest] || '');
    out.push({ code: c, stage: String(sess[i][iStage] || ''), testId: testId,
               summary: summarize(values, c, testId) });
  }

  // порядок как в конфиге: «до» слева, «после» справа
  var order = CONFIG.stages.map(function (st) { return st.id; });
  out.sort(function (a, b) { return order.indexOf(a.stage) - order.indexOf(b.stage); });

  return { ok: true, title: title, sessions: out };
}

/* Сводка по одному коду сессии из уже прочитанного листа ответов. */
function summarize(values, code, testId) {
  var head = values[0].map(function (h) { return String(h); });
  var codeCol = head.indexOf('session_code');

  /* Сводка идёт по ТОЙ ЖЕ общей шкале, что и карта участника: иначе у ведущего
     и у участника получаются две разные системы оценки. */
  var skills = CONFIG.skills.map(function (sk) {
    return { id: sk.id, name: sk.name, ability: sk.ability,
             buckets: [0, 0, 0], zones: [0, 0, 0], levels: [0, 0, 0, 0, 0],
             judged: 0, sum: 0 };
  });

  var count = 0;
  for (var i = 1; i < values.length; i++) {
    if (values[i][codeCol] !== code) continue;
    count++;
    CONFIG.skills.forEach(function (sk, k) {
      var max = sk.factors.length * 3;
      var score = Number(values[i][head.indexOf(sk.id + '_score')] || 0);
      var lvl = sk.ability ? Number(values[i][head.indexOf(sk.ability + '_level')] || 0) : 0;
      if (!(lvl >= 1 && lvl <= 5)) lvl = 0;

      var value = combinedValue(score, max, lvl);
      skills[k].buckets[valueBucket(value)]++;
      skills[k].sum += value;

      var zi = CONFIG.zones.indexOf(String(values[i][head.indexOf(sk.id + '_zone')] || ''));
      if (zi >= 0) skills[k].zones[zi]++;
      if (lvl) { skills[k].levels[lvl - 1]++; skills[k].judged++; }
    });
  }

  skills.forEach(function (sk) { sk.mean = count ? sk.sum / count : 0; delete sk.sum; });

  return { count: count, test: testId || '', skills: skills };
}
