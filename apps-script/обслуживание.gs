/* Обслуживание таблицы. Ничего отсюда не доступно через doPost и не должно быть:
   веб-приложение открыто всем, а значит уметь стирать данные оно не может.
   Эти функции запускаются только вручную из редактора Apps Script.

   Как удалить сессии: впишите коды в СЕССИИ_К_УДАЛЕНИЮ, выберите функцию
   очиститьСессии, нажмите «Выполнить», прочитайте журнал. */

var СЕССИИ_К_УДАЛЕНИЮ = ['A2AQRF', '27ZPQA', 'EDAEBM'];

/* Сначала покажет, что собирается удалить, и ничего не тронет.
   Прогоняйте перед очисткой — дешевле, чем восстанавливать. */
function показатьЧтоУдалится() {
  var план = собратьПлан();
  Logger.log('Сессий под удаление: ' + план.sessions.length);
  план.sessions.forEach(function (s) { Logger.log('  ' + s.code + ' · ' + s.title); });
  Logger.log('Ответов под удаление: ' + план.responses.length);
  план.responses.forEach(function (r) { Logger.log('  ' + r.code + ' · ' + r.at); });
  if (!план.sessions.length && !план.responses.length) Logger.log('Нечего удалять.');
}

function очиститьСессии() {
  if (!СЕССИИ_К_УДАЛЕНИЮ.length) {
    Logger.log('Список СЕССИИ_К_УДАЛЕНИЮ пуст — ничего не делаю.');
    return;
  }

  var план = собратьПлан();
  // Удаляем снизу вверх: иначе после первого же удаления номера строк уезжают.
  var ответы = sheet(SHEET_RESPONSES);
  план.responses.sort(function (a, b) { return b.row - a.row; })
                .forEach(function (r) { ответы.deleteRow(r.row); });

  var сессии = sheet(SHEET_SESSIONS);
  план.sessions.sort(function (a, b) { return b.row - a.row; })
               .forEach(function (s) { сессии.deleteRow(s.row); });

  Logger.log('Удалено ответов: ' + план.responses.length);
  Logger.log('Удалено сессий: ' + план.sessions.length);
  Logger.log('Осталось строк: responses ' + (ответы.getLastRow() - 1) +
             ', sessions ' + (сессии.getLastRow() - 1));
}

function собратьПлан() {
  var коды = {};
  СЕССИИ_К_УДАЛЕНИЮ.forEach(function (c) { коды[String(c).toUpperCase()] = true; });

  var r = sheet(SHEET_RESPONSES).getDataRange().getValues();
  var rh = r[0], rCode = rh.indexOf('session_code'), rAt = rh.indexOf('submitted_at');
  var responses = [];
  for (var i = 1; i < r.length; i++) {
    if (коды[String(r[i][rCode]).toUpperCase()]) {
      responses.push({ row: i + 1, code: r[i][rCode], at: r[i][rAt] });
    }
  }

  var s = sheet(SHEET_SESSIONS).getDataRange().getValues();
  var sessions = [];
  for (var j = 1; j < s.length; j++) {
    if (коды[String(s[j][0]).toUpperCase()]) {
      sessions.push({ row: j + 1, code: s[j][0], title: s[j][1] });
    }
  }

  return { sessions: sessions, responses: responses };
}
