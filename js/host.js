/* Экран ведущего: создать сессию, показать код и QR, держать живой агрегат. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var REFRESH_MS = 15000;

  var code = '';
  var timer = null;

  /* Ссылка на тест: тот же каталог, index.html?s=КОД. */
  function testLink(sessionCode) {
    var base = location.href.replace(/host\.html.*$/, '');
    return base + 'index.html?s=' + sessionCode;
  }

  function fillStages() {
    var sel = $('stageInput');
    TEST.stages.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      sel.appendChild(o);
    });
  }

  function showLive(session) {
    code = session.code;
    $('screenNew').classList.add('hidden');
    $('screenLive').classList.remove('hidden');

    $('liveCode').textContent = code;
    $('liveTitle').textContent = session.title || '';
    $('statStage').textContent = stageName(session.stage);

    var link = testLink(code);
    $('liveLink').textContent = link;
    try {
      QR.draw($('qr'), link, 6);
    } catch (e) {
      $('liveLink').textContent = link + ' (QR не построился: ' + e.message + ')';
    }

    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, REFRESH_MS);
  }

  function stageName(id) {
    var found = TEST.stages.filter(function (s) { return s.id === id; })[0];
    return found ? found.name : (id || '—');
  }

  /* ---- агрегат ---- */

  function refresh() {
    $('refreshNote').textContent = 'обновляем…';
    API.summary(code).then(function (res) {
      // при заходе по ссылке host.html?s=КОД название и этап приходят отсюда
      if (res.session) {
        if (res.session.title) $('liveTitle').textContent = res.session.title;
        if (res.session.stage) $('statStage').textContent = stageName(res.session.stage);
      }
      render(res.summary);
      var t = new Date();
      $('refreshNote').textContent = 'обновлено в ' +
        String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    }).catch(function (err) {
      $('refreshNote').textContent = 'не обновилось: ' + err.message;
    });
  }

  function render(summary) {
    $('statCount').textContent = summary.count;

    // одна картина: пять навыков, одна шкала, доли группы по трети шкалы
    var prof = $('groupProfile');
    prof.innerHTML = '';
    summary.skills.forEach(function (sk) {
      prof.appendChild(groupRow(sk, summary.count));
    });

    renderTime(summary.time);
    renderZoneTable(summary);
    renderLevelTable(summary);
  }

  /* Время. Медиана наверху, разбивка по шагам — в подробностях: ведущему на
     пилоте нужно знать, укладывается ли тест в пятнадцать минут и где затык. */
  function renderTime(t) {
    if (!t || !t.n) {
      $('statTime').textContent = '—';
      $('timeTable').querySelector('tbody').innerHTML = '';
      return;
    }

    $('statTime').textContent = mmss(t.median);

    var names = { intro: 'Инструкция', blockB: 'Свободный ответ' };
    TEST.blockA.forEach(function (s, i) { names[s.id] = 'Ситуация ' + (i + 1); });

    var tb = $('timeTable').querySelector('tbody');
    tb.innerHTML = '';

    add('Медиана прохождения', mmss(t.median));
    add('Быстрее всех', mmss(t.min));
    add('Дольше всех', mmss(t.max));
    add('Не уложились в 15 минут', t.over15 + ' из ' + t.n);

    var order = ['intro'].concat(TEST.blockA.map(function (s) { return s.id; })).concat(['blockB']);
    order.forEach(function (key) {
      if (t.steps && t.steps[key]) add('среднее · ' + (names[key] || key), mmss(t.steps[key]));
    });

    function add(label, value) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(label));
      var td = cell(value);
      td.style.whiteSpace = 'nowrap';
      tr.appendChild(td);
      tb.appendChild(tr);
    }
  }

  function mmss(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function groupRow(sk, total) {
    var row = document.createElement('div');
    row.className = 'prow';

    var name = document.createElement('span');
    name.className = 'prow-name';
    name.textContent = sk.name;
    row.appendChild(name);

    var buckets = sk.buckets || [0, 0, 0];
    var track = document.createElement('span');
    track.className = 'dist';
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', sk.name + ': низ ' + buckets[0] +
      ', середина ' + buckets[1] + ', верх ' + buckets[2]);
    ['z1', 'z2', 'z3'].forEach(function (cls, i) {
      var seg = document.createElement('i');
      seg.className = cls;
      seg.style.width = total ? (buckets[i] * 100 / total) + '%' : '0';
      track.appendChild(seg);
    });
    row.appendChild(track);

    var counts = document.createElement('span');
    counts.className = 'prow-lag';
    counts.textContent = total
      ? buckets[0] + ' · ' + buckets[1] + ' · ' + buckets[2] + ' человек'
      : 'пока никто не прошёл';
    row.appendChild(counts);

    return row;
  }

  function renderZoneTable(summary) {
    var zb = $('zoneTable').querySelector('tbody');
    zb.innerHTML = '';
    summary.skills.forEach(function (sk) {
      var total = sk.zones[0] + sk.zones[1] + sk.zones[2];
      var tr = document.createElement('tr');
      tr.appendChild(cell(sk.name));
      for (var i = 0; i < 3; i++) tr.appendChild(cell(num(sk.zones[i], total)));
      zb.appendChild(tr);
    });
  }

  function renderLevelTable(summary) {
    var lb = $('levelTable').querySelector('tbody');
    lb.innerHTML = '';
    summary.skills.filter(function (sk) { return sk.ability; }).forEach(function (sk) {
      var ability = TEST.abilities.filter(function (a) { return a.id === sk.ability; })[0];
      var tr = document.createElement('tr');
      tr.appendChild(cell(sk.ability + ' · ' + (ability ? ability.name : sk.name)));
      var judged = 0;
      for (var l = 0; l < 5; l++) {
        judged += sk.levels[l];
        tr.appendChild(cell(String(sk.levels[l] || '—')));
      }
      var missing = summary.count - judged;
      tr.appendChild(cell(missing > 0 ? String(missing) : '—'));
      lb.appendChild(tr);
    });
  }

  function cell(text) {
    var td = document.createElement('td');
    td.textContent = text;
    return td;
  }

  function num(n, total) {
    if (!total) return '—';
    return n + ' · ' + Math.round(n * 100 / total) + '%';
  }

  /* ---- старт ---- */

  function init() {
    fillStages();

    $('newForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = $('titleInput').value.trim();
      var stage = $('stageInput').value;
      if (!title) { $('titleInput').focus(); return; }

      $('newBtn').disabled = true;
      $('newBtn').textContent = 'Создаём…';
      $('newErr').classList.add('hidden');

      API.ready()
        .then(function () { return API.createSession(title, stage); })
        .then(function (res) {
          showLive({ code: res.code, title: title, stage: stage });
        })
        .catch(function (err) {
          $('newErr').textContent = 'Не получилось создать сессию: ' + err.message;
          $('newErr').classList.remove('hidden');
        })
        .finally(function () {
          $('newBtn').disabled = false;
          $('newBtn').textContent = 'Создать';
        });
    });

    $('refreshBtn').addEventListener('click', refresh);

    $('copyLink').addEventListener('click', function () {
      var link = testLink(code);
      navigator.clipboard.writeText(link).then(function () {
        $('copyLink').textContent = 'Скопировано';
        setTimeout(function () { $('copyLink').textContent = 'Скопировать ссылку'; }, 1600);
      }).catch(function () {
        $('copyLink').textContent = 'Скопируйте вручную';
      });
    });

    $('openExisting').addEventListener('click', function (e) {
      e.preventDefault();
      var entered = prompt('Код сессии (6 символов)');
      if (!entered) return;
      var clean = entered.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (clean.length === 6) {
        API.ready().then(function () {
          showLive({ code: clean, title: '', stage: '' });
        });
      }
    });

    // host.html?s=КОД — вернуться к уже созданной сессии
    var fromUrl = new URLSearchParams(location.search).get('s');
    if (fromUrl) {
      var clean = fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (clean.length === 6) {
        API.ready().then(function () { showLive({ code: clean, title: '', stage: '' }); });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
