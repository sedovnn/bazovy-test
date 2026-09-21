/* Подсчёт расстановок и сборка карты участника.
   Правила — раздел «Подсчёт» в spec/правила_тестирования_v*.md.

   ЭТОТ ФАЙЛ — ОДИН НА ДВА РАНТАЙМА. Копия лежит в apps-script/scoring.gs и должна
   быть байт в байт такой же: правите здесь — прогоните генератор.
   В браузере подключается ТОЛЬКО моковым бэкендом: в боевом режиме считает
   Apps Script, и ключ в браузер не уезжает. */

/* Идеальный порядок по уровням: сверху вниз 5, 4, 3, 2.
   L1 в репликах не даётся — так заданы правила. Какая реплика какого уровня,
   этот файл не знает: связь живёт в keys.js / keys.gs, которых в публичном
   репозитории нет. */
var IDEAL = [5, 4, 3, 2];

/* Балл за одну ситуацию, 0–3. Правила:
     3 — полное совпадение с ключом
     2 — одна перестановка соседей
     1 — верх верный, остальное перепутано
     0 — L5 не первым

   ⚠ Правила 2 и 0 пересекаются: перестановка первых двух реплик — это и «одна
   перестановка соседей», и «L5 не первым». Читаем список по порядку, сверху
   вниз: сначала 3, потом 2, потом 1, иначе 0. То есть такой ответ получает 2.
   Если читать надо иначе — правится здесь, одним местом. */
function scoreSituation(testId, situationId, orderIds) {
  if (!orderIds || orderIds.length !== 4) return 0;

  var byTest = (typeof KEYS !== 'undefined') ? KEYS[testId] : null;
  var key = byTest ? byTest[situationId] : null;
  if (!key) return 0;

  var levels = [], seen = {};
  for (var i = 0; i < orderIds.length; i++) {
    var lv = key[orderIds[i]];
    if (!lv || seen[lv]) return 0;      // расстановка должна быть полной и без повторов
    seen[lv] = true;
    levels.push(lv);
  }

  var diff = [];
  for (var d = 0; d < IDEAL.length; d++) { if (levels[d] !== IDEAL[d]) diff.push(d); }

  if (diff.length === 0) return 3;

  if (diff.length === 2 && diff[1] === diff[0] + 1 &&
      levels[diff[0]] === IDEAL[diff[1]] && levels[diff[1]] === IDEAL[diff[0]]) {
    return 2;
  }

  if (levels[0] === 5) return 1;

  return 0;
}

/* Зона по сумме. Правила: пара 0–2 не видит · 3–4 видит, путает · 5–6 выбирает;
   одиночная 0 · 1–2 · 3. Возвращает индекс 0–2. */
function zoneIndex(sum, situationCount) {
  if (situationCount === 1) {
    if (sum === 0) return 0;
    if (sum <= 2) return 1;
    return 2;
  }
  if (sum <= 2) return 0;
  if (sum <= 4) return 1;
  return 2;
}

var ZONE_NAMES = ['не видит', 'видит, путает', 'выбирает'];

/* ---------- общая шкала ----------
   Обе величины нормируются в 0…1 и усредняются с равным весом; у «Анализа
   контекста» свободного ответа нет, часть одна. Определение живёт ЗДЕСЬ и
   только здесь — им пользуются и карта участника, и сводка ведущего.

   ⚠ Правила §5 говорят «зоны в L1–L5 не переводятся». Здесь зона в уровень не
   переводится: обе величины приводятся к доле от своего максимума. Показ общей
   шкалы участнику — решение владельца от 21.09. */
function combinedValue(score, max, level) {
  var parts = [max ? score / max : 0];
  if (level) parts.push((level - 1) / 4);
  var sum = 0;
  for (var i = 0; i < parts.length; i++) sum += parts[i];
  return sum / parts.length;
}

/* Треть общей шкалы: 0 низ, 1 середина, 2 верх. */
function valueBucket(value) {
  if (value < 1 / 3) return 0;
  if (value < 2 / 3) return 1;
  return 2;
}

var BUCKET_NAMES = ['низ', 'середина', 'верх'];

/* Порог строки «в тесте выше, чем в своих ответах».
   Правила §5: зона «выбирает», а уровень судьи ≤ L2. */
var GAP_ZONE = 2;
var GAP_MAX_LEVEL = 2;

/* Собирает карту участника.
   test — запись из CONFIG.tests: id, situations, factors (ситуация → код фактора).
   orderings — { s1: ['E','D','C','B'], … }; judge — разобранный ответ судьи или null. */
function buildMap(skills, test, orderings, judge) {
  var perSituation = {};
  for (var sid in orderings) {
    if (Object.prototype.hasOwnProperty.call(orderings, sid)) {
      perSituation[sid] = scoreSituation(test.id, sid, orderings[sid]);
    }
  }

  // фактор → ситуация: в разных тестах привязка своя
  var bySituation = test.factors || {};
  var situationOf = {};
  for (var s in bySituation) {
    if (Object.prototype.hasOwnProperty.call(bySituation, s)) situationOf[bySituation[s]] = s;
  }

  var out = [], gaps = [];

  for (var i = 0; i < skills.length; i++) {
    var sk = skills[i];
    var used = [], sum = 0;

    for (var f = 0; f < sk.factors.length; f++) {
      var sid2 = situationOf[sk.factors[f]];
      if (!sid2) continue;
      used.push(sid2);
      sum += perSituation[sid2] || 0;
    }

    var zi = zoneIndex(sum, used.length || 1);
    var max = (used.length || 1) * 3;

    var row = {
      id: sk.id, name: sk.name, score: sum, max: max,
      zoneIndex: zi, zone: ZONE_NAMES[zi],
      value: combinedValue(sum, max, null),
      ability: sk.ability || null,
      level: null, flag: false, slogan: false, quote: '', why: ''
    };

    if (sk.ability && judge && judge[sk.ability]) {
      var a = judge[sk.ability];
      row.level = a.level;
      row.flag = !!a.flag;
      row.slogan = !!a.slogan;
      row.quote = a.quote || '';
      row.why = a.why || '';
      row.value = combinedValue(sum, max, a.level);

      if (zi >= GAP_ZONE && a.level && a.level <= GAP_MAX_LEVEL) gaps.push(sk.name);
    }

    out.push(row);
  }

  // Дополнительные способности: судья отмечает их только при явном маркере,
  // на зону они не влияют — так заданы правила.
  var extra = [];
  if (judge && judge.extra) {
    for (var code in judge.extra) {
      if (Object.prototype.hasOwnProperty.call(judge.extra, code)) {
        extra.push({ code: code, level: judge.extra[code].level,
                     quote: judge.extra[code].quote || '' });
      }
    }
  }

  return { skills: out, perSituation: perSituation, gaps: gaps, extra: extra };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    scoreSituation: scoreSituation, zoneIndex: zoneIndex, buildMap: buildMap,
    combinedValue: combinedValue, valueBucket: valueBucket, BUCKET_NAMES: BUCKET_NAMES
  };
}
