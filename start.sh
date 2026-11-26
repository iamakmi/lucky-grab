#!/usr/bin/env bash
# LUCKY GRAB — QR 럭키드로우 서버 실행 (Mac / Linux)
set -e
cd "$(dirname "$0")"

echo ""
echo "  ============================================"
echo "     LUCKY GRAB  |  QR 럭키드로우 서버 시작"
echo "  ============================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  [X] Node.js 가 설치되어 있지 않습니다."
  echo ""
  echo "  1) https://nodejs.org 접속"
  echo "  2) LTS 버전 다운로드 후 설치"
  echo "  3) 터미널을 다시 열고 ./start.sh 를 실행해 주세요."
  echo ""
  exit 1
fi

echo "  [1/2] 준비 중..."
npm install --no-audit --no-fund >/dev/null 2>&1 || true

echo "  [2/2] 서버를 시작합니다. (끄려면 Ctrl + C)"
echo ""
exec npm start
