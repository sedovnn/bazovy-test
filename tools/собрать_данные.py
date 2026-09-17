#!/usr/bin/env python3
"""Собирает контент теста из спеки.

    python3 tools/собрать_данные.py

Читает spec/базовый_тест_v*.md и spec/промпт_судьи*.md, переписывает:
  js/data.js                — тексты ситуаций, вариантов и записки (БЕЗ ключей)
  js/keys.js                — ключ: id ситуации → уровень каждого варианта
  apps-script/keys.gs       — тот же ключ для бэкенда
  apps-script/config.gs     — состав ситуаций, навыков и способностей
  apps-script/judge_prompt.gs — промпт судьи целиком, дословно
  apps-script/scoring.gs    — копия js/scoring.js

Руками эти три файла не правят: пришла новая вычитка — положили md в spec/,
убрали прежний, прогнали скрипт. Если разметка изменится, скрипт упадёт
с понятной ошибкой, а не соберёт молча половину.

РАЗМЕТКА, НА КОТОРУЮ ОПИРАЕМСЯ (v1.0):
  ## Часть 1. …          → ### Ситуация N → абзац кейса, **вопрос**, пять «- …»
  ## Часть 2. …          → абзац кейса, **задание … 150–250 слов.**
  # Ключи и критерии …   → **Ситуация N — КОД · Название.** Ключ: буквы через «→»,
                            от сильного варианта к слабому

⚠ ВАРИАНТЫ В v1.0 БЕЗ БУКВ. Ключ по-прежнему записан буквами, поэтому буквы
раздаются по порядку следования: первый «-» = A, пятый = E. В v0.9 буквы стояли
явно и шли ровно в этом порядке, содержание вариантов при переписывании не
переставляли — но это допущение, и оно проверяется глазами один раз на версию.

⚠ Собранный ключ (js/keys.js, apps-script/keys.gs) в публичный репозиторий не
коммитится: он в .gitignore. Не вписывайте сюда сам порядок даже примером.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SKILLS = [
    ('context', 'Анализ контекста',      ['ak1', 'ak2'], None),
    ('alt',     'Генерация альтернатив', ['ga2'],        'ГА-1'),
    ('prio',    'Приоритизация',         ['pr2'],        'ПР-1'),
    ('future',  'Картина будущего',      ['mk2'],        'МК-1'),
    ('path',    'Путь к цели',           ['pp2'],        'ПП-1'),
]

CODE_TO_ID = {'АК-1': 'ak1', 'АК-2': 'ak2', 'ГА-2': 'ga2',
              'ПР-2': 'pr2', 'МК-2': 'mk2', 'ПП-2': 'pp2'}

ABILITIES = [('МК-1', 'Амбициозность цели'), ('ГА-1', 'Генерация альтернатив'),
             ('ПР-1', 'Выбор инициатив'), ('ПП-1', 'Маршрут')]

LETTERS = ['A', 'B', 'C', 'D', 'E']


def fail(msg):
    sys.exit(f'ОШИБКА: {msg}')


def find_spec():
    found = sorted((ROOT / 'spec').glob('базовый_тест_v*.md'))
    if not found:
        fail('в spec/ нет файла базовый_тест_v*.md')
    if len(found) > 1:
        fail('в spec/ несколько версий теста: ' + ', '.join(f.name for f in found) +
             '. Оставьте одну — источник истины должен быть один.')
    return found[0]


def section(text, start_pat, end_pat):
    s = re.search(start_pat, text, re.M)
    if not s:
        fail(f'не нашёл раздел по шаблону {start_pat!r}')
    rest = text[s.end():]
    e = re.search(end_pat, rest, re.M)
    return rest[:e.start()] if e else rest


def parse_situations(text):
    chunk = section(text, r'^## Часть 1\..*$', r'^## Часть 2\.')
    out = []
    for raw in re.split(r'\n### Ситуация\s+', chunk)[1:]:
        lines = raw.split('\n')
        num = lines[0].strip().rstrip('.')
        if not num.isdigit():
            fail(f'не разобрал номер ситуации: {lines[0]!r}')
        body = '\n'.join(lines[1:])

        opts = [m.strip() for m in re.findall(r'^-\s+(.+?)\s*$', body, re.M)]
        if len(opts) != 5:
            fail(f'ситуация {num}: ожидал 5 вариантов, нашёл {len(opts)}')

        first_opt = body.find('\n- ')
        before = body[:first_opt] if first_opt >= 0 else body

        q = re.findall(r'^\*\*(.+?)\*\*$', before.strip(), re.M)
        if len(q) != 1:
            fail(f'ситуация {num}: ожидал ровно один вопрос в **…**, нашёл {len(q)}')

        case_lines = [ln.strip() for ln in before.split('\n')
                      if ln.strip() and not ln.strip().startswith('**')]
        if not case_lines:
            fail(f'ситуация {num}: пустой текст ситуации')

        out.append({
            'num': int(num),
            'caseText': ' '.join(case_lines),
            'question': q[0].strip(),
            'options': [{'id': LETTERS[i], 'text': t} for i, t in enumerate(opts)],
        })

    if len(out) != 6:
        fail(f'ожидал 6 ситуаций, нашёл {len(out)}')
    return out


def parse_keys(text):
    chunk = section(text, r'^# Ключи и критерии.*$', r'^## Подсчёт')
    keys = {}
    pat = r'^\*\*Ситуация\s+(\d+)\s*—\s*([А-ЯA-Z]+-\d)\s*·\s*(.+?)\.\*\*\s*Ключ:\s*([A-E](?:\s*→\s*[A-E]){4})'
    for num, code, title, order in re.findall(pat, chunk, re.M):
        if code not in CODE_TO_ID:
            fail(f'неизвестный код фактора {code!r} — добавьте его в CODE_TO_ID')
        seq = [x.strip() for x in order.split('→')]
        if sorted(seq) != LETTERS:
            fail(f'ситуация {num}: в ключе не все пять вариантов: {seq}')
        keys[int(num)] = {'code': code, 'title': title.strip(),
                          'key': {oid: 5 - i for i, oid in enumerate(seq)}}
    if len(keys) != 6:
        fail(f'в разделе ключей найдено {len(keys)} ситуаций из 6')
    return keys


def parse_note(text):
    chunk = section(text, r'^## Часть 2\..*$', r'^#{1,2} ')
    lines = [ln.strip() for ln in chunk.split('\n') if ln.strip() and ln.strip() != '---']

    task = [ln.strip('*').strip() for ln in lines if ln.startswith('**')]
    case_lines = [ln for ln in lines if not ln.startswith('**') and not ln.startswith('_')]
    if not case_lines or not task:
        fail('записка: не разобрал текст ситуации и задание')

    m = re.search(r'(\d+)\s*[–—-]\s*(\d+)\s*слов', task[0])
    if not m:
        fail('записка: в задании не нашёлся объём «150–250 слов»')

    return {'caseText': ' '.join(case_lines), 'task': task[0],
            'targetFrom': int(m.group(1)), 'targetTo': int(m.group(2))}


def js(value, indent=2):
    return json.dumps(value, ensure_ascii=False, indent=indent)


def main():
    spec_path = find_spec()
    text = spec_path.read_text(encoding='utf-8')
    vm = re.search(r'—\s*(v[\d.]+)', text.split('\n')[0])
    version = vm.group(1) if vm else 'unknown'

    situations = parse_situations(text)
    keys = parse_keys(text)
    note = parse_note(text)

    block_a, key_map = [], {}
    for s in situations:
        k = keys.get(s['num'])
        if not k:
            fail(f'для ситуации {s["num"]} нет ключа')
        sid = CODE_TO_ID[k['code']]
        block_a.append({'id': sid, 'factor': k['code'], 'title': k['title'],
                        'caseText': s['caseText'], 'question': s['question'],
                        'options': s['options']})
        key_map[sid] = k['key']

    head = (f'/* СОБРАНО АВТОМАТИЧЕСКИ из spec/{spec_path.name}.\n'
            '   Руками не править: изменения затрёт следующий прогон\n'
            '   tools/собрать_данные.py. Правится спека, потом скрипт. */\n\n')

    data = {
        'version': version,
        'blockA': block_a,
        'blockB': dict(note, minWords=100),
        'skills': [{'id': i, 'name': n, 'situations': sit, 'ability': ab} for i, n, sit, ab in SKILLS],
        'abilities': [{'id': i, 'name': n} for i, n in ABILITIES],
        'zones': ['не видит', 'видит, путает', 'выбирает'],
        'stages': [{'id': 'baseline', 'name': 'До модуля'},
                   {'id': 'module', 'name': 'После модуля'},
                   {'id': 'final', 'name': 'Единоразовый'}],
    }

    (ROOT / 'js' / 'data.js').write_text(
        head +
        '/* minWords — порог отправки из ТЗ продукта (100), не из спеки: спека просит 150–250. */\n'
        'var TEST = ' + js(data) + ';\n\n'
        "if (typeof module !== 'undefined' && module.exports) { module.exports = TEST; }\n",
        encoding='utf-8')

    key_head = head.replace('*/', '   Ключ: id ситуации → уровень L1–L5 каждого варианта.\n'
                                  '   Буквы розданы по порядку следования вариантов в спеке. */')
    body = ('var KEYS = ' + js(key_map) + ';\n\n'
            "if (typeof module !== 'undefined' && module.exports) { module.exports = KEYS; }\n")
    (ROOT / 'js' / 'keys.js').write_text(key_head + body, encoding='utf-8')
    (ROOT / 'apps-script' / 'keys.gs').write_text(key_head + body, encoding='utf-8')

    # ---- конфиг для бэкенда: состав без текстов ----
    cfg = {
        'situations': [s['id'] for s in block_a],
        'factors': {s['id']: s['factor'] for s in block_a},
        'skills': data['skills'],
        'abilities': data['abilities'],
        'zones': data['zones'],
        'testVersion': version,
    }
    (ROOT / 'apps-script' / 'config.gs').write_text(
        head + 'var CONFIG = ' + js(cfg) + ';\n', encoding='utf-8')

    # ---- промпт судьи: целиком, дословно ----
    prompts = sorted((ROOT / 'spec').glob('промпт_судьи*.md'))
    if len(prompts) != 1:
        fail('в spec/ должен лежать ровно один промпт_судьи*.md, найдено: ' +
             ', '.join(p.name for p in prompts))
    prompt_text = prompts[0].read_text(encoding='utf-8')
    pv = re.search(r'v\d+(?:\.\d+)*', prompts[0].name)
    lines = ',\n'.join(json.dumps(ln, ensure_ascii=False) for ln in prompt_text.split('\n'))
    (ROOT / 'apps-script' / 'judge_prompt.gs').write_text(
        f'/* СОБРАНО АВТОМАТИЧЕСКИ из spec/{prompts[0].name}.\n'
        '   Промпт судьи целиком и дословно — правится только спека.\n'
        '   Строки закодированы как JSON, чтобы кавычки, обратные апострофы\n'
        '   и markdown внутри не ломали литерал. */\n\n'
        f"var JUDGE_PROMPT_VERSION = {json.dumps(pv.group(0) if pv else 'unknown')};\n\n"
        'var JUDGE_PROMPT = [\n' + lines + '\n].join(\'\\n\');\n',
        encoding='utf-8')

    # ---- подсчёт: один код на два рантайма ----
    scoring = (ROOT / 'js' / 'scoring.js').read_text(encoding='utf-8')
    (ROOT / 'apps-script' / 'scoring.gs').write_text(scoring, encoding='utf-8')

    print(f'Спека {spec_path.name} ({version}).')
    print(f'  ситуаций {len(block_a)}, вариантов {sum(len(s["options"]) for s in block_a)}')
    print(f'  записка {note["targetFrom"]}–{note["targetTo"]} слов')
    print(f'  порядок: {", ".join(s["factor"] for s in block_a)}')
    uniform = len({tuple(sorted(k.items())) for k in key_map.values()}) == 1
    print('  ключ одинаков во всех ситуациях' if uniform else
          '  ВНИМАНИЕ: ключи различаются по ситуациям — подсчёт читает их по ситуации')
    print(f'  промпт судьи {prompts[0].name}: {len(prompt_text.splitlines())} строк, '
          f'{len(prompt_text.encode("utf-8")) / 1024:.0f} КБ')
    print('Переписаны: js/data.js, js/keys.js, apps-script/{keys,config,judge_prompt,scoring}.gs')


if __name__ == '__main__':
    main()
