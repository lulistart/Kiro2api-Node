import fetch from 'node-fetch';

/**
 * 查询账号使用额度
 * @param {string} accessToken - 访问令牌
 * @param {object} config - 配置（可选代理）
 * @returns {Promise<object>} 使用限制信息
 */
export async function checkUsageLimits(accessToken, config = {}) {
  const url = 'https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits?isEmailRequired=true&origin=AI_EDITOR&resourceType=AGENTIC_REQUEST';

  const fetchOptions = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'x-amz-user-agent': 'aws-sdk-js/1.0.0 KiroIDE',
      'user-agent': 'aws-sdk-js/1.0.0 KiroIDE'
    }
  };

  // 代理支持
  if (config.proxyUrl) {
    try {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      fetchOptions.agent = new HttpsProxyAgent(config.proxyUrl);
    } catch (e) {
      // 代理模块未安装，忽略
    }
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`获取使用限制失败: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return parseUsageLimits(data);
}

/**
 * 解析 AWS 返回的使用限制数据
 */
function parseUsageLimits(data) {
  const result = {
    resourceType: 'CREDIT',
    usageLimit: 0,
    currentUsage: 0,
    available: 0,
    nextReset: null,
    freeTrial: null,
    userEmail: data.userInfo?.email || null,
    subscriptionType: data.subscriptionInfo?.type || null
  };

  // 查找 CREDIT 类型
  for (const breakdown of data.usageBreakdownList || []) {
    if (breakdown.resourceType === 'CREDIT') {
      let totalLimit = breakdown.usageLimitWithPrecision || breakdown.usageLimit || 0;
      let totalUsed = breakdown.currentUsageWithPrecision || breakdown.currentUsage || 0;

      // 处理免费试用
      if (breakdown.freeTrialInfo && breakdown.freeTrialInfo.freeTrialStatus === 'ACTIVE') {
        const ft = breakdown.freeTrialInfo;
        const ftLimit = ft.usageLimitWithPrecision || ft.usageLimit || 0;
        const ftUsed = ft.currentUsageWithPrecision || ft.currentUsage || 0;
        totalLimit += ftLimit;
        totalUsed += ftUsed;

        result.freeTrial = {
          status: ft.freeTrialStatus,
          usageLimit: ftLimit,
          currentUsage: ftUsed,
          expiry: ft.freeTrialExpiry ? new Date(ft.freeTrialExpiry) : null
        };
      }

      result.usageLimit = totalLimit;
      result.currentUsage = totalUsed;
      result.available = Math.max(0, totalLimit - totalUsed);
      break;
    }
  }

  // 重置日期
  if (data.nextDateReset) {
    result.nextReset = new Date(data.nextDateReset);
  }

  return result;
}
