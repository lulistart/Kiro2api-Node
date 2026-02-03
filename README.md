# Kiro2API-Node

<p align="center">
  <strong>将 Kiro AWS Claude API 转换为标准 Anthropic API 格式的 Node.js 代理服务</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#api-文档">API 文档</a> •
  <a href="#管理面板">管理面板</a> •
  <a href="#配置说明">配置说明</a>
</p>

> 基于 [kiro2api-rs](https://github.com/vagmr/kiro2api-rs) 使用 Node.js 重构优化
>
> ⭐ 如果这个项目对你有帮助，请给个 Star 支持一下！

---

## 功能特性

### 核心功能
- 🔄 **Anthropic API 兼容** - 完整支持 Anthropic Claude API 格式
- 📡 **流式响应** - 支持 SSE (Server-Sent Events) 实时输出
- 🔐 **Token 自动刷新** - 自动管理和刷新 OAuth Token
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

### 方式二：Docker 部署

```bash
# 使用 docker-compose（推荐）
docker-compose up -d

# 或手动构建运行
docker build -t kiro2api-node .
docker run -d -p 8080:8080 \
  -e API_KEY=sk-your-key \
  -e ADMIN_KEY=your-admin-key \
  -v ./data:/app/data \
  kiro2api-node
```

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

| 模型 ID | 说明 |
|---------|------|
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 |
| `claude-opus-4-5-20251101` | Claude Opus 4.5 |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |

---

## 管理面板

访问 `http://localhost:8080/login` 使用管理密钥登录。

### 功能列表

- **账号管理** - 添加、导入、删除、启用/禁用账号
- **额度监控** - 查看和刷新账号配额
- **请求记录** - 查看历史请求日志
- **策略切换** - 轮询 / 随机 / 最少使用
- **密钥管理** - 管理多个 API Key

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
│   ├── kiro-client.js    # Kiro API 客户端
│   ├── pool.js           # 账号池管理
│   ├── settings.js       # 设置管理
│   ├── token.js          # Token 管理
│   ├── usage.js          # 用量统计
│   ├── event-parser.js   # 事件解析器
│   ├── public/           # 静态资源
│   └── routes/           # 路由模块
├── data/                 # 数据存储
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## License

MIT

