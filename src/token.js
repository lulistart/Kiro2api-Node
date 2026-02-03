import fetch from 'node-fetch';
import crypto from 'crypto';

export class TokenManager {
  constructor(config, credentials) {
    this.config = config;
    this.credentials = credentials;
    this.accessToken = credentials.accessToken || null;
    this.expiresAt = credentials.expiresAt ? new Date(credentials.expiresAt) : new Date(0);
  }

  async ensureValidToken() {
    // 检查 token 是否过期（提前 5 分钟刷新）
    if (this.accessToken && this.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
      return this.accessToken;
    }

    // 刷新 token
    return await this.refreshToken();
  }

  async refreshToken() {
    const authMethod = this.credentials.authMethod || 'social';
    
    if (authMethod === 'idc') {
      return await this.refreshIdcToken();
    } else {
      return await this.refreshSocialToken();
    }
  }

  async refreshSocialToken() {
    const region = this.config.region || 'us-east-1';
    const tokenUrl = `https://prod.${region}.auth.desktop.kiro.dev/refreshToken`;
    const machineId = this.credentials.machineId || TokenManager.generateMachineId();
    const kiroVersion = this.config.kiroVersion || '1.6.0';

    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': `KiroIDE-${kiroVersion}-${machineId}`,
        'Accept-Encoding': 'gzip, compress, deflate, br',
        'Connection': 'close'
      },
      body: JSON.stringify({ refresh_token: this.credentials.refreshToken })
    };

    // 代理支持
    if (this.config.proxyUrl) {
      try {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(this.config.proxyUrl);
      } catch (e) {
        console.warn('代理模块未安装，忽略代理设置');
      }
    }

    const response = await fetch(tokenUrl, fetchOptions);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Social Token 刷新失败: ${response.status} - ${error}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
    
    return this.accessToken;
  }

  async refreshIdcToken() {
    const region = this.credentials.region || this.config.region || 'us-east-1';
    const tokenUrl = `https://oidc.${region}.amazonaws.com/token`;

    // 使用 camelCase 格式（AWS SSO OIDC 要求）
    const body = {
      clientId: this.credentials.clientId,
      clientSecret: this.credentials.clientSecret,
      refreshToken: this.credentials.refreshToken,
      grantType: 'refresh_token'
    };

    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'x-amz-user-agent': 'aws-sdk-js/3.738.0 ua/2.1 os/other lang/js md/browser#unknown_unknown api/sso-oidc#3.738.0 m/E KiroIDE',
        'User-Agent': 'node',
        'Accept-Encoding': 'br, gzip, deflate'
      },
      body: JSON.stringify(body)
    };

    // 代理支持
    if (this.config.proxyUrl) {
      try {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(this.config.proxyUrl);
      } catch (e) {
        console.warn('代理模块未安装，忽略代理设置');
      }
    }

    const response = await fetch(tokenUrl, fetchOptions);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`IdC Token 刷新失败: ${response.status} - ${error}`);
    }

    const data = await response.json();
    this.accessToken = data.accessToken || data.access_token;
    this.expiresAt = new Date(Date.now() + (data.expiresIn || data.expires_in || 3600) * 1000);
    
    // 如果返回了新的 refresh_token，更新它
    if (data.refreshToken || data.refresh_token) {
      this.credentials.refreshToken = data.refreshToken || data.refresh_token;
    }
    
    return this.accessToken;
  }

  static generateMachineId() {
    return crypto.randomBytes(32).toString('hex');
  }
}
