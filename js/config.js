/* СОБРАНО АВТОМАТИЧЕСКИ из spec/ (правила_тестирования_v1.0.md и файлы тестов).
   Руками не править: изменения затрёт следующий прогон
   tools/собрать_тесты.py. Правится спека, потом скрипт. */

var CONFIG = {
  "rules": "1.0",
  "tests": [
    {
      "id": "v1.4",
      "name": "Nike · Starbucks · Novo",
      "file": "data/test_v1_4.json",
      "v": "1b42d6dc"
    },
    {
      "id": "v2.3",
      "name": "Intel · bp · Stellantis",
      "file": "data/test_v2_3.json",
      "v": "8ef2024e"
    }
  ],
  "skills": [
    {
      "id": "context",
      "name": "Анализ контекста",
      "factors": [
        "АК-1",
        "АК-2"
      ],
      "ability": null
    },
    {
      "id": "alt",
      "name": "Генерация альтернатив",
      "factors": [
        "ГА-2"
      ],
      "ability": "ГА-1"
    },
    {
      "id": "prio",
      "name": "Приоритизация",
      "factors": [
        "ПР-2"
      ],
      "ability": "ПР-1"
    },
    {
      "id": "future",
      "name": "Картина будущего",
      "factors": [
        "МК-2"
      ],
      "ability": "МК-1"
    },
    {
      "id": "path",
      "name": "Путь к цели",
      "factors": [
        "ПП-2"
      ],
      "ability": "ПП-1"
    }
  ],
  "abilities": [
    {
      "id": "МК-1",
      "name": "Амбициозность цели"
    },
    {
      "id": "ГА-1",
      "name": "Генерация альтернатив"
    },
    {
      "id": "ПР-1",
      "name": "Выбор инициатив"
    },
    {
      "id": "ПП-1",
      "name": "Маршрут"
    }
  ],
  "zones": [
    "не видит",
    "видит, путает",
    "выбирает"
  ],
  "minWords": 20,
  "stages": [
    {
      "id": "before",
      "name": "До потока",
      "test": "v1.4",
      "choose": false
    },
    {
      "id": "after",
      "name": "После потока",
      "test": "v2.3",
      "choose": false
    },
    {
      "id": "single",
      "name": "Базовый тест",
      "test": null,
      "choose": true
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) { module.exports = CONFIG; }
