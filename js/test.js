/* Экраны участника: вход → 6 ситуаций → ожидание → карта.

   Свободные вопросы живут внутри ситуаций 5 и 6, отдельного экрана у них нет:
   человек отвечает, не выходя из кейса, который только что прочитал.

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
    step: 0,            // индекс ситуации, 0…5
    order: {},          // id ситуации → id реплик в порядке расстановки
    shuffled: {},       // id ситуации → порядок показа реплик
    answers: {},        // q1 / q2 → текст
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
    return String(s).replace(/[&<>"]/g, function (c) {
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

    // код из ссылки: index.html?s=КОД
    var fromUrl = new URLSearchParams(location.search).get('s');
    if (fromUrl) {
      input.value = normalize(fromUrl);
      btn.disabled = input.value.length !== 6;
      if (input.value.length === 6) $('enterForm').requestSubmit();
    }
  }

  function showIntro() {
    $('introText').textContent = TEST.intro;
    $('nameBox').classList.toggle('hidden', !state.identify);
    if (state.identify) {
      $('nameInput').value = state.participant || '';
      $('introBtn').disabled = !$('nameInput').value.trim();
    }
    show('screenIntro');
  }

  /* ---------- ситуация ---------- */

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

  function renderSituation(focusOptId) {
    var s = currentSituation();
    if (!state.shuffled[s.id]) {
      state.shuffled[s.id] = shuffle(s.options.map(function (o) { return o.id; }));
    }
    if (!state.order[s.id]) state.order[s.id] = [];

    $('aFactor').textContent = 'Ситуация ' + (state.step + 1) + ' из ' + TEST.situations.length;

    // пост — абзацами, как в спеке
    var post = $('aCase');
    post.innerHTML = '';
    s.post.forEach(function (para) {
      var p = document.createElement('p');
      p.style.margin = '0 0 12px';
      p.textContent = para;
      post.appendChild(p);
    });

    $('aQuestion').textContent = s.question;

    var box = $('aOptions');
    box.innerHTML = '';

    /* Реплики — комментарии: без букв и без нумерации, порядок перемешан.
       Номер на плитке появляется только тот, который ставит сам человек. */
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
          ? 'подписались бы'
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

  /* Свободный вопрос появляется, когда расстановка собрана целиком —
     так задано правилами: «сразу после расстановки». */
  function renderFree(s) {
    var q = freeOf(s);
    var openNow = !!q && rankingDone(s);
    var wasHidden = $('aFree').classList.contains('hidden');

    $('aFree').classList.toggle('hidden', !openNow);
    if (!openNow) return;

    $('aFreeQ').textContent = q.text;
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
    $('aFreeTarget').textContent = ok ? 'Достаточно, можно дальше.'
                                      : 'Минимум ' + CONFIG.minWords + ' слов.';
  }

  /* Что сейчас мешает нажать «Дальше» — одной фразой под кнопкой. */
  function updateNav() {
    var s = currentSituation();
    var q = freeOf(s);
    var last = state.step === TEST.situations.length - 1;
    var words = q ? countWords(state.answers[q.id] || '') : 0;

    var ready = rankingDone(s) && (!q || words >= CONFIG.minWords);

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
    // возвращаемся в ситуацию с готовой расстановкой — время идёт вопросу
    markStep(q && rankingDone(s) ? q.id : s.id);
    show('screenA');
    renderSituation();
  }

  function initSituation() {
    $('aFreeText').addEventListener('input', function () {
      var q = freeOf(currentSituation());
      if (!q) return;
      state.answers[q.id] = $('aFreeText').value;
      save();
      updateCount(q);
      updateNav();
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
     Анализа контекста расстановка по двум ситуациям (0–6), у остальных по одной
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

    var box = $('mapProfile');
    box.innerHTML = '';
    rows.forEach(function (r) { box.appendChild(profileRow(r)); });

    var note = document.createElement('p');
    note.className = 'scale-note';
    note.textContent = 'Шкала одна на все навыки: чем длиннее полоса, тем увереннее навык ' +
      'проявился. Тест короткий, картина приблизительная — она показывает, где перепад, ' +
      'а не точное значение.';
    box.appendChild(note);

    if (gaps.length) {
      $('gapLine').innerHTML = '<b>В тесте выше, чем в своих ответах.</b> Сильные ходы вы ' +
        'узнаёте — ' + escapeHtml(list(gaps.map(lower))) + ' — а в своих ответах их не сделали.';
      $('gapLine').classList.remove('hidden');
    } else {
      $('gapLine').classList.add('hidden');
    }

    renderExtra(res.map.extra || []);

    var fb = $('feedbackBox');
    if (res.judge_status === 'ok' && res.feedback) {
      fb.className = 'read';
      fb.textContent = res.feedback;
    } else {
      fb.className = 'judge-fail';
      fb.textContent = 'Ваши ответы оценить не удалось. Расстановки посчитаны и сохранены, ' +
                       'тексты тоже сохранены — ведущий может запросить разбор повторно.';
    }

    renderDetails(res, rows);
  }

  /* Дополнительные способности: судья отмечает их только при явном маркере,
     на полосы они не влияют — так заданы правила. Поэтому отдельной строкой. */
  function renderExtra(extra) {
    var el = $('extraLine');
    if (!extra.length) { el.classList.add('hidden'); return; }

    var names = [];
    extra.forEach(function (e) {
      var name = skillNameByFactor(e.code);
      if (name && names.indexOf(name) < 0) names.push(name);
    });
    if (!names.length) { el.classList.add('hidden'); return; }

    el.innerHTML = '<p class="kicker" style="margin-bottom:6px">Подтверждено текстом</p>' +
      '<p style="margin:0">Это вы показали не только расстановкой, но и своими словами: ' +
      escapeHtml(list(names.map(lower))) + '.</p>';
    el.classList.remove('hidden');
  }

  function skillNameByFactor(code) {
    for (var i = 0; i < CONFIG.skills.length; i++) {
      if (CONFIG.skills[i].factors.indexOf(code) >= 0) return CONFIG.skills[i].name;
    }
    return '';
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

  /* Подробности: всё, из чего сложилась полоса. Свёрнуто по умолчанию. */
  function renderDetails(res, rows) {
    var box = $('mapDetails');
    box.innerHTML = '';

    var intro = document.createElement('p');
    intro.className = 'util read';
    intro.textContent = 'Полоса выше сводит две разные величины в одну шкалу. Тест — ' +
      'как вы различаете силу готовых реплик; зоны и шкалы для него заданы методикой. ' +
      'Свои ответы — что из этого вы сделали сами, уровнями от 1 до 5. Разбор ниже — ' +
      'по вашим ответам.';
    box.appendChild(intro);

    /* Баллов расстановки здесь нет: это внутренний счёт, человеку он ничего
       не говорит. Навыки без разбора свободного ответа не показываем вовсе —
       пустая строка читалась бы как поломка. */
    rows.filter(function (r) { return r.raw.ability; }).forEach(function (r) {
      var sk = r.raw;
      var wrap = document.createElement('div');
      wrap.className = 'skill';

      var name = document.createElement('div');
      name.className = 'skill-name';
      name.textContent = sk.name;
      wrap.appendChild(name);

      var b = document.createElement('p');
      b.className = 'skill-b';
      if (sk.level) {
        b.innerHTML = levelDots(sk.level) + 'уровень <b>' + sk.level + '</b> из 5';
        if (sk.why) b.innerHTML += '<br /><span class="util">' + escapeHtml(sk.why) + '</span>';
      } else {
        b.innerHTML = '<span class="util">оценка не получена</span>';
      }
      wrap.appendChild(b);

      box.appendChild(wrap);
    });
  }

  function levelDots(level) {
    var out = '<span class="lvl" aria-hidden="true">';
    for (var i = 1; i <= 5; i++) out += '<i class="' + (i <= level ? 'on' : '') + '"></i>';
    return out + '</span>';
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
        $('enterErr').textContent = err.message === 'no_result'
          ? 'Такой карты нет. Проверьте ссылку.'
          : ('Не удалось открыть карту: ' + err.message);
        $('enterErr').classList.remove('hidden');
      });
  }

  /* ---------- старт ---------- */

  /* Карта на выдуманных данных: index.html?demo=1
     Чтобы посмотреть или показать группе результат, не проходя тест целиком.
     Данные подобраны так, чтобы были видны все состояния: верх, низ, строка
     сравнения и строка «подтверждено текстом». */
  function demoMap() {
    function row(id, name, score, max, ability, level, why) {
      return { id: id, name: name, score: score, max: max,
               zoneIndex: max === 6 ? (score <= 2 ? 0 : score <= 4 ? 1 : 2)
                                    : (score === 0 ? 0 : score <= 2 ? 1 : 2),
               zone: '', ability: ability, level: level, flag: false, quote: '', why: why };
    }
    var skills = [
      row('context', 'Анализ контекста', 5, 6, null, null, ''),
      row('alt', 'Генерация альтернатив', 3, 3, 'ГА-1', 2,
          'Уровень 2 пройден: вы добавили новый элемент. Уровень 3 нет: другой стратегической альтернативы вы не предложили.'),
      row('prio', 'Приоритизация', 2, 3, 'ПР-1', 4,
          'Уровень 4 пройден: вы сформулировали отказ как правило. Уровень 5 нет: вы не назвали, какой ресурс высвобождается и куда идёт.'),
      row('future', 'Картина будущего', 3, 3, 'МК-1', 3,
          'Уровень 3 пройден: вы назвали новое положение на рынке с горизонтом. Уровень 4 нет: смены модели в тексте не видно.'),
      row('path', 'Путь к цели', 1, 3, 'ПП-1', 2,
          'Уровень 2 пройден: одно ваше действие привязано к цели. Уровень 3 нет: этапы не выстроены от цели.')
    ];
    skills.forEach(function (sk) {
      sk.zone = CONFIG.zones[sk.zoneIndex];
    });
    return {
      judge_status: 'ok',
      feedback: 'Это показательная карта на выдуманных ответах — она нужна, чтобы посмотреть ' +
                'на результат, не проходя тест. Настоящую обратную связь пишет судья по вашему тексту.',
      map: { skills: skills, perSituation: {}, gaps: ['Генерация альтернатив'],
             extra: [{ code: 'АК-1', level: 4, quote: '' }] }
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

    if (restore()) {
      // возврат после случайного обновления страницы: тест грузим заново
      API.ready()
        .then(function () { return API.loadTest(state.testId); })
        .then(function (test) {
          TEST = test;
          show('screenA');
          renderSituation();
        })
        .catch(function () { show('screenEnter'); });
    } else {
      show('screenEnter');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
