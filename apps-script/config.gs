/* СОБРАНО АВТОМАТИЧЕСКИ из spec/ (правила_тестирования_v1.0.md и файлы тестов).
   Руками не править: изменения затрёт следующий прогон
   tools/собрать_тесты.py. Правится спека, потом скрипт. */

var CONFIG = {
  "rulesVersion": "1.0",
  "tests": [
    {
      "id": "v1.4",
      "name": "Nike · Starbucks · Novo",
      "situations": [
        "s1",
        "s2",
        "s3",
        "s4",
        "s5",
        "s6"
      ],
      "factors": {
        "s1": "АК-1",
        "s2": "АК-2",
        "s3": "ГА-2",
        "s4": "ПР-2",
        "s5": "МК-2",
        "s6": "ПП-2"
      },
      "free": [
        {
          "id": "q1",
          "abilities": [
            "МК-1",
            "ГА-1"
          ]
        },
        {
          "id": "q2",
          "abilities": [
            "ПП-1",
            "ПР-1"
          ]
        }
      ]
    },
    {
      "id": "v2.3",
      "name": "Intel · bp · Stellantis",
      "situations": [
        "s1",
        "s2",
        "s3",
        "s4",
        "s5",
        "s6"
      ],
      "factors": {
        "s1": "АК-1",
        "s2": "АК-2",
        "s3": "ПР-2",
        "s4": "ПП-2",
        "s5": "ГА-2",
        "s6": "МК-2"
      },
      "free": [
        {
          "id": "q1",
          "abilities": [
            "МК-1",
            "ГА-1"
          ]
        },
        {
          "id": "q2",
          "abilities": [
            "ПП-1",
            "ПР-1"
          ]
        }
      ]
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
