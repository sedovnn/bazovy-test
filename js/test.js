/* Экраны участника: вход → новость и 6 веток комментариев → ожидание → карта.

   Новость подаётся карточкой, как пост в канале, под ней 4 комментария.
   Свободные вопросы живут внутри новостей 5 и 6, отдельного экрана у них нет:
   человек отвечает, не выходя из новости, которую только что прочитал.

   Тексты теста подгружаются по коду сессии (data/test_*.json) — в браузер
   уезжает только тот тест, который человек и проходит. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var STORE = 'bt_progress_v2';
  /* Адрес своей карты: живёт дольше вкладки, поэтому localStorage, а не
     sessionStorage. Ключ — код сессии: у одного человека могут быть разные
     прогоны на разных этапах. */
  var RESULTS = 'bt_results_v1';

  var TEST = null;          // содержимое data/test_*.json, приходит после входа

  var state = {
    code: '',
    stage: '',
    testId: '',
    step: 0,            // индекс новости, 0…5
    order: {},          // id новости → id комментариев в порядке расстановки
    shuffled: {},       // id новости → порядок показа комментариев
    answers: {},        // q1 / q2 / q3 → текст
    sent: {},           // q → true: свой комментарий «до расстановки» отправлен и зафиксирован
    participant: '',
    identify: false,
    /* Ключ отправки. Если сеть оборвалась и человек жмёт «Отправить» снова,
       бэкенд по этому ключу узнаёт прежнюю попытку: второй строки не будет
       и судья не будет вызван и оплачен дважды. */
    submissionId: '',
    startedAt: 0,
    /* Сколько секунд человек провёл на каждом шаге. Копится: вернулся назад —
       время добавляется, а не перезаписывается. Нужно, чтобы понять, укладывается
       ли тест в обещанные пятнадцать минут и где именно уходит время. */
    times: {},
    openStep: null,
    stepAt: 0
  };

  /* ---------- утилиты ---------- */

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Закрывает предыдущий шаг и открывает новый. */
  function markStep(id) {
    var now = Date.now();
    if (state.stepAt && state.openStep) {
      state.times[state.openStep] = (state.times[state.openStep] || 0) +
                                    Math.round((now - state.stepAt) / 1000);
    }
    state.openStep = id;
    state.stepAt = now;
    save();
  }

  function countWords(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function wordForm(n) {
    var t = n % 100, o = n % 10;
    if (t >= 11 && t <= 14) return 'слов';
    if (o === 1) return 'слово';
    if (o >= 2 && o <= 4) return 'слова';
    return 'слов';
  }

  function show(id) {
    var screens = ['screenEnter', 'screenIntro', 'screenA', 'screenWait', 'screenMap'];
    for (var i = 0; i < screens.length; i++) {
      $(screens[i]).classList.toggle('hidden', screens[i] !== id);
    }
    $('progress').classList.toggle('hidden', id !== 'screenA');
    window.scrollTo(0, 0);
  }

  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {}
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(STORE);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || !s.code || !s.testId) return false;
      state = s;
      return true;
    } catch (e) { return false; }
  }

  function escapeHtml(s) {
    // \u0022 вместо кавычки: tools/проверить_фронт.py не разбирает регулярки
    return String(s).replace(/[&<>\u0022]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function list(items) {
    if (!items.length) return '';
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(', ') + ' и ' + items[items.length - 1];
  }

  /* ---------- прогресс ---------- */

  function renderProgress() {
    var total = TEST.situations.length;
    var seg = $('progressSeg');
    seg.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var el = document.createElement('i');
      el.className = 'seg' + (i < state.step ? ' is-done' : i === state.step ? ' is-now' : '');
      seg.appendChild(el);
    }
    $('progressNum').textContent = (state.step + 1) + ' / ' + total;
  }

  /* ---------- вход ---------- */

  function initEnter() {
    var input = $('codeInput');
    var btn = $('enterBtn');

    function normalize(v) { return (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }

    input.addEventListener('input', function () {
      input.value = normalize(input.value);
      btn.disabled = input.value.length !== 6;

      var known = input.value.length === 6 ? recallResult(input.value) : '';
      $('againBox').classList.toggle('hidden', !known);
      if (known) {
        $('againLink').onclick = function (e) { e.preventDefault(); openResult(known); };
      }
    });

    $('enterForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = normalize(input.value);
      if (code.length !== 6) return;
      btn.disabled = true;
      btn.textContent = 'Проверяем…';
      $('enterErr').classList.add('hidden');

      API.ready()
        .then(function () { return API.call('checkSession', { code: code }); })
        .then(function (res) {
          state.code = code;
          state.stage = res.stage || '';
          state.testId = res.testId || '';
          state.identify = res.identify === true;
          state.startedAt = Date.now();
          state.submissionId = 'з' + Date.now().toString(36) + '-' +
                               Math.random().toString(36).slice(2, 10);
          return API.loadTest(state.testId);
        })
        .then(function (test) {
          TEST = test;
          markStep('intro');
          showIntro();
        })
        .catch(function (err) {
          $('enterErr').textContent = err.message === 'no_session'
            ? 'Такой сессии нет. Проверьте код у ведущего.'
            : ('Не получилось войти: ' + err.message);
          $('enterErr').classList.remove('hidden');
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Начать';
        });
    });

  }

  /* Код из ссылки index.html?s=КОД, приведённый к виду поля ввода. */
  function codeFromUrl() {
    return (new URLSearchParams(location.search).get('s') || '')
      .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  function startWithCode(code) {
    $('codeInput').value = code;
    $('enterBtn').disabled = code.length !== 6;
    if (code.length === 6) $('enterForm').requestSubmit();
  }

  function showIntro() {
    // Легенда приходит абзацами; первый — крупным, остальные обычным текстом.
    var box = $('introText');
    box.innerHTML = '';
    // В именной сессии абзац про анонимность заменён: имя спрашиваем, на экран не выводим.
    var intro = (state.identify && TEST.introNamed) ? TEST.introNamed : TEST.intro;
    intro.forEach(function (para, i) {
      var el = document.createElement('p');
      el.className = i === 0 ? 'lead' : '';
      el.style.margin = '0 0 14px';
      el.textContent = para;
      box.appendChild(el);
    });
    $('nameBox').classList.toggle('hidden', !state.identify);
    if (state.identify) {
      $('nameInput').value = state.participant || '';
      $('introBtn').disabled = !$('nameInput').value.trim();
    }
    show('screenIntro');
  }

  /* ---------- новость ---------- */

  function currentSituation() { return TEST.situations[state.step]; }

  function freeOf(situation) {
    if (!situation.free) return null;
    for (var i = 0; i < TEST.free.length; i++) {
      if (TEST.free[i].id === situation.free) return TEST.free[i];
    }
    return null;
  }

  function ranked(situation) { return (state.order[situation.id] || []).length; }
  function rankingDone(situation) { return ranked(situation) === situation.options.length; }

  var OVAL = '<svg class="oval" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"><path d="M12,30 C14,14 70,6 152,7 C238,8 292,15 291,29 C290,44 214,53 128,52 C42,51 10,44 11,28 C11,24 13,20 18,17"/></svg>';
  function renderSituation(focusOptId) {
    // Тест приезжает отдельным запросом. Пока его нет, рисовать нечего:
    // без этой проверки гонка двух запусков оставляла пустой экран.
    if (!TEST) return;
    var s = currentSituation();
    var ids = s.options.map(function (o) { return o.id; });

    /* Метка реплики меняется вместе с её текстом. Если человек начал тест,
       а мы выложили правку, в его сохранённом прогоне лежат метки прежней
       версии — по ним реплик уже не найти. Тогда порядок показа и расстановку
       по этой ситуации собираем заново: иначе экран остаётся пустым, и человек
       не понимает, что произошло. Поймано на своём же прогоне при переходе
       с v2.1 на v2.3. */
    var saved = state.shuffled[s.id] || [];
    var fits = saved.length === ids.length && saved.every(function (id) {
      return ids.indexOf(id) >= 0;
    });
    if (!fits) {
      state.shuffled[s.id] = shuffle(ids);
      state.order[s.id] = [];
      save();
    }
    if (!state.order[s.id]) state.order[s.id] = [];

    // Новость одна на кейс: открыта на первой ветке, дальше свёрнута.
    var news = TEST.news || { title: s.title, post: s.post };
    $('aTitle').textContent = news.title || '';
    $('aNewsSum').textContent = 'Новость · ' + (news.title || '');
    var post = $('aCase');
    post.innerHTML = '';
    news.post.forEach(function (para) {
      var p = document.createElement('p');
      p.textContent = para;
      post.appendChild(p);
    });
    if (state.newsStep !== state.step) {
      $('aNews').open = state.step === 0;
      state.newsStep = state.step;
    }

    $('aFactor').textContent = (TEST.news ? 'Ветка комментариев ' : 'Новость ') +
      (state.step + 1) + ' из ' + TEST.situations.length;
    // «Кто сказал: «реплика»» — кто сказал голубым выделителем, реплика в овале
    var post = TEST.news ? s.post.join(' ') : '';
    var cut = post.match(/^([^:«]{3,40}):\s*(.+)$/);
    $('aOpener').innerHTML = cut
      ? '<span class="tag">' + escapeHtml(cut[1].toLowerCase()) + '</span><span class="opener-q">' + escapeHtml(cut[2]) + OVAL + '</span>'
      : escapeHtml(post);
    $('aOpener').classList.toggle('hidden', !TEST.news);

    $('aQuestion').textContent = s.question;

    var box = $('aOptions');
    box.innerHTML = '';

    /* Комментарии: без букв и без нумерации, порядок перемешан. Номер
       на плитке появляется только тот, который ставит сам человек. */
    state.shuffled[s.id].forEach(function (optId) {
      var opt = s.options.filter(function (o) { return o.id === optId; })[0];
      var rank = state.order[s.id].indexOf(optId);

      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt' + (rank >= 0 ? ' is-ranked' : '');
      btn.setAttribute('aria-pressed', rank >= 0 ? 'true' : 'false');

      var badge = document.createElement('span');
      badge.className = 'opt-rank';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = rank >= 0 ? String(rank + 1) : '';

      var text = document.createElement('span');
      text.className = 'opt-text';
      text.textContent = opt.text;

      if (rank >= 0) {
        var note = document.createElement('span');
        note.className = 'opt-note';
        note.textContent = rank === 0
          ? 'написали бы сами'
          : 'место ' + (rank + 1) + ' — нажмите ещё раз, чтобы снять';
        text.appendChild(note);
      }

      btn.appendChild(badge);
      btn.appendChild(text);
      btn.dataset.opt = optId;
      btn.addEventListener('click', function () { tap(s.id, optId); });

      li.appendChild(btn);
      box.appendChild(li);
    });

    renderFree(s);
    updateNav();

    // после перерисовки возвращаем фокус на нажатую реплику: иначе клавиатура
    // после каждого выбора откатывается в начало списка
    if (focusOptId) {
      var back = box.querySelector('[data-opt="' + focusOptId + '"]');
      if (back) back.focus();
    }

    renderProgress();
  }

  /* Свой комментарий. Обычно появляется, когда расстановка собрана целиком.
     В ветке, где он стоит «до» (freeBefore), — наоборот: сначала свой ответ,
     и только потом чужие комментарии, чтобы готовые ходы не подсказали его. */
  function freeFirstPending(s) {
    var q = freeOf(s);
    return !!q && !!s.freeBefore && !(state.sent || {})[q.id];
  }

  function renderFree(s) {
    var q = freeOf(s);
    $((q && s.freeBefore) ? 'aFreeBefore' : 'aFreeAfter').appendChild($('aFree'));
    $('aRank').classList.toggle('hidden', freeFirstPending(s));

    var openNow = !!q && (s.freeBefore || rankingDone(s));
    var wasHidden = $('aFree').classList.contains('hidden');

    $('aFree').classList.toggle('hidden', !openNow);
    if (!openNow) return;

    // Ответ «до расстановки» отправляется кнопкой и после этого не правится:
    // иначе его можно переписать, подсмотрев комментарии ветки.
    var sendable = !!s.freeBefore;
    var sent = sendable && !!(state.sent || {})[q.id];
    $('aFreeSend').classList.toggle('hidden', !sendable || sent);
    $('aFreeSent').classList.toggle('hidden', !sent);
    $('aFreeText').readOnly = sent;

    $('aFreeQ').textContent = q.text;
    var answering = !$('aFreeText').readOnly && countWords(state.answers[q.id] || '') < CONFIG.minWords;
    // подчёркивание «ручкой» — на том, на что человек сейчас отвечает: свой комментарий ещё не написан
    // длинный вопрос — подчёркнута только цель; короткий — целиком
    if (answering) {
      var goal = q.text.match(/цель — [^.?]+/);
      var mark = goal ? goal[0] : (q.text.length < 80 ? q.text : '');
      var i = mark ? q.text.indexOf(mark) : -1;
      if (i >= 0) $('aFreeQ').innerHTML = escapeHtml(q.text.slice(0, i)) + '<span class="pen">' + escapeHtml(mark) + '</span>' + escapeHtml(q.text.slice(i + mark.length));
    }
    if ($('aFreeText').value !== (state.answers[q.id] || '')) {
      $('aFreeText').value = state.answers[q.id] || '';
    }
    updateCount(q);

    if (wasHidden) {
      // вопрос только что появился — время идёт уже ему, а не расстановке
      if (state.openStep !== q.id) markStep(q.id);
      $('aFree').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function updateCount(q) {
    var n = countWords($('aFreeText').value);
    var ok = n >= CONFIG.minWords;
    $('aFreeCount').innerHTML = '<b>' + n + '</b> ' + wordForm(n);
    $('aFreeCount').classList.toggle('is-ok', ok);
    var before = !!currentSituation().freeBefore;
    $('aFreeTarget').textContent = ok ? (before ? 'Достаточно — можно отправлять.' : 'Достаточно, можно дальше.')
                                      : 'Минимум ' + CONFIG.minWords + ' слов.';
    $('aFreeSend').disabled = !ok;
  }

  /* Что сейчас мешает нажать «Дальше» — одной фразой под кнопкой. */
  function updateNav() {
    var s = currentSituation();
    var q = freeOf(s);
    var last = state.step === TEST.situations.length - 1;
    var words = q ? countWords(state.answers[q.id] || '') : 0;

    var ready = rankingDone(s) && (!q || words >= CONFIG.minWords);
    if (freeFirstPending(s)) {
      $('aNext').disabled = true;
      $('aNext').textContent = last ? 'Отправить' : 'Дальше';
      $('aBack').textContent = state.step === 0 ? 'К инструкции' : 'Назад';
      $('aNote').textContent = 'Сначала Ваш комментарий — минимум ' + CONFIG.minWords +
        ' слов, затем «Отправить комментарий». Потом откроются комментарии ветки.';
      return;
    }

    $('aNext').disabled = !ready;
    $('aNext').textContent = last ? 'Отправить' : 'Дальше';
    $('aBack').textContent = state.step === 0 ? 'К инструкции' : 'Назад';

    if (!rankingDone(s)) {
      $('aNote').textContent = 'Расставлено ' + ranked(s) + ' из ' + s.options.length;
    } else if (q && words < CONFIG.minWords) {
      $('aNote').textContent = 'Осталось написать ответ — минимум ' + CONFIG.minWords + ' слов';
    } else {
      $('aNote').textContent = last ? 'Готово — можно отправлять' : '';
    }
  }

  function tap(situationId, optId) {
    var picked = state.order[situationId];
    var at = picked.indexOf(optId);
    if (at >= 0) picked.splice(at, 1);   // повторный тап снимает, остальные подтягиваются
    else picked.push(optId);
    save();
    renderSituation(optId);
  }

  function goTo(step) {
    state.step = step;
    save();
    var s = currentSituation();
    var q = freeOf(s);
    // время идёт тому, что человек сейчас делает: расстановке или своему ответу
    markStep(q && (s.freeBefore ? freeFirstPending(s) : rankingDone(s)) ? q.id : s.id);
    show('screenA');
    renderSituation();
  }

  function initSituation() {
    $('aFreeText').addEventListener('input', function () {
      var q = freeOf(currentSituation());
      if (!q) return;
      if ($('aFreeText').readOnly) return;
      state.answers[q.id] = $('aFreeText').value;
      save();
      updateCount(q);
      updateNav();
    });

    $('aFreeSend').addEventListener('click', function () {
      var s = currentSituation();
      var q = freeOf(s);
      if (!q || countWords(state.answers[q.id] || '') < CONFIG.minWords) return;
      if (!state.sent) state.sent = {};
      state.sent[q.id] = true;
      save();
      markStep(s.id);          // дальше время идёт расстановке
      renderSituation();
      $('aRank').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    $('aNext').addEventListener('click', function () {
      if (state.step < TEST.situations.length - 1) goTo(state.step + 1);
      else submit();
    });

    $('aBack').addEventListener('click', function () {
      if (state.step === 0) { markStep('intro'); showIntro(); return; }
      goTo(state.step - 1);
    });
  }

  /* ---------- отправка ---------- */

  function submit() {
    markStep(null);
    $('aErr').classList.add('hidden');
    show('screenWait');

    var notes = ['Считаем расстановки…', 'Читаем ваши ответы…', 'Собираем карту…'];
    var i = 0;
    var tick = setInterval(function () {
      i = (i + 1) % notes.length;
      $('waitNote').textContent = notes[i];
    }, 4000);

    API.submit({
      code: state.code,
      stage: state.stage,
      testId: state.testId,
      orderings: state.order,
      answers: state.answers,
      participant: state.participant,
      submissionId: state.submissionId,
      durationSec: Math.round((Date.now() - state.startedAt) / 1000),
      times: state.times
    }).then(function (res) {
      clearInterval(tick);
      try { sessionStorage.removeItem(STORE); } catch (e) {}
      rememberResult(state.code, res.rowId);
      renderMap(res);
      showKeepLink(res.rowId);
      show('screenMap');
    }).catch(function (err) {
      clearInterval(tick);
      show('screenA');
      renderSituation();
      $('aErr').textContent = 'Не удалось отправить — ' + err.message +
        '. Ваши ответы сохранены, нажмите «Отправить» ещё раз. Повторная отправка не создаст дубль.';
      $('aErr').classList.remove('hidden');
    });
  }

  /* ---------- карта ----------
     Одна общая шкала на все пять навыков. Ни чисел, ни названий ступеней:
     это результат, а не кухня оценки. Механика — под «подробнее». */

  /* Сводит навык к одному положению 0…1 на общей шкале.

     ⚠ ЭТО ОГРУБЛЕНИЕ, И ОНО МОЁ. Правила дают по навыку разные величины: у
     Анализа контекста расстановка по двум новостям (0–6), у остальных по одной
     (0–3), и у четырёх сверх того уровень свободного ответа L1–L5. Общей шкалы
     правила не задают. Здесь обе части нормируются в 0…1 и усредняются с равным
     весом, у Анализа контекста часть одна. Тест короткий, картина заведомо
     приблизительная — вес и способ сведения правятся здесь, одним местом. */
  function combined(sk) {
    var parts = [sk.max ? sk.score / sk.max : 0];
    if (sk.level) parts.push((sk.level - 1) / 4);
    var sum = 0;
    for (var i = 0; i < parts.length; i++) sum += parts[i];
    return sum / parts.length;
  }

  function renderMap(res) {
    /* Строку сравнения считает бэкенд по правилам: зона «выбирает» и уровень
       свободного ответа не выше 2. Фронт только показывает. */
    var gaps = res.map.gaps || [];

    var rows = res.map.skills.map(function (sk) {
      return { name: sk.name, value: combined(sk), lag: gaps.indexOf(sk.name) >= 0, raw: sk };
    });

    $('mapLead').textContent = leadText(rows);
    var h = document.querySelector('#screenMap .screen-h');
    if (h && !h.parentNode.classList.contains('pattern')) {
      var wrap = document.createElement('div');
      wrap.className = 'pattern';
      h.parentNode.insertBefore(wrap, h);
      wrap.appendChild(h);
      wrap.insertAdjacentHTML('afterbegin', '<i style="right:0;top:-8px;width:22%"></i><i style="left:34%;top:22px;width:18%"></i>');
    }
    // сильнейший навык подчёркнут «ручкой»
    var top = rows.slice().sort(function (x, y) { return y.value - x.value; })[0];
    var name = top ? top.name.toLowerCase() : '';
    var lead = $('mapLead'), txt = lead.textContent, at = name ? txt.indexOf(name) : -1;
    if (at >= 0) {
      lead.innerHTML = escapeHtml(txt.slice(0, at)) + '<span class="pen">' + escapeHtml(name) + '</span>' + escapeHtml(txt.slice(at + name.length));
    }

    var box = $('mapProfile');
    box.innerHTML = '';
    var note = document.createElement('p');
    note.className = 'scale-note';
    if (res.legacy) {
      // Карта из первой версии теста: там другая шкала, полосы по нынешней были бы враньём.
      $('mapLead').textContent = 'Это карта из первой версии теста.';
      note.textContent = 'Полосы для неё не строятся: в той версии была другая шкала. Ниже — что было видно по вашим ответам.';
    } else {
      rows.forEach(function (r) { box.appendChild(profileRow(r)); });
      note.textContent = 'Шкала одна на все навыки: чем длиннее полоса, тем увереннее навык проявился.';
    }
    box.appendChild(note);

    if (gaps.length) {
      $('gapLine').innerHTML = '<b>В тесте выше, чем в своих ответах.</b> Сильные ходы Вы ' +
        'узнаёте — ' + escapeHtml(list(gaps.map(lower))) + ' — а в своих ответах их не сделали.';
      $('gapLine').classList.remove('hidden');
    } else {
      $('gapLine').classList.add('hidden');
    }

    renderReport(res);
  }

  function lower(s) { return String(s).toLowerCase(); }

  /* Две фразы вместо объяснения шкалы: их читают, объяснение — нет.
     Края берутся по той же общей шкале, что и полосы. */
  function leadText(rows) {
    var sorted = rows.slice().sort(function (a, b) { return b.value - a.value; });
    var top = sorted[0], bottom = sorted[sorted.length - 1];

    if (top.value - bottom.value < 0.15) {
      return 'Все пять навыков проявились примерно одинаково.';
    }

    var high = sorted.filter(function (r) { return r.value >= top.value - 0.01; });
    var low = sorted.filter(function (r) { return r.value <= bottom.value + 0.01; });

    return 'Выше всего — ' + list(high.map(function (r) { return lower(r.name); })) + '. ' +
           'Ниже всего — ' + list(low.map(function (r) { return lower(r.name); })) + '.';
  }

  function profileRow(r) {
    var row = document.createElement('div');
    row.className = 'prow';

    var name = document.createElement('span');
    name.className = 'prow-name';
    name.textContent = r.name;
    row.appendChild(name);

    var track = document.createElement('span');
    track.className = 'ptrack';
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', r.name + ': ' + Math.round(r.value * 100) + ' из 100 по общей шкале');
    var fill = document.createElement('i');
    // минимум видимой полосы: нулевая длина читается как «не посчитали»
    fill.style.width = Math.max(3, Math.round(r.value * 100)) + '%';
    track.appendChild(fill);
    row.appendChild(track);

    if (r.lag) {
      var lag = document.createElement('span');
      lag.className = 'prow-lag';
      lag.textContent = 'в тесте выше, чем в своих ответах';
      row.appendChild(lag);
    }

    return row;
  }

  /* Что человек различает в расстановке — одна фраза по зоне навыка.
     Тексты пересказывают сквозные лестницы методологии простыми словами:
     какой комментарий человек ставит первым. Слово «различаете», а не
     «умеете»: расстановка показывает узнавание чужого сильного хода. */
  var RECOGNITION = {
    context: [
      ['Вам ближе комментарии, которые называют одну причину.',
       'Сильнее те, что показывают, как причины тянут друг друга.'],
      ['Широкий разбор Вы замечаете, но иногда ставите выше перечень причин.',
       'Сильнее не тот, кто назвал больше причин, а тот, кто показал их связь.'],
      ['Вы узнаёте разбор, который смотрит дальше новости и связывает причины в цепочку.', '']
    ],
    alt: [
      ['Вам ближе решения из привычной практики своей отрасли.',
       'Сильнее ходы, взятые из других отраслей, — особенно когда понятно, почему они там сработали.'],
      ['Чужой опыт Вы цените, но копию не всегда отличаете от осмысленного переноса.',
       'Сильнее перенос, который объясняет, за счёт чего ход работает и что пришлось поменять.'],
      ['Вы узнаёте ход, взятый из другой отрасли с пониманием, почему он там работает.', '']
    ],
    prio: [
      ['Вам ближе выбор, объяснённый одним фактом.',
       'Сильнее выбор, объяснённый целью, — и ещё сильнее, когда названо, чем жертвуют.'],
      ['Выбор через цель Вы видите, но не всегда отличаете его от сравнения вариантов с названной ценой.',
       'Сильнее выбор, где варианты сравнили и честно назвали, от чего отказались.'],
      ['Вы узнаёте выбор, за которым стоит правило и честно названная жертва.', '']
    ],
    future: [
      ['Вам ближе одно уверенное будущее.',
       'Сильнее взгляд, где будущих несколько и их разводит то, что случится вокруг компании.'],
      ['Несколько исходов Вы видите, но не всегда замечаете, что именно их разводит.',
       'Сильнее, когда исходы зависят не от успеха компании, а от того, что произойдёт вокруг неё.'],
      ['Вы узнаёте взгляд, где будущее разводит внешняя неопределённость, а не успех компании.', '']
    ],
    path: [
      ['Вам ближе честное снижение цели под ограничения.',
       'Сильнее ходы, где цель остаётся, а под каждый барьер находится свой ресурс.'],
      ['Ресурсы под барьеры Вы видите, но не всегда отличаете это от простого «цель держим».',
       'Сильнее, когда к каждому барьеру подобран конкретный ресурс — или барьер перестаёт быть барьером.'],
      ['Вы узнаёте ход, где ограничение перестаёт быть стеной, а цель остаётся прежней.', '']
    ]
  };

  /* Блок отчёта с подписанными частями: «В тесте» — что выбираете и на что
     обратить внимание; «В ответе» — сильная сторона и что сделать лучше.
     Пустые части не выводятся. */
  function repBlock(tag, parts, open) {
    var box = document.createElement('div');
    box.className = 'rep-line' + (open ? ' is-open' : '');
    var t = document.createElement('span');
    t.className = 'rep-tag';
    t.textContent = tag;
    box.appendChild(t);
    parts.forEach(function (pt) {
      if (!pt[1]) return;
      var p = document.createElement('p');
      p.className = 'rep-part';
      if (pt[0]) {
        var b = document.createElement('span');
        // подпись части — голубым текстовыделителем, как теги в брендбуке
        b.className = 'tag';
        b.textContent = pt[0];
        p.appendChild(b);
        p.appendChild(document.createElement('br'));
      }
      p.appendChild(document.createTextNode(pt[1]));
      box.appendChild(p);
    });
    return box;
  }

  function repLine(tag, text, open) {
    var p = document.createElement('p');
    p.className = 'rep-line' + (open ? ' is-open' : '');
    var t = document.createElement('span');
    t.className = 'rep-tag';
    t.textContent = tag;
    p.appendChild(t);
    p.appendChild(document.createTextNode(text));
    return p;
  }

  /* «О чём этот навык» — тексты методолога по каждой способности навыка,
     дословно из spec/тексты_отчёта_Кати.md. Свёрнуто: отчёт остаётся
     коротким, а смысл навыка под рукой. */
  function aboutBlock(sk) {
    // строка карты несёт только способность; состав навыка — в конфиге
    var def = CONFIG.skills.filter(function (x) { return x.id === sk.id; })[0] || {};
    var codes = (def.factors || []).slice();
    if (def.ability) codes.push(def.ability);
    var items = (CONFIG.subskills || []).filter(function (s) { return codes.indexOf(s.id) >= 0; });
    if (!items.length) return null;
    var d = document.createElement('details');
    d.className = 'rep-about';
    var s = document.createElement('summary');
    s.textContent = 'О чём этот навык';
    d.appendChild(s);
    items.forEach(function (it) {
      var p = document.createElement('p');
      var b = document.createElement('b');
      b.textContent = it.name + '. ';
      p.appendChild(b);
      p.appendChild(document.createTextNode(it.about));
      d.appendChild(p);
    });
    return d;
  }

  /* «Как тренировать» — закреплённая страница методолога, под припиской. */
  function renderTraining() {
    var box = $('mapTrain');
    if (!box || !CONFIG.training || !CONFIG.training.items) return;
    box.innerHTML = '';
    var k = document.createElement('p');
    k.className = 'kicker';
    k.textContent = 'Как тренировать';
    box.appendChild(k);
    var ul = document.createElement('ul');
    CONFIG.training.items.forEach(function (it) {
      var li = document.createElement('li');
      var b = document.createElement('b');
      b.textContent = it.name;
      li.appendChild(b);
      li.appendChild(document.createTextNode(' — ' + it.text));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    if (CONFIG.training.site) {
      var a = document.createElement('a');
      a.href = 'https://' + CONFIG.training.site;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = CONFIG.training.site;
      box.appendChild(a);
    }
  }

  /* Отчёт: по каждому навыку не больше двух строк. Уровней и кодов нет. */
  function renderReport(res) {
    var box = $('mapReport');
    box.innerHTML = '';
    renderTraining();
    var judged = res.judge_status === 'ok';

    res.map.skills.forEach(function (sk) {
      var wrap = document.createElement('div');
      wrap.className = 'skill';
      var name = document.createElement('div');
      name.className = 'skill-name';
      name.textContent = sk.name;
      wrap.appendChild(name);
      var about = aboutBlock(sk);
      if (about) wrap.appendChild(about);

      var zi = (typeof sk.zoneIndex === 'number') ? sk.zoneIndex : CONFIG.zones.indexOf(sk.zone);
      if (RECOGNITION[sk.id] && zi >= 0) {
        wrap.appendChild(repBlock('В тесте', [
          ['Что Вы выбираете', RECOGNITION[sk.id][zi][0]],
          ['На что обратить внимание', RECOGNITION[sk.id][zi][1]]
        ]));
      }

      if (sk.ability) {
        if (!judged) {
          wrap.appendChild(repLine('В ответе',
            'Оценка ответа не получена. Расстановка и текст сохранены, ведущий может запросить разбор повторно.', true));
        } else if (sk.review) {
          wrap.appendChild(repLine('В ответе', 'Уточняется. ' + (sk.takeaway || ''), true));
        } else if (sk.has || sk.next) {
          wrap.appendChild(repBlock('В ответе', [
            ['Сильная сторона', sk.has],
            ['Что можно сделать лучше', sk.next]
          ]));
        } else if (sk.takeaway || sk.why) {
          // строки, записанные до разделения на две части
          wrap.appendChild(repLine('В ответе', sk.takeaway || sk.why));
        }
      }
      box.appendChild(wrap);
    });
  }

  /* ---------- возврат к своей карте ---------- */

  function resultLink(rowId) {
    return location.origin + location.pathname + '?r=' + encodeURIComponent(rowId);
  }

  function rememberResult(code, rowId) {
    try {
      var all = JSON.parse(localStorage.getItem(RESULTS) || '{}');
      all[code] = rowId;
      localStorage.setItem(RESULTS, JSON.stringify(all));
    } catch (e) {}
  }

  function recallResult(code) {
    try { return (JSON.parse(localStorage.getItem(RESULTS) || '{}'))[code] || ''; }
    catch (e) { return ''; }
  }

  function showKeepLink(rowId) {
    if (!rowId) { $('keepBox').classList.add('hidden'); return; }
    var link = resultLink(rowId);
    $('keepLink').textContent = link;
    $('keepBox').classList.remove('hidden');
    $('keepCopy').onclick = function () {
      navigator.clipboard.writeText(link).then(function () {
        $('keepCopy').textContent = 'Скопировано';
        setTimeout(function () { $('keepCopy').textContent = 'Скопировать ссылку'; }, 1600);
      }).catch(function () { $('keepCopy').textContent = 'Скопируйте вручную'; });
    };
  }

  function openResult(rowId) {
    show('screenWait');
    $('waitNote').textContent = 'Открываем вашу карту…';
    API.ready()
      .then(function () { return API.result(rowId); })
      .then(function (res) {
        renderMap(res);
        showKeepLink(rowId);
        show('screenMap');
      })
      .catch(function (err) {
        show('screenEnter');
        $('enterErr').textContent =
          err.message === 'no_result' ? 'Такой карты нет. Проверьте ссылку.' :
          err.message === 'old_test' ? 'Эта карта от прежней версии теста — открыть её больше нельзя.' :
          ('Не удалось открыть карту: ' + err.message);
        $('enterErr').classList.remove('hidden');
      });
  }

  /* ---------- старт ---------- */

  /* Карта на выдуманных данных: index.html?demo=1
     Чтобы посмотреть или показать группе результат, не проходя тест целиком.
     Данные подобраны так, чтобы были видны все состояния: верх, низ, строка
     сравнения и «уточняется». */
  function demoMap() {
    function row(id, name, score, max, ability, level, has, next) {
      return { id: id, name: name, score: score, max: max,
               zoneIndex: max === 6 ? (score <= 2 ? 0 : score <= 4 ? 1 : 2)
                                    : (score === 0 ? 0 : score <= 2 ? 1 : 2),
               zone: '', ability: ability, level: level, review: false,
               flag: false, quote: '', has: has || '', next: next || '',
               takeaway: [has, next].filter(Boolean).join(' '), why: '' };
    }
    var skills = [
      row('context', 'Анализ контекста', 5, 6, null, null),
      row('alt', 'Генерация альтернатив', 3, 3, 'ГА-1', 2,
          'Вы добавили свой ход поверх предложенных в ветке.',
          'Сравните его хотя бы с одним другим путём, который придумаете сами.'),
      row('prio', 'Приоритизация', 2, 3, 'ПР-1', 4,
          'Вы сформулировали правило, по которому будете отказываться от инициатив.',
          'Назовите, что этот отказ освобождает и куда это пойдёт.'),
      row('future', 'Картина будущего', 3, 3, 'МК-1', 3,
          'Вы называете новое место компании на рынке.',
          'Покажите, меняется ли при этом сам способ зарабатывать и чем компания за это платит.'),
      row('path', 'Путь к цели', 1, 3, 'ПП-1', 2,
          'Ваши шаги ведут к цели, которую поставили в вопросе.',
          'Покажите, какой шаг открывает следующий и по какому результату это видно.')
    ];
    skills.forEach(function (sk) { sk.zone = CONFIG.zones[sk.zoneIndex]; });
    return {
      judge_status: 'ok',
      map: { skills: skills, perSituation: {}, gaps: ['Генерация альтернатив'], extra: [] }
    };
  }

  function init() {
    var params = new URLSearchParams(location.search);

    // своя карта по ссылке: index.html?r=<row_id>
    if (params.get('r')) { openResult(params.get('r')); return; }

    // показательная карта: index.html?demo=1
    if (params.has('demo')) {
      renderMap(demoMap());
      show('screenMap');
      return;
    }

    initEnter();
    initSituation();

    $('nameInput').addEventListener('input', function () {
      state.participant = $('nameInput').value.trim();
      save();
      $('introBtn').disabled = state.identify && !state.participant;
    });

    $('introBtn').addEventListener('click', function () { goTo(state.step); });

    /* Сохранённый прогон и ссылка с кодом могут спорить: человек не дошёл
       до конца, а потом в той же вкладке открыл ссылку на другую сессию.
       Побеждает ссылка — это осознанное действие, а прогон мог остаться
       от кого-то другого на общем устройстве. Раньше оба запускались разом
       и гонка оставляла пустой экран. */
    var fromUrl = codeFromUrl();
    var есть = restore();

    if (есть && fromUrl && fromUrl !== state.code) {
      try { sessionStorage.removeItem(STORE); } catch (e) {}
      есть = false;
      state.order = {};
      state.shuffled = {};
      state.answers = {};
      state.times = {};
      state.step = 0;
    }

    if (есть) {
      // возврат после случайного обновления страницы: тест грузим заново
      API.ready()
        .then(function () { return API.loadTest(state.testId); })
        .then(function (test) {
          TEST = test;
          show('screenA');
          renderSituation();
        })
        .catch(function () { show('screenEnter'); });
      return;
    }

    show('screenEnter');
    if (fromUrl) startWithCode(fromUrl);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
