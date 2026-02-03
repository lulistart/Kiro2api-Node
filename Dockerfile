FROM node:20-alpine

WORKDIR /app

# 复制依赖文件并安装
COPY package*.json ./
RUN npm ci --only=production

# 复制源代码
COPY src ./src

# 创建数据目录
RUN mkdir -p /app/data

ENV NODE_ENV=production

# 不在这里设置 PORT，让 Zeabur 动态注入
EXPOSE 8080

# 使用 shell 形式确保环境变量被正确解析
CMD node src/index.js
