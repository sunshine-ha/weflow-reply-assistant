@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 18 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo 已生成 .env，请先填写你的 DeepSeek API Key。
)

if not exist "runtime\weflow.exe" (
  echo 首次运行，正在下载 weflow 数据组件...
  node scripts\fetch-weflow.cjs
  if errorlevel 1 (
    echo 下载失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

node server.js
