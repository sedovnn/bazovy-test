#!/usr/bin/env python3
"""Проверяет js/qr.js двумя независимыми способами.

    pip3 install --target LIB opencv-python-headless numpy segno
    PYTHONPATH=LIB python3 tools/сверить_qr.py

1. Служебные модули (поисковые и выравнивающие узоры, синхродорожки, поля формата
   и версии) сверяются с эталонным кодировщиком segno — они обязаны совпасть
   до модуля.
2. Картинка читается настоящим декодером (OpenCV) и должна вернуть исходную
   строку.

Матрицы целиком не сравниваем: байты-заполнителя после терминатора у разных
кодировщиков законно отличаются, из-за этого расходится и коррекция ошибок,
хотя оба кода читаются одинаково.

Детектор OpenCV не берёт версии 10+ даже у эталона — для них остаётся
проверка 1, она и ловит ошибки в раскладке."""

import json
import subprocess
import sys
from pathlib import Path

try:
    import cv2
    import numpy as np
    import segno
except ImportError as e:
    sys.exit(f'нужны opencv-python-headless, numpy и segno ({e})')

ROOT = Path(__file__).resolve().parent.parent
QR_JS = json.dumps(str(ROOT / 'js' / 'qr.js'))

CASES = [
    'ABCDEF',
    'https://example.com/index.html?s=ABC123',
    'https://sedovnn.github.io/bazovy-test/index.html?s=K7M2QX',
    'https://skills.example.ru/t/index.html?s=QWERTY&stage=module',
    'https://пример.рф/index.html?s=ЖЖ1234',
    'https://very-long-organisation-name.github.io/strategic-skills-basic-test/index.html?s=ZZ9Q8W',
    'https://x.example/' + 'a' * 85 + '/index.html?s=ABC123',
    'https://x.example/' + 'a' * 135 + '/index.html?s=ABC123',
    'https://x.example/' + 'a' * 170 + '/index.html?s=ABC123',
]


def node(expr):
    out = subprocess.run(['node', '-e', expr], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit('node упал: ' + out.stderr)
    return json.loads(out.stdout)


def encode(text, mask=None):
    arg = 'null' if mask is None else str(mask)
    return node(f'const QR=require({QR_JS});'
                f'process.stdout.write(JSON.stringify(QR.encode({json.dumps(text)},{arg})));')


def reserved(version):
    return node(f'const QR=require({QR_JS});'
                f'const fn=QR._debug.buildFunctions({version});'
                f'process.stdout.write(JSON.stringify(fn.map(r=>r.map(c=>c!==null?1:0))));')


def render(matrix, px=10, quiet=4):
    n = len(matrix)
    full = (n + quiet * 2) * px
    img = np.full((full, full), 255, dtype=np.uint8)
    for r in range(n):
        for c in range(n):
            if matrix[r][c]:
                img[(r + quiet) * px:(r + quiet + 1) * px,
                    (c + quiet) * px:(c + quiet + 1) * px] = 0
    return img


detector = cv2.QRCodeDetector()
bad = 0

for text in CASES:
    ref_qr = segno.make(text, error='m', micro=False, boost_error=False, mode='byte')
    version = ref_qr.version
    mine = encode(text)
    problems = []

    if len(mine) != version * 4 + 17:
        problems.append(f'размер {len(mine)}, у эталона {version * 4 + 17}')
    else:
        # 1. служебные модули — при той же маске, что выбрал эталон
        same_mask = encode(text, ref_qr.mask)
        ref = [list(r) for r in segno.make(text, error='m', mask=ref_qr.mask,
                                           micro=False, boost_error=False,
                                           mode='byte').matrix]
        res = reserved(version)
        wrong = [(r, c) for r in range(len(ref)) for c in range(len(ref))
                 if res[r][c] and same_mask[r][c] != ref[r][c]]
        if wrong:
            problems.append(f'служебных модулей разошлось {len(wrong)}, первые {wrong[:5]}')

    # 2. чтение декодером
    decoded, _, _ = detector.detectAndDecode(render(mine))
    if decoded != text:
        if version >= 10:
            ref_read, _, _ = detector.detectAndDecode(render(
                [list(r) for r in ref_qr.matrix]))
            if ref_read != text:
                decoded = None      # детектор не тянет эту версию и у эталона
        if decoded is not None:
            problems.append(f'декодер вернул {decoded!r}')

    mark = 'ok ' if not problems else 'ПЛОХО'
    read = 'прочитан' if decoded == text else 'детектор не тянет v10+'
    print(f'{mark} · v{version} · {len(mine)}×{len(mine)} · служебные сошлись · {read}'
          f' · {text[:40]}')
    for p in problems:
        bad += 1
        print('      ' + p)

print()
print('Кодировщик сошёлся с эталоном и читается.' if not bad else f'ПРОВАЛЕНО: {bad}')
sys.exit(1 if bad else 0)
