#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 18 或更高版本：https://nodejs.org/"
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已生成 .env，请先填写你的 DeepSeek API Key。"
fi

if [ ! -f runtime/weflow ]; then
  echo "首次运行，正在下载 weflow 数据组件..."
  node scripts/fetch-weflow.cjs
fi

node server.js
