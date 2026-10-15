#!/usr/bin/env python3
"""Сверяет промпты судьи с кейсами.

    python3 tools/сверить_промпты.py

Промпт каждого кейса собирается генератором из шаблона обёртки и того же
файла кейсов. Проверка ловит рассинхрон, если judge_prompts.gs собран
со старой спекой или правился руками:
  1. у каждого кейса есть промпт;
  2. новость, все 24 комментария и все 3 своих вопроса попали в промпт дословно;
  3. не осталось неподставленных {{…}} из шаблона.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def norm(s):
    return ' '.join(str(s).split())


setup = json.loads(re.search(r'var CONFIG = (\{.*?\});\n',
                             (ROOT / 'js' / 'config.js').read_text(encoding='utf-8'), re.S).group(1))
src = (ROOT / 'apps-script' / 'judge_prompts.gs').read_text(encoding='utf-8')

prompts = {}
for m in re.finditer(r'^  ("[^"]+"): \{\n    version: ("[^"]*"),\n    text: \[\n(.*?)\n    \]\.join', src, re.M | re.S):
    lines = [json.loads(ln.rstrip(',')) for ln in m.group(3).split('\n')]
    prompts[json.loads(m.group(1))] = norm('\n'.join(lines).replace('> ', ' ').replace('>', ' '))

bad = 0
for entry in setup['tests']:
    text = prompts.get(entry['id'])
    if text is None:
        print(f'ПЛОХО  у кейса {entry["id"]} нет промпта судьи')
        bad += 1
        continue
    data = json.loads((ROOT / entry['file']).read_text(encoding='utf-8'))
    items = [data['news']['title']] + data['news']['post']
    for s in data['situations']:
        items += s['post'] + [o['text'] for o in s['options']]
    items += [q['text'] for q in data['free']]
    miss = [x for x in items if norm(x) not in text]
    for x in miss:
        print(f'ПЛОХО  {entry["id"]}: в промпте нет «{norm(x)[:90]}…»')
    if '{{' in text:
        print(f'ПЛОХО  {entry["id"]}: в промпте остался неподставленный {{{{…}}}}')
        bad += 1
    bad += len(miss)
    print(f'{entry["id"]}: сверено {len(items)} кусков')

print()
print('Промпты сходятся с кейсами.' if not bad else f'ПРОВАЛЕНО: {bad}')
sys.exit(1 if bad else 0)
