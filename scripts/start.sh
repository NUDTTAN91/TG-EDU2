#!/bin/bash

# Homework Submission System - Start Script

set -e

echo "=== 作业提交系统启动脚本 ==="

# Check if .env file exists, if not create from example
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
    else
        cat > .env << 'EOF'
# 环境变量配置
ADMIN_USERNAME=tan91
ADMIN_PASSWORD=tan91@TG.cn
SECRET_KEY=change-me-in-production
DATABASE_URL=sqlite+aiosqlite:///./data/database.db
EOF
    fi
fi

# Create data directory if it doesn't exist
mkdir -p data/uploads

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt -q

# Start the application
echo "Starting server on http://0.0.0.0:5000"
echo "Press Ctrl+C to stop"
echo ""

uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload
