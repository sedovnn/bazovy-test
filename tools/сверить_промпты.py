#!/usr/bin/env python3
"""Сверяет промпты судьи с тестами, к которым они привязаны.

    python3 tools/сверить_промпты.py

Судья видит посты и реплики ситуаций 5–6 — они вписаны в промпт дословно.
Если пост правят в тесте и забывают в промпте, судья оценивает ответы
по устаревшему кейсу, и никакая другая проверка этого не видит.

Проверяет три вещи:
  1. У каждого теста есть промпт. Привязка — по «(тест vX.Y)» в первой строке
     файла промпта. Переименовали тест — промпт осиротел.
  2. Посты и реплики ситуаций 5–6 попали в промпт дословно.
  3. Формулировки свободных вопросов в промпте совпадают с тестом.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'spec'


def norm(s):
    return ' '.join(str(s).split())


def situations(text):
    """Ситуация → (пост, [реплики]). Разбор тот же, что у собрать_тесты.py."""
    body = text[:text.index('# Ключи')] if '# Ключи' in text else text
    out = {}
    for chunk in re.split(r'\n## (?:Новость|Ситуация)\s+', body)[1:]:
        lines = chunk.split('\n')
        num = lines[0].split('—')[0].strip()
        rest = re.split(r'\n### Свободный вопрос', '\n'.join(lines[1:]))[0]
        bullets = [m.strip() for m in re.findall(r'^-\s+(.+?)\s*$', rest, re.M)]
        first = rest.find('\n- ')
        before = rest[:first] if first >= 0 else rest
        post = [ln.strip() for ln in before.split('\n')
                if ln.strip() and not ln.strip().startswith('**')]
        out[int(num)] = (' '.join(post), bullets)
    return out


def free_questions(text):
    return {int(n): norm(' '.join(ln.strip() for ln in tail.split('\n')
                                  if ln.strip() and not ln.startswith('#')
                                  and set(ln.strip()) != {'-'}))
            for n, _, tail in re.findall(
                r'### Свободный вопрос\s+(\d+)\s*—\s*появляется после расстановки '
                r'в (?:новости|ситуации)\s+(\d+)\s*\n(.+?)(?=\n#|\Z)', text, re.S)}


bad = 0
prompts = {}
for path in sorted(SPEC.glob('промпт_судьи*.md')):
    text = path.read_text(encoding='utf-8')
    m = re.search(r'\(тест\s+(v[\d.]+)\)', text.split('\n')[0])
    if not m:
        print(f'ПЛОХО  {path.name}: в первой строке нет «(тест vX.Y)» — '
              'привязать не к чему')
        bad += 1
        continue
    # цитаты в промпте идут markdown-блоком «> …» и могут быть в несколько
    # абзацев — сравниваем без маркеров цитаты
    прямой = re.sub(r'^\s*>\s?', '', text, flags=re.M)
    prompts.setdefault(m.group(1), []).append((path.name, norm(прямой)))

for test_path in sorted(SPEC.glob('тест_v*.md')):
    text = test_path.read_text(encoding='utf-8')
    test_id = re.search(r'^#\s*Тест\s+(v[\d.]+)', text, re.M).group(1)
    got = prompts.get(test_id)

    if not got:
        print(f'ПЛОХО  {test_path.name} ({test_id}): промпта судьи нет. '
              'Свободные ответы этого теста оценивать нечем.')
        свободные = [n for n, v in prompts.items()]
        print(f'       Промпты в spec/ привязаны к: {", ".join(sorted(свободные)) or "—"}')
        bad += 1
        continue
    if len(got) > 1:
        print(f'ПЛОХО  {test_id}: на него нацелены сразу {len(got)} промпта: '
              + ', '.join(n for n, _ in got))
        bad += 1
        continue

    name, prompt = got[0]
    sits = situations(text)
    checked = 0

    for num in (5, 6):
        post, bullets = sits[num]
        if norm(post) not in prompt:
            print(f'ПЛОХО  {name}: новость {num} из {test_path.name} '
                  'в промпт не попала дословно')
            print(f'       {norm(post)[:110]}…')
            bad += 1
        checked += 1
        for i, b in enumerate(bullets, 1):
            if norm(b) not in prompt:
                print(f'ПЛОХО  {name}: комментарий {i} новости {num} '
                      'в промпт не попал дословно')
                print(f'       {norm(b)[:110]}…')
                bad += 1
            checked += 1

    for num, q in free_questions(text).items():
        if q not in prompt:
            print(f'ПЛОХО  {name}: свободный вопрос {num} записан в промпте иначе, '
                  'чем в тесте')
            print(f'       тест: {q[:110]}…')
            bad += 1
        checked += 1

    print(f'{test_id} → {name}: сверено {checked} кусков')

print()
print('Промпты сходятся с тестами.' if not bad else f'ПРОВАЛЕНО: {bad}')
sys.exit(1 if bad else 0)
