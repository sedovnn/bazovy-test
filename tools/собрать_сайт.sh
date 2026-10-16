#!/bin/sh
# Собирает в public/ ровно то, что отдаётся участникам и ведущему.
# Ключа расстановки (js/keys.js), спеки и бэкенда здесь нет и быть не должно.
set -e
cd "$(dirname "$0")/.."
rm -rf public
mkdir -p public/js
cp index.html host.html public/
cp -R css data assets public/
for f in js/*.js; do
  case "$f" in js/keys.js) ;; *) cp "$f" public/js/ ;; esac
done
test ! -e public/js/keys.js
echo "public/ собран: $(find public -type f | wc -l | tr -d ' ') файлов"
