/* Связь с бэкендом (Apps Script) и моковый бэкенд для локальной работы.

   Боевой режим: впишите URL веб-приложения в API_URL ниже — и всё.
   Пустой API_URL = моковый режим: данные лежат в localStorage этого браузера,
   судья имитируется. В моковом режиме дополнительно подгружается js/scoring.js;
   в боевом он не нужен и ключ в браузер не попадает. */

var API_URL = 'https://script.google.com/macros/s/AKfycbzXshbrdDdHR4T2nzSbAx6TlUcNkmZVnHYhGXZWqMjr-9_-UbT5_p3WNaf_1KF3JwPw/exec';

/* ?mock=1 в адресе — принудительно моковый режим на локальной машине:
   пройти тест целиком, ничего не записав в таблицу и не заплатив судье.
   На GitHub Pages ключей нет, поэтому там переключатель просто не сработает. */
if (typeof location !== 'undefined' &&
    new URLSearchParams(location.search).has('mock')) {
  API_URL = '';
}

/* Сколько ждём ответа. Отправке нужно больше: судья честно думает 15–20 секунд.
   Без таймаута оборванная сеть оставляет человека на экране ожидания навсегда —
   поймали ровно это. */
var TIMEOUTS = { submit: 90000, rejudge: 90000, result: 60000, _default: 30000 };

/* Apps Script и CORS: шлём text/plain, иначе браузер делает preflight OPTIONS,
   которого веб-приложение Apps Script не отдаёт. Тело — всё равно JSON. */
function callBackend(action, payload) {
  var body = JSON.stringify(Object.assign({ action: action }, payload || {}));
  var ms = TIMEOUTS[action] || TIMEOUTS._default;

  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);

  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body,
    signal: ctrl ? ctrl.signal : undefined
  }).then(function (r) {
    if (!r.ok) throw new Error('Сервер ответил ' + r.status);
    return r.json();
  }).then(function (data) {
    if (data && data.ok === false) throw new Error(data.error || 'Ошибка сервера');
    return data;
  }).catch(function (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('сервер не ответил за ' + Math.round(ms / 1000) + ' с');
    }
    throw err;
  }).finally(function () { clearTimeout(timer); });
}

var API = {
  isMock: function () { return !API_URL; },

  call: function (action, payload) {
    return API_URL ? callBackend(action, payload) : MOCK.call(action, payload);
  },

  createSession: function (p) { return API.call('createSession', p); },
  submit: function (p) { return API.call('submit', p); },
  summary: function (code) { return API.call('summary', { code: code }); },
  compare: function (code) { return API.call('compare', { code: code }); },
  result: function (rowId) { return API.call('result', { rowId: rowId }); },
  rejudge: function (rowId) { return API.call('rejudge', { rowId: rowId }); },

  /* Тексты теста лежат в отдельном файле на тест. Грузим ровно тот, который
     назвала сессия: участнику «до» не должен уехать тест «после».
     ?v=<отпечаток> — чтобы после правки спеки браузер не показал старый текст. */
  loadTest: function (testId) {
    var known = CONFIG.tests.filter(function (t) { return t.id === testId; })[0];
    if (!known) {
      return Promise.reject(new Error('сессия ссылается на неизвестный тест «' +
                                      (testId || '—') + '»'));
    }
    if (API._test && API._test.id === testId) return Promise.resolve(API._test);
    return fetch(known.file + '?v=' + known.v).then(function (r) {
      if (!r.ok) throw new Error('не открылся файл теста (' + r.status + ')');
      return r.json();
    }).then(function (test) {
      API._test = test;
      return test;
    });
  },
  _test: null
};

/* ---------------- моковый бэкенд ---------------- */

var MOCK = {
  KEY: 'bt_mock_v2',

  load: function () {
    try { return JSON.parse(localStorage.getItem(MOCK.KEY)) || { sessions: {}, responses: [] }; }
    catch (e) { return { sessions: {}, responses: [] }; }
  },

  save: function (db) {
    try { localStorage.setItem(MOCK.KEY, JSON.stringify(db)); } catch (e) {}
  },

  code: function () {
    // без похожих знаков: 0/O, 1/I — их диктуют вслух и вводят с телефона
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
    for (var i = 0; i < 6; i++) out += abc.charAt(Math.floor(Math.random() * abc.length));
    return out;
  },

  delay: function (ms, value) {
    return new Promise(function (res) { setTimeout(function () { res(value); }, ms); });
  },

  stage: function (id) {
    return CONFIG.stages.filter(function (s) { return s.id === id; })[0] || CONFIG.stages[0];
  },

  /* Тест по этапу — по тем же правилам, что и на бэкенде: у «до» и «после»
     он задан жёстко, у «Базового теста» его называет ведущий. */
  testFor: function (p) {
    var stage = MOCK.stage(p.stage);
    return stage.choose ? String(p.testId || CONFIG.tests[0].id) : stage.test;
  },

  call: function (action, p) {
    var db = MOCK.load();

    if (action === 'createSession') {
      var code = MOCK.code();
      var testId = MOCK.testFor(p);
      db.sessions[code] = { code: code, title: p.title, stage: p.stage, testId: testId,
                            identify: !!p.identify, created_at: new Date().toISOString() };
      MOCK.save(db);
      return MOCK.delay(250, { ok: true, code: code, testId: testId, stage: p.stage });
    }

    if (action === 'checkSession') {
      var s = db.sessions[p.code];
      // в моке принимаем любой код: иначе не потыкать тест без host.html
      return MOCK.delay(200, {
        ok: true,
        title: s ? s.title : 'Демо-сессия',
        stage: s ? s.stage : CONFIG.stages[0].id,
        testId: s ? s.testId : CONFIG.stages[0].test,
        identify: s ? !!s.identify : false
      });
    }

    if (action === 'submit') {
      var test = TESTMETA[p.testId];
      var answers = p.answers || {};
      var judge = MOCK.judge(Object.keys(answers).map(function (k) { return answers[k]; }).join(' '));
      var fail = new URLSearchParams(location.search).has('mockfail');
      var map = buildMap(CONFIG.skills, test, p.orderings || {}, fail ? null : judge);
      var row = {
        rowId: 'mock-' + Date.now(),
        session_code: p.code,
        stage: p.stage || '',
        testId: p.testId,
        orderings: p.orderings,
        submitted_at: new Date().toISOString(),
        duration_sec: p.durationSec || 0,
        map: map,
        judge: fail ? null : judge,
        judge_status: fail ? 'error' : 'ok'
      };
      db.responses.push(row);
      MOCK.save(db);
      // судья отвечает 10–20 с — в моке сокращено, но экран ожидания тот же
      return MOCK.delay(2200, {
        ok: true, rowId: row.rowId, testId: p.testId, map: map,
        judge: row.judge, judge_status: row.judge_status,
        feedback: fail ? '' : judge.feedback
      });
    }

    if (action === 'rejudge') {
      var idx = -1;
      for (var i = 0; i < db.responses.length; i++) { if (db.responses[i].rowId === p.rowId) idx = i; }
      if (idx < 0) return Promise.reject(new Error('Строка не найдена'));
      var j = MOCK.judge('повтор ' + db.responses[idx].rowId);
      db.responses[idx].judge = j;
      db.responses[idx].judge_status = 'ok';
      db.responses[idx].map = buildMap(CONFIG.skills, TESTMETA[db.responses[idx].testId],
                                       db.responses[idx].orderings || {}, j);
      MOCK.save(db);
      return MOCK.delay(1800, { ok: true, judge: j, judge_status: 'ok', feedback: j.feedback });
    }

    if (action === 'result') {
      var found = null;
      for (var k = 0; k < db.responses.length; k++) {
        if (db.responses[k].rowId === p.rowId) found = db.responses[k];
      }
      if (!found) return Promise.reject(new Error('no_result'));
      return MOCK.delay(300, { ok: true, repeat: true, rowId: found.rowId, map: found.map,
                               judge: found.judge, judge_status: found.judge_status,
                               feedback: found.judge ? found.judge.feedback : '' });
    }

    if (action === 'summary') {
      var mine = db.sessions[p.code] || null;
      var rows = db.responses.filter(function (r) { return r.session_code === p.code; });
      return MOCK.delay(300, { ok: true, session: mine,
                               summary: MOCK.summary(rows, mine && mine.testId) });
    }

    if (action === 'compare') {
      var own = db.sessions[p.code] || null;
      var title = own ? own.title : '';
      var out = [];
      Object.keys(db.sessions).forEach(function (c) {
        var sess = db.sessions[c];
        if (!title || sess.title !== title) return;
        var rows2 = db.responses.filter(function (r) { return r.session_code === c; });
        out.push({ code: c, stage: sess.stage, testId: sess.testId,
                   summary: MOCK.summary(rows2, sess.testId) });
      });
      return MOCK.delay(300, { ok: true, title: title, sessions: out });
    }

    return Promise.reject(new Error('Неизвестное действие: ' + action));
  },

  /* Имитация судьи: уровни выводятся из длины текста, чтобы карта менялась
     от ответа к ответу и было что показать на экране. */
  judge: function (text) {
    var words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    var base = words < 30 ? 1 : words < 60 ? 2 : words < 110 ? 3 : 4;
    var out = {};
    var ids = CONFIG.abilities.map(function (a) { return a.id; });
    for (var i = 0; i < ids.length; i++) {
      var lv = Math.max(1, Math.min(5, base + ((words + i * 7) % 3) - 1));
      out[ids[i]] = {
        level: lv,
        quote: 'фрагмент ответа участника (мок)',
        why: 'Уровень ' + lv + ' пройден, следующий — нет (мок).',
        flag: false,
        slogan: false
      };
    }
    out.extra = words > 60 ? { 'АК-1': { level: 4, quote: 'фрагмент (мок)' } } : {};
    out.feedback = 'Это моковая обратная связь: настоящую пишет судья по промпту из spec/. ' +
                   'В тексте видно направление, но не хватает явного отказа от одного из ' +
                   'предложений и связи этапов между собой.';
    return out;
  },

  /* Считает ту же сводку, что и бэкенд: общая шкала, зоны, уровни. */
  summary: function (rows, testId) {
    var skills = CONFIG.skills.map(function (sk) {
      return { id: sk.id, name: sk.name, ability: sk.ability,
               buckets: [0, 0, 0], zones: [0, 0, 0], levels: [0, 0, 0, 0, 0],
               judged: 0, mean: 0 };
    });
    var sums = [0, 0, 0, 0, 0];
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i].map;
      if (!m) continue;
      for (var j = 0; j < m.skills.length; j++) {
        var r = m.skills[j];
        var value = combinedValue(r.score, r.max, r.level);
        skills[j].buckets[valueBucket(value)]++;
        sums[j] += value;
        skills[j].zones[r.zoneIndex]++;
        if (r.level) { skills[j].levels[r.level - 1]++; skills[j].judged++; }
      }
    }
    skills.forEach(function (sk, k) { sk.mean = rows.length ? sums[k] / rows.length : 0; });
    return { count: rows.length, test: testId || '', skills: skills };
  }
};

/* В моковом режиме нужен настоящий подсчёт — подгружаем его отдельными файлами.
   Экраны ждут API.ready(), поэтому в боевом режиме scoring.js не грузится вовсе. */
API.ready = function () {
  if (API_URL) return Promise.resolve();
  if (typeof buildMap === 'function') return Promise.resolve();
  return ['js/keys.js', 'js/scoring.js'].reduce(function (chain, src) {
    return chain.then(function () {
      return new Promise(function (res, rej) {
        var el = document.createElement('script');
        el.src = src;
        el.onload = function () { res(); };
        // На GitHub Pages этих файлов нет: ключ в публичный репозиторий не
        // коммитится. Значит, забыли вписать API_URL — так и говорим.
        el.onerror = function () {
          rej(new Error('бэкенд не настроен. Впишите URL веб-приложения Apps Script ' +
                        'в js/api.js, строка API_URL.'));
        };
        document.head.appendChild(el);
      });
    });
  }, Promise.resolve());
};
