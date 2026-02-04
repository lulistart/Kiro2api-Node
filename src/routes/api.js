import { Router } from 'express';
import { KiroClient, KiroApiError } from '../kiro-client.js';
import { EventStreamDecoder, parseKiroEvent } from '../event-parser.js';
import { countTokens, countMessagesTokens, countToolUseTokens } from '../tokenizer.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

// 获取模型上下文长度
function getModelContextLength(model, config) {
  const configured = Number(config?.modelContextLength);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  const lower = String(model || '').toLowerCase();
  if (lower.includes('sonnet')) return 200000;
  if (lower.includes('opus')) return 200000;
  if (lower.includes('haiku')) return 200000;
  return 200000;
}

// 标准化上下文使用百分比
function normalizeContextUsagePercentage(value) {
  let pct = Number(value);
  if (!Number.isFinite(pct)) return 0;
  if (pct > 1) pct = pct / 100;
  if (pct < 0) pct = 0;
  if (pct > 1) pct = 1;
  return pct;
}

export function createApiRouter(state) {
  const router = Router();

  // API Key 认证中间件
  const authMiddleware = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || 
                   req.headers['authorization']?.replace('Bearer ', '');
    
    if (!apiKey || !state.settingsManager.verifyApiKey(apiKey)) {
      return res.status(401).json({
        type: 'error',
        error: { type: 'authentication_error', message: 'Invalid API key' }
      });
    }
    next();
  };

  router.use(authMiddleware);

  // GET /v1/models
  router.get('/models', (req, res) => {
    res.json({
      object: 'list',
      data: [
        { 
          id: 'claude-sonnet-4-5-20250929', 
          object: 'model', 
          created: 1727568000, 
          owned_by: 'anthropic', 
          display_name: 'Claude Sonnet 4.5',
          model_type: 'chat',
          max_tokens: 32000
        },
        { 
          id: 'claude-opus-4-5-20251101', 
          object: 'model', 
          created: 1730419200, 
          owned_by: 'anthropic', 
          display_name: 'Claude Opus 4.5',
          model_type: 'chat',
          max_tokens: 32000
        },
        { 
          id: 'claude-haiku-4-5-20251001', 
          object: 'model', 
          created: 1727740800, 
          owned_by: 'anthropic', 
          display_name: 'Claude Haiku 4.5',
          model_type: 'chat',
          max_tokens: 32000
        }
      ]
    });
  });

  // POST /v1/messages (Anthropic 格式)
  router.post('/messages', async (req, res) => {
    const startTime = Date.now();
    let selected = null;

    try {
      // 选择账号
      selected = await state.accountPool.selectAccount();
      if (!selected) {
        return res.status(503).json({
          type: 'error',
          error: { type: 'overloaded_error', message: '没有可用的账号' }
        });
      }

      const isStream = req.body.stream === true;
      const kiroClient = new KiroClient(state.config, selected.tokenManager);

      // 调用 Kiro API
      const { response, toolNameMap } = await kiroClient.callApiStream(req.body);

      if (isStream) {
        // 流式响应
        await handleStreamResponse(res, response, toolNameMap, selected, state, startTime, req.body.model);
      } else {
        // 非流式响应
        await handleNonStreamResponse(res, response, toolNameMap, selected, state, startTime, req.body.model);
      }

    } catch (error) {
      // 记录错误
      if (selected) {
        state.accountPool.addLog({
          accountId: selected.id,
          accountName: selected.name,
          model: req.body.model,
          inputTokens: inputTokens,
          outputTokens: 0,
          durationMs: Date.now() - startTime,
          success: false,
          error: error.message
        });
        
        // 增加账号错误计数
        const isRateLimit = error.status === 429 || error.message?.includes('rate') || error.message?.includes('limit');
        state.accountPool.recordError(selected.id, isRateLimit);
      }

      if (error instanceof KiroApiError) {
        try {
          const debugDir = path.join(state.config.dataDir || './data', 'debug');
          await fs.mkdir(debugDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const debugPath = path.join(debugDir, `kiro_error_${stamp}.json`);
          await fs.writeFile(debugPath, JSON.stringify({
            at: new Date().toISOString(),
            status: error.status,
            responseText: error.responseText,
            requestDebug: error.requestDebug
          }, null, 2));
        } catch {
          // ignore debug write failures
        }
      }

      const status = inferHttpStatus(error);
      const errorType = inferAnthropicErrorType(status);

      res.status(status).json({
        type: 'error',
        error: { type: errorType, message: error.message }
      });
    }
  });

  return router;
}

function inferHttpStatus(error) {
  const msg = String(error?.message || '');

  const kiroStatusMatch = msg.match(/Kiro API 错误:\s*(\d{3})\b/);
  if (kiroStatusMatch) {
    const code = parseInt(kiroStatusMatch[1], 10);
    if (Number.isFinite(code)) return code;
  }

  if (msg.includes('不支持的模型') || msg.includes('消息数组不能为空')) {
    return 400;
  }

  // 网络/上游异常：偏向 502
  if (msg.includes('FetchError') || msg.includes('ECONN') || msg.includes('ETIMEDOUT')) {
    return 502;
  }

  return 500;
}

function inferAnthropicErrorType(status) {
  if (status === 401) return 'authentication_error';
  if (status === 429) return 'rate_limit_error';
  if (status === 503) return 'overloaded_error';
  if (status >= 400 && status < 500) return 'invalid_request_error';
  return 'api_error';
}

/**
 * 处理流式响应 (Anthropic 格式)
 */
async function handleStreamResponse(res, response, toolNameMap, selected, state, startTime, model) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const messageId = 'msg_' + uuidv4().replace(/-/g, '');
  const decoder = new EventStreamDecoder();
  const toolNameReverse = new Map();
  for (const [originalName, kiroName] of toolNameMap || []) {
    toolNameReverse.set(kiroName, originalName);
  }
  let inputTokens = 0;
  const modelContextLength = getModelContextLength(model, state.config);
  let outputTokens = 0;
  let contentBlockIndex = 0;
  let thinkingBlockIndex = -1;
  let textBlockIndex = -1;
  let hasToolUse = false;
  let eventCount = 0;
  let outputTextBuffer = '';
  let outputThinkingBuffer = '';
  const toolUseBuffers = new Map(); // toolUseId -> { name, input }

  // thinking 处理状态
  let thinkingBuffer = '';
  let inThinkingBlock = false;
  let thinkingExtracted = false;

  // 工具调用状态跟踪
  const toolBlocks = new Map(); // toolUseId -> blockIndex

  // 发送初始事件
  const messageStart = {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  };
  res.write(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`);

  // 辅助函数：发送 text_delta
  function sendTextDelta(text) {
    if (!text) return;

    outputTextBuffer += text;

    if (textBlockIndex === -1) {
      // 如果有 thinking 块，先结束它
      if (thinkingBlockIndex !== -1) {
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: thinkingBlockIndex
        })}\n\n`);
        thinkingBlockIndex = -1;
      }

      textBlockIndex = contentBlockIndex++;
      res.write(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: textBlockIndex,
        content_block: { type: 'text', text: '' }
      })}\n\n`);
    }

    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: textBlockIndex,
      delta: { type: 'text_delta', text: text }
    })}\n\n`);
  }

  // 辅助函数：发送 thinking_delta
  function sendThinkingDelta(thinking) {
    if (!thinking) return;

    outputThinkingBuffer += thinking;
    
    if (thinkingBlockIndex === -1) {
      thinkingBlockIndex = contentBlockIndex++;
      res.write(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: thinkingBlockIndex,
        content_block: { type: 'thinking', thinking: '' }
      })}\n\n`);
    }
    
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: thinkingBlockIndex,
      delta: { type: 'thinking_delta', thinking: thinking }
    })}\n\n`);
  }
  
  // 辅助函数：处理包含 thinking 标签的内容
  function processContentWithThinking(content) {
    thinkingBuffer += content;
    
    while (true) {
      if (!inThinkingBlock && !thinkingExtracted) {
        // 查找 <thinking> 开始标签
        const startPos = thinkingBuffer.indexOf('<thinking>');
        if (startPos !== -1) {
          // 发送 <thinking> 之前的内容
          const beforeThinking = thinkingBuffer.substring(0, startPos);
          if (beforeThinking) {
            sendTextDelta(beforeThinking);
          }
          
          // 进入 thinking 块
          inThinkingBlock = true;
          thinkingBuffer = thinkingBuffer.substring(startPos + '<thinking>'.length);
        } else {
          // 没有找到 <thinking>，保留可能是部分标签的内容
          const safeLen = Math.max(0, thinkingBuffer.length - '<thinking>'.length);
          if (safeLen > 0) {
            const safeContent = thinkingBuffer.substring(0, safeLen);
            sendTextDelta(safeContent);
            thinkingBuffer = thinkingBuffer.substring(safeLen);
          }
          break;
        }
      } else if (inThinkingBlock) {
        // 在 thinking 块内，查找 </thinking> 结束标签
        const endPos = thinkingBuffer.indexOf('</thinking>');
        if (endPos !== -1) {
          // 检查后面是否有双换行符（真正的结束标签）
          const afterTag = thinkingBuffer.substring(endPos + '</thinking>'.length);
          if (afterTag.length >= 2 && afterTag.startsWith('\n\n')) {
            // 提取 thinking 内容
            const thinkingContent = thinkingBuffer.substring(0, endPos);
            if (thinkingContent) {
              sendThinkingDelta(thinkingContent);
            }
            
            // 结束 thinking 块
            inThinkingBlock = false;
            thinkingExtracted = true;
            
            // 关闭 thinking 块
            if (thinkingBlockIndex !== -1) {
              res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                type: 'content_block_stop',
                index: thinkingBlockIndex
              })}\n\n`);
            }
            
            thinkingBuffer = afterTag.substring(2); // 跳过 \n\n
          } else if (afterTag.length < 2) {
            // 等待更多内容
            break;
          } else {
            // 不是真正的结束标签，继续搜索
            const thinkingContent = thinkingBuffer.substring(0, endPos + '</thinking>'.length);
            sendThinkingDelta(thinkingContent);
            thinkingBuffer = afterTag;
          }
        } else {
          // 没有找到结束标签，发送当前内容
          const safeLen = Math.max(0, thinkingBuffer.length - '</thinking>'.length);
          if (safeLen > 0) {
            const safeContent = thinkingBuffer.substring(0, safeLen);
            sendThinkingDelta(safeContent);
            thinkingBuffer = thinkingBuffer.substring(safeLen);
          }
          break;
        }
      } else {
        // thinking 已提取完成，剩余内容作为 text_delta
        if (thinkingBuffer) {
          sendTextDelta(thinkingBuffer);
          thinkingBuffer = '';
        }
        break;
      }
    }
  }

  try {
    for await (const chunk of response.body) {
      decoder.feed(chunk);
      
      for (const frame of decoder.decode()) {
        const event = parseKiroEvent(frame);
        if (!event || !event.data) continue;
        
        eventCount++;
        const eventType = event.type;
        const data = event.data;

        if (eventType === 'assistantResponseEvent') {
          const content = data.content || '';
          if (!content) continue;
          
          // 处理内容（可能包含 thinking 标签）
          processContentWithThinking(content);

        } else if (eventType === 'toolUseEvent') {
          // 工具调用事件
          hasToolUse = true;
          const toolUseId = data.toolUseId;
          const toolName = toolNameReverse.get(data.name) || data.name;
          const toolInput = data.input || '';
          const isStop = data.stop || false;

          // 累积工具调用到 buffer
          if (!toolUseBuffers.has(toolUseId)) {
            toolUseBuffers.set(toolUseId, { name: toolName, input: '' });
          }
          toolUseBuffers.get(toolUseId).input += toolInput;

          // 如果是新的工具调用，先结束文本块
          if (!toolBlocks.has(toolUseId)) {
            // flush thinking buffer
            if (thinkingBuffer) {
              if (inThinkingBlock) {
                sendThinkingDelta(thinkingBuffer);
              } else {
                sendTextDelta(thinkingBuffer);
              }
              thinkingBuffer = '';
            }

            if (textBlockIndex !== -1) {
              res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                type: 'content_block_stop',
                index: textBlockIndex
              })}\n\n`);
              textBlockIndex = -1;
            }

            const toolBlockIndex = contentBlockIndex++;
            toolBlocks.set(toolUseId, toolBlockIndex);

            res.write(`event: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: toolBlockIndex,
              content_block: {
                type: 'tool_use',
                id: toolUseId,
                name: toolName,
                input: {}
              }
            })}\n\n`);
          }

          const toolBlockIndex = toolBlocks.get(toolUseId);

          if (toolInput) {
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              index: toolBlockIndex,
              delta: { type: 'input_json_delta', partial_json: toolInput }
            })}\n\n`);
          }

          if (isStop) {
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({
              type: 'content_block_stop',
              index: toolBlockIndex
            })}\n\n`);
          }

        } else if (eventType === 'contextUsageEvent') {
          const percentage = normalizeContextUsagePercentage(data.contextUsagePercentage || 0);
          const estimated = Math.round(percentage * modelContextLength);
          if (estimated > inputTokens) {
            inputTokens = estimated;
          }
        }
      }
    }

    // flush 剩余的 thinking buffer
    if (thinkingBuffer) {
      if (inThinkingBlock) {
        sendThinkingDelta(thinkingBuffer);
        if (thinkingBlockIndex !== -1) {
          res.write(`event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: thinkingBlockIndex
          })}\n\n`);
        }
      } else {
        sendTextDelta(thinkingBuffer);
      }
      thinkingBuffer = '';
    }

    // 结束最后的 content block
    if (textBlockIndex !== -1) {
      res.write(`event: content_block_stop\ndata: ${JSON.stringify({
        type: 'content_block_stop',
        index: textBlockIndex
      })}\n\n`);
    }

    // 确定 stop_reason
    const stopReason = hasToolUse ? 'tool_use' : 'end_turn';

    // 使用 tiktoken 计算输出 token
    outputTokens = countTokens(outputTextBuffer) + countTokens(outputThinkingBuffer) + countToolUseTokens(toolUseBuffers);

    // 发送最终事件
    res.write(`event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: inputTokens, output_tokens: outputTokens }
    })}\n\n`);

    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);

    res.end();

    // 记录成功
    state.accountPool.addLog({
      accountId: selected.id,
      accountName: selected.name,
      model: model,
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens,
      durationMs: Date.now() - startTime,
      success: true
    });

  } catch (error) {
    res.end();
  }
}

/**
 * 处理非流式响应 (Anthropic 格式)
 */
async function handleNonStreamResponse(res, response, toolNameMap, selected, state, startTime, model) {
  const decoder = new EventStreamDecoder();
  let textContent = '';
  let thinkingContent = '';
  const toolUses = [];
  let inputTokens = 0;
  const modelContextLength = getModelContextLength(model, state.config);
  let outputTokens = 0;
  const toolNameReverse = new Map();
  for (const [originalName, kiroName] of toolNameMap || []) {
    toolNameReverse.set(kiroName, originalName);
  }

  // 工具调用 JSON 缓冲区
  const toolJsonBuffers = new Map();

  try {
    // node-fetch v3 的 body 是一个 ReadableStream
    for await (const chunk of response.body) {
      decoder.feed(chunk);
      
      for (const frame of decoder.decode()) {
        const event = parseKiroEvent(frame);
        if (!event || !event.data) continue;

        const eventType = event.type;
        const data = event.data;

        if (eventType === 'thinkingEvent') {
          thinkingContent += data.thinking || '';
        } else if (eventType === 'assistantResponseEvent') {
          textContent += data.content || '';
        } else if (eventType === 'toolUseEvent') {
          const toolUseId = data.toolUseId;
          const toolName = toolNameReverse.get(data.name) || data.name;
          const toolInput = data.input || '';
          const isStop = data.stop || false;

          // 累积工具的 JSON 输入
          if (!toolJsonBuffers.has(toolUseId)) {
            toolJsonBuffers.set(toolUseId, { name: toolName, input: '' });
          }
          toolJsonBuffers.get(toolUseId).input += toolInput;

          // 如果是完整的工具调用，添加到列表
          if (isStop) {
            const buffer = toolJsonBuffers.get(toolUseId);
            try {
              const input = JSON.parse(buffer.input);
              toolUses.push({
                type: 'tool_use',
                id: toolUseId,
                name: buffer.name,
                input: input
              });
            } catch (e) {
              toolUses.push({
                type: 'tool_use',
                id: toolUseId,
                name: buffer.name,
                input: {}
              });
            }
          }
        } else if (eventType === 'contextUsageEvent') {
          const percentage = normalizeContextUsagePercentage(data.contextUsagePercentage || 0);
          const estimated = Math.round(percentage * modelContextLength);
          if (estimated > inputTokens) {
            inputTokens = estimated;
          }
        }
      }
    }

    // 构建响应内容
    const content = [];

    if (thinkingContent) {
      content.push({
        type: 'thinking',
        thinking: thinkingContent
      });
    }

    if (textContent) {
      content.push({
        type: 'text',
        text: textContent
      });
    }

    content.push(...toolUses);

    // 使用 tiktoken 计算输出 tokens
    outputTokens = countTokens(textContent) + countTokens(thinkingContent) + countToolUseTokens(toolJsonBuffers);

    const messageId = 'msg_' + uuidv4().replace(/-/g, '');
    const stopReason = toolUses.length > 0 ? 'tool_use' : 'end_turn';

    res.json({
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: content,
      model: model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens || 0,
        output_tokens: outputTokens
      }
    });

    // 记录成功
    state.accountPool.addLog({
      accountId: selected.id,
      accountName: selected.name,
      model: model,
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens,
      durationMs: Date.now() - startTime,
      success: true
    });

  } catch (error) {
    throw error;
  }
}
