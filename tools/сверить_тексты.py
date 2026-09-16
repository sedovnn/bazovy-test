#!/usr/bin/env python3
"""Сверяет собранный js/data.js со спекой: каждый текст обязан встречаться
в spec/базовый_тест_v*.md дословно. Запуск: python3 tools/сверить_тексты.py

Генератор и так собирает данные из спеки — эта проверка ловит случай, когда
data.js правили руками в обход генератора."""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
found = sorted((ROOT / 'spec').glob('базовый_тест_v*.md'))
if len(found) != 1:
    sys.exit('ОШИБКА: в spec/ должен лежать ровно один базовый_тест_v*.md')
spec = found[0].read_text(encoding='utf-8')
raw = (ROOT / 'js' / 'data.js').read_text(encoding='utf-8')

m = re.search(r'var TEST = (\{.*?\});\n', raw, re.S)
if not m:
    sys.exit('ОШИБКА: не нашёл объект TEST в js/data.js')
data = json.loads(m.group(1))

checked = failed = 0
def check(label, value):
    global checked, failed
    checked += 1
    # в спеке текст ситуации может быть разбит на абзацы — сверяем по предложениям
    parts = [value] if value in spec else [p.strip() for p in value.split('  ') if p.strip()]
    for part in parts:
        if part not in spec:
            failed += 1
            print(f'РАСХОЖДЕНИЕ [{label}]:\n  {part[:140]}\n')
            return

for s in data['blockA']:
    check(s['factor'] + '/case', s['caseText'])
    check(s['factor'] + '/question', s['question'])
    for o in s['options']:
        check(f'{s["factor"]}/{o["id"]}', o['text'])
check('Б/case', data['blockB']['caseText'])
check('Б/task', data['blockB']['task'])

print(f'Проверено текстов: {checked}. Расхождений: {failed}.')
sys.exit(1 if failed else 0)
