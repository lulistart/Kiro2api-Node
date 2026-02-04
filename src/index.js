import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { SettingsManager } from './settings.js';
import { AccountPool } from './pool.js';
import { createApiRouter } from './routes/api.js';
import { createUiRouter } from './routes/ui.js';
import { createAdminRouter } from './routes/admin.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  try {
    console.log('========== 启动诊断信息 ==========');
    console.log('Node 版本:', process.version);
    console.log('工作目录:', process.cwd());
    console.log('环境变量 PORT:', process.env.PORT);
    console.log('环境变量 NODE_ENV:', process.env.NODE_ENV);
    
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));

    // 配置
    const config = {
      port: parseInt(process.env.PORT) || 8080,
      apiKey: process.env.API_KEY || 'sk-default-key',
      adminKey: process.env.ADMIN_KEY || 'admin-default-key',
      dataDir: process.env.DATA_DIR || './data',
      region: process.env.REGION || 'us-east-1',
      kiroVersion: process.env.KIRO_VERSION || '0.8.0',
      proxyUrl: process.env.PROXY_URL || null
    };

    console.log('配置端口:', config.port);
    console.log('正在初始化服务...');

    // 初始化设置管理器
    const settingsManager = new SettingsManager(config.dataDir);
    await settingsManager.init(config.adminKey, config.apiKey);
    console.log('✓ 设置管理器初始化完成');

    // 初始化账号池
    const accountPool = new AccountPool(config);
    await accountPool.load();
    console.log('✓ 账号池初始化完成');

    // 启动时间
    const startTime = Date.now();

    // 共享状态
    const state = {
      config,
      settingsManager,
      accountPool,
      startTime
    };

    // 静态文件
    const publicPath = path.join(__dirname, 'public');
    console.log('静态文件目录:', publicPath);
    app.use(express.static(publicPath));

    // API 路由 (需要 API Key 认证)
    app.use('/v1', createApiRouter(state));

    // 管理 API 路由 (需要 Admin Key 认证)
    app.use('/api', createAdminRouter(state));

    // UI 路由
    app.use('/', createUiRouter(state));

    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log('========================================');
      console.log(`🚀 Kiro-Node 已启动`);
      console.log(`   端口: ${config.port}`);
      console.log(`   监听: 0.0.0.0:${config.port}`);
      console.log(`   API Key: ${config.apiKey.slice(0, 8)}***`);
      console.log(`   管理面板: http://localhost:${config.port}/login`);
      console.log(`   API 端点:`);
      console.log(`     GET  /v1/models`);
      console.log(`     POST /v1/messages`);
      console.log(`     GET  /health`);
      console.log('========================================');
    });

    server.on('error', (error) => {
      console.error('❌ 服务器错误:', error);
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ 服务启动失败:', error);
    console.error('错误堆栈:', error.stack);
    process.exit(1);
  }
}

startServer();
