import { Router } from 'express';

// SSE 客户端连接池
const sseClients = new Set();

// 广播更新给所有连接的客户端
export function broadcastUpdate(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

export function createAdminRouter(state) {
  const router = Router();

  // Admin Key 认证中间件
  const authMiddleware = (req, res, next) => {
    const adminKey = req.headers['authorization']?.replace('Bearer ', '');
    
    if (!adminKey || !state.settingsManager.verifyAdminKey(adminKey)) {
      return res.status(401).json({ error: '需要认证，请提供管理密钥' });
    }
    next();
  };

  router.use(authMiddleware);

  // SSE 实时更新端点
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);
    
    // 发送初始数据
    const initialData = {
      type: 'init',
      stats: state.accountPool.getStats(),
      accounts: state.accountPool.listAccounts(),
      logStats: state.accountPool.getLogStats()
    };
    res.write(`data: ${JSON.stringify(initialData)}\n\n`);

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // GET /api/status
  router.get('/status', (req, res) => {
    const stats = state.accountPool.getStats();
    res.json({
      status: 'running',
      version: '1.0.0',
      uptimeSecs: Math.floor((Date.now() - state.startTime) / 1000),
      pool: stats
    });
  });

  // GET /api/accounts
  router.get('/accounts', (req, res) => {
    res.json(state.accountPool.listAccounts());
  });

  // POST /api/accounts
  router.post('/accounts', async (req, res) => {
    try {
      const { name, refresh_token, auth_method, client_id, client_secret } = req.body;
      
      const id = await state.accountPool.addAccount({
        name,
        credentials: {
          refreshToken: refresh_token,
          authMethod: auth_method,
          clientId: client_id,
          clientSecret: client_secret
        }
      });
      
      res.status(201).json({ id });
    } catch (error) {
      res.status(400).json({ error: `凭证验证失败: ${error.message}` });
    }
  });

  // POST /api/accounts/import
  router.post('/accounts/import', async (req, res) => {
    try {
      const { raw_json, name } = req.body;
      const parsed = JSON.parse(raw_json);
      
      // 支持数组格式（批量导入）
      const accounts = Array.isArray(parsed) ? parsed : [parsed];
      const results = [];
      
      for (const raw of accounts) {
        try {
          const authMethod = (raw.clientId && raw.clientSecret) ? 'idc' : 'social';
          const accountName = raw.label || raw.email || name || '导入的账号';
          
          const id = await state.accountPool.addAccount({
            name: accountName,
            credentials: {
              refreshToken: raw.refreshToken,
              authMethod,
              clientId: raw.clientId,
              clientSecret: raw.clientSecret,
              region: raw.region,
              machineId: raw.machineId
            }
          }, true); // skipValidation = true，导入时跳过验证
          results.push({ success: true, id, name: accountName });
        } catch (e) {
          results.push({ success: false, name: raw.label || raw.email, error: e.message });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      res.status(201).json({ 
        total: accounts.length, 
        success: successCount, 
        failed: accounts.length - successCount,
        results 
      });
    } catch (error) {
      res.status(400).json({ error: `导入失败: ${error.message}` });
    }
  });

  // DELETE /api/accounts/:id
  router.delete('/accounts/:id', async (req, res) => {
    const removed = await state.accountPool.removeAccount(req.params.id);
    res.status(removed ? 204 : 404).end();
  });

  // POST /api/accounts/:id/enable
  router.post('/accounts/:id/enable', async (req, res) => {
    const success = await state.accountPool.enableAccount(req.params.id);
    res.json({ success });
  });

  // POST /api/accounts/:id/disable
  router.post('/accounts/:id/disable', async (req, res) => {
    const success = await state.accountPool.disableAccount(req.params.id);
    res.json({ success });
  });

  // POST /api/accounts/:id/refresh-usage - 刷新单个账号额度
  router.post('/accounts/:id/refresh-usage', async (req, res) => {
    try {
      const usage = await state.accountPool.refreshAccountUsage(req.params.id);
      if (!usage) {
        return res.status(404).json({ error: '账号不存在' });
      }
      res.json(usage);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/accounts/refresh-all-usage - 刷新所有账号额度
  router.post('/accounts/refresh-all-usage', async (req, res) => {
    try {
      const results = await state.accountPool.refreshAllUsage();
      res.json(results);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/strategy
  router.get('/strategy', (req, res) => {
    res.json({ strategy: state.accountPool.getStrategy() });
  });

  // POST /api/strategy
  router.post('/strategy', (req, res) => {
    const { strategy } = req.body;
    if (!['round-robin', 'random', 'least-used'].includes(strategy)) {
      return res.status(400).json({ error: '无效的策略' });
    }
    state.accountPool.setStrategy(strategy);
    res.json({ success: true });
  });

  // GET /api/logs
  router.get('/logs', (req, res) => {
    res.json(state.accountPool.getRecentLogs(100));
  });

  // DELETE /api/logs - 清空日志
  router.delete('/logs', async (req, res) => {
    await state.accountPool.clearLogs();
    res.json({ success: true });
  });

  // GET /api/logs/stats
  router.get('/logs/stats', (req, res) => {
    res.json(state.accountPool.getLogStats());
  });

  // DELETE /api/accounts/batch - 批量删除账号
  router.delete('/accounts/batch', async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供要删除的账号 ID 列表' });
    }
    const results = await state.accountPool.removeAccounts(ids);
    res.json(results);
  });

  // ============ 设置管理 API ============

  // POST /api/settings/admin-key
  router.post('/settings/admin-key', async (req, res) => {
    const { new_key } = req.body;
    if (!new_key || new_key.length < 6) {
      return res.status(400).json({ error: '密钥长度至少 6 位' });
    }
    await state.settingsManager.changeAdminKey(new_key);
    res.json({ success: true });
  });

  // GET /api/settings/api-keys
  router.get('/settings/api-keys', (req, res) => {
    const keys = state.settingsManager.listApiKeys();
    res.json(keys.map(key => ({ key })));
  });

  // POST /api/settings/api-keys
  router.post('/settings/api-keys', async (req, res) => {
    const { key } = req.body;
    if (!key || key.length < 6) {
      return res.status(400).json({ error: '密钥长度至少 6 位' });
    }
    const added = await state.settingsManager.addApiKey(key);
    res.status(added ? 201 : 409).json({ success: added, error: added ? null : '密钥已存在' });
  });

  // DELETE /api/settings/api-keys
  router.delete('/settings/api-keys', async (req, res) => {
    const { key } = req.body;
    const removed = await state.settingsManager.removeApiKey(key);
    res.json({ success: removed, error: removed ? null : '无法删除，至少保留一个 API 密钥' });
  });

  return router;
}
