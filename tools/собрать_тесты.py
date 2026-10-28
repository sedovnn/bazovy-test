#!/usr/bin/env python3
"""Собирает контент из спеки в данные фронта и бэкенда.

    python3 tools/собрать_тесты.py

Читает spec/правила_тестирования_v*.md, spec/вычитка_*компаний.md (6 кейсов:
новость, 6 веток комментариев, 3 своих комментария), шаблон обёртки судьи
spec/обёртка_судьи_кейсы*.md, профиль, тексты отчёта и методологию, переписывает:

  data/case_<компания>.json  — тексты ОДНОГО кейса (БЕЗ ключей), по файлу на кейс
  js/config.js               — общая часть: навыки, способности, зоны, этапы,
                               список кейсов с именами файлов
  js/keys.js                 — ключи: кейс → ветка → уровень каждого комментария
  apps-script/keys.gs        — то же для бэкенда
  apps-script/config.gs      — состав навыков, способностей, кейсов, зоны
  apps-script/judge_prompts.gs — промпты судьи целиком, по одному на кейс

Тексты кейсов лежат врозь намеренно: участник скачивает только свой кейс.

Руками эти файлы не правят: правится спека, потом скрипт.

РАЗМЕТКА ФАЙЛА КЕЙСОВ — в шапке самого файла. Ветка N меряет одну и ту же
способность во всех кейсах (BRANCH_FACTORS), свой комментарий N — тоже
(FREE_ABILITIES). В ветке комментарии идут по возрастанию силы: первый — L2,
четвёртый — L5.

⚠ КОММЕНТАРИИ БЕЗ БУКВ. В data/*.json НЕЛЬЗЯ класть ни порядок из спеки, ни
уровни: файл лежит в публичном репозитории. Комментарий получает метку —
шесть знаков от хеша «кейс | ветка | текст», — и в файле они отсортированы по
метке. Связь «метка → уровень» живёт только в keys.js и keys.gs, которые в
публичный репозиторий не коммитятся. Правка текста меняет метку и ключ вместе.
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

# Названия — дословно из методологии v8 (так требует методолог).
SUBSKILLS = {
    'МК-1': 'Амбициозность цели', 'МК-2': 'Множественность образов будущего',
    'ПП-1': 'Декомпозиция цели и выстраивание маршрута',
    'ПП-2': 'Работа с ресурсами и ограничениями на пути к цели',
    'АК-1': 'Широта охвата факторов среды', 'АК-2': 'Глубина анализа взаимосвязей',
    'ПР-1': 'Выбор инициатив', 'ПР-2': 'Основание выбора',
    'ГА-1': 'Самостоятельная генерация альтернатив', 'ГА-2': 'Привлечение идей из разных областей',
}

ABILITIES = [(c, SUBSKILLS[c]) for c in ('МК-1', 'ГА-1', 'ПР-1', 'ПП-1')]

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


def lowercase_you(s):
    """«Вы», «Ваш» внутри предложения → «вы», «ваш» (вне цитат): так решил владелец
    теста 16.10.2026. В начале предложения заглавная остаётся."""
    def fix(m):
        if m.group(0).startswith('«'):
            return m.group(0)
        return m.group(1) + m.group(2).lower()
    return re.sub(r'«[^»]*»|([^.!?…\s«]\s+)(Вы|Вас|Вам|Вами|Ваш[а-яё]*)(?![А-Яа-яЁё])', fix, s)


def report_texts():
    """Тексты отчёта от методолога: «О чём этот навык», «Как тренировать»,
    фразы роста для судьи. Файл spec/тексты_отчёта_Кати*.md, разметка — в нём."""
    path = one('тексты_отчёта_Кати*.md', 'тексты отчёта')
    src = path.read_text(encoding='utf-8')

    def section(title):
        m = re.search(r'^## ' + re.escape(title) + r'[^\n]*\n(.*?)(?=^## |\Z)', src, re.M | re.S)
        if not m:
            fail(f'{path.name}: нет раздела «## {title}»')
        return m.group(1)

    about = {}
    for code, body in re.findall(r'^### (\S+)\n(.*?)(?=^### |\Z)', section('О чём этот навык'), re.M | re.S):
        lines = [ln.strip() for ln in body.strip().split('\n') if ln.strip()]
        text = next((ln for ln in lines if not ln.startswith('Было')), '')
        if code not in SUBSKILLS or not text:
            fail(f'{path.name}: «О чём этот навык» — непонятный блок {code}')
        about[code] = lowercase_you(text)
    missing = [c for c in SUBSKILLS if c not in about]
    if missing:
        fail(f'{path.name}: нет «О чём этот навык» для {", ".join(missing)}')

    training = []
    site = ''
    for ln in section('Как тренировать').split('\n'):
        m = re.match(r'^- \*\*(.+?)\*\* — (.+)$', ln.strip())
        if m:
            training.append({'name': m.group(1), 'text': lowercase_you(m.group(2))})
        elif re.match(r'^[\w.-]+\.ru$', ln.strip()):
            site = ln.strip()
    if not training:
        fail(f'{path.name}: в «Как тренировать» нет пунктов')

    growth = {}
    for code, body in re.findall(r'^### (\S+)\n(.*?)(?=^### |\Z)', section('Фразы роста'), re.M | re.S):
        growth[code] = {int(n): s.strip() for n, s in re.findall(r'^- ([1-3]): (.+)$', body, re.M)}
    for code, _ in ABILITIES:
        if sorted(growth.get(code, {})) != [1, 2, 3]:
            fail(f'{path.name}: фразы роста для {code} — нужны уровни 1, 2, 3')
    ver = re.search(r'Версия:\s*([\d.]+)', src)
    return {'about': about, 'training': training, 'site': site, 'growth': growth,
            'version': ver.group(1) if ver else '?', 'file': path.name}


def next_step_section(rt):
    """Раздел промпта: как писать «дальше» — по правилу отчёта методолога."""
    out = ['### Как писать `next` (что попробовать дальше)', '',
           'Так строится «Следующий шаг» в отчёте методолога. `next` — одно действие, которое человек '
           'может сделать в следующем ответе. Опора — вопрос сквозной лестницы этого поднавыка для '
           'границы, следующей за уровнем человека (уровень N → граница N→N+1), и абзац «Чтобы перейти '
           'на L(N+1)» в методологии. Пиши словами его собственного ответа: что именно добавить или '
           'изменить в том, что он написал.',
           '',
           'Ниже — образцы методолога для уровней 1–3: держись их смысла, но привязывай к ответу '
           'человека, не копируй. Для уровня 4 образца нет — опирайся только на вопрос границы 4→5. '
           'На уровне 5 `next` — пустая строка: шага выше нет. На уровнях 1–4 `next` есть всегда.',
           '']
    for code, name in ABILITIES:
        out.append(f'**{code} · {name}**')
        for n in (1, 2, 3):
            out.append(f'- уровень {n}: {rt["growth"][code][n]}')
        out.append('')
    out.append('Правила языка для `has` и `next` (из отчёта методолога): «вы», «ваш» — со строчной, '
               'с заглавной только в начале предложения; без сравнения с другими людьми («лучше многих», «мало кто», «не каждый»); '
               'без суждений о личности («по натуре», «Вы из тех, кто»); без оценки числом. Слова '
               'человека можно приводить в кавычках «…». Текст с нарушением человеку не покажут.')
    return '\n'.join(out)


def tag(test_id, situation_id, text):
    """Метка реплики: шесть знаков от хеша её текста. Не несёт уровня."""
    seed = '|'.join([test_id, situation_id, ' '.join(text.split())])
    return hashlib.sha1(seed.encode('utf-8')).hexdigest()[:6]


def slug(test_id):
    """v1.3 → v1_3: из версии получается имя файла."""
    return test_id.replace('.', '_')


# Новая подача: одна новость, 6 веток, 3 своих комментария. Какую способность
# меряет ветка и какой ответ — задано форматом и одинаково во всех кейсах.
BRANCH_FACTORS = {1: 'АК-1', 2: 'АК-2', 3: 'ГА-2', 4: 'ПР-2', 5: 'ПП-2', 6: 'МК-2'}
FREE_ABILITIES = {1: ['ПП-1', 'ПР-1'], 2: ['ГА-1'], 3: ['МК-1']}
RANK_QUESTION = ('Расставьте 4 комментария: 1 — тот, который написали бы сами, '
                 '4 — тот, с которым согласны меньше всего.')


def parse_cases(path):
    """Кейсы из файла вычитки. Разметка — в шапке самого файла."""
    text = path.read_text(encoding='utf-8')
    vm = re.search(r'Версия кейсов:\s*(\d+(?:\.\d+)*)', text)
    if not vm:
        fail(f'{path.name}: нет строки «Версия кейсов: X.Y»')
    version = vm.group(1)

    im = re.search(r'^## Вводная[^\n]*\n(.*?)(?=^---|^#)', text, re.M | re.S)
    if not im:
        fail(f'{path.name}: нет раздела «## Вводная»')
    # В именной сессии абзац про анонимность и вывод на экран не годится:
    # его заменяет строка «*В именной сессии вместо этого абзаца:* …».
    intro, intro_named = [], []
    NAMED = '*В именной сессии вместо этого абзаца:*'
    for ln in (x.strip() for x in im.group(1).split('\n')):
        if not ln:
            continue
        if ln.startswith(NAMED):
            if not intro:
                fail(f'{path.name}: замена для именной сессии стоит раньше вводной')
            intro_named[-1] = ln[len(NAMED):].strip()
        elif not ln.startswith('*'):
            intro.append(ln)
            intro_named.append(ln)
    if intro_named == intro:
        fail(f'{path.name}: в вводной нет замены для именной сессии ({NAMED} …)')

    body = text[:text.index('# Ключи')] if '# Ключи' in text else text
    cases = []
    for num, name, chunk in re.findall(r'^# (\d+)\. (.+?)\n(.*?)(?=^# |\Z)', body, re.M | re.S):
        where = f'{path.name}, кейс {name}'
        nm = re.search(r'^## Новость — (.+?)\n(.*?)(?=^## )', chunk, re.M | re.S)
        if not nm:
            fail(f'{where}: нет «## Новость — …»')
        news = {'title': nm.group(1).strip(),
                'post': [ln.strip() for ln in nm.group(2).split('\n')
                         if ln.strip() and set(ln.strip()) != {'-'}]}
        cid = re.sub(r'[^a-z0-9]+', '', name.lower()) + '-' + version

        situations, free = [], []
        branches = re.findall(r'^## Ветка комментариев (\d)\n(.*?)(?=^## |\Z)', chunk, re.M | re.S)
        if [int(b[0]) for b in branches] != [1, 2, 3, 4, 5, 6]:
            fail(f'{where}: ветки должны идти 1–6, нашёл {[b[0] for b in branches]}')
        for bnum, btext in branches:
            bnum = int(bnum)
            lines = [ln.strip() for ln in btext.split('\n') if ln.strip() and set(ln.strip()) != {'-'}]
            bullets = [ln[2:].strip() for ln in lines if ln.startswith('- ')]
            if len(bullets) != 4:
                fail(f'{where}, ветка {bnum}: ожидал 4 комментария, нашёл {len(bullets)}')
            opener = next((ln for ln in lines if not ln.startswith('- ') and not ln.startswith('>')), '')
            if not opener:
                fail(f'{where}, ветка {bnum}: нет реплики, открывающей ветку')
            sid = f's{bnum}'
            options = [{'id': tag(cid, sid, b), 'text': b, 'level': LEVEL_OF[LETTERS[k]]}
                       for k, b in enumerate(bullets)]
            if len({o['id'] for o in options}) != 4:
                fail(f'{where}, ветка {bnum}: два комментария совпали дословно')
            options.sort(key=lambda o: o['id'])   # порядок по метке, не по силе
            s = {'num': bnum, 'id': sid, 'title': f'Ветка комментариев {bnum}', 'post': [opener],
                 'question': RANK_QUESTION, 'options': options, 'factor': BRANCH_FACTORS[bnum]}

            for k, ln in enumerate(lines):
                qm = re.match(r'^> \*\*Ваш комментарий (\d)\.\*\*\s*(.+)$', ln)
                if not qm:
                    continue
                qn = int(qm.group(1))
                first_bullet = next(x for x, l2 in enumerate(lines) if l2.startswith('- '))
                q = {'id': f'q{qn}', 'num': qn, 'after': bnum, 'text': qm.group(2).strip(),
                     'abilities': FREE_ABILITIES[qn], 'before': k < first_bullet}
                free.append(q)
                s['free'] = q['id']
                s['freeBefore'] = q['before']
            situations.append(s)

        free.sort(key=lambda f: f['num'])
        if [f['num'] for f in free] != [1, 2, 3]:
            fail(f'{where}: нужны «Ваш комментарий» 1, 2, 3, нашёл {[f["num"] for f in free]}')
        goal = re.search(r'цель — (.+?)\. Что вы', free[0]['text'])
        cases.append({
            'id': cid, 'name': name.strip(), 'intro': intro, 'introNamed': intro_named, 'news': news,
            'file': f'data/case_{re.sub(r"[^a-z0-9]+", "", name.lower())}.json',
            'situations': situations, 'free': free,
            'goal': goal.group(1) if goal else '',
            'key': {s['id']: {o['id']: o['level'] for o in s['options']} for s in situations},
        })
    if len(cases) != 6:
        fail(f'{path.name}: ожидал 6 кейсов, нашёл {len(cases)}')
    return cases


def case_context(c):
    """Контекст для судьи: всё, что видел участник, в том же порядке.
    Комментарии — в порядке файла (от слабого к сильному), как в прежних обёртках."""
    out = [f'**Новость — {c["news"]["title"]}**', '']
    out += ['> ' + p + '\n>' for p in c['news']['post']]
    out[-1] = out[-1][:-2]
    out.append('')
    free = {f['id']: f for f in c['free']}
    for s in c['situations']:
        out += [f'**Ветка комментариев {s["num"]}.** {s["post"][0]}', '']
        q = free.get(s.get('free', ''))
        if q and q['before']:
            out += [f'**Ответ {q["num"]}** — вопрос участнику, до расстановки этой ветки: «{q["text"]}»', '']
        levels = sorted(s['options'], key=lambda o: o['level'])
        out += ['> — ' + o['text'] + '\n>' for o in levels]
        out[-1] = out[-1][:-2]
        out.append('')
        if q and not q['before']:
            out += [f'**Ответ {q["num"]}** — вопрос участнику, после расстановки этой ветки: «{q["text"]}»', '']
    return '\n'.join(out).rstrip()


def js(value, indent=2):
    return json.dumps(value, ensure_ascii=False, indent=indent)


def main():
    rules_path = one('правила_тестирования_v*.md', 'правила')
    rules = rules_path.read_text(encoding='utf-8')
    rules_version = (re.search(r'Версия правил:\s*([\d.]+)', rules) or [None, '?'])[1] \
        if re.search(r'Версия правил:\s*([\d.]+)', rules) else '?'

    cases_path = one('вычитка_*компаний.md', 'кейсы')
    tests = parse_cases(cases_path)

    head = (f'/* СОБРАНО АВТОМАТИЧЕСКИ из spec/ ({rules_path.name} и {cases_path.name}).\n'
            '   Руками не править: изменения затрёт следующий прогон\n'
            '   tools/собрать_тесты.py. Правится спека, потом скрипт. */\n\n')

    # ---- тексты тестов: по файлу на тест, без ключей ----
    (ROOT / 'data').mkdir(exist_ok=True)
    for t in tests:
        payload = {
            '_': 'Собрано автоматически из spec/. Руками не править.',
            'id': t['id'], 'name': t['name'], 'intro': t['intro'], 'introNamed': t['introNamed'],
            'news': t['news'],
            # в публичный файл уходит только то, что человек видит на экране:
            # ни кода способности, ни уровня реплики
            'situations': [{'id': s['id'], 'num': s['num'], 'title': s['title'],
                            'post': s['post'],
                            'question': s['question'], 'free': s.get('free', ''),
                            'freeBefore': s.get('freeBefore', False),
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

    rt = report_texts()

    # ---- общая часть: всё, что не зависит от теста ----
    setup = {
        'rules': rules_version,
        # какой свой комментарий на какие способности нацелен — не секрет,
        # нужен экрану ведущего для разбора комментариев
        'tests': [{'id': t['id'], 'name': t['name'], 'file': t['file'], 'v': t['v'],
                   'free': [{'id': f['id'], 'abilities': f['abilities']} for f in t['free']]}
                  for t in tests],
        'skills': [{'id': i, 'name': n, 'factors': f, 'ability': a} for i, n, f, a in SKILLS],
        'abilities': [{'id': i, 'name': n} for i, n in ABILITIES],
        # «О чём этот навык» и «Как тренировать» — тексты методолога, дословно.
        'subskills': [{'id': c, 'name': n, 'about': rt['about'][c]} for c, n in SUBSKILLS.items()],
        'training': {'items': rt['training'], 'site': rt['site']},
        'zones': ['не видит', 'видит, путает', 'выбирает'],
        'minWords': MIN_WORDS,
        # Кейсов 6, и на любом этапе ведущий выбирает кейс сам (решение владельца
        # 15.10). Правило «один кейс дважды не даётся» проверяет бэкенд: на «после»
        # нельзя взять кейс, который у группы с тем же названием был на «до».
        'stages': [
            {'id': 'before', 'name': 'До потока', 'test': None, 'choose': True},
            {'id': 'after', 'name': 'После потока', 'test': None, 'choose': True},
            {'id': 'single', 'name': 'Базовый тест', 'test': None, 'choose': True},
        ],
    }

    (ROOT / 'js' / 'config.js').write_text(
        head + 'var CONFIG = ' + js(setup) + ';\n\n'
        "if (typeof module !== 'undefined' && module.exports) { module.exports = CONFIG; }\n",
        encoding='utf-8')

    # ---- ключи ----
    keys = {t['id']: t['key'] for t in tests}

    # Прежние метки. Метка — хеш текста комментария, и правка текста её меняет.
    # Сохранённые прохождения хранят порядок по старым меткам, а карта и пересчёт
    # собираются заново по ключу — без старых меток расстановка правленой ветки
    # обнулилась бы. Поэтому метка, пропавшая из ключа, остаётся в нём со своим
    # уровнем; список копится в spec/прежние_метки.json.
    legacy_path = ROOT / 'spec' / 'прежние_метки.json'
    legacy = json.loads(legacy_path.read_text(encoding='utf-8')) if legacy_path.exists() else {}
    old_gs = ROOT / 'apps-script' / 'keys.gs'
    if old_gs.exists():
        m = re.search(r'var KEYS = (\{.*?\});\s*\n', old_gs.read_text(encoding='utf-8'), re.S)
        old = json.loads(m.group(1)) if m else {}
        for tid, sits in old.items():
            for sid, labels in sits.items():
                for lab, lv in labels.items():
                    if lab not in keys.get(tid, {}).get(sid, {}):
                        legacy.setdefault(tid, {}).setdefault(sid, {})[lab] = lv
    legacy_path.write_text(json.dumps(legacy, ensure_ascii=False, indent=1), encoding='utf-8')
    for tid, sits in legacy.items():
        for sid, labels in sits.items():
            for lab, lv in labels.items():
                if tid in keys and sid in keys[tid]:
                    keys[tid][sid].setdefault(lab, lv)
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
    #
    # Файл промпта в спеке — это только обёртка: контекст новостей 5–6,
    # каталог Т1 и формат выдачи. Генератор дописывает к ней профиль
    # мини-формата и полный текст методологии. Так методология лежит в спеке
    # одним файлом, дословно, и не расходится между тестами.
    profile_path = one('профиль_мини_формата*.md', 'профиль')
    method_path = one('methodology_for_imp_v*.md', 'методология')
    profile = profile_path.read_text(encoding='utf-8').strip()
    method = method_path.read_text(encoding='utf-8').strip()
    pv = re.search(r'Версия профиля:\s*([\d.]+)', profile)
    mv = re.search(r'^Версия:\s*(\S+?)\.?$', method, re.M)
    profile_ver = pv.group(1) if pv else '?'
    method_ver = mv.group(1) if mv else method_path.stem

    # Обёртка одна на все кейсы: шаблон, куда подставляются новость, ветки,
    # вопросы и цель. Так обёртки кейсов не расходятся между собой.
    tpl_path = one('обёртка_судьи_кейсы*.md', 'обёртка судьи')
    tpl = tpl_path.read_text(encoding='utf-8')
    tv = re.search(r'Версия обёртки:\s*([\d.]+)', tpl)
    wrapper_base = tpl[tpl.index('## Часть 1.'):]
    prompts = {}
    for c in tests:
        if not c['goal']:
            fail(f'{cases_path.name}, кейс {c["name"]}: в «Ваш комментарий 1» не нашёл цель «цель — …. Что вы»')
        wrapper = (f'# Промпт судьи — кейс {c["name"]} (тест {c["id"]})\n\n---\n\n'
                   + wrapper_base.replace('{{КОНТЕКСТ}}', case_context(c)).replace('{{ЦЕЛЬ}}', c['goal']))
        if '{{' in wrapper:
            fail(f'{tpl_path.name}: остался неподставленный {{{{…}}}}')
        text = (wrapper.rstrip() + '\n\n' + next_step_section(rt)
                + '\n\n---\n\n## Часть 2. Профиль применения к мини-формату\n\n' + profile
                + '\n\n---\n\n## Часть 3. Методология (дословно)\n\n' + method + '\n')
        prompts[c['id']] = {
            'version': f'обёртка {tv.group(1) if tv else "?"} · кейсы {c["id"].split("-")[-1]}'
                       f' · профиль {profile_ver} · тексты отчёта {rt["version"]} · методология {method_ver}',
            'file': tpl_path.name, 'text': text}

    lines = []
    for test_id in sorted(prompts):
        body = ',\n'.join(json.dumps(ln, ensure_ascii=False)
                          for ln in prompts[test_id]['text'].split('\n'))
        lines.append('  ' + json.dumps(test_id, ensure_ascii=False) + ': {\n'
                     + '    version: ' + json.dumps(prompts[test_id]['version'], ensure_ascii=False) + ',\n'
                     + '    text: [\n' + body + '\n    ].join(\'\\n\')\n  }')

    (ROOT / 'apps-script' / 'judge_prompts.gs').write_text(
        '/* СОБРАНО АВТОМАТИЧЕСКИ: spec/обёртка_судьи_кейсы*.md с кейсом + профиль\n'
        '   мини-формата + методология, по промпту на тест. Правится только спека.\n'
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
            print(f'      свой комментарий {q["num"]} {"до" if q["before"] else "после"} расстановки '
                  f'в ветке {q["after"]} → {", ".join(q["abilities"])}')
    print('  промпты судьи:')
    for t in tests:
        got = prompts.get(t['id'])
        print(f'    {t["id"]} → ' + (f'{got["file"]} ({len(got["text"])} знаков)' if got
                                     else 'НЕТ — свободные ответы этого теста оценить нечем'))
    print('Переписаны: data/case_*.json, js/config.js, js/keys.js, '
          'apps-script/{keys,config,judge_prompts}.gs')


if __name__ == '__main__':
    main()
