#!/usr/bin/env python3
"""Собирает все тексты, которые видит человек, в один файл на вычитку.

    python3 tools/собрать_тексты.py

Пишет ТЕКСТЫ_НА_ВЫЧИТКУ.md: содержание теста (из spec/) отдельно, формулировки
интерфейса отдельно, у каждой строки адрес файл:строка. Собирается, а не пишется
руками, — иначе при правках файл разойдётся с тем, что на экране."""

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CYR = re.compile(r'[а-яёА-ЯЁ]')

# Что где живёт: файл → в какой раздел складывать
UI_FILES = [
    ('index.html', 'Экран участника'),
    ('js/test.js', 'Экран участника'),
    ('host.html', 'Экран ведущего'),
    ('js/host.js', 'Экран ведущего'),
    ('js/api.js', 'Служебные сообщения'),
]

SKIP = re.compile(r'^(?:[A-Za-z0-9_\-. ]+)$')      # чистая латиница/цифры — не текст


def strip_html_comments(text):
    return re.sub(r'<!--.*?-->', lambda m: '\n' * m.group(0).count('\n'), text, flags=re.S)


def strip_js_comments(text):
    out, i, n = [], 0, len(text)
    while i < n:
        two = text[i:i + 2]
        if two == '/*':
            j = text.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append('\n' * text[i:j].count('\n'))
            i = j
        elif two == '//':
            j = text.find('\n', i)
            j = n if j < 0 else j
            i = j
        elif text[i] in '"\'':
            q = text[i]
            j = i + 1
            while j < n and text[j] != q:
                j += 2 if text[j] == '\\' else 1
            out.append(text[i:j + 1])
            i = j + 1
        else:
            out.append(text[i])
            i += 1
    return ''.join(out)


class Texts(HTMLParser):
    """Текстовые узлы и человекочитаемые атрибуты, с номерами строк."""
    WANTED = {'placeholder', 'aria-label', 'title', 'alt', 'content'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in self.WANTED and value and CYR.search(value):
                self.found.append((self.getpos()[0], value.strip(), name))

    def handle_data(self, data):
        text = ' '.join(data.split())
        if text and CYR.search(text):
            self.found.append((self.getpos()[0], text, ''))


def from_html(path):
    raw = strip_html_comments((ROOT / path).read_text(encoding='utf-8'))
    parser = Texts()
    parser.feed(raw)
    return parser.found


def from_js(path):
    """Строковые литералы с кириллицей. Фраза, разрезанная на несколько строк
    через «+», склеивается обратно — иначе вычитывать нечего."""
    raw = strip_js_comments((ROOT / path).read_text(encoding='utf-8'))
    out = []
    continuing = False

    for num, line in enumerate(raw.split('\n'), 1):
        found, prev_end = [], None
        first = re.search(r'''['"]''', line)
        # на строке-продолжении перед первой кавычкой стоит подстановка
        head_var = bool(first and line[:first.start()].replace('+', '').strip())
        for m in re.finditer(r'''(['"])((?:[^\\]|\\.)*?)\1''', line):
            value = m.group(2).replace('\\n', ' ')
            if not CYR.search(value) or SKIP.match(value.strip()):
                prev_end = m.end()
                continue
            # между кусками стояла переменная — отмечаем её многоточием,
            # иначе вычитывающий не поймёт, что тут подставляется значение
            if found and prev_end is not None:
                between = line[prev_end:m.start()].replace('+', '').strip()
                if between:
                    found[-1] += ' …'
            found.append(value)
            prev_end = m.end()

        if found:
            if continuing and out:
                gap = ' … ' if (continuing == 'var' or head_var) else ' '
                out[-1] = (out[-1][0], (out[-1][1] + gap + found[0]), '')
                found = found[1:]
            for value in found:
                out.append((num, value, ''))

        # строка кончается на «+» — значит фраза продолжается на следующей;
        # 'var' — если перед «+» стояла подстановка
        if line.rstrip().endswith('+') and (found or continuing):
            tail = line.rstrip()[:-1]
            last_quote = max(tail.rfind('\''), tail.rfind('"'))
            rest = tail[last_quote + 1:].strip() if last_quote >= 0 else ''
            continuing = 'var' if rest else True
        else:
            continuing = False

    return [(n, ' '.join(v.split()), a) for n, v, a in out if v.strip()]


def main():
    setup = json.loads(re.search(r'var CONFIG = (\{.*?\});\n',
                                 (ROOT / 'js' / 'config.js').read_text(encoding='utf-8'),
                                 re.S).group(1))
    tests = [json.loads((ROOT / t['file']).read_text(encoding='utf-8'))
             for t in setup['tests']]

    L = []
    L.append('# Тексты теста — на вычитку\n')
    L.append('Собрано скриптом `tools/собрать_тексты.py` из того, что сейчас на экране. '
             f'Правила версии {setup["rules"]}, тестов — {len(tests)}.\n')
    L.append('**Правки вносятся в двух разных местах, и это важно:**\n')
    L.append('- **Часть 1 — содержание тестов.** Источник истины — файлы `spec/тест_v*.md` '
             '(приватный репозиторий). Правите там, потом `python3 tools/собрать_тесты.py`. '
             'В коде эти тексты не редактируются — затрёт.\n')
    L.append('- **Часть 2 и дальше — формулировки интерфейса.** Их писал я, никем не вычитаны. '
             'Правятся прямо в коде, у каждой строки указан адрес.\n')
    L.append('\n---\n')

    # ---- часть 1: содержание ----
    L.append('\n## Часть 1. Содержание тестов — правится в spec/\n')

    for test in tests:
        L.append(f'\n### Тест {test["id"]} — {test["name"]}\n')
        L.append('\n**Вводная на экране.**\n')
        for para in test['intro']:
            L.append(f'\n{para}\n')
        L.append('\nУчастник видит комментарии в случайном порядке и без букв. Здесь они '
                 'в порядке спеки: сверху слабейший, снизу сильнейший.\n')

        free = {q['id']: q for q in test['free']}
        for sit in test['situations']:
            L.append(f'\n#### Новость {sit["num"]} — {sit["title"]}\n')
            for para in sit['post']:
                L.append(f'\n{para}\n')
            L.append(f'\n**Вопрос.** {sit["question"]}\n\n')
            for o in sit['options']:
                L.append(f'- {o["text"]}\n')
            q = free.get(sit.get('free'))
            if q:
                L.append(f'\n**Свободный вопрос {q["num"]}** (появляется сразу после '
                         f'расстановки). {q["text"]}\n')

    L.append('\n### Названия навыков и способностей\n\n')
    for sk in setup['skills']:
        ab = f' · свободный ответ: {sk["ability"]}' if sk['ability'] else ' · свободного ответа нет'
        L.append(f'- {sk["name"]}{ab}\n')
    L.append('\n')
    for a in setup['abilities']:
        L.append(f'- {a["id"]} — {a["name"]}\n')
    L.append('\n### Названия этапов\n\n')
    for st in setup['stages']:
        bound = ('тест выбирает ведущий' if st['choose']
                 else f'тест {st["test"]}')
        L.append(f'- {st["name"]} (`{st["id"]}`) — {bound}\n')
    L.append(f'\nПорог свободного ответа — {setup["minWords"]} слов.\n')

    # ---- часть 2: интерфейс ----
    L.append('\n---\n')
    L.append('\n## Часть 2. Формулировки интерфейса — правятся в коде\n')

    sections = {}
    for path, section in UI_FILES:
        found = from_html(path) if path.endswith('.html') else from_js(path)
        # Соседние куски одной строки склеиваем: заголовок с <br> и <em> внутри
        # иначе распадается на «Карта» / «стратегических» / «навыков».
        merged, last = [], None
        for num, text, attr in found:
            if last and last[0] == num and not attr and not last[2]:
                merged[-1] = (num, merged[-1][1] + ' ' + text, '')
            else:
                merged.append((num, text, attr))
                last = (num, text, attr)
        found = merged
        seen = set()
        for num, text, attr in found:
            key = text.strip()
            if not key or key in seen:
                continue
            seen.add(key)
            sections.setdefault(section, []).append((path, num, key, attr))

    for section in ['Экран участника', 'Экран ведущего', 'Служебные сообщения']:
        rows = sections.get(section, [])
        if not rows:
            continue
        L.append(f'\n### {section}\n\n')
        if section == 'Служебные сообщения':
            L.append('Часть из них видна только в моковом режиме при локальной работе — '
                     'участник их не увидит. Помечены как `js/api.js`.\n\n')
        L.append('| Текст | Где править |\n|---|---|\n')
        for path, num, text, attr in rows:
            where = f'`{path}:{num}`' + (f' · {attr}' if attr else '')
            L.append(f'| {text.replace("|", "\\|")} | {where} |\n')

    out = ROOT / 'ТЕКСТЫ_НА_ВЫЧИТКУ.md'
    out.write_text(''.join(L), encoding='utf-8')

    total = sum(len(v) for v in sections.values())
    print(f'{out.name}: содержание теста + {total} строк интерфейса')


if __name__ == '__main__':
    main()
