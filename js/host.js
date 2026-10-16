/* Экран ведущего: создать сессию, показать код и QR, держать живой агрегат,
   свести «до» и «после» одной группы. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var REFRESH_MS = 15000;

  var code = '';
  var hostKey = '';      // ключ ведущего: открывает список кандидатов
  var identify = false;
  var timer = null;

  /* Ключ живёт в ссылке ведущего и запоминается в этом браузере по коду сессии. */
  function rememberKey(c, k) { try { localStorage.setItem('bt_hostkey_' + c, k); } catch (e) {} }
  function recallKey(c) { try { return localStorage.getItem('bt_hostkey_' + c) || ''; } catch (e) { return ''; } }

  function hostLink(c, k) {
    return location.href.replace(/host\.html.*$/, '') + 'host.html?s=' + c + '&k=' + k;
  }

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

  /* Кейс выбирает ведущий на любом этапе. Один кейс дважды одной группе
     давать нельзя — это проверяет бэкенд при создании сессии. */
  function syncStage() {
    var stage = stageById($('stageInput').value);
    if (!stage) return;
    $('testRow').classList.toggle('hidden', !stage.choose);
    var paired = stage.id === 'before' || stage.id === 'after';
    $('stageNote').textContent = stage.choose
      ? (paired ? 'Кейс выбираете вы. На «до» и «после» одной группы — разные кейсы.'
                : 'Кейс выбираете вы — любой из шести.')
      : 'Кейс для этого этапа задан: ' + testName(stage.test) + '.';
  }

  /* ---- живой экран ---- */

  function showLive(session) {
    code = session.code;
    hostKey = session.hostKey || recallKey(code);
    identify = !!session.identify;
    if (hostKey) {
      rememberKey(code, hostKey);
      $('hostLink').textContent = hostLink(code, hostKey);
      $('hostLinkBox').classList.remove('hidden');
      // ссылка в адресной строке — с ключом: перезагрузка страницы его не теряет
      try { history.replaceState(null, '', 'host.html?s=' + code + '&k=' + hostKey); } catch (e) {}
    }
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

  /* ---- кандидаты именной сессии ---- */

  function refreshCandidates() {
    $('candBox').classList.toggle('hidden', !identify);
    $('namesNote').classList.toggle('hidden', identify);
    if (!identify) return;
    if (!hostKey) {
      $('candList').innerHTML = '';
      $('candNote').textContent = 'Список кандидатов открывается только по ссылке ведущего — той, что ' +
        'появилась при создании сессии. У сессий, созданных до 16.10.2026, такой ссылки нет: ' +
        'для интервью заведите новую.';
      return;
    }
    API.call('candidates', { code: code, key: hostKey }).then(function (res) {
      var ul = $('candList');
      ul.innerHTML = '';
      if (!res.items.length) {
        ul.innerHTML = '<li class="util">Пока никто не отправил ответы.</li>';
        return;
      }
      res.items.forEach(function (it) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.className = 'cand-name';
        name.textContent = it.name;
        li.appendChild(name);
        var when = document.createElement('span');
        when.className = 'util';
        var d = new Date(it.submittedAt);
        when.textContent = isNaN(d) ? '' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit' }) + (it.judged ? '' : ' · ответы ещё не оценены');
        li.appendChild(when);
        var a = document.createElement('a');
        a.className = 'btn btn-ghost btn-sm';
        a.href = location.href.replace(/host\.html.*$/, '') + 'index.html?r=' + encodeURIComponent(it.rowId);
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Открыть результат';
        li.appendChild(a);
        ul.appendChild(li);
      });
    }).catch(function (err) {
      $('candList').innerHTML = '';
      $('candNote').textContent = err.message === 'no_key'
        ? 'Ключ в ссылке не подходит к этой сессии. Откройте ссылку ведущего, которую сохранили при создании.'
        : 'Не получилось загрузить кандидатов: ' + err.message;
    });
  }

  /* ---- комментарии группы ---- */

  function loadQuotes() {
    $('quotesBtn').disabled = true;
    $('quotesBtn').textContent = 'Загружаем…';
    API.call('quotes', { code: code }).then(function (res) {
      var box = $('quotesList');
      box.innerHTML = '';
      var any = false;
      (res.abilities || []).forEach(function (a) {
        if (!a.items.length) return;
        any = true;
        var d = document.createElement('details');
        d.className = 'quotes-skill';
        var s = document.createElement('summary');
        s.textContent = a.skill + ' · ' + a.name + ' — ' + a.items.length;
        d.appendChild(s);
        var ul = document.createElement('ul');
        ul.className = 'quotes';
        a.items.forEach(function (it) {
          var li = document.createElement('li');
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'quote-item';
          var lvl = document.createElement('span');
          lvl.className = 'quote-lvl';
          lvl.textContent = it.level ? 'уровень ' + it.level : (it.review ? 'уточняется' : 'без оценки');
          b.appendChild(lvl);
          if (it.shortestStrong) {
            var tag = document.createElement('span');
            tag.className = 'quote-tag';
            tag.textContent = 'самый короткий из сильных';
            b.appendChild(tag);
          }
          var tx = document.createElement('span');
          tx.className = 'quote-text';
          tx.textContent = it.text;
          b.appendChild(tx);
          b.addEventListener('click', function () { openQuote(a.skill, it.text); });
          li.appendChild(b);
          ul.appendChild(li);
        });
        d.appendChild(ul);
        box.appendChild(d);
      });
      if (!any) box.innerHTML = '<p class="util">Пока нет ни одного комментария.</p>';
    }).catch(function (err) {
      $('quotesList').innerHTML = '';
      var p = document.createElement('p');
      p.className = 'err';
      p.textContent = 'Не получилось загрузить: ' + err.message;
      $('quotesList').appendChild(p);
    }).then(function () {
      $('quotesBtn').disabled = false;
      $('quotesBtn').textContent = 'Обновить комментарии';
    });
  }

  // На стене — только текст и навык: уровень не уезжает на экран.
  function openQuote(skill, text) {
    $('quoteFullSkill').textContent = skill;
    $('quoteFullText').textContent = text;
    $('quoteFull').classList.remove('hidden');
    $('quoteFullClose').focus();
  }

  function closeQuote() { $('quoteFull').classList.add('hidden'); }

  /* ---- агрегат ---- */

  function refresh() {
    $('refreshNote').textContent = 'обновляем…';
    API.summary(code).then(function (res) {
      // при заходе по ссылке host.html?s=КОД название, этап и тест приходят отсюда
      if (res.session) {
        identify = !!res.session.identify;
        if (res.session.title) $('liveTitle').textContent = res.session.title;
        if (res.session.stage) $('statStage').textContent = stageName(res.session.stage);
        if (res.session.testId) $('statTest').textContent = testName(res.session.testId);
      }
      render(res.summary);
      refreshCandidates();
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
                     testId: res.testId || testId, identify: identify, hostKey: res.hostKey || '' });
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
    $('quotesBtn').addEventListener('click', loadQuotes);
    $('quoteFullClose').addEventListener('click', closeQuote);
    $('quoteFull').addEventListener('click', function (e) { if (e.target === $('quoteFull')) closeQuote(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeQuote(); });

    $('copyLink').addEventListener('click', function () {
      var link = testLink(code);
      navigator.clipboard.writeText(link).then(function () {
        $('copyLink').textContent = 'Скопировано';
        setTimeout(function () { $('copyLink').textContent = 'Скопировать ссылку'; }, 1600);
      }).catch(function () {
        $('copyLink').textContent = 'Скопируйте вручную';
      });
    });

    $('copyHostLink').addEventListener('click', function () {
      navigator.clipboard.writeText(hostLink(code, hostKey)).then(function () {
        $('copyHostLink').textContent = 'Скопировано';
        setTimeout(function () { $('copyHostLink').textContent = 'Скопировать ссылку ведущего'; }, 1600);
      }).catch(function () {
        $('copyHostLink').textContent = 'Скопируйте вручную';
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
    var params = new URLSearchParams(location.search);
    var fromUrl = params.get('s');
    var keyFromUrl = (params.get('k') || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
    if (fromUrl) {
      var clean = fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (clean.length === 6) {
        API.ready().then(function () {
          showLive({ code: clean, title: '', stage: '', testId: '', hostKey: keyFromUrl });
        });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
