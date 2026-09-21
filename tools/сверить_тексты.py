#!/usr/bin/env python3
"""Сверяет собранные data/test_*.json со спекой и проверяет, что в публичных
файлах нет ключа.

    python3 tools/сверить_тексты.py

1. Каждый текст обязан встречаться в соответствующем spec/тест_v*.md дословно.
   Генератор и так собирает данные из спеки — проверка ловит случай, когда
   json правили руками в обход генератора.
2. Метка реплики — хеш её текста, и реплики в файле идут по метке. Это
   единственное, что мешает прочитать ключ прямо из data/*.json: в спеке
   реплики стоят по возрастанию силы, и если сохранить тот порядок, файл
   и будет готовой расстановкой. Однажды так и было.
"""

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

setup = json.loads(re.search(r'var CONFIG = (\{.*?\});\n',
                             (ROOT / 'js' / 'config.js').read_text(encoding='utf-8'),
                             re.S).group(1))


def norm(s):
    """Сравниваем без разницы в пробелах: в json абзацы склеены."""
    return ' '.join(str(s).split())


bad = 0
for entry in setup['tests']:
    slug = entry['id'].replace('.', '_')
    spec_files = sorted((ROOT / 'spec').glob(f'тест_{entry["id"]}.md'))
    if len(spec_files) != 1:
        print(f'ПЛОХО  для теста {entry["id"]} в spec/ нет файла тест_{entry["id"]}.md')
        bad += 1
        continue

    spec = norm(spec_files[0].read_text(encoding='utf-8'))
    data = json.loads((ROOT / entry['file']).read_text(encoding='utf-8'))

    checked = 0
    items = [('вводная', data['intro'])]
    for s in data['situations']:
        for i, para in enumerate(s['post']):
            items.append((f'ситуация {s["num"]}, абзац {i + 1}', para))
        items.append((f'ситуация {s["num"]}, вопрос', s['question']))
        for j, o in enumerate(s['options'], 1):
            items.append((f'ситуация {s["num"]}, реплика {j}', o['text']))
    for q in data['free']:
        items.append((f'свободный вопрос {q["num"]}', q['text']))

    for where, text in items:
        checked += 1
        if norm(text) not in spec:
            print(f'ПЛОХО  {entry["id"]} · {where}: в спеке такого текста нет')
            print(f'       {norm(text)[:120]}…')
            bad += 1

    # метки реплик: хеш текста, и порядок в файле — по метке
    for s in data['situations']:
        ids = [o['id'] for o in s['options']]
        if ids != sorted(ids):
            print(f'ПЛОХО  {entry["id"]} · ситуация {s["num"]}: реплики идут не по метке. '
                  'Скорее всего, остался порядок спеки — это и есть ключ.')
            bad += 1
        for o in s['options']:
            seed = '|'.join([entry['id'], s['id'], norm(o['text'])])
            want = hashlib.sha1(seed.encode('utf-8')).hexdigest()[:6]
            if o['id'] != want:
                print(f'ПЛОХО  {entry["id"]} · ситуация {s["num"]}: метка «{o["id"]}» '
                      f'не выводится из текста реплики (ожидал «{want}»)')
                bad += 1

    # отпечаток из config.js должен совпадать с файлом на диске
    digest = hashlib.sha1((ROOT / entry['file']).read_bytes()).hexdigest()[:8]
    if digest != entry['v']:
        print(f'ПЛОХО  {entry["id"]}: отпечаток в js/config.js ({entry["v"]}) '
              f'не совпадает с файлом ({digest}) — прогоните собрать_тесты.py')
        bad += 1

    print(f'{entry["id"]}: сверено {checked} текстов' + ('' if not bad else ''))

print()
print('Тексты сходятся со спекой.' if not bad else f'ПРОВАЛЕНО: {bad}')
sys.exit(1 if bad else 0)
