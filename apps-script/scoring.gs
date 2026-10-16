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

/* Балл за одну ветку, 0–3, с шагом 0,5. Правило «уровень — кого поставил первым»
   (решение владельца 16.10.2026, заменило «3 — полное совпадение, 2 — одна
   перестановка соседей, 1 — верх верный, 0 — L5 не первым»):
     — основа — уровень комментария на первом месте: L5 → 3, L4 → 2, L3 → 1, L2 → 0;
     — остальные три стоят не по убыванию — минус 0,5;
     — порядок похож на случайный: перепутано больше половины пар (4 из 6
       и больше) — 0, кто бы ни стоял первым.
   Пример: 4 3 5 2 → 2 − 0,5 = 1,5, «между третьим и четвёртым». */
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

  // пара перепутана, если слабый комментарий стоит выше сильного
  var inversions = 0;
  for (var a = 0; a < levels.length; a++) {
    for (var b = a + 1; b < levels.length; b++) { if (levels[a] < levels[b]) inversions++; }
  }
  if (inversions >= 4) return 0;

  var score = levels[0] - 2;
  for (var c = 1; c < levels.length - 1; c++) {
    if (levels[c] < levels[c + 1]) { score -= 0.5; break; }
  }
  return Math.max(0, score);
}

/* Зона по сумме баллов навыка. Одна ветка: меньше 1 — не видит, 1–2 — видит,
   путает, от 2,5 — выбирает. Две ветки — те же пороги, удвоенные: меньше 2,
   2–4,5, от 5. Возвращает индекс 0–2. */
function zoneIndex(sum, situationCount) {
  var k = situationCount === 1 ? 1 : 2;
  if (sum < 1 * k) return 0;
  if (sum < 2.5 * k) return 1;
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
   test — запись из CONFIG.tests: id, situations, factors (новость → код способности).
   orderings — { s1: [метки в порядке расстановки], … }; judge — разобранный
   ответ судьи (см. parseVerdict в judge.gs) или null. */
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
      level: null, review: false, flag: false, slogan: false,
      quote: '', why: '', takeaway: '', has: '', next: '', stronger: null
    };

    if (sk.ability && judge && judge[sk.ability]) {
      var a = judge[sk.ability];
      // «Ручная проверка» по методологии v8: уровня нет, полоса строится
      // только по расстановке, человек видит «уточняется».
      row.review = a.status === 'ручная проверка' || !a.level;
      row.level = row.review ? null : a.level;
      row.flag = !!a.flag;
      row.slogan = !!a.slogan;
      row.quote = a.quote || '';
      row.takeaway = a.takeaway || a.why || '';
      // «что есть» и «что дальше» — отдельно: на карте у них свои подписи
      row.has = a.has || '';
      row.next = a.next || '';
      row.stronger = a.stronger || null;
      row.why = row.takeaway;
      row.value = combinedValue(sum, max, row.level);

      if (zi >= GAP_ZONE && row.level && row.level <= GAP_MAX_LEVEL) gaps.push(sk.name);
    }

    out.push(row);
  }

  /* Оценка остальных шести способностей по свободному тексту снята профилем
     мини-формата: вопросы под них не строились. Поле оставлено пустым, чтобы
     прежние экраны не ломались. */
  return { skills: out, perSituation: perSituation, gaps: gaps, extra: [] };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    scoreSituation: scoreSituation, zoneIndex: zoneIndex, buildMap: buildMap,
    combinedValue: combinedValue, valueBucket: valueBucket, BUCKET_NAMES: BUCKET_NAMES
  };
}
