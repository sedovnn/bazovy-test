/* Подсчёт блока А и сборка карты участника.
   Правила — из раздела «Подсчёт» в spec/базовый_тест_v0.9.md.

   ЭТОТ ФАЙЛ — ОДИН НА ДВА РАНТАЙМА. Копия лежит в apps-script/scoring.gs и должна
   быть байт в байт такой же: правите здесь — прогоните tools/sync.sh.
   В браузере он подключается ТОЛЬКО моковым бэкендом (см. js/api.js): в боевом
   режиме считает Apps Script, и ключ в браузер не уезжает. */

/* Ключ лежит отдельно (keys.js / keys.gs) и собирается из спеки генератором:
   id ситуации → уровень L1–L5 каждого варианта. Читаем по ситуации: новая вычитка
   может ключ и переставить.

   ⚠ Самого ключа здесь нет и быть не должно. keys.js в публичный репозиторий не
   коммитится — иначе ответы лежали бы в открытом доступе. */

var IDEAL = [5, 4, 3, 2, 1];


/* ---------- общая шкала ----------
   Спека v1.1, раздел «Что видит участник»: обе части нормируются в 0…1 и
   усредняются с равным весом; у «Анализа контекста» записки нет, часть одна.
   Определение живёт ЗДЕСЬ и только здесь — им пользуются и карта участника,
   и сводка ведущего, иначе формулы разъедутся. */
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

/* Балл за одну ситуацию, 0–4.
   Спека: «полное совпадение 4; перестановка соседей 3; L5/L4 первым, середина
   перепутана 2; L5/L4 на 2–3-м месте 1; ниже 0».

   ⚠ Спека не дописывает две границы, читаем их так (и так же написано в README):
   — «перестановка соседей» = ровно один обмен двух соседних позиций, остальное на
     местах. Проверяется раньше правила про «L5/L4 первым», иначе ответ [4,5,3,2,1]
     получил бы 2 вместо 3.
   — «L5/L4 на 2–3-м месте» = L5 или L4 стоит вторым или третьим, при том что
     первым не стоит ни один из них. Если оба ушли на 4–5-е места — 0.
   Если читать надо иначе — правится здесь, одним местом. */
function scoreSituation(situationId, orderIds) {
  if (!orderIds || orderIds.length !== 5) return 0;

  var key = (typeof KEYS !== 'undefined') ? KEYS[situationId] : null;
  if (!key) return 0;

  var levels = [];
  for (var i = 0; i < orderIds.length; i++) {
    var lv = key[orderIds[i]];
    if (!lv) return 0;
    levels.push(lv);
  }
  // расстановка должна быть полной: пять разных вариантов
  var seen = {};
  for (var s = 0; s < levels.length; s++) {
    if (seen[levels[s]]) return 0;
    seen[levels[s]] = true;
  }

  // 4 — полное совпадение
  var diff = [];
  for (var d = 0; d < 5; d++) { if (levels[d] !== IDEAL[d]) diff.push(d); }
  if (diff.length === 0) return 4;

  // 3 — перестановка соседей
  if (diff.length === 2 && diff[1] === diff[0] + 1 &&
      levels[diff[0]] === IDEAL[diff[1]] && levels[diff[1]] === IDEAL[diff[0]]) {
    return 3;
  }

  // 2 — L5 или L4 первым, середина перепутана
  if (levels[0] === 5 || levels[0] === 4) return 2;

  // 1 — L5 или L4 на 2–3-м месте
  var p5 = levels.indexOf(5), p4 = levels.indexOf(4);
  if (p5 === 1 || p5 === 2 || p4 === 1 || p4 === 2) return 1;

  // 0 — ниже
  return 0;
}

/* Зона по сумме. Спека: 0–3 не видит · 4–6 видит, путает · 7–8 выбирает;
   для одиночной ситуации 0–1 · 2–3 · 4. Возвращает индекс 0–2. */
function zoneIndex(sum, situationCount) {
  if (situationCount === 1) {
    if (sum <= 1) return 0;
    if (sum <= 3) return 1;
    return 2;
  }
  if (sum <= 3) return 0;
  if (sum <= 6) return 1;
  return 2;
}

var ZONE_NAMES = ['не видит', 'видит, путает', 'выбирает'];

/* Порог строки «различаю, но не делаю».
   ⚠ Спека называет расхождение, но не числа. Читаем так: расстановка в верхней
   зоне («выбирает»), а уровень той же способности в блоке Б — L1 или L2. */
var GAP_ZONE = 2;
var GAP_MAX_LEVEL = 2;

/* Собирает карту участника.
   orderings — { ak1: ['E','D',...], ... }; judge — разобранный ответ судьи или null.
   Возвращает объект, который уходит на фронт как есть. */
function buildMap(skills, orderings, judge) {
  var perSituation = {};
  for (var sid in orderings) {
    if (Object.prototype.hasOwnProperty.call(orderings, sid)) {
      perSituation[sid] = scoreSituation(sid, orderings[sid]);
    }
  }

  var out = [];
  var gaps = [];

  for (var i = 0; i < skills.length; i++) {
    var sk = skills[i];
    var sum = 0;
    for (var j = 0; j < sk.situations.length; j++) {
      sum += perSituation[sk.situations[j]] || 0;
    }
    var zi = zoneIndex(sum, sk.situations.length);

    var row = {
      id: sk.id,
      name: sk.name,
      score: sum,
      max: sk.situations.length * 4,
      zoneIndex: zi,
      zone: ZONE_NAMES[zi],
      value: combinedValue(sum, sk.situations.length * 4, null),
      ability: sk.ability || null,
      level: null,
      flag: false,
      quote: '',
      why: ''
    };

    if (sk.ability && judge && judge[sk.ability]) {
      var a = judge[sk.ability];
      row.level = a.level;
      row.flag = !!a.flag;
      row.quote = a.quote || '';
      row.why = a.why || '';
      row.value = combinedValue(sum, sk.situations.length * 4, a.level);

      if (zi >= GAP_ZONE && a.level && a.level <= GAP_MAX_LEVEL) {
        gaps.push(sk.name);
      }
    }

    out.push(row);
  }

  return { skills: out, perSituation: perSituation, gaps: gaps };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    scoreSituation: scoreSituation, zoneIndex: zoneIndex, buildMap: buildMap,
    combinedValue: combinedValue, valueBucket: valueBucket, BUCKET_NAMES: BUCKET_NAMES
  };
}
