#!/bin/bash

# Homework Submission System - Deploy Script
# 用于生产环境部署

set -e

echo "=== 作业提交系统部署脚本 ==="
echo ""

# 检查 Docker 是否可用
if ! command -v docker &> /dev/null; then
    echo "错误: 未找到 Docker，请先安装 Docker"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "错误: 未找到 docker-compose，请先安装"
    exit 1
fi

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "创建 .env 配置文件..."
    RAND_KEY=$(openssl rand -hex 32 2>/dev/null || date +%s%N)
    cat > .env << EOF
# 作业提交系统配置
# 请根据实际情况修改以下配置

# 管理员账号
ADMIN_USERNAME=tan91
ADMIN_PASSWORD=tan91@TG.cn

# JWT 密钥 (生产环境请修改为随机字符串)
SECRET_KEY=${RAND_KEY}

# 数据库配置
DATABASE_URL=sqlite+aiosqlite:///./data/database.db

# 上传配置
UPLOAD_DIR=./data/uploads
MAX_UPLOAD_SIZE=52428800
EOF
    echo "已创建 .env 文件，请根据需要修改配置"
fi

# 创建必要目录
echo "创建数据目录..."
mkdir -p data/uploads
chmod -R 755 data/

# 停止现有服务
echo "停止现有服务..."
docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true

# 构建并启动服务
echo "构建并启动服务..."
docker compose up -d --build 2>/dev/null || docker-compose up -d --build

# 等待服务启动
echo "等待服务启动..."
sleep 5

# 检查服务状态
echo "检查服务状态..."
if docker compose ps 2>/dev/null | grep -q "running" || docker-compose ps 2>/dev/null | grep -q "running"; then
    echo ""
    echo "=== 部署成功 ==="
    echo "服务已启动: http://localhost"
    echo ""
    echo "默认管理员账号: tan91 / tan91@TG.cn"
    echo ""
    echo "查看日志: docker compose logs -f"
    echo "停止服务: ./scripts/stop.sh"
else
    echo "错误: 服务启动失败"
    echo "查看日志: docker compose logs"
    exit 1
fi
