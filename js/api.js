/* Связь с бэкендом (Apps Script) и моковый бэкенд для локальной работы.

   Боевой режим: впишите URL веб-приложения в API_URL ниже — и всё.
   Пустой API_URL = моковый режим: данные лежат в localStorage этого браузера,
   судья имитируется. В моковом режиме дополнительно подгружается js/scoring.js;
   в боевом он не нужен и ключ в браузер не попадает. */

var API_URL = 'https://script.google.com/macros/s/AKfycbzXshbrdDdHR4T2nzSbAx6TlUcNkmZVnHYhGXZWqMjr-9_-UbT5_p3WNaf_1KF3JwPw/exec';

/* Apps Script и CORS: шлём text/plain, иначе браузер делает preflight OPTIONS,
   которого веб-приложение Apps Script не отдаёт. Тело — всё равно JSON. */
function callBackend(action, payload) {
  var body = JSON.stringify(Object.assign({ action: action }, payload || {}));
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body
  }).then(function (r) {
    if (!r.ok) throw new Error('Сервер ответил ' + r.status);
    return r.json();
  }).then(function (data) {
    if (data && data.ok === false) throw new Error(data.error || 'Ошибка сервера');
    return data;
  });
}

var API = {
  isMock: function () { return !API_URL; },

  call: function (action, payload) {
    return API_URL ? callBackend(action, payload) : MOCK.call(action, payload);
  },

  createSession: function (title, stage, identify) {
    return API.call('createSession', { title: title, stage: stage, identify: !!identify });
  },
  submit: function (p) { return API.call('submit', p); },
  summary: function (code) { return API.call('summary', { code: code }); },
  rejudge: function (rowId) { return API.call('rejudge', { rowId: rowId }); }
};

/* ---------------- моковый бэкенд ---------------- */

var MOCK = {
  KEY: 'bt_mock_v1',

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

  call: function (action, p) {
    var db = MOCK.load();

    if (action === 'createSession') {
      var code = MOCK.code();
      db.sessions[code] = { code: code, title: p.title, stage: p.stage,
                            identify: !!p.identify, created_at: new Date().toISOString() };
      MOCK.save(db);
      return MOCK.delay(250, { ok: true, code: code });
    }

    if (action === 'checkSession') {
      var s = db.sessions[p.code];
      // в моке принимаем любой код: иначе не потыкать тест без host.html
      return MOCK.delay(200, { ok: true, title: s ? s.title : 'Демо-сессия',
                               stage: s ? s.stage : 'baseline', identify: s ? !!s.identify : false });
    }

    if (action === 'submit') {
      var judge = MOCK.judge(p.answerText);
      var fail = new URLSearchParams(location.search).has('mockfail');
      var map = buildMap(TEST.skills, p.orderings, fail ? null : judge);
      var row = {
        rowId: 'mock-' + Date.now(),
        session_code: p.code,
        stage: p.stage || 'baseline',
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
        ok: true,
        rowId: row.rowId,
        map: map,
        judge: row.judge,
        judge_status: row.judge_status,
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
      db.responses[idx].map = buildMap(TEST.skills, db.responses[idx].orderings || {}, j);
      MOCK.save(db);
      return MOCK.delay(1800, { ok: true, judge: j, judge_status: 'ok', feedback: j.feedback });
    }

    if (action === 'summary') {
      var rows = db.responses.filter(function (r) { return r.session_code === p.code; });
      return MOCK.delay(300, { ok: true, summary: MOCK.summary(rows), session: db.sessions[p.code] || null });
    }

    return Promise.reject(new Error('Неизвестное действие: ' + action));
  },

  /* Имитация судьи: уровни выводятся из длины текста, чтобы карта менялась
     от ответа к ответу и было что показать на экране. */
  judge: function (text) {
    var words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    var base = words < 120 ? 1 : words < 170 ? 2 : words < 230 ? 3 : 4;
    var out = {};
    var ids = ['МК-1', 'ГА-1', 'ПР-1', 'ПП-1'];
    for (var i = 0; i < ids.length; i++) {
      var lv = Math.max(1, Math.min(5, base + ((words + i * 7) % 3) - 1));
      out[ids[i]] = {
        level: lv,
        quote: 'фрагмент ответа участника (мок)',
        why: 'Гейт L' + lv + ' пройден, следующий — нет (мок).',
        flag: false
      };
    }
    out.feedback = 'Это моковая обратная связь: настоящую пишет судья по промпту из spec/. ' +
                   'В тексте видно направление, но не хватает явного отказа от одного из предложений и связи этапов между собой.';
    return out;
  },

  summary: function (rows) {
    var skills = TEST.skills.map(function (sk) {
      return { id: sk.id, name: sk.name, ability: sk.ability, zones: [0, 0, 0], levels: [0, 0, 0, 0, 0] };
    });
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i].map;
      if (!m) continue;
      for (var j = 0; j < m.skills.length; j++) {
        var r = m.skills[j];
        skills[j].zones[r.zoneIndex]++;
        if (r.level) skills[j].levels[r.level - 1]++;
      }
    }
    return { count: rows.length, skills: skills };
  }
};

/* В моковом режиме нужен настоящий подсчёт — подгружаем его отдельным файлом.
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
