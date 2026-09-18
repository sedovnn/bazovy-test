#!/usr/bin/env python3
"""Ловит то, чего не видит проверка синтаксиса.

    python3 tools/проверить_фронт.py

1. Вызов функции, которой нет. Так пропала groupRow: её вырезали вместе
   с соседним куском, синтаксис остался верным, экран ведущего сломался.
2. getElementById на id, которого нет в разметке.

Проверка грубая, на регулярках, но именно эти две поломки она видит."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PAGES = {
    'index.html': ['js/data.js', 'js/api.js', 'js/test.js'],
    'host.html': ['js/data.js', 'js/qr.js', 'js/api.js', 'js/host.js'],
}

BROWSER = {
    'document', 'window', 'console', 'JSON', 'Math', 'Date', 'Object', 'Array', 'String',
    'Number', 'Boolean', 'Promise', 'Error', 'RegExp', 'Map', 'Set', 'parseInt', 'parseFloat',
    'isNaN', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch', 'alert',
    'prompt', 'confirm', 'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape',
    'URLSearchParams', 'Event', 'AbortController', 'TextEncoder', 'Uint8Array', 'localStorage',
    'sessionStorage', 'navigator', 'location', 'require', 'module', 'if', 'for', 'while',
    'switch', 'catch', 'return', 'typeof', 'function', 'new', 'else', 'do', 'in', 'of',
}

def strip_comments(text):
    out, i, n = [], 0, len(text)
    while i < n:
        two = text[i:i + 2]
        if two == '/*':
            j = text.find('*/', i + 2); j = n if j < 0 else j + 2
            out.append('\n' * text[i:j].count('\n')); i = j
        elif two == '//':
            j = text.find('\n', i); i = n if j < 0 else j
        elif text[i] in '"\'':
            q, j = text[i], i + 1
            while j < n and text[j] != q:
                j += 2 if text[j] == '\\' else 1
            i = j + 1
        else:
            out.append(text[i]); i += 1
    return ''.join(out)


def defined_names(code):
    names = set()
    names |= set(re.findall(r'\bfunction\s+([A-Za-zА-Яа-я_$][\w$А-Яа-я]*)\s*\(', code))
    names |= set(re.findall(r'\b(?:var|let|const)\s+([A-Za-zА-Яа-я_$][\w$А-Яа-я]*)', code))
    for params in re.findall(r'\bfunction\s*[\w$А-Яа-я]*\s*\(([^)]*)\)', code):
        for part in params.split(','):
            part = part.strip()
            if part:
                names.add(part)
    names |= set(re.findall(r'\bcatch\s*\(\s*([\w$]+)\s*\)', code))
    return names


bad = 0

for page, scripts in PAGES.items():
    html = (ROOT / page).read_text(encoding='utf-8')
    ids = set(re.findall(r'\bid="([^"]+)"', html))

    combined, per_file = '', {}
    for rel in scripts:
        code = strip_comments((ROOT / rel).read_text(encoding='utf-8'))
        per_file[rel] = code
        combined += '\n' + code

    known = defined_names(combined) | BROWSER
    # глобальные из data.js / keys.js / scoring.js, подключаемых отдельно
    known |= {'TEST', 'KEYS', 'QR', 'API', 'MOCK', 'buildMap', 'scoreSituation',
              'zoneIndex', 'combinedValue', 'valueBucket', 'BUCKET_NAMES', 'ZONE_NAMES'}

    print(f'\n{page}')

    for rel, code in per_file.items():
        # вызовы вида имя( , не после точки
        for m in re.finditer(r'(?<![.\w$])([A-Za-zА-Яа-я_$][\w$А-Яа-я]*)\s*\(', code):
            name = m.group(1)
            if name in known:
                continue
            line = code[:m.start()].count('\n') + 1
            print(f'  ПЛОХО  {rel}:{line} — вызывается {name}(), а определения нет')
            bad += 1

        for m in re.finditer(r"getElementById\(\s*'([^']+)'\s*\)", code):
            if m.group(1) not in ids:
                line = code[:m.start()].count('\n') + 1
                print(f'  ПЛОХО  {rel}:{line} — id "{m.group(1)}" в {page} отсутствует')
                bad += 1

    if not bad:
        print('  ok · все вызовы и id на месте')

print()
print('Фронт сходится.' if not bad else f'ПРОВАЛЕНО: {bad}')
sys.exit(1 if bad else 0)
