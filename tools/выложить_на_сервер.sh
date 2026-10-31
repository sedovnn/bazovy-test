#!/bin/sh
# Выкладывает базовый тест на сервер тестовой среды и перезапускает сервис.
#   sh tools/выложить_на_сервер.sh
# Что едет: public/ (страницы), server/*.js, бэкенд apps-script/{config,keys,scoring,Code,judge,judge_prompts}.gs.
# Ключ расстановки (keys.gs) читает только пользователь сервиса; в public/ его нет.
set -e
cd "$(dirname "$0")/.."
HOST=root@217.168.240.53
KEY="$HOME/.ssh/selectel_bazovy_test"
SSH="ssh -i $KEY -o BatchMode=yes"

sh tools/собрать_сайт.sh
rsync -az --delete -e "$SSH" public/ "$HOST:/opt/bazovy-test/public/"
rsync -az -e "$SSH" server/server.js server/worker.js server/sheets.js server/импорт.js server/пересчёт.js "$HOST:/opt/bazovy-test/server/"
rsync -az -e "$SSH" apps-script/config.gs apps-script/keys.gs apps-script/scoring.gs apps-script/Code.gs apps-script/judge.gs apps-script/judge_prompts.gs "$HOST:/opt/bazovy-test/apps-script/"
$SSH "$HOST" 'chown -R root:bazovy /opt/bazovy-test && chmod -R u=rwX,g=rX,o= /opt/bazovy-test/server /opt/bazovy-test/apps-script && chmod -R a+rX /opt/bazovy-test/public && systemctl restart bazovy-test && sleep 2 && systemctl is-active bazovy-test && curl -s http://127.0.0.1:8080/api'
echo
