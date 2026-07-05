#!/bin/bash

# Homework Submission System - Stop Script
# 用于停止服务

set -e

echo "=== 作业提交系统停止脚本 ==="
echo ""

# 停止 Docker 服务
echo "停止 Docker 服务..."
if docker compose down 2>/dev/null; then
    echo "Docker Compose 服务已停止"
elif docker-compose down 2>/dev/null; then
    echo "Docker Compose 服务已停止"
else
    echo "未找到运行中的 Docker Compose 服务"
fi

# 检查是否有残留进程
echo "检查残留进程..."
if pgrep -f "uvicorn app.main:app" > /dev/null; then
    echo "发现本地 uvicorn 进程，正在停止..."
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    sleep 1
    echo "已停止本地进程"
fi

echo ""
echo "=== 服务已停止 ==="
