/* Судья свободных ответов: сборка запроса, вызов Anthropic, разбор JSON.

   Промпт свой на каждый тест — судья читает контекст конкретного кейса.
   Берётся из judge_prompts.gs, собранного из spec/ дословно.

   system = промпт целиком: обёртка теста + профиль мини-формата + методология v8.
   user = <ответ1>…</ответ1>\n<ответ2>…</ответ2>.
   При неразборчивом JSON — один повтор с добавлением «Ответь только JSON».

   Выдача по профилю мини-формата: по каждому из 4 поднавыков — 4 границы
   лестницы («да» / «нет» / «спорно» с цитатой), статус «оценено» или
   «ручная проверка», уровень или null, вывод для человека в 1–2 предложения.
   Лимит ответа поднят до 4000: разбор по границам длиннее прежнего.

   ⚠ РАСХОЖДЕНИЕ СО СПЕКОЙ, ВЫНУЖДЕННОЕ. «Температуры 0» на этой модели нет:
   Sonnet 5 отвечает «400 `temperature` is deprecated for this model» —
   sampling-параметры из модели убраны. Параметр снят, замены ему не придумано.
   Рассуждение выключено: иначе оно ело бы те же токены, что отведены под ответ,
   и растягивало ожидание участника.

   Ключ читается из свойств скрипта и никогда не покидает бэкенд. */

var ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_VERSION = '2023-06-01';
var DEFAULT_MODEL = 'claude-sonnet-5';   // как у судьи Искры
var MAX_TOKENS = 4000;

function judgeModel() {
  return PROP.getProperty('MODEL') || DEFAULT_MODEL;
}

function judgePrompt(testId) {
  return (typeof JUDGE_PROMPTS !== 'undefined') ? JUDGE_PROMPTS[testId] : null;
}

/* Возвращает { ok, judge, error, model, promptVersion }.
   Исключений наружу не бросает: падение судьи не должно ронять отправку. */
function judgeAnswers(testId, answer1, answer2) {
  var model = judgeModel();
  var prompt = judgePrompt(testId);

  if (!prompt) {
    return { ok: false, judge: null, model: model, promptVersion: '',
             error: 'Для теста ' + testId + ' нет промпта судьи' };
  }

  var key = PROP.getProperty('ANTHROPIC_API_KEY');
  if (!key) {
    return { ok: false, judge: null, model: model, promptVersion: prompt.version,
             error: 'Не задан ANTHROPIC_API_KEY в свойствах скрипта' };
  }

  var userText = '<ответ1>\n' + String(answer1 || '') + '\n</ответ1>\n' +
                 '<ответ2>\n' + String(answer2 || '') + '\n</ответ2>';

  var first = callAnthropic(key, model, prompt.text, userText);
  if (!first.ok) {
    return { ok: false, judge: null, error: first.error, model: model, promptVersion: prompt.version };
  }

  var parsed = parseVerdict(first.text);
  if (parsed) return checked(parsed, key, model, prompt, userText);

  // один повтор — как предписано спекой
  var second = callAnthropic(key, model, prompt.text, userText + '\n\nОтветь только JSON.');
  if (!second.ok) {
    return { ok: false, judge: null, error: second.error, model: model, promptVersion: prompt.version };
  }

  parsed = parseVerdict(second.text);
  if (parsed) return checked(parsed, key, model, prompt, userText);

  return { ok: false, judge: null, model: model, promptVersion: prompt.version,
           error: 'Судья вернул неразборчивый JSON дважды' };
}

/* Проверка текста для человека по языковым правилам методолога (отчёт
   основной платформы, report-ai.js: запрещённые слова, сравнения с другими,
   суждения о личности, «Вы» с заглавной). Как у Кати: при нарушении — одна
   попытка исправления, потом поле не показывается. Заглавную «Вы» правит код
   сам: это не повод звать судью ещё раз. */
function checked(parsed, key, model, prompt, userText) {
  var problems = textProblemsAll(parsed);
  if (problems.length) {
    var again = callAnthropic(key, model, prompt.text, userText +
      '\n\nВ прошлом ответе тексты для человека нарушали правила языка: ' + problems.join('; ') +
      '. Соблюдай правила полей has и next. Ответь только JSON.');
    var second = again.ok ? parseVerdict(again.text) : null;
    if (second && textProblemsAll(second).length < problems.length) parsed = second;
  }
  finishTexts(parsed);
  return { ok: true, judge: parsed, error: '', model: model, promptVersion: prompt.version };
}

var TEXT_RULES = [
  [/уров(ень|ня|ню|нем|не|ни|ней|ням|нями|нях)/i, 'слово «уровень»'],
  [/(^|[^А-Яа-яЁёA-Za-z])L\s?[1-5]/, 'запись вида L3'],
  [/(МК|ПП|АК|ПР|ГА)\s?-?\s?[12]/, 'код способности'],
  [/(^|[^А-Яа-яЁё])[ТИ][0-5]([^А-Яа-яЁё0-9]|$)/, 'служебный код'],
  [/гейт|границ[аеуыой]|маркер|дисквалификатор|домен|судь[яиеюё]|рубрик|флаг/i, 'служебное слово методологии'],
  [/участник/i, '«участник» в третьем лице'],
  [/параллельност|соразмерност|декомпозиц/i, 'жаргон методологии'],
  [/\d\s*(из|\/)\s*\d|балл/i, 'оценка числом'],
  [/лучше многих|чем у? ?большинств|чем у других|в отличие от других|встречается редко|редко встречается|мало кто|не каждый/i, 'сравнение с другими'],
  [/по натуре|скорее всего,? вы|вы из тех|вам свойственно|ваш характер/i, 'суждение о личности']
];
var PRAISE = /(^|[^А-Яа-яЁё])(сильн|редк|зрел|целостн|хорош|отличн|блестящ)/i;

// Цитаты «…» из ответа человека проверке не подлежат: в них его слова.
function unquoted(s) { return String(s || '').replace(/«[^»]*»/g, ' '); }

function textProblems(field, s) {
  var core = unquoted(s), out = [];
  if (!core.trim()) return out;
  TEXT_RULES.forEach(function (r) { if (r[0].test(core)) out.push(r[1]); });
  if (field === 'has' && PRAISE.test(core)) out.push('похвала');
  return out;
}

function textProblemsAll(verdict) {
  var all = [];
  Object.keys(verdict).forEach(function (id) {
    ['has', 'next'].forEach(function (f) {
      textProblems(f, verdict[id][f]).forEach(function (p) { all.push(id + ' ' + f + ': ' + p); });
    });
  });
  return all;
}

// «вы», «ваш» → «Вы», «Ваш» вне цитат.
function capitalizeYou(s) {
  return String(s || '').replace(/«[^»]*»|(^|[^А-Яа-яЁё])(вы|вас|вам|вами|ваш[а-яё]*)(?![А-Яа-яЁё])/g,
    function (m, pre, w) { return w ? pre + w.charAt(0).toUpperCase() + w.slice(1) : m; });
}

/* Окончательный текст для человека: поле с нарушением не показываем,
   причина уходит в таблицу. */
function finishTexts(verdict) {
  Object.keys(verdict).forEach(function (id) {
    var v = verdict[id], notes = [];
    ['has', 'next'].forEach(function (f) {
      v[f] = capitalizeYou(v[f]);
      var p = textProblems(f, v[f]);
      if (p.length) { notes.push(f + ' скрыт: ' + p.join(', ') + ' — «' + v[f] + '»'); v[f] = ''; }
    });
    var review = v.status === REVIEW;
    var parts = [v.has, review ? '' : v.next].filter(function (x) { return x; });
    v.takeaway = parts.length ? parts.join(' ') : '';
    v.why = v.takeaway;
    v.textcheck = notes.join('\n');
  });
}

function callAnthropic(key, model, system, user) {
  var payload = {
    model: model,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'disabled' },   // см. расхождение со спекой в шапке файла
    // Промпт статичный и большой — кэшируем. Содержание от этого не меняется,
    // а каждый следующий участник в течение жизни кэша считается заметно дешевле.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }]
  };

  var res;
  try {
    res = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    return { ok: false, error: 'Сеть: ' + String(e && e.message || e) };
  }

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    var msg = body;
    try { msg = JSON.parse(body).error.message; } catch (e) {}
    return { ok: false, error: 'API ' + code + ': ' + String(msg).slice(0, 300) };
  }

  var data;
  try { data = JSON.parse(body); } catch (e) {
    return { ok: false, error: 'Ответ API не разобрался как JSON' };
  }

  var text = '';
  (data.content || []).forEach(function (part) {
    if (part.type === 'text') text += part.text;
  });
  if (!text) return { ok: false, error: 'Пустой ответ судьи' };

  return { ok: true, text: text };
}

var GATE_KEYS = ['2', '3', '4', '5'];   // границы 1→2, 2→3, 3→4, 4→5
var REVIEW = 'ручная проверка';

/* Разбирает вердикт. Ждём голый JSON, но на всякий случай снимаем
   markdown-ограждение и берём самый внешний объект.

   Годится, только если есть все 4 поднавыка. У «оценено» обязателен уровень
   1–5; у «ручной проверки» уровня нет — так требует методология v8
   (правила оценщика 9 и 13): предварительная оценка не выдаётся за окончательную. */
function parseVerdict(raw) {
  var text = String(raw || '').trim();

  var fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  if (text.charAt(0) !== '{') {
    var from = text.indexOf('{'), to = text.lastIndexOf('}');
    if (from < 0 || to <= from) return null;
    text = text.slice(from, to + 1);
  }

  var obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object') return null;

  var out = {};
  for (var i = 0; i < CONFIG.abilities.length; i++) {
    var id = CONFIG.abilities[i].id;
    var got = obj[id];
    if (!got || typeof got !== 'object') return null;

    var src = (got.gates && typeof got.gates === 'object') ? got.gates : {};
    var gates = {}, best = '';
    for (var k = 0; k < GATE_KEYS.length; k++) {
      var g = src[GATE_KEYS[k]] || {};
      var st = gateStatus(g.s);
      gates[GATE_KEYS[k]] = { s: st, q: String(g.q === undefined ? '' : g.q) };
      // цитата верхней пройденной границы — её и показываем как подтверждение
      if (st === 'да' && g.q) best = String(g.q);
    }

    var review = String(got.status || '').toLowerCase().indexOf('ручн') >= 0;
    var level = null;
    if (!review) {
      level = Number(got.level);
      if (!(level >= 1 && level <= 5)) return null;
      level = Math.round(level);
    }

    var options = [];
    if (review && got.options && got.options.length) {
      for (var o = 0; o < got.options.length; o++) {
        var n = Number(got.options[o]);
        if (n >= 1 && n <= 5 && options.indexOf(n) < 0) options.push(Math.round(n));
      }
    }

    /* Вывод для человека судья пишет двумя полями: «что есть» и «дальше»
       (или «что неясно» при ручной проверке). Разделение нарочное: одной
       фразой модель стабильно съезжала в «чтобы выйти на следующий уровень»
       и в похвалы. Старое поле takeaway тоже принимаем. */
    function txt(x) { return String(x === undefined || x === null ? '' : x).trim(); }
    // При ручной проверке человек видит только «что есть»; объяснение, что
    // спорно, — для методолога, в таблицу.
    var has = txt(got.has), next = review ? '' : txt(got.next);
    var parts = [has, next].filter(function (x) { return x; });
    var takeaway = parts.length ? parts.join(' ') : txt(got.takeaway);
    var unclear = review ? txt(got.unclear) : '';
    out[id] = {
      status: review ? REVIEW : 'оценено',
      level: level,
      options: options,
      gates: gates,
      flag: got.flag === true,
      slogan: got.slogan === true,
      quote: best,
      takeaway: takeaway,
      has: has || (parts.length ? '' : takeaway),
      next: next,
      unclear: unclear,
      why: takeaway      // прежнее поле: старые экраны читают его
    };
  }
  return out;
}

function gateStatus(s) {
  var v = String(s || '').trim().toLowerCase();
  if (v.indexOf('да') === 0) return 'да';
  if (v.indexOf('спорн') === 0) return 'спорно';
  return 'нет';
}

/* Прогон одной пары ответов из редактора — проверить ключ, модель и промпт.
   Выбрать функцию проверитьСудью и нажать «Выполнить», смотреть логи. */
function проверитьСудью() {
  var testId = CONFIG.tests[CONFIG.tests.length - 1].id;
  var ответ1 = 'Через 5 лет Stellantis продаёт не машины, а доступ к ним: марка и опыт вождения ' +
    'остаются нам, заводы и софт уходят партнёрам. Главная развилка — придёт ли китайская цена ' +
    'в Европу. Если придёт, выигрывает тот, кто продаёт мощности, и мы к этому готовы. ' +
    'Путь, которого никто не назвал: подписка на автомобиль вместо продажи.';
  var ответ2 = 'Сначала возвращаем Jeep и Ram в средний ценовой сегмент в США — без этого доли ' +
    'не вернуть. После этого загружаем освободившиеся мощности контрактной сборкой, потому что ' +
    'она окупает заводы только при полной загрузке. Отказываемся от вывода новых марок в Европе ' +
    'на эти 3 года, даже если рынок будет звать.';
  var r = judgeAnswers(testId, ответ1, ответ2);
  Logger.log('тест: ' + testId + ' · модель: ' + judgeModel() + ' · промпт: ' + r.promptVersion);
  Logger.log(r.ok ? JSON.stringify(r.judge, null, 2) : ('ошибка: ' + r.error));
}
