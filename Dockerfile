FROM python:3.11-slim

LABEL Author="tan91"
LABEL GitHub="https://github.com/NUDTTAN91"
LABEL Blog="https://blog.csdn.net/ZXW_NUDT"

WORKDIR /app

ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# AI 批改渲染依赖：poppler 渲图 + LibreOffice 转 PDF + CJK 字体（中文渲染必需）
# 用阿里云内网镜像（不占公网带宽，仅阿里云 ECS 内网可达；非阿里云机器构建请换公网镜像）
# 公网镜像：mirrors.aliyun.com
RUN for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
        if [ -f "$f" ]; then \
            sed -i 's|deb.debian.org|mirrors.cloud.aliyuncs.com|g; s|security.debian.org|mirrors.cloud.aliyuncs.com|g' "$f"; \
        fi; \
    done \
    && apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils libreoffice-writer fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn -r requirements.txt

COPY . .

RUN mkdir -p data/db data/avatars data/submissions

EXPOSE 5000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000"]
