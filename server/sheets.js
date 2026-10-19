/* Таблица на сервере: те же «листы», что в Google Таблице, но в SQLite.
   Бэкенд (apps-script/Code.gs) написан под SpreadsheetApp и работает с листом
   как с двумерным массивом. Здесь — ровно те вызовы, которые он делает,
   поверх файла базы. Так код бэкенда один и тот же в Apps Script и на сервере.

   Строка листа хранится JSON-массивом под своим номером (с 1, как в таблице).
   Значения отдаются прямоугольником шириной в самую длинную строку и
   добиваются '' — как getValues() у Google. */

'use strict';
const { DatabaseSync } = require('node:sqlite');

/* Один раз при старте, в главном процессе: режим журнала и таблицы.
   Рабочие открывают уже готовую базу — иначе шесть процессов разом
   переключают журнал и ловят «database is locked». */
function init(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA busy_timeout = 30000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sheets (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS rows (
      sheet TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (sheet, idx));
  `);
  db.close();
}

function open(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 30000;');

  const q = {
    hasSheet: db.prepare('SELECT 1 FROM sheets WHERE name = ?'),
    addSheet: db.prepare('INSERT OR IGNORE INTO sheets (name) VALUES (?)'),
    listSheets: db.prepare('SELECT name FROM sheets ORDER BY rowid'),
    all: db.prepare('SELECT idx, data FROM rows WHERE sheet = ? ORDER BY idx'),
    one: db.prepare('SELECT data FROM rows WHERE sheet = ? AND idx = ?'),
    count: db.prepare('SELECT COALESCE(MAX(idx), 0) AS n FROM rows WHERE sheet = ?'),
    insert: db.prepare('INSERT INTO rows (sheet, idx, data) VALUES (?, ?, ?)'),
    update: db.prepare('INSERT OR REPLACE INTO rows (sheet, idx, data) VALUES (?, ?, ?)'),
    del: db.prepare('DELETE FROM rows WHERE sheet = ? AND idx = ?'),
    // сдвиг в два шага: за один UPDATE SQLite может переставить строки в любом
    // порядке и упереться в уникальность номера (так и случилось 19.10)
    shiftOut: db.prepare('UPDATE rows SET idx = -idx WHERE sheet = ? AND idx > ?'),
    shiftIn: db.prepare('UPDATE rows SET idx = -idx - 1 WHERE sheet = ? AND idx < 0'),
  };

  function rowsOf(name) {
    return q.all.all(name).map(r => JSON.parse(r.data));
  }

  function width(rows) {
    return rows.reduce((m, r) => Math.max(m, r.length), 0);
  }

  function pad(r, w) {
    const out = r.slice();
    while (out.length < w) out.push('');
    return out.map(v => (v === null || v === undefined ? '' : v));
  }

  function getRow(name, idx) {
    const r = q.one.get(name, idx);
    return r ? JSON.parse(r.data) : [];
  }

  function makeSheet(name) {
    const sheet = {
      getName: () => name,
      appendRow(values) {
        const n = q.count.get(name).n;
        q.insert.run(name, n + 1, JSON.stringify(values));
        return sheet;
      },
      getDataRange() {
        return { getValues() { const rows = rowsOf(name); const w = width(rows); return rows.map(r => pad(r, w)); } };
      },
      getRange(row, col, nRows, nCols) {
        nRows = nRows || 1; nCols = nCols || 1;
        return {
          getValues() {
            const out = [];
            for (let r = row; r < row + nRows; r++) {
              const cur = getRow(name, r);
              const slice = [];
              for (let c = col; c < col + nCols; c++) {
                const v = cur[c - 1];
                slice.push(v === null || v === undefined ? '' : v);
              }
              out.push(slice);
            }
            return out;
          },
          setValue(v) { this.setValues([[v]]); },
          setValues(vals) {
            vals.forEach((line, i) => {
              const cur = getRow(name, row + i);
              line.forEach((v, j) => {
                while (cur.length < col - 1 + j) cur.push('');
                cur[col - 1 + j] = v;
              });
              q.update.run(name, row + i, JSON.stringify(cur));
            });
          },
          createTextFinder(needle) {
            return {
              matchEntireCell() {
                return {
                  findNext() {
                    const last = q.count.get(name).n;
                    for (let r = row; r < row + nRows && r <= last; r++) {
                      const v = getRow(name, r)[col - 1];
                      if (v !== undefined && String(v) === String(needle)) return { getRow: () => r };
                    }
                    return null;
                  },
                };
              },
            };
          },
        };
      },
      getLastColumn: () => width(rowsOf(name)),
      getLastRow: () => q.count.get(name).n,
      deleteRow(n) { q.del.run(name, n); q.shiftOut.run(name, n); q.shiftIn.run(name); },
      setFrozenRows() {},
    };
    return sheet;
  }

  const book = {
    getId: () => 'selectel',
    getSheetByName: n => (q.hasSheet.get(n) ? makeSheet(n) : null),
    insertSheet: n => { q.addSheet.run(n); return makeSheet(n); },
    getSheets: () => q.listSheets.all().map(r => makeSheet(r.name)),
    deleteSheet: s => {},   // бэкенд удаляет только пустой «Лист1» новой книги; здесь его нет
  };

  /* Замок как у LockService: одна запись за раз на все рабочие процессы.
     BEGIN IMMEDIATE держит запись в базе; читать в это время можно. */
  const lock = {
    held: false,
    tryLock() {
      const until = Date.now() + 30000;
      for (;;) {
        try { db.exec('BEGIN IMMEDIATE'); this.held = true; return true; } catch (e) {
          if (Date.now() > until) return false;
        }
      }
    },
    waitLock() { if (!this.tryLock()) throw new Error('Не дождались записи в базу'); },
    releaseLock() { if (this.held) { db.exec('COMMIT'); this.held = false; } },
  };

  return { db, book, lock, rowsOf, pad, width };
}

module.exports = { init, open };
