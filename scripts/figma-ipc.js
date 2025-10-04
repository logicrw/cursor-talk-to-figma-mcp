import WebSocket from 'ws';

const COMMAND_TIMEOUT_MS = 30000;
const DEFAULT_SCAN_TYPES = ['FRAME', 'SECTION', 'GROUP', 'COMPONENT', 'INSTANCE'];

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureState(ctx) {
  if (!ctx) throw new Error('Figma IPC context is required');
  if (!ctx.pending) ctx.pending = new Map();
  if (!ctx.messageId) ctx.messageId = 1;
}

export function normalizeToolResult(raw) {
  if (raw == null) return null;

  if (raw && typeof raw === 'object') {
    const content = Array.isArray(raw.content) ? raw.content : null;
    if (content) {
      for (let i = 0; i < content.length; i++) {
        const entry = content[i];
        if (entry && entry.type === 'text' && typeof entry.text === 'string') {
          try {
            return JSON.parse(entry.text);
          } catch (error) {
            console.warn('⚠️ normalizeToolResult text parse failed:', error?.message || error);
          }
        }
      }
    }
  }

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn('⚠️ normalizeToolResult string parse failed:', error?.message || error);
      return { text: raw };
    }
  }

  if (raw && typeof raw === 'object' && raw.result && typeof raw.result === 'object') {
    return raw.result;
  }

  if (raw && typeof raw === 'object') {
    return raw;
  }

  return raw;
}

export async function connectWS(ctx, { url, channel, joinPayload } = {}) {
  if (!url) throw new Error('connectWS requires url');
  ensureState(ctx);
  const targetChannel = channel ? String(channel).trim() : '';

  return await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);

    const handleError = (err) => {
      console.error('❌ WebSocket 错误:', err && err.message ? err.message : err);
      if (settled) return;
      settled = true;
      reject(err);
    };

    ws.on('open', async () => {
      ctx.ws = ws;
      ctx.channel = targetChannel || ctx.channel || '';
      settled = true;
      console.log(`✅ WebSocket connected: ${url}`);

      if (targetChannel) {
        try {
          console.log(`📡 Joining channel: ${targetChannel}`);
          await wsSend(ctx, joinPayload || { type: 'join', channel: targetChannel });
        } catch (error) {
          handleError(error);
          return;
        }
      }
      resolve(ws);
    });

    ws.on('message', (data) => onMessage(ctx, data));
    ws.on('error', handleError);
    ws.on('close', () => {
      console.log('🔌 WebSocket connection closed');
    });
  });
}

export function onMessage(ctx, raw) {
  try {
    const msg = JSON.parse(raw.toString());
    console.log(`📨 Received message type: ${msg.type}${msg.message?.id ? ` (id: ${msg.message.id})` : ''}`);

    if (msg.type === 'broadcast' && msg.message) {
      const inner = msg.message;
      if (inner.id && ctx.pending?.has(inner.id) && inner.result !== undefined) {
        const entry = ctx.pending.get(inner.id);
        ctx.pending.delete(inner.id);
        if (entry?.timeout) clearTimeout(entry.timeout);
        console.log(`✅ Got result for command id: ${inner.id}`);
        const payload = inner && Object.prototype.hasOwnProperty.call(inner, 'result')
          ? inner.result
          : inner;
        entry.resolve(normalizeToolResult(payload));
        return;
      }
    }

    if (msg.type === 'system') {
      if (msg.message && typeof msg.message === 'object' && msg.message.result) {
        console.log(`✅ Channel confirmed: ${msg.channel}`);
      }
    }
  } catch (error) {
    console.error('消息解析错误:', error);
  }
}

function wsSend(ctx, payload) {
  return new Promise((resolve, reject) => {
    if (!ctx?.ws) {
      reject(new Error('WebSocket connection is not ready'));
      return;
    }
    ctx.ws.send(JSON.stringify(payload), (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

export async function sendCommand(ctx, command, params = {}) {
  ensureState(ctx);
  const id = String(ctx.messageId++);
  console.log(`📤 Sending command: ${command} (id: ${id})`);

  return await new Promise((resolve, reject) => {
    ctx.pending.set(id, { resolve, reject });
    const payload = {
      id,
      type: 'message',
      channel: ctx.channel,
      message: { id, command, params }
    };

    wsSend(ctx, payload).catch((error) => {
      if (ctx.pending.has(id)) {
        const entry = ctx.pending.get(id);
        if (entry?.timeout) clearTimeout(entry.timeout);
        ctx.pending.delete(id);
        reject(error);
      }
    });

    const timeout = setTimeout(() => {
      if (ctx.pending.has(id)) {
        ctx.pending.delete(id);
        console.error(`❌ Timeout for command ${command} (id: ${id})`);
        reject(new Error(`Timeout for command ${command}`));
      }
    }, COMMAND_TIMEOUT_MS);

    const entry = ctx.pending.get(id);
    if (entry) entry.timeout = timeout;
  });
}

export function parsePrepareCardRootResult(raw) {
  if (!raw) return null;
  const direct = normalizeToolResult(raw);

  if (direct && typeof direct === 'object' && typeof direct.rootId === 'string') {
    return direct;
  }

  if (direct && typeof direct === 'object' && Array.isArray(direct.content)) {
    for (let i = 0; i < direct.content.length; i++) {
      const entry = direct.content[i];
      if (entry && entry.type === 'text' && typeof entry.text === 'string') {
        try {
          const parsed = JSON.parse(entry.text);
          if (parsed && typeof parsed.rootId === 'string') {
            return parsed;
          }
        } catch (error) {
          console.warn('⚠️ prepare_card_root nested text parse failed:', error?.message || error);
        }
      }
    }
  }

  return null;
}

export function normalizeName(input) {
  return String(input || '')
    .normalize('NFKC')
    .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

export async function deepFindByName(ctx, rootNodeId, targetName, types = DEFAULT_SCAN_TYPES) {
  if (!rootNodeId || !targetName) return null;
  const normalizedTarget = normalizeName(targetName);
  try {
    const res = await sendCommand(ctx, 'scan_nodes_by_types', { nodeId: rootNodeId, types });
    const nodes = res?.nodes || res?.matchingNodes || [];
    return nodes.find((n) => normalizeName(n.name) === normalizedTarget) || null;
  } catch (error) {
    console.warn('⚠️ deepFindByName failed:', error?.message || error);
    return null;
  }
}

export function findShallowByName(children, targetName) {
  const normalizedTarget = normalizeName(targetName);
  return (children || []).find((child) => normalizeName(child.name) === normalizedTarget) || null;
}
