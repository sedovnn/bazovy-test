/* Судья свободных ответов: сборка запроса, вызов Anthropic, разбор JSON.

   Промпт свой на каждый тест — судья читает контекст конкретного кейса.
   Берётся из judge_prompts.gs, собранного из spec/ дословно.

   Спека («Как прогонять»): system = весь файл промпта,
   user = <ответ1>…</ответ1>\n<ответ2>…</ответ2>, max_tokens 2000, температура 0,
   при неразборчивом JSON — один повтор с добавлением «Ответь только JSON».

   ⚠ РАСХОЖДЕНИЕ СО СПЕКОЙ, ВЫНУЖДЕННОЕ. «Температуры 0» на этой модели нет:
   Sonnet 5 отвечает «400 `temperature` is deprecated for this model» —
   sampling-параметры из модели убраны. Параметр снят, замены ему не придумано.
   Рассуждение выключено: иначе оно ело бы те же токены, что отведены под ответ,
   и растягивало ожидание участника.

   Ключ читается из свойств скрипта и никогда не покидает бэкенд. */

var ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_VERSION = '2023-06-01';
var DEFAULT_MODEL = 'claude-sonnet-5';   // как у судьи Искры
var MAX_TOKENS = 2000;

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
  if (parsed) return { ok: true, judge: parsed, error: '', model: model, promptVersion: prompt.version };

  // один повтор — как предписано спекой
  var second = callAnthropic(key, model, prompt.text, userText + '\n\nОтветь только JSON.');
  if (!second.ok) {
    return { ok: false, judge: null, error: second.error, model: model, promptVersion: prompt.version };
  }

  parsed = parseVerdict(second.text);
  if (parsed) return { ok: true, judge: parsed, error: '', model: model, promptVersion: prompt.version };

  return { ok: false, judge: null, model: model, promptVersion: prompt.version,
           error: 'Судья вернул неразборчивый JSON дважды' };
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

/* Разбирает вердикт. Спека требует голый JSON, но на всякий случай снимаем
   markdown-ограждение и берём самый внешний объект. */
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

  // Годится, только если есть все четыре основные способности с уровнем 1–5.
  var out = { feedback: String(obj.feedback || ''), extra: {} };
  for (var i = 0; i < CONFIG.abilities.length; i++) {
    var id = CONFIG.abilities[i].id;
    var got = obj[id];
    if (!got || typeof got !== 'object') return null;
    var level = Number(got.level);
    if (!(level >= 1 && level <= 5)) return null;
    out[id] = {
      level: Math.round(level),
      quote: String(got.quote === undefined ? '' : got.quote),
      why: String(got.why === undefined ? '' : got.why),
      flag: got.flag === true,
      slogan: got.slogan === true
    };
  }

  // Дополнительные способности — только с явным маркером, могут отсутствовать.
  if (obj.extra && typeof obj.extra === 'object') {
    for (var code in obj.extra) {
      if (!Object.prototype.hasOwnProperty.call(obj.extra, code)) continue;
      var e = obj.extra[code];
      var lv = e && Number(e.level);
      if (lv >= 1 && lv <= 5) {
        out.extra[code] = { level: Math.round(lv), quote: String((e && e.quote) || '') };
      }
    }
  }

  return out;
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
