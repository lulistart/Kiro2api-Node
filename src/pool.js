import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { TokenManager } from './token.js';
import { checkUsageLimits } from './usage.js';

const ACCOUNTS_FILE = 'accounts.json';
const LOGS_FILE = 'request_logs.json';

export class AccountPool {
  constructor(config) {
    this.config = config;
    this.accounts = new Map();
    this.tokenManagers = new Map();
    this.strategy = 'round-robin';
    this.roundRobinIndex = 0;
    this.logs = [];
    this.maxLogs = 1000;
  }

  async load() {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });
      
      // 加载账号
      const accountsPath = path.join(this.config.dataDir, ACCOUNTS_FILE);
      try {
        const content = await fs.readFile(accountsPath, 'utf-8');
        const accounts = JSON.parse(content);
        for (const acc of accounts) {
          this.accounts.set(acc.id, acc);
          this.tokenManagers.set(acc.id, new TokenManager(this.config, acc.credentials));
        }
        console.log(`✓ 加载了 ${accounts.length} 个账号`);
      } catch { }

      // 加载日志
      const logsPath = path.join(this.config.dataDir, LOGS_FILE);
      try {
        const content = await fs.readFile(logsPath, 'utf-8');
        this.logs = JSON.parse(content).slice(-this.maxLogs);
      } catch { }
    } catch (e) {
      console.error('加载账号池失败:', e);
    }
  }

  async save() {
    const accountsPath = path.join(this.config.dataDir, ACCOUNTS_FILE);
    const accounts = Array.from(this.accounts.values());
    await fs.writeFile(accountsPath, JSON.stringify(accounts, null, 2));
  }

  async saveLogs() {
    const logsPath = path.join(this.config.dataDir, LOGS_FILE);
    await fs.writeFile(logsPath, JSON.stringify(this.logs.slice(-this.maxLogs)));
  }

  async addAccount(account, skipValidation = false) {
    const id = account.id || uuidv4();
    const newAccount = {
      id,
      name: account.name || '未命名账号',
      credentials: account.credentials,
      status: 'active',
      requestCount: 0,
      errorCount: 0,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    };

    // 验证凭证（可跳过）
    if (!skipValidation) {
      const tm = new TokenManager(this.config, newAccount.credentials);
      await tm.ensureValidToken(); // 会抛出错误如果无效
    }

    this.accounts.set(id, newAccount);
    this.tokenManagers.set(id, new TokenManager(this.config, newAccount.credentials));
    await this.save();
    return id;
  }

  async removeAccount(id) {
    const removed = this.accounts.delete(id);
    this.tokenManagers.delete(id);
    if (removed) await this.save();
    return removed;
  }

  listAccounts() {
    return Array.from(this.accounts.values()).map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      requestCount: a.requestCount,
      errorCount: a.errorCount,
      createdAt: a.createdAt,
      lastUsedAt: a.lastUsedAt,
      usage: a.usage || null
    }));
  }

  async refreshAccountUsage(id) {
    const account = this.accounts.get(id);
    if (!account) return null;

    try {
      const tm = this.tokenManagers.get(id);
      const token = await tm.ensureValidToken();
      const usage = await checkUsageLimits(token, this.config);
      
      account.usage = {
        usageLimit: usage.usageLimit,
        currentUsage: usage.currentUsage,
        available: usage.available,
        userEmail: usage.userEmail,
        subscriptionType: usage.subscriptionType,
        nextReset: usage.nextReset,
        updatedAt: new Date().toISOString()
      };
      
      await this.save();
      return account.usage;
    } catch (e) {
      console.error(`刷新账号 ${id} 额度失败:`, e.message);
      return { error: e.message };
    }
  }

  async refreshAllUsage() {
    const results = [];
    for (const [id, account] of this.accounts) {
      if (account.status !== 'invalid') {
        const usage = await this.refreshAccountUsage(id);
        results.push({ id, name: account.name, usage });
      }
    }
    return results;
  }

  async selectAccount() {
    const available = Array.from(this.accounts.values())
      .filter(a => a.status === 'active');
    
    if (available.length === 0) return null;

    let selected;
    switch (this.strategy) {
      case 'random':
        selected = available[Math.floor(Math.random() * available.length)];
        break;
      case 'least-used':
        selected = available.reduce((a, b) => a.requestCount < b.requestCount ? a : b);
        break;
      default: // round-robin
        selected = available[this.roundRobinIndex % available.length];
        this.roundRobinIndex++;
    }

    selected.requestCount++;
    selected.lastUsedAt = new Date().toISOString();
    
    // 异步保存，不阻塞请求
    this.save().catch(() => {});
    
    return {
      id: selected.id,
      name: selected.name,
      tokenManager: this.tokenManagers.get(selected.id)
    };
  }

  async recordError(id, isRateLimit) {
    const account = this.accounts.get(id);
    if (!account) return;
    
    account.errorCount++;
    if (isRateLimit) {
      account.status = 'cooldown';
      setTimeout(() => {
        if (account.status === 'cooldown') {
          account.status = 'active';
        }
      }, 5 * 60 * 1000); // 5分钟冷却
    }
    await this.save();
  }

  async markInvalid(id) {
    const account = this.accounts.get(id);
    if (account) {
      account.status = 'invalid';
      await this.save();
    }
  }

  async enableAccount(id) {
    const account = this.accounts.get(id);
    if (account) {
      account.status = 'active';
      await this.save();
      return true;
    }
    return false;
  }

  async disableAccount(id) {
    const account = this.accounts.get(id);
    if (account) {
      account.status = 'disabled';
      await this.save();
      return true;
    }
    return false;
  }

  setStrategy(strategy) {
    this.strategy = strategy;
  }

  getStrategy() {
    return this.strategy;
  }

  getStats() {
    const accounts = Array.from(this.accounts.values());
    return {
      total: accounts.length,
      active: accounts.filter(a => a.status === 'active').length,
      cooldown: accounts.filter(a => a.status === 'cooldown').length,
      invalid: accounts.filter(a => a.status === 'invalid').length,
      disabled: accounts.filter(a => a.status === 'disabled').length,
      totalRequests: accounts.reduce((sum, a) => sum + a.requestCount, 0),
      totalErrors: accounts.reduce((sum, a) => sum + a.errorCount, 0)
    };
  }

  addLog(log) {
    this.logs.push({ ...log, timestamp: new Date().toISOString() });
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    this.saveLogs().catch(() => {});
  }

  getRecentLogs(n = 100) {
    return this.logs.slice(-n).reverse();
  }

  async clearLogs() {
    this.logs = [];
    await this.saveLogs();
  }

  async removeAccounts(ids) {
    let removed = 0;
    for (const id of ids) {
      if (this.accounts.delete(id)) {
        this.tokenManagers.delete(id);
        removed++;
      }
    }
    if (removed > 0) await this.save();
    return { total: ids.length, removed };
  }

  getLogStats() {
    return {
      totalInputTokens: this.logs.reduce((sum, l) => sum + (l.inputTokens || 0), 0),
      totalOutputTokens: this.logs.reduce((sum, l) => sum + (l.outputTokens || 0), 0)
    };
  }
}
