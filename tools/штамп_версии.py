#!/usr/bin/env python3
"""Проставляет версию в ссылки на css и js.

    python3 tools/штамп_версии.py

Без этого браузер держит старые css/js до десяти минут после выкладки, и участник
на пилоте может получить прошлую версию теста. Прогонять перед каждым пушем,
который трогает фронт. Версия — метка времени, содержание её не важно, важно что
она меняется."""

import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ['index.html', 'host.html']
LOCAL = re.compile(r'(?:href|src)="((?:css|js)/[^"?]+)(\?v=[^"]*)?"')

stamp = datetime.now().strftime('%Y%m%d-%H%M')
total = 0

for name in FILES:
    p = ROOT / name
    text = p.read_text(encoding='utf-8')
    count = 0

    def sub(m):
        global count
        count += 1
        attr = m.group(0).split('=', 1)[0]
        return f'{attr}="{m.group(1)}?v={stamp}"'

    new = LOCAL.sub(sub, text)
    if new != text:
        p.write_text(new, encoding='utf-8')
    print(f'{name}: проставлено ссылок {count}')
    total += count

if not total:
    sys.exit('ОШИБКА: не нашёл ни одной локальной ссылки на css/js — проверьте разметку')
print(f'Версия: {stamp}')
