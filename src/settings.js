import fs from 'fs/promises';
import path from 'path';

const SETTINGS_FILE = 'settings.json';

export class SettingsManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.settings = {
      adminKey: '',
      apiKeys: new Set()
    };
  }

  async init(defaultAdminKey, defaultApiKey) {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const filePath = path.join(this.dataDir, SETTINGS_FILE);
      
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const loaded = JSON.parse(content);
        this.settings.adminKey = loaded.adminKey;
        this.settings.apiKeys = new Set(loaded.apiKeys || []);
        console.log('✓ 从文件加载了系统设置');
      } catch {
        // 文件不存在，使用默认值
        this.settings.adminKey = defaultAdminKey;
        this.settings.apiKeys.add(defaultApiKey);
        await this.save();
        console.log('✓ 使用默认值初始化系统设置');
      }
    } catch (e) {
      console.error('初始化设置失败:', e);
    }
  }

  async save() {
    const filePath = path.join(this.dataDir, SETTINGS_FILE);
    const data = {
      adminKey: this.settings.adminKey,
      apiKeys: Array.from(this.settings.apiKeys)
    };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  verifyAdminKey(key) {
    return this.settings.adminKey === key;
  }

  verifyApiKey(key) {
    return this.settings.apiKeys.has(key);
  }

  async changeAdminKey(newKey) {
    this.settings.adminKey = newKey;
    await this.save();
  }

  async addApiKey(key) {
    if (this.settings.apiKeys.has(key)) return false;
    this.settings.apiKeys.add(key);
    await this.save();
    return true;
  }

  async removeApiKey(key) {
    if (this.settings.apiKeys.size <= 1) return false;
    const removed = this.settings.apiKeys.delete(key);
    if (removed) await this.save();
    return removed;
  }

  listApiKeys() {
    return Array.from(this.settings.apiKeys);
  }
}
