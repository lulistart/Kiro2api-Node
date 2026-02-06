# Kiro2API-Node

<p align="center">
  <strong>将 Kiro AWS Claude API 转换为标准 Anthropic API 格式的 Node.js 代理服务</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#api-文档">API 文档</a> •
  <a href="#管理面板">管理面板</a> •
  <a href="#环境变量">环境变量</a>
</p>

> 基于 [kiro2api-rs](https://github.com/vagmr/kiro2api-rs) 使用 Node.js 重构优化
>
> ⭐ 如果这个项目对你有帮助，请给个 Star 支持一下！

---

## 功能特性

### 核心功能
- 🔄 **Anthropic API 兼容** - 完整支持 Anthropic Claude API 格式
- 📡 **流式响应** - 支持 SSE (Server-Sent Events) 实时输出
- 🔐 **Token 自动刷新** - 自动管理和刷新 OAuth Token（social/idc）
- 🧠 **Thinking 模式** - 支持 Claude extended thinking 功能
- 🛠️ **工具调用** - 完整支持 function calling / tool use

### 账号管理
- 👥 **账号池模式** - 支持多账号轮询、随机、最少使用策略
- 📊 **配额管理** - 实时查看账号剩余配额
- ❄️ **自动冷却** - 账号限流自动冷却处理
- 📥 **批量导入** - 支持 JSON 文件批量导入账号
- 🗑️ **批量删除** - 多选批量删除账号

### 运维功能
- 🖥️ **Web 管理面板** - 可视化管理账号和监控状态
- 📝 **请求记录** - 记录请求历史和统计信息
- 🔑 **多 API 密钥** - 支持配置多个 API Key
- 🐳 **Docker 支持** - 开箱即用的容器化部署

---

## 快速开始

### 方式一：直接运行

```bash
# 安装依赖
npm install

# 启动服务
npm start

# 开发模式（自动重载）
npm run dev
```

### 方式二：PM2 部署

```bash
# 安装 PM2（如未安装）
npm install -g pm2

# 启动服务
npm run pm2:start

# 查看状态
npm run pm2:status

# 查看日志
npm run pm2:logs

# 重启服务
npm run pm2:restart

# 停止服务
npm run pm2:stop

# 删除进程
npm run pm2:delete

# 设置开机自启
pm2 startup
pm2 save
```

### 方式三：Docker 部署

```bash
# 复制环境变量示例并按需修改
cp .env.example .env

# 使用 docker-compose（推荐）
docker-compose up -d

# 或手动构建运行
docker build -t kiro2api-node .
docker run -d -p 8080:8080 \
  -e API_KEY=sk-your-key \
  -e ADMIN_KEY=your-admin-key \
  -e DATA_DIR=/app/data \
  -v ./data:/app/data \
  kiro2api-node
```

**数据持久化说明：**
- 所有数据（账号、设置、请求日志）存储在 SQLite 数据库中
- 通过 `-v ./data:/app/data` 挂载数据目录，确保数据持久化
- 数据库文件：`data/kiro.db`（自动创建）
- 首次启动会自动迁移旧的 JSON 文件到数据库

服务默认运行在 `http://localhost:8080`

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | 服务端口 |
| `API_KEY` | `sk-default-key` | API 调用密钥 |
| `ADMIN_KEY` | `admin-default-key` | 管理面板密钥 |
| `DATA_DIR` | `./data` | 数据存储目录 |
| `REGION` | `us-east-1` | AWS 区域 |
| `KIRO_VERSION` | `0.8.0` | Kiro 版本号 |
| `PROXY_URL` | - | HTTP 代理地址（可选） |

---

## 数据存储

### 存储方式
项目使用 **SQLite 数据库**存储所有数据，提供更好的性能和可靠性：

- **数据库文件**：`data/kiro.db`
- **日志模式**：WAL（Write-Ahead Log）提升并发性能
- **自动迁移**：首次启动自动检测并迁移旧的 JSON 文件

### 数据结构

| 表名 | 说明 |
|------|------|
| `accounts` | 账号信息（凭证、状态、配额） |
| `settings` | 系统设置（管理密钥） |
| `api_keys` | API 密钥列表 |
| `models` | 模型配置（展示名、上下文等） |
| `model_mappings` | 模型映射规则 |
| `request_logs` | 请求日志记录 |

### 数据迁移

从 JSON 文件自动迁移到数据库：
- `accounts.json` → `accounts` 表
- `settings.json` → `settings` + `api_keys` 表
- `request_logs.json` → `request_logs` 表

迁移后自动备份原文件（`.backup.{timestamp}`）并删除原文件，防止重复迁移。

**默认模型初始化：**
- 首次启动会初始化 `models` 与 `model_mappings` 默认数据
- 可通过管理 API 重置模型与映射

**请求日志自动清理：**
- 每天凌晨 3 点清理旧日志，默认保留最近 10 万条

### 备份建议

定期备份数据库文件：
```bash
# 备份数据库
cp data/kiro.db data/kiro.db.backup.$(date +%Y%m%d)

# Docker 环境
docker cp kiro2api-node:/app/data/kiro.db ./backup/
```

---

## API 文档

### 端点列表

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/v1/models` | 获取可用模型列表 |
| `POST` | `/v1/messages` | 发送消息（Anthropic 格式） |
| `GET` | `/health` | 健康检查 |

### 请求示例

#### 基础请求

```bash
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-default-key" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

#### 流式请求

```bash
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-default-key" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

#### Thinking 模式

```bash
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-default-key" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 16000,
    "thinking": {
      "type": "enabled",
      "budget_tokens": 10000
    },
    "messages": [
      {"role": "user", "content": "请一步步分析这个问题..."}
    ]
  }'
```

---

## 支持的模型

| 模型 ID | 说明 | 是否支持 |
|---------|------|----------|
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 | ✅ |
| `claude-opus-4-5-20251101` | Claude Opus 4.5 | ❌ |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | ✅ |

---

## 管理面板

访问 `http://localhost:8080/login` 使用管理密钥登录。

### 功能列表

- **账号管理** - 添加、导入、删除、启用/禁用账号
- **额度监控** - 查看和刷新账号配额
- **请求记录** - 查看历史请求日志
- **策略切换** - 轮询 / 随机 / 最少使用
- **密钥管理** - 管理多个 API Key
- **模型管理** - 模型与映射规则配置
- **统计面板** - 请求与 Token 统计

---

## 账号配置

支持两种认证方式：

### Social 认证

```json
{
  "refreshToken": "your_refresh_token",
  "authMethod": "social"
}
```

### IdC / BuilderId 认证

```json
{
  "refreshToken": "your_refresh_token",
  "authMethod": "idc",
  "clientId": "your_client_id",
  "clientSecret": "your_client_secret"
}
```

---

## 项目结构

```
kiro-node/
├── src/
│   ├── index.js          # 入口文件
│   ├── db.js             # 数据库管理
│   ├── kiro-client.js    # Kiro API 客户端
│   ├── pool.js           # 账号池管理
│   ├── settings.js       # 设置管理
│   ├── token.js          # Token 管理
│   ├── usage.js          # 用量统计
│   ├── event-parser.js   # 事件解析器
│   ├── migrations/       # 数据迁移脚本
│   ├── public/           # 静态资源
│   └── routes/           # 路由模块
├── data/                 # 数据存储
│   └── kiro.db           # SQLite 数据库（自动创建）
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```

---

## License

MIT

