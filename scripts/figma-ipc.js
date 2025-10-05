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
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.content)) {
      for (let i = 0; i < raw.content.length; i++) {
        const entry = raw.content[i];
        if (entry && entry.type === 'text' && typeof entry.text === 'string') {
          try {
            return JSON.parse(entry.text);
          } catch (error) {
            const message = error && error.message ? error.message : error;
            console.warn('⚠️ normalizeToolResult text parse failed:', message);
          }
        }
      }
    }

    if (raw.result && typeof raw.result === 'object') {
      return raw.result;
    }

    if (!Array.isArray(raw)) {
      return raw;
    }
  }

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      const message = error && error.message ? error.message : error;
      console.warn('⚠️ normalizeToolResult string parse failed:', message);
    }
  }

  return raw || {};
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

/**
 * 准备卡片根节点并清理内容（标准流程）
 * @param {Object} ctx - 上下文对象（包含 ws, sendCommand 等）
 * @param {string} instanceId - 组件实例 ID
 * @param {Object} options - 配置选项
 * @param {string} options.mode - 清理模式（默认 'safe'）
 * @param {string[]} options.targetNames - 清理目标容器名称列表
 * @param {string[]} options.removeNamePrefixes - 需要删除的节点名称前缀
 * @param {string[]} options.preserveNames - 需要保留的节点名称列表
 * @param {boolean} options.skipClear - 是否跳过清理步骤（默认 false）
 * @returns {Promise<string>} - 返回准备好的 rootId
 */
export async function prepareAndClearCard(ctx, instanceId, options = {}) {
  const {
    mode = 'safe',
    targetNames = [],
    removeNamePrefixes = [],
    preserveNames = ['Logo', '背景', 'Background'],
    skipClear = false
  } = options;

  // Step 1: 准备根节点
  let rootId = instanceId;
  try {
    const result = await sendCommand(ctx, 'prepare_card_root', { nodeId: instanceId });
    const prep = parsePrepareCardRootResult(result);

    if (prep && prep.rootId) {
      rootId = prep.rootId;
      const times = prep.detachedTimes ?? 'unknown';
      const deep = prep.descendantDetaches ?? 'unknown';
      console.log(`✅ 根节点准备完成: ${rootId} (detached=${times}, deep=${deep})`);
    } else {
      console.warn('⚠️ prepare_card_root 返回异常，使用原始 ID');
    }
  } catch (error) {
    console.warn('⚠️ prepare_card_root 失败，继续使用原始 ID:', error.message || error);
  }

  // Step 2: 清理动态内容（可选）
  if (!skipClear) {
    try {
      const clearParams = {
        cardId: rootId,
        mode
      };

      if (targetNames.length > 0) clearParams.targetNames = targetNames;
      if (removeNamePrefixes.length > 0) clearParams.removeNamePrefixes = removeNamePrefixes;
      if (preserveNames.length > 0) clearParams.preserveNames = preserveNames;

      await sendCommand(ctx, 'clear_card_content', clearParams);
      console.log('🧹 已清理卡片动态内容');
    } catch (error) {
      console.warn('⚠️ 清理内容失败:', error.message || error);
    }
  }

  // Step 3: 强制布局刷新（避免测量为 0）
  try {
    await sendCommand(ctx, 'flush_layout', {});
  } catch {}
  await sleep(80);

  return rootId;
}

/**
 * 填充图片（自动降级：URL → Base64）
 * @param {Object} ctx - 上下文对象
 * @param {string} nodeId - 目标节点 ID
 * @param {string} url - 图片 URL
 * @param {Object} options - 配置选项
 * @param {string} options.scaleMode - 缩放模式（默认 'FIT'）
 * @param {number} options.opacity - 透明度（默认 1）
 * @param {Function} options.base64Fallback - Base64 降级函数（可选）
 * @param {Function} options.throttleFn - 限流函数（可选）
 * @returns {Promise<boolean>} - 是否成功填充
 */
export async function fillImage(ctx, nodeId, url, options = {}) {
  const {
    scaleMode = 'FIT',
    opacity = 1,
    base64Fallback = null,
    throttleFn = null
  } = options;

  let success = false;
  let lastError = null;

  // 尝试 1: URL 填充
  try {
    const res = await sendCommand(ctx, 'set_image_fill', {
      nodeId,
      imageUrl: url,
      scaleMode,
      opacity
    });
    success = !res || res.success !== false;

    if (success) {
      console.log(`✅ 图片填充成功 (URL): ${nodeId}`);
      return true;
    }
  } catch (error) {
    lastError = error;
    console.warn(`⚠️ URL 填充失败 (${nodeId}):`, error.message || error);
  }

  // 尝试 2: Base64 降级
  if (!success && base64Fallback) {
    try {
      const base64 = await base64Fallback(url);

      if (base64) {
        // 应用限流（如果提供）
        if (throttleFn) await throttleFn();

        const resFallback = await sendCommand(ctx, 'set_image_fill', {
          nodeId,
          imageBase64: base64,
          scaleMode,
          opacity
        });
        success = !resFallback || resFallback.success !== false;

        if (success) {
          console.log(`✅ 图片填充成功 (Base64): ${nodeId}`);
          return true;
        }
      } else {
        console.warn(`⚠️ Base64 降级不可用: ${nodeId}`);
      }
    } catch (fallbackError) {
      lastError = fallbackError;
      console.warn(`⚠️ Base64 填充失败 (${nodeId}):`, fallbackError.message || fallbackError);
    }
  }

  // 两种方式都失败
  const reason = lastError ? (lastError.message || lastError) : 'unknown reason';
  console.warn(`❌ 图片填充失败 (${nodeId}): ${reason}`);
  return false;
}

/**
 * 智能节点查找（浅 → 深 → 选区降级）
 * @param {Object} ctx - 上下文对象
 * @param {string} rootId - 根节点 ID（用于浅层和深度搜索）
 * @param {string} targetName - 目标节点名称
 * @param {Object} options - 配置选项
 * @param {string[]} options.types - 节点类型列表（默认 ['FRAME', 'SECTION', 'GROUP', 'COMPONENT', 'INSTANCE']）
 * @param {boolean} options.useDeep - 是否使用深度搜索（默认 true）
 * @param {boolean} options.useSelectionFallback - 是否使用选区降级（默认 false）
 * @returns {Promise<Object|null>} - 找到的节点对象，包含 {id, name, type}
 */
export async function findNode(ctx, rootId, targetName, options = {}) {
  const {
    types = DEFAULT_SCAN_TYPES,
    useDeep = true,
    useSelectionFallback = false
  } = options;

  // 策略 1: 浅层查找（快速）
  try {
    const nodeInfo = await sendCommand(ctx, 'get_node_info', { nodeId: rootId });
    const shallow = findShallowByName(nodeInfo?.children, targetName);
    if (shallow && shallow.id) {
      console.log(`🔍 浅层查找成功: ${targetName} → ${shallow.id}`);
      return shallow;
    }
  } catch (error) {
    console.warn('⚠️ 浅层查找失败:', error.message || error);
  }

  // 策略 2: 深度搜索
  if (useDeep) {
    try {
      const deep = await deepFindByName(ctx, rootId, targetName, types);
      if (deep && deep.id) {
        console.log(`🔍 深度查找成功: ${targetName} → ${deep.id}`);
        return deep;
      }
    } catch (error) {
      console.warn('⚠️ 深度查找失败:', error.message || error);
    }
  }

  // 策略 3: 选区降级
  if (useSelectionFallback) {
    try {
      const sel = await sendCommand(ctx, 'get_selection', {});
      const first = (sel.selection || []).find(n => types.includes(n.type)) || sel.selection?.[0];

      if (first) {
        console.warn(`⚠️ 使用选区降级: ${first.name} (${first.id})`);
        return first;
      }
    } catch (error) {
      console.warn('⚠️ 选区降级失败:', error.message || error);
    }
  }

  console.warn(`❌ 未找到节点: ${targetName}`);
  return null;
}

/**
 * 批量查找节点（并行查找，提高性能）
 * @param {Object} ctx - 上下文对象
 * @param {string} rootId - 根节点 ID
 * @param {string[]} targetNames - 目标节点名称列表
 * @param {Object} options - 配置选项（同 findNode）
 * @returns {Promise<Map<string, Object>>} - 名称到节点的映射
 */
export async function findNodes(ctx, rootId, targetNames, options = {}) {
  const results = new Map();

  // 并行查找所有节点
  const promises = targetNames.map(async (name) => {
    const node = await findNode(ctx, rootId, name, options);
    if (node) results.set(name, node);
  });

  await Promise.all(promises);

  console.log(`🔍 批量查找完成: ${results.size}/${targetNames.length} 个节点找到`);
  return results;
}

/**
 * 强制布局刷新并等待结算（关键操作，避免测量为 0）
 * @param {Object} ctx - 上下文对象
 * @param {number} delay - 等待时间（默认 80ms）
 * @returns {Promise<void>}
 */
export async function flushLayout(ctx, delay = 80) {
  try {
    await sendCommand(ctx, 'flush_layout', {});
  } catch (error) {
    console.warn('⚠️ flush_layout 失败:', error.message || error);
  }
  await sleep(delay);
}

/**
 * 批量获取节点信息（并行）
 * @param {Object} ctx - 上下文对象
 * @param {string[]} nodeIds - 节点 ID 列表
 * @returns {Promise<Map<string, Object>>} - nodeId → nodeInfo 映射
 */
export async function getNodesInfo(ctx, nodeIds) {
  if (!nodeIds || nodeIds.length === 0) {
    return new Map();
  }

  const promises = nodeIds.map(nodeId =>
    sendCommand(ctx, 'get_node_info', { nodeId })
      .catch(error => {
        console.warn(`⚠️ get_node_info 失败 (${nodeId}):`, error.message || error);
        return null;
      })
  );

  const results = await Promise.all(promises);
  const map = new Map();

  nodeIds.forEach((nodeId, index) => {
    if (results[index]) {
      map.set(nodeId, results[index]);
    }
  });

  console.log(`📊 批量获取节点信息: ${map.size}/${nodeIds.length} 个成功`);
  return map;
}

/**
 * 设置文本内容并配置自动调整模式
 * @param {Object} ctx - 上下文对象
 * @param {string} nodeId - 文本节点 ID
 * @param {string} text - 文本内容
 * @param {Object} options - 配置选项
 * @param {string} options.autoResize - 自动调整模式 ('NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT')
 * @param {Object} options.layoutSizing - 布局尺寸配置 {layoutSizingHorizontal, layoutSizingVertical}
 * @param {boolean} options.flush - 是否自动刷新布局（默认 false）
 * @returns {Promise<void>}
 */
export async function setText(ctx, nodeId, text, options = {}) {
  const { autoResize = null, layoutSizing = null, flush = false } = options;

  // Step 1: 设置文本
  try {
    await sendCommand(ctx, 'set_text_content', { nodeId, text });
  } catch (error) {
    console.warn(`⚠️ set_text_content 失败 (${nodeId}):`, error.message || error);
    throw error;
  }

  // Step 2: 自动调整模式（可选）
  if (autoResize) {
    try {
      await sendCommand(ctx, 'set_text_auto_resize', { nodeId, autoResize });
    } catch (error) {
      console.warn(`⚠️ set_text_auto_resize 失败 (${nodeId}):`, error.message || error);
    }
  }

  // Step 3: 布局尺寸（可选）
  if (layoutSizing) {
    try {
      await sendCommand(ctx, 'set_layout_sizing', {
        nodeId,
        ...layoutSizing
      });
    } catch (error) {
      console.warn(`⚠️ set_layout_sizing 失败 (${nodeId}):`, error.message || error);
    }
  }

  // Step 4: 刷新布局（可选）
  if (flush) {
    await flushLayout(ctx);
  }

  console.log(`✅ 文本已设置: ${nodeId} (autoResize=${autoResize || 'none'})`);
}

/**
 * 安全执行命令（自动 try-catch）
 * @param {Object} ctx - 上下文对象
 * @param {string} command - 命令名称
 * @param {Object} params - 参数
 * @param {Object} options - 选项
 * @param {any} options.fallback - 失败时返回的默认值（默认 null）
 * @param {boolean} options.silent - 是否静默错误（默认 false）
 * @param {number} options.retries - 重试次数（默认 0）
 * @returns {Promise<any>} - 命令结果，失败返回 fallback
 */
export async function sendCommandSafe(ctx, command, params = {}, options = {}) {
  const { fallback = null, silent = false, retries = 0 } = options;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await sendCommand(ctx, command, params);
      return result;
    } catch (error) {
      lastError = error;
      if (!silent && attempt === retries) {
        console.warn(`⚠️ ${command} 失败:`, error.message || error);
      }
      if (attempt < retries) {
        await sleep(100 * (attempt + 1)); // 指数退避
      }
    }
  }

  return fallback;
}

/**
 * 创建组件实例并设置属性
 * @param {Object} ctx - 上下文对象
 * @param {Object} options - 配置选项
 * @param {string} options.componentKey - 组件 Key
 * @param {string} options.componentId - 组件 ID
 * @param {string} options.parentId - 父节点 ID
 * @param {number} options.x - X 位置（默认 0）
 * @param {number} options.y - Y 位置（默认 0）
 * @param {Object} options.properties - 实例属性
 * @returns {Promise<string>} - 实例 ID
 */
export async function createInstance(ctx, options = {}) {
  const {
    componentKey,
    componentId,
    parentId,
    x = 0,
    y = 0,
    properties = {}
  } = options;

  let instanceId = null;

  // 策略 1: 直接创建
  if (componentKey || componentId) {
    try {
      const result = await sendCommand(ctx, 'create_component_instance', {
        componentKey,
        componentId,
        x,
        y
      });
      instanceId = result?.id;
      if (instanceId) {
        console.log(`✅ 直接创建实例: ${instanceId}`);
      }
    } catch (error) {
      console.warn('⚠️ 直接创建失败:', error.message || error);
    }
  }

  if (!instanceId) {
    throw new Error('组件实例创建失败');
  }

  // 设置属性
  if (Object.keys(properties).length > 0) {
    try {
      await sendCommand(ctx, 'set_instance_properties_by_base', {
        nodeId: instanceId,
        properties
      });
      console.log(`✅ 实例属性已设置: ${instanceId}`);
    } catch (error) {
      console.warn('⚠️ 属性设置失败:', error.message || error);
    }
  }

  return instanceId;
}
