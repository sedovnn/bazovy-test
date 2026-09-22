#!/usr/bin/env python3
"""Собирает контент из спеки (правила + тесты) в данные фронта и бэкенда.

    python3 tools/собрать_тесты.py

Читает spec/правила_тестирования_v*.md, все spec/тест_v*.md и все
spec/промпт_судьи*.md, переписывает:

  data/test_<версия>.json    — тексты ОДНОГО теста (БЕЗ ключей), по файлу на тест
  js/config.js               — общая часть: навыки, способности, зоны, этапы,
                               список тестов с именами файлов
  js/keys.js                 — ключи: тест → ситуация → уровень каждой реплики
  apps-script/keys.gs        — то же для бэкенда
  apps-script/config.gs      — состав навыков, способностей, тестов, зоны
  apps-script/judge_prompts.gs — промпты судьи целиком, по одному на тест

Тексты тестов лежат врозь намеренно: участник скачивает только свой тест.
Иначе тот, кто проходит «до», получил бы в браузер и тест «после».

Руками эти файлы не правят: правится спека, потом скрипт.

РАЗМЕТКА, НА КОТОРУЮ ОПИРАЕМСЯ:
  Вводная для участника…: «…»  ← абзацы разделяются переводом строки
  ## Новость N — Заголовок → заголовок карточки, абзацы новости, **вопрос**,
                             четыре «- комментарий»
  ### Свободный вопрос N — появляется после расстановки в новости M
  # Ключи…                 → **Новость N — КОД.** …

Прежнее слово «Ситуация» разбирается тоже: старые файлы тестов не ломаются.

⚠ РЕПЛИКИ БЕЗ БУКВ. В спеке они идут по возрастанию силы, и уровень каждой
известен по её месту в списке. Поэтому в data/*.json НЕЛЬЗЯ класть ни буквы,
ни порядок из спеки: файл лежит в публичном репозитории, и по нему собралась
бы готовая расстановка. Реплика получает метку — шесть знаков от хеша её
текста, — и реплики в файле пересортированы по этой метке. Метка ничего
не говорит об уровне; связь «метка → уровень» живёт только в keys.js и
keys.gs, которые в публичный репозиторий не коммитятся.

Метка держится, пока не меняется текст реплики. Правка текста меняет метку
и ключ вместе — новые прохождения считаются верно; у прежних строк в таблице
остаётся записанный балл, пересчитать их по новому тексту всё равно нельзя.
"""

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'spec'

# Навыки карты: какие факторы расстановки и какая способность свободного ответа.
SKILLS = [
    ('context', 'Анализ контекста',      ['АК-1', 'АК-2'], None),
    ('alt',     'Генерация альтернатив', ['ГА-2'],         'ГА-1'),
    ('prio',    'Приоритизация',         ['ПР-2'],         'ПР-1'),
    ('future',  'Картина будущего',      ['МК-2'],         'МК-1'),
    ('path',    'Путь к цели',           ['ПП-2'],         'ПП-1'),
]

ABILITIES = [('МК-1', 'Амбициозность цели'), ('ГА-1', 'Генерация альтернатив'),
             ('ПР-1', 'Выбор инициатив'), ('ПП-1', 'Маршрут')]

LETTERS = ['B', 'C', 'D', 'E']          # по возрастанию: B = L2 … E = L5
LEVEL_OF = {'B': 2, 'C': 3, 'D': 4, 'E': 5}

# Минимум для свободного ответа. Правила задают объём предложениями
# (3–4 и 3), а поле считает слова — двадцать слов это примерно три
# коротких предложения. Порог живёт здесь одним местом.
MIN_WORDS = 20


def fail(msg):
    sys.exit(f'ОШИБКА: {msg}')


def one(pattern, where):
    found = sorted(SPEC.glob(pattern))
    if len(found) != 1:
        fail(f'в spec/ должен лежать ровно один {pattern}, найдено: '
             + (', '.join(f.name for f in found) or 'ничего'))
    return found[0]


def tag(test_id, situation_id, text):
    """Метка реплики: шесть знаков от хеша её текста. Не несёт уровня."""
    seed = '|'.join([test_id, situation_id, ' '.join(text.split())])
    return hashlib.sha1(seed.encode('utf-8')).hexdigest()[:6]


def slug(test_id):
    """v1.3 → v1_3: из версии получается имя файла."""
    return test_id.replace('.', '_')


def parse_test(path):
    text = path.read_text(encoding='utf-8')

    vm = re.search(r'^#\s*Тест\s+(v[\d.]+)', text, re.M)
    hm = re.search(r'^#\s*Тест\s+v[\d.]+\s*—\s*(.+)$', text, re.M)
    if not vm:
        fail(f'{path.name}: в заголовке нет версии вида «v1.3»')

    im = re.search(r'Вводная для участника[^«]*«([^»]+)»', text)
    if not im:
        fail(f'{path.name}: не нашёл вводную для участника')

    # ---- ситуации ----
    body = text[:text.index('# Ключи')] if '# Ключи' in text else text
    situations = []
    for chunk in re.split(r'\n## (?:Новость|Ситуация)\s+', body)[1:]:
        lines = chunk.split('\n')
        # «5 — Stellantis · май 2026»: номер и заголовок карточки
        head = re.match(r'(\d+)\s*(?:—\s*(.+?))?\s*$', lines[0].strip())
        if not head:
            fail(f'{path.name}: не разобрал заголовок новости: {lines[0]!r}')
        num, title = head.group(1), (head.group(2) or '').strip()
        rest = '\n'.join(lines[1:])

        # свободный вопрос отрезаем — он разбирается отдельно
        rest = re.split(r'\n### Свободный вопрос', rest)[0]

        bullets = [m.strip() for m in re.findall(r'^-\s+(.+?)\s*$', rest, re.M)]
        if len(bullets) != 4:
            fail(f'{path.name}, новость {num}: ожидал 4 комментария, нашёл {len(bullets)}')

        first = rest.find('\n- ')
        before = rest[:first] if first >= 0 else rest
        q = re.findall(r'^\*\*(.+?)\*\*$', before.strip(), re.M)
        if len(q) != 1:
            fail(f'{path.name}, новость {num}: ожидал один вопрос в **…**, нашёл {len(q)}')

        # пост — абзацами, как в файле: на экране они и будут абзацами
        post = [ln.strip() for ln in before.split('\n')
                if ln.strip() and not ln.strip().startswith('**')]
        if not post:
            fail(f'{path.name}, новость {num}: пустая новость')

        sid = f's{num}'
        options = [{'id': tag(vm.group(1), sid, t), 'text': t, 'level': LEVEL_OF[LETTERS[i]]}
                   for i, t in enumerate(bullets)]
        if len({o['id'] for o in options}) != 4:
            fail(f'{path.name}, новость {num}: два комментария совпали дословно')
        # порядок в файле — по метке, а не по силе: иначе файл и есть ключ
        options.sort(key=lambda o: o['id'])

        situations.append({
            'num': int(num), 'title': title, 'post': post, 'question': q[0].strip(),
            'options': options,
        })

    if len(situations) != 6:
        fail(f'{path.name}: ожидал 6 новостей, нашёл {len(situations)}')

    # ---- свободные вопросы ----
    free = []
    for num, after, tail in re.findall(
            r'### Свободный вопрос\s+(\d+)\s*—\s*появляется после расстановки '
            r'в (?:новости|ситуации)\s+(\d+)\s*\n(.+?)(?=\n#|\Z)',
            text, re.S):
        # «---» — разделитель markdown, а не текст вопроса
        para = [ln.strip() for ln in tail.split('\n')
                if ln.strip() and not ln.startswith('#') and set(ln.strip()) != {'-'}]
        if not para:
            fail(f'{path.name}: пустой свободный вопрос {num}')
        free.append({'id': 'q' + num, 'num': int(num), 'after': int(after),
                     'text': ' '.join(para)})
    if len(free) != 2:
        fail(f'{path.name}: ожидал 2 свободных вопроса, нашёл {len(free)}')
    free.sort(key=lambda f: f['num'])

    # ---- ключи: какая ситуация какой фактор ----
    keys_part = text[text.index('# Ключи'):] if '# Ключи' in text else ''
    factors = {}
    for num, code in re.findall(r'\*\*(?:Новость|Ситуация)\s+(\d+)\s*—\s*([А-ЯA-Z]+-\d)', keys_part):
        factors.setdefault(int(num), code)
    if len(factors) != 6:
        fail(f'{path.name}: в ключах найдено {len(factors)} новостей из 6')

    # порядок ключа: в правилах он единый, но читаем из файла, если записан
    order = re.search(r'([BCDE](?:\s*→\s*[BCDE]){3})', keys_part)
    order = [x.strip() for x in order.group(1).split('→')] if order else ['E', 'D', 'C', 'B']
    if sorted(order) != sorted(LETTERS):
        fail(f'{path.name}: в ключе не все четыре реплики: {order}')

    # какой способности какой свободный вопрос
    q_abilities = {}
    for num, codes in re.findall(r'Свободный вопрос\s+(\d+)\s*→\s*([А-ЯA-Z0-9\-,\s]+)', keys_part):
        q_abilities[int(num)] = [c.strip() for c in codes.split(',') if c.strip()]
    for f in free:
        f['abilities'] = q_abilities.get(f['num'], [])
        if not f['abilities']:
            fail(f'{path.name}: не нашёл, какие способности меряет свободный вопрос {f["num"]}')

    for s in situations:
        s['factor'] = factors[s['num']]
        s['id'] = f's{s["num"]}'

    # к какой ситуации прицеплен свободный вопрос
    by_num = {s['num']: s for s in situations}
    for f in free:
        if f['after'] not in by_num:
            fail(f'{path.name}: свободный вопрос {f["num"]} ссылается на новость '
                 f'{f["after"]}, которой нет')
        by_num[f['after']]['free'] = f['id']

    return {
        'id': vm.group(1),
        'name': hm.group(1).strip() if hm else vm.group(1),
        'intro': [ln.strip() for ln in im.group(1).split('\n') if ln.strip()],
        'file': f'data/test_{slug(vm.group(1))}.json',
        'situations': situations,
        'free': free,
        'key': {s['id']: {o['id']: o['level'] for o in s['options']} for s in situations},
    }


def js(value, indent=2):
    return json.dumps(value, ensure_ascii=False, indent=indent)


def main():
    rules_path = one('правила_тестирования_v*.md', 'правила')
    rules = rules_path.read_text(encoding='utf-8')
    rules_version = (re.search(r'Версия правил:\s*([\d.]+)', rules) or [None, '?'])[1] \
        if re.search(r'Версия правил:\s*([\d.]+)', rules) else '?'

    tests = sorted((parse_test(p) for p in SPEC.glob('тест_v*.md')), key=lambda t: t['id'])
    if not tests:
        fail('в spec/ нет ни одного файла тест_v*.md')

    head = (f'/* СОБРАНО АВТОМАТИЧЕСКИ из spec/ ({rules_path.name} и файлы тестов).\n'
            '   Руками не править: изменения затрёт следующий прогон\n'
            '   tools/собрать_тесты.py. Правится спека, потом скрипт. */\n\n')

    # ---- тексты тестов: по файлу на тест, без ключей ----
    (ROOT / 'data').mkdir(exist_ok=True)
    for t in tests:
        payload = {
            '_': 'Собрано автоматически из spec/. Руками не править.',
            'id': t['id'], 'name': t['name'], 'intro': t['intro'],
            # в публичный файл уходит только то, что человек видит на экране:
            # ни кода способности, ни уровня реплики
            'situations': [{'id': s['id'], 'num': s['num'], 'title': s['title'],
                            'post': s['post'],
                            'question': s['question'], 'free': s.get('free', ''),
                            'options': [{'id': o['id'], 'text': o['text']}
                                        for o in s['options']]}
                           for s in t['situations']],
            'free': [{k: v for k, v in f.items() if k != 'abilities'} for f in t['free']],
        }
        text = js(payload) + '\n'
        (ROOT / t['file']).write_text(text, encoding='utf-8')
        # Отпечаток содержимого — чтобы браузер не показывал старый текст теста
        # после правки спеки и не перекачивал файл, когда ничего не менялось.
        t['v'] = hashlib.sha1(text.encode('utf-8')).hexdigest()[:8]

    # ---- общая часть: всё, что не зависит от теста ----
    setup = {
        'rules': rules_version,
        'tests': [{'id': t['id'], 'name': t['name'], 'file': t['file'], 'v': t['v']}
                  for t in tests],
        'skills': [{'id': i, 'name': n, 'factors': f, 'ability': a} for i, n, f, a in SKILLS],
        'abilities': [{'id': i, 'name': n} for i, n in ABILITIES],
        'zones': ['не видит', 'видит, путает', 'выбирает'],
        'minWords': MIN_WORDS,
        # Привязка теста к этапу жёсткая (решение владельца 21.09): «до» и «после»
        # обязаны быть разными тестами, правила запрещают давать один дважды.
        # У «Базового теста» пары нет — тест выбирает ведущий.
        'stages': [
            {'id': 'before', 'name': 'До потока', 'test': tests[0]['id'], 'choose': False},
            {'id': 'after', 'name': 'После потока', 'test': tests[-1]['id'], 'choose': False},
            {'id': 'single', 'name': 'Базовый тест', 'test': None, 'choose': True},
        ],
    }

    (ROOT / 'js' / 'config.js').write_text(
        head + 'var CONFIG = ' + js(setup) + ';\n\n'
        "if (typeof module !== 'undefined' && module.exports) { module.exports = CONFIG; }\n",
        encoding='utf-8')

    # ---- ключи ----
    keys = {t['id']: t['key'] for t in tests}
    key_head = head.replace('*/', '   Ключ: тест → ситуация → метка реплики → её уровень.\n'
                                  '   Метка — хеш текста реплики, порядка в ней нет. */')
    body = ('var KEYS = ' + js(keys) + ';\n\n'
            "if (typeof module !== 'undefined' && module.exports) { module.exports = KEYS; }\n")
    (ROOT / 'apps-script' / 'keys.gs').write_text(key_head + body, encoding='utf-8')

    # В браузере ключи нужны только моковому бэкенду — вместе с разметкой
    # «ситуация → способность», иначе карту не собрать. В боевом режиме этот
    # файл не грузится, и в публичный репозиторий он не коммитится.
    meta = {t['id']: {'id': t['id'],
                      'situations': [s2['id'] for s2 in t['situations']],
                      'factors': {s2['id']: s2['factor'] for s2 in t['situations']},
                      'free': [{'id': f['id'], 'abilities': f['abilities']} for f in t['free']]}
            for t in tests}
    (ROOT / 'js' / 'keys.js').write_text(
        key_head + body + '\nvar TESTMETA = ' + js(meta) + ';\n', encoding='utf-8')

    # ---- конфиг бэкенда: состав без текстов ----
    cfg = {
        'rulesVersion': rules_version,
        'tests': [{'id': t['id'], 'name': t['name'],
                   'situations': [s['id'] for s in t['situations']],
                   'factors': {s['id']: s['factor'] for s in t['situations']},
                   'free': [{'id': f['id'], 'abilities': f['abilities']} for f in t['free']]}
                  for t in tests],
        'skills': setup['skills'],
        'abilities': setup['abilities'],
        'zones': setup['zones'],
        'minWords': MIN_WORDS,
        'stages': setup['stages'],
    }
    (ROOT / 'apps-script' / 'config.gs').write_text(
        head + 'var CONFIG = ' + js(cfg) + ';\n', encoding='utf-8')

    # ---- промпты судьи: свой на каждый тест ----
    # Судья видит контекст конкретного кейса, поэтому один промпт на два теста
    # не годится. Привязка — по «(тест vX.Y)» в заголовке файла промпта.
    prompts = {}
    for path in sorted(SPEC.glob('промпт_судьи*.md')):
        text = path.read_text(encoding='utf-8')
        m = re.search(r'\(тест\s+(v[\d.]+)\)', text.split('\n')[0])
        if not m:
            print(f'  ПРОПУЩЕН {path.name}: в заголовке нет «(тест vX.Y)»')
            continue
        vm2 = re.search(r'v[\d.]+', path.name)
        prompts[m.group(1)] = {'version': vm2.group(0) if vm2 else '?',
                               'file': path.name, 'text': text}

    lines = []
    for test_id in sorted(prompts):
        body = ',\n'.join(json.dumps(ln, ensure_ascii=False)
                          for ln in prompts[test_id]['text'].split('\n'))
        lines.append('  ' + json.dumps(test_id, ensure_ascii=False) + ': {\n'
                     + '    version: ' + json.dumps(prompts[test_id]['version'], ensure_ascii=False) + ',\n'
                     + '    text: [\n' + body + '\n    ].join(\'\\n\')\n  }')

    (ROOT / 'apps-script' / 'judge_prompts.gs').write_text(
        '/* СОБРАНО АВТОМАТИЧЕСКИ из spec/промпт_судьи*.md.\n'
        '   Промпты целиком и дословно, по одному на тест. Правится только спека.\n'
        '   Строки закодированы как JSON, чтобы кавычки и markdown внутри\n'
        '   не ломали литерал. */\n\n'
        'var JUDGE_PROMPTS = {\n' + ',\n'.join(lines) + '\n};\n',
        encoding='utf-8')

    print(f'Правила {rules_path.name} (версия {rules_version}).')
    for t in tests:
        f = ' · '.join(f'{s["num"]}={s["factor"]}' for s in t['situations'])
        print(f'  {t["id"]} «{t["name"]}» → {t["file"]}')
        print(f'      {f}')
        for q in t['free']:
            print(f'      вопрос {q["num"]} после новости {q["after"]} → {", ".join(q["abilities"])}')
    print('  промпты судьи:')
    for t in tests:
        got = prompts.get(t['id'])
        print(f'    {t["id"]} → ' + (f'{got["file"]} ({len(got["text"])} знаков)' if got
                                     else 'НЕТ — свободные ответы этого теста оценить нечем'))
    print('Переписаны: data/test_*.json, js/config.js, js/keys.js, '
          'apps-script/{keys,config,judge_prompts}.gs')


if __name__ == '__main__':
    main()
