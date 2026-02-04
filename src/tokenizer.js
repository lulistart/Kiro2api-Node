import { get_encoding } from 'tiktoken';

// 使用 Claude 的 tokenizer (cl100k_base)
let encoder = null;

function getEncoder() {
  if (!encoder) {
    encoder = get_encoding('cl100k_base');
  }
  return encoder;
}

/**
 * 计算文本的 token 数量
 * @param {string} text - 要计算的文本
 * @returns {number} token 数量
 */
export function countTokens(text) {
  if (!text) return 0;
  try {
    const enc = getEncoder();
    return enc.encode(text).length;
  } catch (e) {
    // 降级到估算
    return Math.ceil(text.length / 2);
  }
}

/**
 * 计算消息数组的 token 数量
 * @param {Array} messages - Anthropic 格式的消息数组
 * @returns {number} token 数量
 */
export function countMessagesTokens(messages) {
  if (!messages || !Array.isArray(messages)) return 0;
  
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += countTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') {
          total += countTokens(block.text);
        } else if (block.type === 'tool_result') {
          total += countTokens(typeof block.content === 'string' ? block.content : JSON.stringify(block.content));
        }
      }
    }
    // 每条消息额外开销约 4 tokens
    total += 4;
  }
  return total;
}

/**
 * 计算工具调用的 token 数量
 * @param {Map} toolUseBuffers - Map of toolUseId -> { name, input }
 * @returns {number} token 数量
 */
export function countToolUseTokens(toolUseBuffers) {
  let total = 0;
  for (const toolUse of toolUseBuffers.values()) {
    total += countTokens(toolUse.name || '');
    total += countTokens(toolUse.input || '');
  }
  return total;
}
