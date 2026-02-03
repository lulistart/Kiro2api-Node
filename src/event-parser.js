/**
 * AWS Event Stream 解析器
 * 解析 Kiro API 返回的二进制事件流
 */

import zlib from 'zlib';

const PRELUDE_SIZE = 12; // 4 (total_length) + 4 (headers_length) + 4 (prelude_crc)
const MESSAGE_CRC_SIZE = 4;
const MIN_MESSAGE_SIZE = PRELUDE_SIZE + MESSAGE_CRC_SIZE;

/**
 * CRC32C 计算（简化版，用于验证）
 */
function crc32c(data) {
  // 简化实现，实际生产环境应使用 crc32c 库
  let crc = 0xFFFFFFFF;
  const table = getCrc32cTable();
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

let crc32cTable = null;
function getCrc32cTable() {
  if (crc32cTable) return crc32cTable;
  crc32cTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0x82F63B78 ^ (crc >>> 1)) : (crc >>> 1);
    }
    crc32cTable[i] = crc;
  }
  return crc32cTable;
}

/**
 * 解析单个事件帧
 */
function parseFrame(buffer, offset = 0) {
  if (buffer.length - offset < MIN_MESSAGE_SIZE) {
    return null; // 数据不足
  }

  // 读取 prelude
  const totalLength = buffer.readUInt32BE(offset);
  const headersLength = buffer.readUInt32BE(offset + 4);
  
  // 验证长度
  if (totalLength < MIN_MESSAGE_SIZE || totalLength > 16 * 1024 * 1024) {
    throw new Error(`无效的消息长度: ${totalLength}`);
  }

  if (buffer.length - offset < totalLength) {
    return null; // 数据不足
  }

  // 解析 headers
  const headersStart = offset + PRELUDE_SIZE;
  const headersEnd = headersStart + headersLength;
  const headers = parseHeaders(buffer.slice(headersStart, headersEnd));

  // 解析 payload
  const payloadStart = headersEnd;
  const payloadEnd = offset + totalLength - MESSAGE_CRC_SIZE;
  let payload = buffer.slice(payloadStart, payloadEnd);

  // 检查是否需要解压
  const contentType = headers[':content-type'];
  if (contentType === 'application/vnd.amazon.eventstream') {
    // 嵌套的事件流，递归解析
    return {
      headers,
      payload: null,
      nested: parseFrame(payload),
      consumed: totalLength
    };
  }

  // 尝试解压 payload
  if (payload.length > 0) {
    try {
      // 检查是否是 gzip 压缩
      if (payload[0] === 0x1f && payload[1] === 0x8b) {
        payload = zlib.gunzipSync(payload);
      }
    } catch (e) {
      // 解压失败，使用原始数据
    }
  }

  return {
    headers,
    payload,
    consumed: totalLength
  };
}

/**
 * 解析 headers
 */
function parseHeaders(buffer) {
  const headers = {};
  let offset = 0;

  while (offset < buffer.length) {
    // 读取 header name 长度
    const nameLength = buffer.readUInt8(offset);
    offset += 1;

    // 读取 header name
    const name = buffer.slice(offset, offset + nameLength).toString('utf8');
    offset += nameLength;

    // 读取 header type
    const headerType = buffer.readUInt8(offset);
    offset += 1;

    // 根据类型读取值
    let value;
    switch (headerType) {
      case 0: // bool_true
        value = true;
        break;
      case 1: // bool_false
        value = false;
        break;
      case 2: // byte
        value = buffer.readInt8(offset);
        offset += 1;
        break;
      case 3: // short
        value = buffer.readInt16BE(offset);
        offset += 2;
        break;
      case 4: // int
        value = buffer.readInt32BE(offset);
        offset += 4;
        break;
      case 5: // long
        value = buffer.readBigInt64BE(offset);
        offset += 8;
        break;
      case 6: // bytes
        const bytesLength = buffer.readUInt16BE(offset);
        offset += 2;
        value = buffer.slice(offset, offset + bytesLength);
        offset += bytesLength;
        break;
      case 7: // string
        const strLength = buffer.readUInt16BE(offset);
        offset += 2;
        value = buffer.slice(offset, offset + strLength).toString('utf8');
        offset += strLength;
        break;
      case 8: // timestamp
        value = new Date(Number(buffer.readBigInt64BE(offset)));
        offset += 8;
        break;
      case 9: // uuid
        value = buffer.slice(offset, offset + 16).toString('hex');
        offset += 16;
        break;
      default:
        throw new Error(`未知的 header 类型: ${headerType}`);
    }

    headers[name] = value;
  }

  return headers;
}

/**
 * 事件流解码器
 */
export class EventStreamDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * 添加数据到缓冲区
   */
  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  /**
   * 解码所有可用的帧
   */
  *decode() {
    while (this.buffer.length >= MIN_MESSAGE_SIZE) {
      try {
        const frame = parseFrame(this.buffer);
        if (!frame) break; // 数据不足

        // 移除已处理的数据
        this.buffer = this.buffer.slice(frame.consumed);

        // 处理嵌套帧
        if (frame.nested) {
          yield frame.nested;
        } else {
          yield frame;
        }
      } catch (e) {
        // 解析错误，跳过一个字节继续
        this.buffer = this.buffer.slice(1);
      }
    }
  }
}

/**
 * 解析 Kiro 事件
 */
export function parseKiroEvent(frame) {
  const eventType = frame.headers[':event-type'];
  
  if (!frame.payload || frame.payload.length === 0) {
    return { type: eventType, data: null };
  }

  try {
    const data = JSON.parse(frame.payload.toString('utf8'));
    return { type: eventType, data };
  } catch (e) {
    return { type: eventType, data: frame.payload.toString('utf8') };
  }
}
