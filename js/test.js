/* Экраны участника: вход → блок А → блок Б → ожидание → карта. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var TOTAL = TEST.blockA.length + 1;      // шесть ситуаций + блок Б
  var STORE = 'bt_progress_v1';

  var state = {
    code: '',
    stage: 'baseline',
    step: 0,            // 0..5 — ситуации, 6 — блок Б
    order: {},          // id ситуации → массив id вариантов в порядке расстановки
    shuffled: {},       // id ситуации → порядок показа вариантов
    answer: '',
    startedAt: 0
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

  function countWords(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function show(id) {
    var screens = ['screenEnter', 'screenIntro', 'screenA', 'screenB', 'screenWait', 'screenMap'];
    for (var i = 0; i < screens.length; i++) {
      $(screens[i]).classList.toggle('hidden', screens[i] !== id);
    }
    var inTest = (id === 'screenA' || id === 'screenB');
    $('progress').classList.toggle('hidden', !inTest);
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
      if (!s || !s.code) return false;
      state = s;
      return true;
    } catch (e) { return false; }
  }

  /* ---------- прогресс ---------- */

  function renderProgress() {
    var seg = $('progressSeg');
    seg.innerHTML = '';
    for (var i = 0; i < TOTAL; i++) {
      var el = document.createElement('i');
      el.className = 'seg' + (i < state.step ? ' is-done' : i === state.step ? ' is-now' : '');
      seg.appendChild(el);
    }
    $('progressNum').textContent = (state.step + 1) + ' / ' + TOTAL;
  }

  /* ---------- вход ---------- */

  function initEnter() {
    var input = $('codeInput');
    var btn = $('enterBtn');

    function normalize(v) { return (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }

    input.addEventListener('input', function () {
      input.value = normalize(input.value);
      btn.disabled = input.value.length !== 6;
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
          state.stage = res.stage || 'baseline';
          state.startedAt = Date.now();
          save();
          show('screenIntro');
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

  /* ---------- блок А ---------- */

  function currentSituation() { return TEST.blockA[state.step]; }

  function renderSituation(focusOptId) {
    var s = currentSituation();
    if (!state.shuffled[s.id]) {
      state.shuffled[s.id] = shuffle(s.options.map(function (o) { return o.id; }));
    }
    if (!state.order[s.id]) state.order[s.id] = [];

    $('aFactor').textContent = 'Ситуация ' + (state.step + 1) + ' из ' + TEST.blockA.length;
    $('aCase').textContent = s.caseText;
    $('aQuestion').textContent = s.question;

    var list = $('aOptions');
    list.innerHTML = '';

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
        note.textContent = rank === 0 ? 'лучший' : 'место ' + (rank + 1) + ' — нажмите ещё раз, чтобы снять';
        text.appendChild(note);
      }

      btn.appendChild(badge);
      btn.appendChild(text);
      btn.dataset.opt = optId;
      btn.addEventListener('click', function () { tap(s.id, optId); });

      li.appendChild(btn);
      list.appendChild(li);
    });

    var done = state.order[s.id].length === s.options.length;
    $('aNext').disabled = !done;
    $('aNote').textContent = done
      ? 'Все пять расставлены'
      : 'Расставлено ' + state.order[s.id].length + ' из ' + s.options.length;
    $('aBack').textContent = state.step === 0 ? 'К инструкции' : 'Назад';

    // после перерисовки возвращаем фокус на нажатый вариант: иначе клавиатура
    // после каждого выбора откатывается в начало списка
    if (focusOptId) {
      var back = list.querySelector('[data-opt="' + focusOptId + '"]');
      if (back) back.focus();
    }

    renderProgress();
  }

  function tap(situationId, optId) {
    var picked = state.order[situationId];
    var at = picked.indexOf(optId);
    if (at >= 0) picked.splice(at, 1);   // повторный тап снимает, остальные подтягиваются
    else picked.push(optId);
    save();
    renderSituation(optId);
  }

  function initBlockA() {
    $('aNext').addEventListener('click', function () {
      state.step++;
      save();
      if (state.step < TEST.blockA.length) { show('screenA'); renderSituation(); }
      else { show('screenB'); renderBlockB(); }
    });

    $('aBack').addEventListener('click', function () {
      if (state.step === 0) { show('screenIntro'); return; }
      state.step--;
      save();
      show('screenA');
      renderSituation();
    });
  }

  /* ---------- блок Б ---------- */

  function renderBlockB() {
    $('bCase').textContent = TEST.blockB.caseText;
    $('bTask').textContent = TEST.blockB.task;
    $('bTarget').textContent = 'Ориентир — ' + TEST.blockB.targetFrom + '–' + TEST.blockB.targetTo +
                               ' слов, отправка открывается со ' + TEST.blockB.minWords + '.';
    $('bAnswer').value = state.answer || '';
    updateCount();
    renderProgress();
  }

  function updateCount() {
    var n = countWords($('bAnswer').value);
    var ok = n >= TEST.blockB.minWords;
    $('bCount').innerHTML = '<b>' + n + '</b> ' + wordForm(n);
    $('bCount').classList.toggle('is-ok', ok);
    $('bSend').disabled = !ok;
  }

  function wordForm(n) {
    var t = n % 100, o = n % 10;
    if (t >= 11 && t <= 14) return 'слов';
    if (o === 1) return 'слово';
    if (o >= 2 && o <= 4) return 'слова';
    return 'слов';
  }

  function initBlockB() {
    $('bAnswer').addEventListener('input', function () {
      state.answer = $('bAnswer').value;
      save();
      updateCount();
    });

    $('bBack').addEventListener('click', function () {
      state.step = TEST.blockA.length - 1;
      save();
      show('screenA');
      renderSituation();
    });

    $('bSend').addEventListener('click', submit);
  }

  /* ---------- отправка ---------- */

  function submit() {
    $('bErr').classList.add('hidden');
    show('screenWait');

    var notes = ['Считаем расстановку…', 'Читаем записку…', 'Собираем карту…'];
    var i = 0;
    var tick = setInterval(function () {
      i = (i + 1) % notes.length;
      $('waitNote').textContent = notes[i];
    }, 4000);

    API.submit({
      code: state.code,
      stage: state.stage,
      orderings: state.order,
      answerText: state.answer,
      durationSec: Math.round((Date.now() - state.startedAt) / 1000)
    }).then(function (res) {
      clearInterval(tick);
      try { sessionStorage.removeItem(STORE); } catch (e) {}
      renderMap(res);
      show('screenMap');
    }).catch(function (err) {
      clearInterval(tick);
      show('screenB');
      $('bErr').textContent = 'Не удалось отправить: ' + err.message + ' Ответ сохранён — попробуйте ещё раз.';
      $('bErr').classList.remove('hidden');
    });
  }

  /* ---------- карта ----------
     Наверху — две фразы и одна картина: где сильны, где нет. Числа, уровни
     и разбор гейтов — под «подробнее»: это кухня оценки, а не результат. */

  var BANDS = ['не видит', 'видит, путает', 'выбирает'];

  /* ⚠ Уровень записки L1–L5 сведён к трём ступеням расстановки, чтобы отставание
     можно было показать на одной картинке. Спека такого сведения не задаёт —
     это моё огрубление, и менять его методологу здесь, одним местом. */
  function levelBand(level) {
    if (!level) return null;
    if (level <= 2) return 0;
    if (level === 3) return 1;
    return 2;
  }

  function renderMap(res) {
    var rows = res.map.skills.map(function (sk) {
      return {
        name: sk.name,
        band: sk.zoneIndex,
        lag: sk.level ? (levelBand(sk.level) < sk.zoneIndex) : false,
        raw: sk
      };
    });

    $('mapLead').textContent = leadText(rows);

    var box = $('mapProfile');
    box.innerHTML = '';
    rows.forEach(function (r) { box.appendChild(profileRow(r)); });

    // «различаю, но не делаю» — вывод поперёк строк, поэтому отдельным блоком
    var gaps = res.map.gaps || [];
    if (gaps.length) {
      $('gapLine').innerHTML = '<b>Различаю, но не делаю.</b> Сильные ходы вы узнаёте — ' +
        escapeHtml(gaps.join(', ')) + ' — а в собственном тексте их не сделали.';
      $('gapLine').classList.remove('hidden');
    } else {
      $('gapLine').classList.add('hidden');
    }

    var fb = $('feedbackBox');
    if (res.judge_status === 'ok' && res.feedback) {
      fb.className = 'read';
      fb.textContent = res.feedback;
    } else {
      fb.className = 'judge-fail';
      fb.textContent = 'Записку оценить не удалось. Расстановка посчитана и сохранена, ' +
                       'текст тоже сохранён — ведущий может запросить разбор повторно.';
    }

    renderDetails(res, rows);
  }

  /* Две фразы вместо шапки-объяснения: их читают, объяснение шкалы — нет. */
  function leadText(rows) {
    var strong = rows.filter(function (r) { return r.band === 2; }).map(nameOf);
    var weak = rows.filter(function (r) { return r.band === 0; }).map(nameOf);
    var parts = [];

    if (strong.length) parts.push('Сильнее всего — ' + list(strong) + '.');
    if (weak.length) parts.push((strong.length ? 'Слабее' : 'Слабее всего') + ' — ' + list(weak) + '.');
    if (!parts.length) parts.push('Выраженных краёв нет: все пять навыков в середине.');

    return parts.join(' ');
  }

  function nameOf(r) { return r.name.toLowerCase(); }

  function list(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(', ') + ' и ' + items[items.length - 1];
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
    track.setAttribute('aria-label', r.name + ': ' + BANDS[r.band]);
    for (var i = 0; i < 3; i++) {
      var seg = document.createElement('i');
      seg.className = i < r.band ? 'is-passed' : (i === r.band ? 'is-here' : '');
      track.appendChild(seg);
    }
    row.appendChild(track);

    var word = document.createElement('span');
    word.className = 'prow-word' + (r.band === 0 ? ' is-low' : '');
    word.textContent = BANDS[r.band];
    row.appendChild(word);

    // приписка только там, где записка отстала: пустая строка читалась бы как поломка
    if (r.lag) {
      var lag = document.createElement('span');
      lag.className = 'prow-lag';
      lag.textContent = 'в собственном тексте — ниже';
      row.appendChild(lag);
    }

    return row;
  }

  /* Подробности: всё, что раньше стояло наверху. Свёрнуто по умолчанию. */
  function renderDetails(res, rows) {
    var box = $('mapDetails');
    box.innerHTML = '';

    var intro = document.createElement('p');
    intro.className = 'util read';
    intro.textContent = 'Расстановка — как вы различаете силу готовых ответов. ' +
      'Записка — что из этого вы сделали сами, когда готовых ответов не было.';
    box.appendChild(intro);

    rows.forEach(function (r) {
      var sk = r.raw;
      var wrap = document.createElement('div');
      wrap.className = 'skill';

      var top = document.createElement('div');
      top.className = 'skill-top';

      var name = document.createElement('span');
      name.className = 'skill-name';
      name.textContent = sk.name;

      var score = document.createElement('span');
      score.className = 'skill-score';
      score.textContent = 'расстановка ' + sk.score + ' из ' + sk.max + ' · ' + sk.zone;

      top.appendChild(name);
      top.appendChild(score);
      wrap.appendChild(top);

      if (sk.ability) {
        var b = document.createElement('p');
        b.className = 'skill-b';
        if (sk.level) {
          b.innerHTML = levelDots(sk.level) + 'записка — уровень <b>L' + sk.level + '</b>';
          if (sk.why) b.innerHTML += '<br /><span class="util">' + escapeHtml(sk.why) + '</span>';
        } else {
          b.innerHTML = '<span class="util">записка — оценка не получена</span>';
        }
        wrap.appendChild(b);
      }

      box.appendChild(wrap);
    });
  }

  function levelDots(level) {
    var out = '<span class="lvl" aria-hidden="true">';
    for (var i = 1; i <= 5; i++) out += '<i class="' + (i <= level ? 'on' : '') + '"></i>';
    return out + '</span>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- старт ---------- */

  function init() {
    initEnter();
    initBlockA();
    initBlockB();
    $('introBtn').addEventListener('click', function () {
      show('screenA');
      renderSituation();
    });

    if (restore()) {
      // возврат после случайного обновления страницы
      if (state.step >= TEST.blockA.length) { show('screenB'); renderBlockB(); }
      else { show('screenA'); renderSituation(); }
      API.ready();
    } else {
      show('screenEnter');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
