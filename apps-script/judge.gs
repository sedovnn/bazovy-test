/* Судья блока Б: сборка запроса, вызов Anthropic, разбор JSON.

   Промпт берётся целиком из judge_prompt.gs (собран из spec/ дословно).
   Спека предписывает: system = весь файл, user = <ответ>…</ответ>,
   температура 0, max_tokens 1500, при неразборчивом JSON — один повтор
   с добавлением «Ответь только JSON».

   ⚠ РАСХОЖДЕНИЕ СО СПЕКОЙ, ВЫНУЖДЕННОЕ. «Температуры 0» на этой модели больше
   нет: Sonnet 5 отвечает «400 `temperature` is deprecated for this model» —
   sampling-параметры из модели убраны. Параметр снят, замены ему не придумано.
   Заодно выключено рассуждение: иначе оно ело бы те же 1500 токенов, что
   отведены под ответ, и растягивало ожидание за обещанные участнику 10–20 с.
   Если калибровка с Катей покажет, что судья мажет, — первый рычаг здесь:
   включить рассуждение и поднять max_tokens.

   Ключ читается из свойств скрипта и никогда не покидает бэкенд. */

var ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_VERSION = '2023-06-01';
var DEFAULT_MODEL = 'claude-sonnet-5';   // как у судьи Искры
var MAX_TOKENS = 1500;

function judgeModel() {
  return PROP.getProperty('MODEL') || DEFAULT_MODEL;
}

/* Возвращает { ok, judge, error, model }. Исключений наружу не бросает:
   падение судьи не должно ронять отправку. */
function judgeAnswer(answerText) {
  var model = judgeModel();
  var key = PROP.getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, judge: null, error: 'Не задан ANTHROPIC_API_KEY в свойствах скрипта', model: model };

  var userText = '<ответ>\n' + String(answerText) + '\n</ответ>';

  var first = callAnthropic(key, model, JUDGE_PROMPT, userText);
  if (!first.ok) return { ok: false, judge: null, error: first.error, model: model };

  var parsed = parseVerdict(first.text);
  if (parsed) return { ok: true, judge: parsed, error: '', model: model };

  // один повтор — как предписано спекой
  var second = callAnthropic(key, model, JUDGE_PROMPT,
    userText + '\n\nОтветь только JSON.');
  if (!second.ok) return { ok: false, judge: null, error: second.error, model: model };

  parsed = parseVerdict(second.text);
  if (parsed) return { ok: true, judge: parsed, error: '', model: model };

  return { ok: false, judge: null, error: 'Судья вернул неразборчивый JSON дважды', model: model };
}

function callAnthropic(key, model, system, user) {
  var payload = {
    model: model,
    max_tokens: MAX_TOKENS,
    // см. расхождение со спекой в шапке файла
    thinking: { type: 'disabled' },
    // Промпт статичный и большой (около 60 тысяч знаков) — кэшируем его.
    // Содержание от этого не меняется, а каждый следующий участник в течение
    // жизни кэша считается заметно дешевле.
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

  // Вердикт годится, только если есть все четыре способности с уровнем 1–5.
  var out = { feedback: String(obj.feedback || '') };
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
      flag: got.flag === true
    };
  }
  return out;
}

/* Прогон одной записки из редактора — чтобы проверить ключ и модель без фронта.
   Запустить: выбрать функцию проверитьСудью и нажать «Выполнить», смотреть логи. */
function проверитьСудью() {
  var демо = 'Через три года сеть перестаёт быть розницей и становится сервисом ведения ' +
    'хронических пациентов. Отказываемся от пятнадцати новых точек: они масштабируют ' +
    'старую модель. Высвобожденные деньги идут в онлайн-заказ и в ведение курса. ' +
    'Первый год — договор с двумя клиниками и запуск доставки в трёх городах. ' +
    'Второй год — подписка на сопровождение курса. Третий — выход за пределы области.';
  var r = judgeAnswer(демо);
  Logger.log('модель: ' + judgeModel());
  Logger.log('версия промпта: ' + JUDGE_PROMPT_VERSION);
  Logger.log(r.ok ? JSON.stringify(r.judge, null, 2) : ('ошибка: ' + r.error));
}
