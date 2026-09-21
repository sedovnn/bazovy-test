/* Экран ведущего: создать сессию, показать код и QR, держать живой агрегат,
   свести «до» и «после» одной группы. */

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

  function stageById(id) {
    return CONFIG.stages.filter(function (s) { return s.id === id; })[0] || null;
  }

  function stageName(id) {
    var found = stageById(id);
    return found ? found.name : (id || '—');
  }

  function testName(id) {
    var found = CONFIG.tests.filter(function (t) { return t.id === id; })[0];
    return found ? found.name : (id || '—');
  }

  /* ---- создание ---- */

  function fillStages() {
    var sel = $('stageInput');
    CONFIG.stages.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      sel.appendChild(o);
    });

    var tests = $('testInput');
    CONFIG.tests.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      tests.appendChild(o);
    });

    sel.addEventListener('change', syncStage);
    syncStage();
  }

  /* У «до» и «после» тест привязан жёстко: один и тот же тест дважды давать
     нельзя. Выбор есть только у этапа без пары. */
  function syncStage() {
    var stage = stageById($('stageInput').value);
    if (!stage) return;
    $('testRow').classList.toggle('hidden', !stage.choose);
    $('stageNote').textContent = stage.choose
      ? 'Тест выбираете вы — берите любой из двух.'
      : 'Тест для этого этапа задан: ' + testName(stage.test) + '.';
  }

  /* ---- живой экран ---- */

  function showLive(session) {
    code = session.code;
    $('screenNew').classList.add('hidden');
    $('screenLive').classList.remove('hidden');

    $('liveCode').textContent = code;
    $('liveTitle').textContent = session.title || '';
    $('statStage').textContent = stageName(session.stage);
    $('statTest').textContent = session.testId ? testName(session.testId) : '—';

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

  /* ---- агрегат ---- */

  function refresh() {
    $('refreshNote').textContent = 'обновляем…';
    API.summary(code).then(function (res) {
      // при заходе по ссылке host.html?s=КОД название, этап и тест приходят отсюда
      if (res.session) {
        if (res.session.title) $('liveTitle').textContent = res.session.title;
        if (res.session.stage) $('statStage').textContent = stageName(res.session.stage);
        if (res.session.testId) $('statTest').textContent = testName(res.session.testId);
      }
      render(res.summary);
      var t = new Date();
      $('refreshNote').textContent = 'обновлено в ' +
        String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      return refreshCompare();
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

    renderZoneTable(summary);
    renderLevelTable(summary);
  }

  /* Одна строка картины: навык, полоса из трёх долей группы, числа. */
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
    // три числа читаются вместе с легендой под картиной: низ · середина · верх
    counts.textContent = total
      ? buckets[0] + ' · ' + buckets[1] + ' · ' + buckets[2] + ' из ' + total
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
      var ability = CONFIG.abilities.filter(function (a) { return a.id === sk.ability; })[0];
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

  /* ---- сравнение «до/после» ----
     Группа опознаётся по названию: ведущий заводит две сессии с одним
     названием и разными этапами. Одна сессия — сравнивать нечего, блок скрыт. */

  function refreshCompare() {
    return API.compare(code).then(function (res) {
      var list = (res.sessions || []).filter(function (s) { return s.summary.count > 0; });
      if (list.length < 2) { $('compareBox').classList.add('hidden'); return; }

      $('compareTitle').textContent = res.title || 'Сравнение по группе';
      var box = $('compareCols');
      box.innerHTML = '';
      list.forEach(function (s) { box.appendChild(compareCard(s)); });
      $('compareBox').classList.remove('hidden');
    }).catch(function () {
      // сравнение — не главная работа экрана: молча прячем, агрегат остаётся
      $('compareBox').classList.add('hidden');
    });
  }

  function compareCard(s) {
    var card = document.createElement('div');

    var head = document.createElement('p');
    head.className = 'kicker';
    head.textContent = stageName(s.stage) + ' · ' + testName(s.testId);
    card.appendChild(head);

    var count = document.createElement('p');
    count.className = 'util';
    count.style.margin = '0 0 8px';
    count.textContent = s.summary.count + ' ' + peopleForm(s.summary.count) +
                        ' · код ' + s.code;
    card.appendChild(count);

    s.summary.skills.forEach(function (sk) {
      card.appendChild(meanRow(sk, s.summary.count));
    });

    return card;
  }

  /* В сравнении показываем среднее по группе одной полосой: две колонки
     из трёхцветных распределений рядом не читаются. */
  function meanRow(sk, total) {
    var row = document.createElement('div');
    row.className = 'prow';

    var name = document.createElement('span');
    name.className = 'prow-name';
    name.textContent = sk.name;
    row.appendChild(name);

    var track = document.createElement('span');
    track.className = 'ptrack';
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', sk.name + ': ' + Math.round(sk.mean * 100) +
      ' из 100 по общей шкале, среднее по группе');
    var fill = document.createElement('i');
    fill.style.width = Math.max(3, Math.round((sk.mean || 0) * 100)) + '%';
    track.appendChild(fill);
    row.appendChild(track);

    return row;
  }

  function peopleForm(n) {
    var t = n % 100, o = n % 10;
    if (t >= 11 && t <= 14) return 'человек';
    if (o >= 2 && o <= 4) return 'человека';
    return 'человек';
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
      var stage = stageById($('stageInput').value);
      var identify = $('identifyInput').value === 'да';
      if (!title) { $('titleInput').focus(); return; }

      var testId = stage && stage.choose ? $('testInput').value : (stage ? stage.test : '');

      $('newBtn').disabled = true;
      $('newBtn').textContent = 'Создаём…';
      $('newErr').classList.add('hidden');

      API.ready()
        .then(function () {
          return API.createSession({ title: title, stage: stage.id,
                                     testId: testId, identify: identify });
        })
        .then(function (res) {
          showLive({ code: res.code, title: title, stage: stage.id,
                     testId: res.testId || testId });
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
          showLive({ code: clean, title: '', stage: '', testId: '' });
        });
      }
    });

    // host.html?s=КОД — вернуться к уже созданной сессии
    var fromUrl = new URLSearchParams(location.search).get('s');
    if (fromUrl) {
      var clean = fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (clean.length === 6) {
        API.ready().then(function () {
          showLive({ code: clean, title: '', stage: '', testId: '' });
        });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
