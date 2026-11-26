@echo off
chcp 65001 >nul
title LUCKY GRAB - QR 럭키드로우
cd /d "%~dp0"

echo.
echo   ============================================
echo      LUCKY GRAB  ^|  QR 럭키드로우 서버 시작
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js 가 설치되어 있지 않습니다.
  echo.
  echo   1^) https://nodejs.org 접속
  echo   2^) "LTS" 버전 다운로드 후 설치 ^(모두 다음 버튼^)
  echo   3^) 이 창을 닫고 start.bat 을 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo   [1/2] 준비 중...
  call npm install --no-audit --no-fund >nul 2>nul
)

echo   [2/2] 서버를 시작합니다.  ^(끄려면 Ctrl + C^)
echo.
call npm start

echo.
echo   서버가 종료되었습니다.
pause
