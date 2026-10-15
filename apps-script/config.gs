/* СОБРАНО АВТОМАТИЧЕСКИ из spec/ (правила_тестирования_v1.2.md и вычитка_6_компаний.md).
   Руками не править: изменения затрёт следующий прогон
   tools/собрать_тесты.py. Правится спека, потом скрипт. */

var CONFIG = {
  "rulesVersion": "1.2",
  "tests": [
    {
      "id": "intel-1.0",
      "name": "Intel",
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
        "s5": "ПП-2",
        "s6": "МК-2"
      },
      "free": [
        {
          "id": "q1",
          "abilities": [
            "ПП-1",
            "ПР-1"
          ]
        },
        {
          "id": "q2",
          "abilities": [
            "ГА-1"
          ]
        },
        {
          "id": "q3",
          "abilities": [
            "МК-1"
          ]
        }
      ]
    },
    {
      "id": "nike-1.0",
      "name": "Nike",
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
        "s5": "ПП-2",
        "s6": "МК-2"
      },
      "free": [
        {
          "id": "q1",
          "abilities": [
            "ПП-1",
            "ПР-1"
          ]
        },
        {
          "id": "q2",
          "abilities": [
            "ГА-1"
          ]
        },
        {
          "id": "q3",
          "abilities": [
            "МК-1"
          ]
        }
      ]
    },
    {
      "id": "starbucks-1.0",
      "name": "Starbucks",
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
        "s5": "ПП-2",
        "s6": "МК-2"
      },
      "free": [
        {
          "id": "q1",
          "abilities": [
            "ПП-1",
            "ПР-1"
          ]
        },
        {
          "id": "q2",
          "abilities": [
            "ГА-1"
          ]
        },
        {
          "id": "q3",
          "abilities": [
            "МК-1"
          ]
        }
      ]
    },
    {
      "id": "bp-1.0",
      "name": "bp",
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
        "s5": "ПП-2",
        "s6": "МК-2"
      },
      "free": [
        {
          "id": "q1",
          "abilities": [
            "ПП-1",
            "ПР-1"
          ]
        },
        {
          "id": "q2",
          "abilities": [
            "ГА-1"
          ]
        },
        {
          "id": "q3",
          "abilities": [
            "МК-1"
          ]
        }
      ]
    },
    {
      "id": "stellantis-1.0",
      "name": "Stellantis",
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
        "s5": "ПП-2",
        "s6": "МК-2"
      },
      "free": [
        {
          "id": "q1",
          "abilities": [
            "ПП-1",
            "ПР-1"
          ]
        },
        {
          "id": "q2",
          "abilities": [
            "ГА-1"
          ]
        },
        {
          "id": "q3",
          "abilities": [
            "МК-1"
          ]
        }
      ]
    },
    {
      "id": "novo-1.0",
      "name": "Novo",
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
        "s5": "ПП-2",
        "s6": "МК-2"
      },
      "free": [
        {
          "id": "q1",
          "abilities": [
            "ПП-1",
            "ПР-1"
          ]
        },
        {
          "id": "q2",
          "abilities": [
            "ГА-1"
          ]
        },
        {
          "id": "q3",
          "abilities": [
            "МК-1"
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
      "name": "Самостоятельная генерация альтернатив"
    },
    {
      "id": "ПР-1",
      "name": "Выбор инициатив"
    },
    {
      "id": "ПП-1",
      "name": "Декомпозиция цели и выстраивание маршрута"
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
      "test": null,
      "choose": true
    },
    {
      "id": "after",
      "name": "После потока",
      "test": null,
      "choose": true
    },
    {
      "id": "single",
      "name": "Базовый тест",
      "test": null,
      "choose": true
    }
  ]
};
