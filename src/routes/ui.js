import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createUiRouter(state) {
  const router = Router();

  // 登录页面
  router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  // 健康检查端点
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Date.now() - state.startTime });
  });

  return router;
}
