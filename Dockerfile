FROM node:20-bookworm-slim

WORKDIR /app

# 复制依赖文件并安装
COPY package*.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# 复制源代码
COPY src ./src

# 创建数据目录
RUN mkdir -p /app/data

ENV NODE_ENV=production

# 不在这里设置 PORT，让 Zeabur 动态注入
EXPOSE 8080

# 使用 exec 形式确保信号处理正确
CMD ["node", "src/index.js"]
