/* Экран ведущего: создать сессию, показать код и QR, держать живой агрегат,
   свести «до» и «после» одной группы. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var REFRESH_MS = 15000;

  var code = '';
  var identify = false;
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

  /* ---- экраны кабинета: вход → все сессии → сессия / новая ---- */

  var SCREENS = ['screenLogin', 'screenList', 'screenNew', 'screenLive'];
  function screen(id) {
    SCREENS.forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    if (id !== 'screenLive' && timer) { clearInterval(timer); timer = null; }
    window.scrollTo(0, 0);
  }

  function toLogin() {
    try { localStorage.removeItem('bt_host_token'); } catch (e) {}
    try { history.replaceState(null, '', 'host.html'); } catch (e) {}
    screen('screenLogin');
    $('loginInput').focus();
  }

  function needLogin(err) { return err && /need_login/.test(err.message); }

  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function toList() {
    try { history.replaceState(null, '', 'host.html'); } catch (e) {}
    screen('screenList');
    $('exportAll').href = 'admin/export.csv?token=' + encodeURIComponent(API.token());
    var tb = $('sessTable').querySelector('tbody');
    tb.innerHTML = '<tr><td colspan="8" class="util">Загружаем…</td></tr>';
    API.call('listSessions', {}).then(function (res) {
      tb.innerHTML = '';
      var all = res.sessions || [];
      var list = all.filter(function (s) { return !s.deleted; });
      renderTrash(all.filter(function (s) { return s.deleted; }));
      list.forEach(function (s) {
        var tr = document.createElement('tr');
        tr.className = 'sess-row' + (s.current ? '' : ' is-old');
        [fmtDate(s.createdAt), s.title || '—', s.code, stageName(s.stage),
         s.current ? testName(s.testId) : 'прежний формат', s.identify ? 'да' : '',
         String(s.count), s.lastAt ? fmtDate(s.lastAt) : '—'].forEach(function (t) { tr.appendChild(cell(t)); });
        tr.tabIndex = 0;
        var open = function () {
          showLive({ code: s.code, title: s.title, stage: s.stage, testId: s.testId, identify: s.identify });
        };
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
        tb.appendChild(tr);
      });
      $('sessNote').textContent = list.length
        ? 'Сессий: ' + list.length + '. Нажмите на строку, чтобы открыть сессию.'
        : 'Сессий пока нет — создайте первую.';
    }).catch(function (err) {
      if (needLogin(err)) return toLogin();
      tb.innerHTML = '';
      $('sessNote').textContent = 'Не получилось загрузить список: ' + err.message;
    });
  }

  function renderTrash(gone) {
    $('trashBox').classList.toggle('hidden', !gone.length);
    $('trashSum').textContent = 'Удалённые сессии (' + gone.length + ')';
    var ul = $('trashList');
    ul.innerHTML = '';
    gone.forEach(function (s) {
      var li = document.createElement('li');
      var n = document.createElement('span');
      n.className = 'cand-name';
      n.textContent = (s.title || '—') + ' · ' + s.code;
      li.appendChild(n);
      var w = document.createElement('span');
      w.className = 'util';
      w.textContent = fmtDate(s.createdAt) + ' · прошли ' + s.count;
      li.appendChild(w);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-ghost btn-sm';
      b.textContent = 'Вернуть';
      b.addEventListener('click', function () {
        b.disabled = true;
        API.call('restoreSession', { code: s.code }).then(toList).catch(function (err) {
          if (needLogin(err)) return toLogin();
          b.textContent = 'Не получилось: ' + err.message;
        });
      });
      var acts = document.createElement('span');
      acts.className = 'cand-acts';
      acts.appendChild(b);
      li.appendChild(acts);
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'btn btn-ghost btn-sm btn-danger';
      x.textContent = 'Удалить насовсем';
      x.addEventListener('click', function () {
        if (!confirm('Стереть сессию «' + (s.title || '—') + '» (' + s.code + ') и все её ответы (' + s.count + ')? Вернуть будет нельзя.')) return;
        x.disabled = true;
        API.call('purgeSession', { code: s.code }).then(toList).catch(function (err) {
          if (needLogin(err)) return toLogin();
          x.textContent = 'Не получилось: ' + err.message;
        });
      });
      acts.appendChild(x);
      ul.appendChild(li);
    });
  }

  function deleteCurrent() {
    var title = $('liveTitle').textContent || '';
    if (!confirm('Удалить сессию ' + (title ? '«' + title + '» ' : '') + '(' + code + ')?\n\n' +
                 'Участники больше не смогут пройти по ней тест, её ответы пропадут из списка и выгрузки. ' +
                 'Вернуть можно из «Удалённых» внизу списка сессий.')) return;
    $('deleteBtn').disabled = true;
    API.call('deleteSession', { code: code }).then(toList).catch(function (err) {
      if (needLogin(err)) return toLogin();
      alert('Не получилось удалить: ' + err.message);
    }).then(function () { $('deleteBtn').disabled = false; });
  }

  function showLive(session) {
    code = session.code;
    identify = !!session.identify;
    try { history.replaceState(null, '', 'host.html?s=' + code); } catch (e) {}
    screen('screenLive');

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
    API.call('candidates', { code: code }).then(function (res) {
      var ul = $('candList');
      ul.innerHTML = '';
      $('candSum').textContent = 'Кандидаты — ' + res.items.length;
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
        var acts = document.createElement('span');
        acts.className = 'cand-acts';
        acts.appendChild(a);
        li.appendChild(acts);
        var dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'btn btn-ghost btn-sm';
        dl.textContent = 'Скачать разбор';
        dl.addEventListener('click', function () { downloadDetail(it, dl); });
        acts.appendChild(dl);
        ul.appendChild(li);
      });
    }).catch(function (err) {
      $('candList').innerHTML = '';
      if (needLogin(err)) return toLogin();
      $('candNote').textContent = 'Не получилось загрузить кандидатов: ' + err.message;
    });
  }

  /* ---- разбор кандидата файлом ----
     Расстановка с уровнями комментариев, свои комментарии и аргументация
     судьи по каждой способности. Один HTML-файл: открывается в любом
     браузере, печатается в PDF. Тексты кейса — из файла кейса на сайте. */

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>\u0022]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\u0022': '&quot;' }[c];
    });
  }

  function downloadDetail(it, btn) {
    btn.disabled = true;
    btn.textContent = 'Готовим…';
    var detail;
    API.call('candidateDetail', { code: code, rowId: it.rowId }).then(function (res) {
      detail = res;
      var meta = CONFIG.tests.filter(function (t) { return t.id === res.testId; })[0];
      if (!meta) throw new Error('кейс ' + res.testId + ' не найден');
      return fetch(meta.file).then(function (r) { return r.json(); });
    }).then(function (test) {
      var html = detailHtml(detail, test);
      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      var a = document.createElement('a');
      var day = (detail.submittedAt || '').slice(0, 10);
      a.href = URL.createObjectURL(blob);
      a.download = 'разбор — ' + detail.name.replace(/[\\/:*?\u0022<>|]/g, ' ') + (day ? ' — ' + day : '') + '.html';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      btn.textContent = 'Скачать разбор';
    }).catch(function (err) {
      btn.textContent = 'Не получилось: ' + err.message;
    }).then(function () { btn.disabled = false; });
  }

  function detailHtml(d, test) {
    var abilityName = {};
    CONFIG.abilities.forEach(function (a) { abilityName[a.id] = a.name; });
    var when = new Date(d.submittedAt);
    var out = [];
    out.push('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Разбор — ' + esc(d.name) + '</title>' +
      '<style>body{font:15px/1.45 -apple-system,"Inter Tight",Arial,sans-serif;color:#181818;max-width:820px;margin:32px auto;padding:0 20px}' +
      'h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 10px;border-top:1px solid #dbdbd9;padding-top:18px}' +
      'h3{font-size:16px;margin:22px 0 6px}.muted{color:#6b6b66}.lvl{display:inline-block;min-width:82px;margin-right:6px;font-weight:600}' +
      'ol{padding-left:22px}li{margin:6px 0}.ans{white-space:pre-wrap;background:#f6f6f5;padding:12px 14px;border-radius:4px}' +
      '.gates{white-space:pre-wrap;font-size:14px;background:#f6f6f5;padding:10px 14px;border-radius:4px}' +
      '.tag{background:#b2d4f7;padding:0 4px;font-size:13px}.warn{color:#cc3700}</style></head><body>');
    out.push('<h1>' + esc(d.name) + '</h1>');
    out.push('<p class="muted">Кейс: ' + esc(test.name || d.testId) + ' · ' +
      (isNaN(when) ? '' : when.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })) +
      (d.durationSec ? ' · на тест ушло ' + Math.round(d.durationSec / 60) + ' мин' : '') + '</p>');
    if (d.judgeStatus !== 'ok') out.push('<p class="warn">Судья не оценил ответы: ' + esc(d.judgeError || 'нет оценки') + '</p>');

    // карта
    out.push('<h2>Карта</h2><ul>');
    d.skills.forEach(function (sk) {
      var zone = typeof sk.zone === 'number' || /^\d$/.test(String(sk.zone)) ? (CONFIG.zones || [])[Number(sk.zone)] : sk.zone;
      out.push('<li><b>' + esc(sk.name) + '</b> — расстановка: ' + esc(sk.score === '' ? '—' : String(sk.score).replace('.', ',')) +
               (zone ? ' (' + esc(zone) + ')' : '') + '</li>');
    });
    out.push('</ul>');

    // расстановка
    out.push('<h2>Расстановка комментариев</h2><p class="muted">В порядке, который поставил участник: 1 — «написал бы сам». ' +
      'Уровень комментария — по методологии (5 — самый сильный). Балл за ветку, 0–3: уровень комментария на первом месте ' +
      '(5 → 3, 4 → 2, 3 → 1, 2 → 0), минус 0,5, если остальные не по убыванию; 0, если порядок похож на случайный.</p>');
    d.situations.forEach(function (sit, n) {
      var ts = (test.situations || []).filter(function (x) { return x.id === sit.id; })[0] || { options: [], post: [] };
      var textOf = {};
      ts.options.forEach(function (o) { textOf[o.id] = o.text; });
      out.push('<h3>Ветка ' + (n + 1) + ' · ' + esc(sit.factor) + ' — балл ' + (sit.score === null ? '—' : String(sit.score).replace('.', ',')) + ' из 3</h3>');
      if (ts.post && ts.post.length) out.push('<p class="muted">' + esc(ts.post.join(' ')) + '</p>');
      if (!sit.order.length) { out.push('<p class="muted">Не расставлено.</p>'); return; }
      out.push('<ol>');
      sit.order.forEach(function (label, i) {
        out.push('<li><span class="lvl">уровень ' + (sit.levels[i] || '?') + '</span>' + esc(textOf[label] || label) + '</li>');
      });
      out.push('</ol>');
    });

    // свои комментарии и судья
    out.push('<h2>Свои комментарии и оценка судьи</h2>');
    d.free.forEach(function (q, n) {
      var tq = (test.free || []).filter(function (x) { return x.id === q.id; })[0] || {};
      out.push('<h3>Комментарий ' + (n + 1) + '</h3>');
      if (tq.text) out.push('<p class="muted">Вопрос: ' + esc(tq.text) + '</p>');
      out.push('<div class="ans">' + (q.text ? esc(q.text) : '<span class="muted">пусто</span>') + '</div>');
      q.abilities.forEach(function (aid) {
        var a = d.abilities.filter(function (x) { return x.id === aid; })[0];
        if (!a) return;
        out.push('<p><span class="tag">' + esc(aid) + ' · ' + esc(abilityName[aid] || a.name) + '</span> ' +
          '<b>' + (a.level ? 'уровень ' + a.level : 'нет оценки') + '</b></p>');
        // флаг и «лозунг» — служебные пометки судьи: остаются в таблице, в разбор не идут
        if (a.gates) out.push('<div class="gates">' + esc(a.gates) + '</div>');
        if (a.has) out.push('<p><b>Сильная сторона:</b> ' + esc(a.has) + '</p>');
        if (a.next) out.push('<p><b>Что можно сделать лучше:</b> ' + esc(a.next) + '</p>');
        if (a.stronger) out.push('<p><b>Как та же мысль звучала бы сильнее:</b><br>' +
          '<span class="muted">Написал(а): «' + esc(a.stronger.quote) + '»</span><br>' +
          'Сильнее: ' + esc(a.stronger.text) + '<br><span class="muted">Что изменилось: ' + esc(a.stronger.change) + '</span></p>');
        if (a.unclear) out.push('<p class="muted"><b>Что спорно (для методолога):</b> ' + esc(a.unclear) + '</p>');
      });
    });
    out.push('<p class="muted" style="margin-top:40px">Границы уровней: «1→2: да «цитата»» — судья нашёл в ответе признак ' +
      'следующего уровня и привёл фрагмент. Уровень — сколько границ подряд пройдено.</p>');
    out.push('</body></html>');
    return out.join('\n');
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
      if (needLogin(err)) return toLogin();
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
                     testId: res.testId || testId, identify: identify });
        })
        .catch(function (err) {
          if (needLogin(err)) return toLogin();
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

    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      $('loginBtn').disabled = true;
      $('loginErr').classList.add('hidden');
      API.call('login', { login: $('loginInput').value, password: $('passInput').value }).then(function (res) {
        try { localStorage.setItem('bt_host_token', res.token); } catch (e2) {}
        $('passInput').value = '';
        route();
      }).catch(function (err) {
        $('loginErr').textContent = err.message;
        $('loginErr').classList.remove('hidden');
      }).then(function () { $('loginBtn').disabled = false; });
    });

    $('logoutBtn').addEventListener('click', toLogin);
    $('deleteBtn').addEventListener('click', deleteCurrent);
    $('toNew').addEventListener('click', function () { screen('screenNew'); $('titleInput').focus(); });
    Array.prototype.forEach.call(document.querySelectorAll('.back-list'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); toList(); });
    });

    API.ready().then(route);
  }

  /* Куда попасть: без входа — на вход; host.html?s=КОД — сразу в сессию; иначе список. */
  function route() {
    API.call('checkToken', { token: API.token() }).then(function (res) {
      if (!res.ok) return toLogin();
      var fromUrl = (new URLSearchParams(location.search).get('s') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (fromUrl.length === 6) showLive({ code: fromUrl, title: '', stage: '', testId: '' });
      else toList();
    }).catch(toLogin);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
