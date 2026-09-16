/* QR-код: байтовый режим, уровень коррекции M, версии 1–10.
   Свой, а не сторонний сервис-картинка: код сессии не должен уходить на чужой
   сервер, и QR обязан рисоваться без интернета. Больше версии 10 не нужно —
   это 213 байт, ссылка на страницу с кодом втрое короче.
   Сверен с эталоном (segno) по матрице модулей: tools/сверить_qr.py */

var QR = (function () {
  'use strict';

  /* ---- поле GF(256), примитивный многочлен 0x11D ---- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /* Порождающий многочлен Рида — Соломона степени n. */
  function rsPoly(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = poly.concat([0]);
      for (var j = 0; j < poly.length; j++) {
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsPoly(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      if (factor !== 0) {
        for (var j = 0; j < gen.length - 1; j++) {
          res[j] ^= mul(gen[j + 1], factor);
        }
      }
    }
    return res;
  }

  /* ---- таблицы по версиям, уровень M ---- */
  // всего кодовых слов в версии
  var TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  // [слов коррекции на блок, [[блоков, слов данных в блоке], …]]
  var GROUPS = [
    null,
    [10, [[1, 16]]],
    [16, [[1, 28]]],
    [26, [[1, 44]]],
    [18, [[2, 32]]],
    [24, [[2, 43]]],
    [16, [[4, 27]]],
    [18, [[4, 31]]],
    [22, [[2, 38], [2, 39]]],
    [22, [[3, 36], [2, 37]]],
    [26, [[4, 43], [1, 44]]]
  ];
  // центры выравнивающих узоров
  var ALIGN = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30],
    [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  function dataCapacity(v) {
    var g = GROUPS[v], n = 0;
    for (var i = 0; i < g[1].length; i++) n += g[1][i][0] * g[1][i][1];
    return n;
  }

  /* ---- BCH для служебных полей ---- */
  function bch(value, poly, bits) {
    var v = value << bits;
    var polyBits = 0, t = poly;
    while (t) { polyBits++; t >>= 1; }
    var vb = 0, u = v;
    while (u) { vb++; u >>= 1; }
    while (vb >= polyBits) {
      v ^= poly << (vb - polyBits);
      vb = 0; u = v;
      while (u) { vb++; u >>= 1; }
    }
    return (value << bits) | v;
  }

  function formatBits(mask) {
    // уровень M = 0b00; BCH(15,5), затем маска 0x5412
    return bch((0 << 3) | mask, 0x537, 10) ^ 0x5412;
  }

  function versionBits(v) { return bch(v, 0x1f25, 12); }

  /* ---- данные ---- */
  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.prototype.slice.call(new TextEncoder().encode(text));
    }
    var out = [], s = unescape(encodeURIComponent(text));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }

  function pickVersion(len) {
    for (var v = 1; v <= 10; v++) {
      var lenBits = v < 10 ? 8 : 16;
      if (dataCapacity(v) * 8 >= 4 + lenBits + len * 8) return v;
    }
    throw new Error('Строка не помещается в QR версии 10');
  }

  function buildCodewords(bytes, v) {
    var bits = [];
    function push(value, n) {
      for (var i = n - 1; i >= 0; i--) bits.push((value >> i) & 1);
    }

    push(4, 4);                              // режим: байты
    push(bytes.length, v < 10 ? 8 : 16);     // длина
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var capacity = dataCapacity(v) * 8;
    push(0, Math.min(4, capacity - bits.length));   // терминатор
    while (bits.length % 8) bits.push(0);

    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      data.push(byte);
    }
    var pad = [0xec, 0x11], p = 0;
    while (data.length < dataCapacity(v)) data.push(pad[p++ % 2]);

    // разбивка по блокам и чередование
    var spec = GROUPS[v], ecLen = spec[0];
    var blocks = [], ecBlocks = [], at = 0;
    for (var g = 0; g < spec[1].length; g++) {
      for (var n = 0; n < spec[1][g][0]; n++) {
        var size = spec[1][g][1];
        var chunk = data.slice(at, at + size);
        at += size;
        blocks.push(chunk);
        ecBlocks.push(rsEncode(chunk, ecLen));
      }
    }

    var out = [], maxLen = 0, e;
    for (e = 0; e < blocks.length; e++) maxLen = Math.max(maxLen, blocks[e].length);
    for (var c = 0; c < maxLen; c++) {
      for (e = 0; e < blocks.length; e++) {
        if (c < blocks[e].length) out.push(blocks[e][c]);
      }
    }
    for (var c2 = 0; c2 < ecLen; c2++) {
      for (e = 0; e < ecBlocks.length; e++) out.push(ecBlocks[e][c2]);
    }
    return out;
  }

  /* ---- матрица ---- */
  function newMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) m.push(new Array(size).fill(null));
    return m;
  }

  function placeFinder(m, r, c) {
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                 (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                 (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        m[rr][cc] = on ? 1 : 0;
      }
    }
  }

  function buildFunctions(v) {
    var size = v * 4 + 17;
    var m = newMatrix(size);

    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);

    // синхродорожки
    for (var i = 8; i < size - 8; i++) {
      m[6][i] = m[i][6] = (i % 2 === 0) ? 1 : 0;
    }

    // выравнивающие узоры
    var pos = ALIGN[v];
    var last = pos.length - 1;
    for (var a = 0; a < pos.length; a++) {
      for (var b = 0; b < pos.length; b++) {
        // три угла заняты поисковыми узорами; остальные ставятся всегда,
        // в том числе поверх синхродорожки — это норма
        if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
        var r = pos[a], c = pos[b];
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var edge = Math.max(Math.abs(dr), Math.abs(dc));
            m[r + dr][c + dc] = (edge !== 1) ? 1 : 0;
          }
        }
      }
    }

    m[size - 8][8] = 1;   // тёмный модуль

    // места под служебные поля резервируем нулём, значения впишем позже
    for (var k = 0; k <= 8; k++) {
      if (m[8][k] === null) m[8][k] = 0;
      if (m[k][8] === null) m[k][8] = 0;
    }
    for (var k2 = 0; k2 < 8; k2++) {
      if (m[8][size - 1 - k2] === null) m[8][size - 1 - k2] = 0;
      if (m[size - 1 - k2][8] === null) m[size - 1 - k2][8] = 0;
    }
    if (v >= 7) {
      for (var i2 = 0; i2 < 6; i2++) {
        for (var j2 = 0; j2 < 3; j2++) {
          m[i2][size - 11 + j2] = 0;
          m[size - 11 + j2][i2] = 0;
        }
      }
    }
    return m;
  }

  function placeData(m, codewords) {
    var size = m.length;
    var bitIndex = 0;
    var total = codewords.length * 8;
    var upward = true;

    for (var right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;   // столбец 6 занят синхродорожкой
      for (var step = 0; step < size; step++) {
        var row = upward ? size - 1 - step : step;
        for (var k = 0; k < 2; k++) {
          var col = right - k;
          if (m[row][col] !== null) continue;
          var bit = 0;
          if (bitIndex < total) {
            bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
            bitIndex++;
          }
          m[row][col] = bit;
        }
      }
      upward = !upward;
    }
  }

  function maskFn(n, r, c) {
    switch (n) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
    }
  }

  function penalty(m) {
    var size = m.length, score = 0, i, j, run, last;

    // правило 1: пять и более подряд
    for (i = 0; i < size; i++) {
      run = 1; last = m[i][0];
      for (j = 1; j < size; j++) {
        if (m[i][j] === last) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); last = m[i][j]; run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);

      run = 1; last = m[0][i];
      for (j = 1; j < size; j++) {
        if (m[j][i] === last) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); last = m[j][i]; run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    // правило 2: блоки 2×2
    for (i = 0; i < size - 1; i++) {
      for (j = 0; j < size - 1; j++) {
        var v0 = m[i][j];
        if (v0 === m[i][j + 1] && v0 === m[i + 1][j] && v0 === m[i + 1][j + 1]) score += 3;
      }
    }

    // правило 3: узор 1011101 с четырьмя светлыми с любой стороны
    var p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function match(get, n, pat) {
      for (var k = 0; k < pat.length; k++) if (get(n + k) !== pat[k]) return false;
      return true;
    }
    for (i = 0; i < size; i++) {
      for (j = 0; j + 11 <= size; j++) {
        /* jshint loopfunc:true */
        var row = (function (r) { return function (x) { return m[r][x]; }; })(i);
        var col = (function (c) { return function (x) { return m[x][c]; }; })(i);
        if (match(row, j, p1) || match(row, j, p2)) score += 40;
        if (match(col, j, p1) || match(col, j, p2)) score += 40;
      }
    }

    // правило 4: перекос светлого и тёмного
    var dark = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) dark += m[i][j];
    var percent = dark * 100 / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  function applyFormat(m, v, mask) {
    var size = m.length;
    var bits = formatBits(mask);
    for (var i = 0; i < 15; i++) {
      var bit = (bits >> i) & 1;
      // первая копия: столбец 8 сверху вниз, затем строка 8 справа налево
      if (i < 6) m[i][8] = bit;
      else if (i === 6) m[7][8] = bit;
      else if (i === 7) m[8][8] = bit;
      else if (i === 8) m[8][7] = bit;
      else m[8][14 - i] = bit;
      // вторая копия: строка 8 справа, затем столбец 8 снизу
      if (i < 8) m[8][size - 1 - i] = bit;
      else m[size - 15 + i][8] = bit;
    }
    m[size - 8][8] = 1;

    if (v >= 7) {
      var vb = versionBits(v);
      for (var k = 0; k < 18; k++) {
        var b = (vb >> k) & 1;
        var r = Math.floor(k / 3), c = k % 3;
        m[r][size - 11 + c] = b;
        m[size - 11 + c][r] = b;
      }
    }
  }

  /* Строит матрицу модулей: массив массивов 0/1. */
  function encode(text, forceMask) {
    var bytes = utf8(text);
    var v = pickVersion(bytes.length);
    var codewords = buildCodewords(bytes, v);

    var fn = buildFunctions(v);
    var reserved = fn.map(function (row) {
      return row.map(function (cell) { return cell !== null; });
    });

    var base = fn.map(function (row) { return row.slice(); });
    placeData(base, codewords);

    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      if (forceMask !== undefined && forceMask !== null && mask !== forceMask) continue;
      var m = base.map(function (row) { return row.slice(); });
      for (var r = 0; r < m.length; r++) {
        for (var c = 0; c < m.length; c++) {
          if (!reserved[r][c] && maskFn(mask, r, c)) m[r][c] ^= 1;
        }
      }
      applyFormat(m, v, mask);
      var s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  /* Рисует QR в <canvas>. quiet — поле в модулях (стандарт требует 4). */
  function draw(canvas, text, px, quiet) {
    var m = encode(text);
    var size = m.length;
    quiet = (quiet === undefined) ? 4 : quiet;
    var full = (size + quiet * 2) * px;

    var ratio = window.devicePixelRatio || 1;
    canvas.width = full * ratio;
    canvas.height = full * ratio;
    canvas.style.width = full + 'px';
    canvas.style.height = full + 'px';

    var ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, full, full);
    ctx.fillStyle = '#181818';
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (m[r][c]) ctx.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
      }
    }
    return m;
  }

  return { encode: encode, draw: draw,
           _debug: { buildFunctions: buildFunctions, buildCodewords: buildCodewords,
                     utf8: utf8, pickVersion: pickVersion, maskFn: maskFn } };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = QR; }
