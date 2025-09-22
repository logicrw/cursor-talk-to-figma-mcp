#!/usr/bin/env node

/**
 * Article Images Generator
 * 生成文章配图（shortCard）- 支持多语言版本
 *
 * 用法:
 * node scripts/run_article_images.js \
 *   --channel 3fspxu5k \
 *   --content-zh docx2json/250915-单向上行_zh-CN.json \
 *   --content-en docx2json/250915-up-only_en-US.json \
 *   --content-tc docx2json/250915-單向上行_zh-HK.json \
 *   --template "shortCard"
 *
 * 可选参数：
 *   --auto-export  启用自动导出（默认关闭）
 *   --output-dir   导出目录（默认 ./exports）
 *   --asset-dir    资产目录（默认自动检测，如 assets/250915）
 */

import { promises as fs } from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  connectWS as connectFigmaWS,
  sendCommand as sendFigmaCommand,
  parsePrepareCardRootResult as parsePrepareCardRootResultUtil,
  sleep as sleepUtil,
  normalizeName as normalizeNameUtil,
  findShallowByName as findShallowByNameUtil
} from './figma-ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const THROTTLE_MS = 50;  // 操作间隔
const BASE64_THROTTLE_MS = 100;  // Base64 传输间隔

class ArticleImageRunner {
  constructor() {
    this.ws = null;
    this.staticServer = null;
    this.staticPort = 3056;
    this.staticUrl = `http://localhost:${this.staticPort}/assets`;
    this.wsHost = 'localhost';
    this.wsPort = 3055;

    // 命令行参数 - 频道优先级：CLI > 环境变量 > 默认值
    this.channel = this.getArg('--channel') || process.env.CHANNEL || 'weekly-poster';
    this.templateName = this.getArg('--template') || 'shortCard';
    this.outputDir = this.getArg('--output-dir') || './exports';

    // 资产目录（可通过参数覆盖，默认自动检测）
    this.assetDir = this.getArg('--asset-dir') || null;

    // 内容文件路径
    this.contentPaths = {
      zh: this.getArg('--content-zh'),
      en: this.getArg('--content-en'),
      tc: this.getArg('--content-tc')
    };

    // 自动导出控制
    const autoFlagIndex = process.argv.indexOf('--auto-export');
    this.enableAutoExport = process.env.AUTO_EXPORT === '1' || autoFlagIndex !== -1;

    // WebSocket 消息处理（对齐 run_weekly_poster.js）
    this.pending = new Map();  // 替代 commandCallbacks
    this.messageId = 1;        // 递增的消息 ID
    this.lastBase64Time = 0;

    // 内容数据
    this.contents = {};
    this.assets = {};
  }

  getArg(flag) {
    const index = process.argv.indexOf(flag);
    if (index > -1 && index < process.argv.length - 1) {
      return process.argv[index + 1];
    }
    return null;
  }

  async loadContent(lang, filePath) {
    if (!filePath) return null;

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);

      // 新格式：blocks 数组，包含 figure 和 paragraph 类型
      // 提取所有 figure blocks 组成 groups
      const figures = data.blocks?.filter(b => b.type === 'figure') || [];

      // 按 group_id 组织
      const groups = {};
      figures.forEach(fig => {
        const groupId = fig.group_id || `single_${figures.indexOf(fig)}`;
        if (!groups[groupId]) {
          groups[groupId] = [];
        }
        groups[groupId].push({
          title: fig.title,
          image: fig.image,
          credit: fig.credit,
          credit_tokens: fig.credit_tokens
        });
      });

      // 转换为数组格式
      const items = Object.values(groups).map(group => ({
        figures: group
      }));

      console.log(`📄 加载 ${lang} 内容: ${items.length} 组图片 (从 ${figures.length} 个 figure 块)`);

      // 自动检测资产目录（如果未指定）
      if (!this.assetDir && figures.length > 0) {
        const firstAssetId = figures[0]?.image?.asset_id;
        if (firstAssetId) {
          // 从文件路径推断资产目录
          // 假设 JSON 文件名格式: YYMMDD-title_lang.json
          const jsonName = path.basename(filePath);
          const match = jsonName.match(/^(\d{6})/);  // 匹配6位日期
          if (match) {
            this.assetDir = `assets/${match[1]}`;
            console.log(`🔍 自动检测资产目录: ${this.assetDir}`);
          }
        }
      }

      return {
        doc: data.doc,
        items,
        assets: [] // 新格式没有独立的 assets 数组
      };
    } catch (error) {
      console.error(`❌ 加载 ${lang} 内容失败:`, error.message);
      return null;
    }
  }

  async loadAllContents() {
    for (const [lang, path] of Object.entries(this.contentPaths)) {
      if (path) {
        this.contents[lang] = await this.loadContent(lang, path);
      }
    }

    const loadedLangs = Object.keys(this.contents).filter(lang => this.contents[lang]);
    if (loadedLangs.length === 0) {
      throw new Error('未能加载任何内容文件');
    }

    console.log(`✅ 已加载语言版本: ${loadedLangs.join(', ')}`);
  }

  async ensureStaticServer() {
    return new Promise((resolve) => {
      this.staticServer = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${this.staticPort}`);

        if (url.pathname.startsWith('/assets/')) {
          const assetPath = url.pathname.slice(8);
          // 动态资产路径
          const assetDir = this.assetDir || 'assets/250915';  // 默认值作为后备
          const fullPath = path.resolve('docx2json', assetDir, assetPath);

          fs.readFile(fullPath)
            .then(data => {
              const ext = path.extname(fullPath).toLowerCase();
              const contentType = ext === '.png' ? 'image/png' :
                               ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                               'application/octet-stream';

              res.writeHead(200, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*'
              });
              res.end(data);
            })
            .catch(err => {
              console.error(`静态服务器错误: ${err.message}`);
              res.writeHead(404);
              res.end('Not Found');
            });
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      this.staticServer.listen(this.staticPort, () => {
        console.log(`🌐 静态服务器运行在 http://localhost:${this.staticPort}`);
        resolve();
      });
    });
  }

  async connectWS() {
    const wsUrl = `ws://${this.wsHost}:${this.wsPort}`;
    console.log(`🔌 连接到 Figma 插件: ${wsUrl}`);
    const joinChan = this.channel.trim();
    await connectFigmaWS(this, { url: wsUrl, channel: joinChan });
    this.channel = joinChan;
  }

  sendCommand(command, params = {}) {
    return sendFigmaCommand(this, command, params);
  }

  // 不再需要单独的 joinChannel 方法，已集成到 connectWS 中

  async findShortCardComponent() {
    try {
      const result = await this.sendCommand('get_local_components');
      console.log(`📦 组件查询结果类型: ${typeof result}, 是否为数组: ${Array.isArray(result)}`);

      // 确保 result 是数组
      const components = Array.isArray(result) ? result : (result?.components || []);

      if (components.length === 0) {
        console.warn('⚠️ 未找到任何组件');
        throw new Error('没有可用的组件');
      }

      console.log(`📦 找到 ${components.length} 个组件`);

      // 查找 shortCard 组件
      const shortCard = components.find(c => {
        const name = c.name || '';
        const matches = name === this.templateName ||
                       name.includes('shortCard') ||
                       name.includes('短图');
        if (matches) {
          console.log(`  ✓ 匹配组件: ${name}`);
        }
        return matches;
      });

      if (!shortCard) {
        console.log('可用组件列表:');
        components.forEach(c => console.log(`  - ${c.name || '(unnamed)'}`));
        throw new Error(`未找到组件: ${this.templateName}`);
      }

      console.log(`✅ 找到组件: ${shortCard.name} (${shortCard.id || shortCard.key})`);
      return shortCard;
    } catch (error) {
      console.error('❌ 查找组件失败:', error.message);
      throw error;
    }
  }

  async createShortCardInstance(component, x = 0, y = 0, parentId = null) {
    try {
      // 支持传入 component.id 或 component.key
      const params = {
        x,
        y
      };

      if (component.id) {
        params.componentId = component.id;
      } else if (component.key) {
        params.componentKey = component.key;
      } else {
        throw new Error('组件缺少 id 或 key');
      }

      if (parentId) {
        params.parentId = parentId;
      }

      const result = await this.sendCommand('create_component_instance', params);

      if (!result || !result.id) {
        throw new Error('创建实例未返回有效 ID');
      }

      console.log(`✅ 创建组件实例: ${result.id}`);
      return result.id;
    } catch (error) {
      console.error('❌ 创建组件实例失败:', error.message);
      throw error;
    }
  }

  async applyVisibilityControl(rootId, options) {
    const { hasTitle, hasSource, imageCount } = options;

    const BOOL_TARGETS = this.buildVisibilityTargets({ hasTitle, hasSource, imageCount });

    const normalizePropToken = (value) => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

    const propertiesPayload = {};
    const fallbackHideNames = new Set();
    let propertyKeys = [];

    try {
      const propRefs = await this.sendCommand('get_component_property_references', { nodeId: rootId });
      const refProperties = (propRefs && typeof propRefs === 'object') ? (propRefs.properties || propRefs.componentProperties || propRefs) : {};
      propertyKeys = Array.isArray(propRefs?.propertyKeys) ? propRefs.propertyKeys : Object.keys(refProperties || {});
      console.log(`📋 组件属性键: ${propertyKeys.join(', ')}`);
    } catch (error) {
      console.warn('⚠️ 获取组件属性失败，启用降级路径:', error.message || error);
    }

    const entries = propertyKeys.map((key) => {
      const base = key.includes('#') ? key.split('#')[0] : key;
      return {
        key,
        base,
        normalized: normalizePropToken(key),
        normalizedBase: normalizePropToken(base)
      };
    });

    const resolvePropKey = (target) => {
      const normalized = normalizePropToken(target);
      const direct = entries.find((entry) => entry.normalized === normalized || entry.normalizedBase === normalized);
      if (direct) return direct.key;
      const fuzzy = entries.find((entry) => entry.normalized.includes(normalized) || normalized.includes(entry.normalized));
      return fuzzy ? fuzzy.key : null;
    };

    const togglesNeedingFallback = [];

    for (const target of BOOL_TARGETS) {
      const key = resolvePropKey(target.name);
      if (key) {
        propertiesPayload[key] = !!target.shouldShow;
      } else if (!target.shouldShow) {
        togglesNeedingFallback.push(target);
      }
    }

    let propUpdateSucceeded = true;
    if (Object.keys(propertiesPayload).length > 0) {
      try {
        console.log('🎛️ 设置组件属性:', JSON.stringify(propertiesPayload));
        const result = await this.sendCommand('set_instance_properties', {
          nodeId: rootId,
          properties: propertiesPayload
        });
        if (result && result.success === false) {
          propUpdateSucceeded = false;
          console.warn('⚠️ set_instance_properties 返回失败:', result.message);
        }
      } catch (error) {
        propUpdateSucceeded = false;
        console.warn('⚠️ 设置组件属性时出错，需降级隐藏:', error.message || error);
      }
    }

    if (!propUpdateSucceeded) {
      for (const target of BOOL_TARGETS) {
        if (!target.shouldShow && !togglesNeedingFallback.includes(target)) {
          togglesNeedingFallback.push(target);
        }
      }
    }

    await this.applyVisibilityFallbackInternal(rootId, togglesNeedingFallback);

    try {
      await this.sendCommand('flush_layout', {});
    } catch (error) {
      console.warn('⚠️ flush_layout 失败:', error.message || error);
    }
    await this.sleep(80);
  }

  buildVisibilityTargets({ hasTitle, hasSource, imageCount }) {
    return [
      { name: 'ShowimgSlot2', shouldShow: imageCount >= 2, fallback: ['imgSlot2', 'slot:IMAGE_GRID/imgSlot2'] },
      { name: 'ShowimgSlot3', shouldShow: imageCount >= 3, fallback: ['imgSlot3', 'slot:IMAGE_GRID/imgSlot3'] },
      { name: 'ShowimgSlot4', shouldShow: imageCount >= 4, fallback: ['imgSlot4', 'slot:IMAGE_GRID/imgSlot4'] },
      { name: 'Showslot:SOURCE', shouldShow: hasSource, fallback: ['slot:SOURCE', 'sourceText', 'SOURCE', 'Source', '来源'] },
      { name: 'Showslot:TITLE', shouldShow: hasTitle, fallback: ['slot:TITLE', 'titleText', 'TITLE', 'Title', '标题'] }
    ];
  }

  async applyVisibilityFallbackInternal(rootId, targets) {
    const fallbackHideNames = new Set();
    for (const target of targets || []) {
      if (!target?.shouldShow) {
        [target.name, ...(target.fallback || [])].forEach((name) => {
          if (name) fallbackHideNames.add(name);
        });
      }
    }

    if (fallbackHideNames.size === 0) {
      return;
    }

    const names = Array.from(fallbackHideNames).map((name) => name.trim()).filter(Boolean);
    console.log(`🪄 降级隐藏节点: ${names.join(', ')}`);
    try {
      await this.sendCommand('hide_nodes_by_name', {
        rootId,
        names
      });
    } catch (error) {
      console.warn('⚠️ hide_nodes_by_name 失败，逐个隐藏:', error.message || error);
      for (const name of names) {
        try {
          const nodeId = await this.findChildByName(rootId, name);
          if (nodeId) {
            await this.sendCommand('set_node_visible', { nodeId, visible: false });
          }
        } catch (fallbackError) {
          console.warn(`⚠️ set_node_visible(${name}) 失败:`, fallbackError.message || fallbackError);
        }
      }
    }

    try {
      await this.sendCommand('flush_layout', {});
    } catch (flushError) {
      console.warn('⚠️ flush_layout 失败:', flushError.message || flushError);
    }
    await this.sleep(80);
  }

  async applyVisibilityFallback(rootId, options) {
    const targets = this.buildVisibilityTargets(options);
    await this.applyVisibilityFallbackInternal(rootId, targets);
  }

  async reflowShortCard(rootId, layoutContext = {}) {
    const {
      titleSlotId,
      titleTextId,
      adornmentId,
      imageGridId,
      sourceNodeId,
      hasTitle,
      hasSource
    } = layoutContext;

    const TITLE_TO_GRID_GAP = 40;
    const GRID_TO_SOURCE_GAP = 32;

    if (!imageGridId) {
      console.warn('⚠️ 缺少 slot:IMAGE_GRID，跳过重排');
      return;
    }

    try {
      await this.sendCommand('flush_layout', {});
    } catch {}
    await this.sleep(150);

    const ids = [rootId, titleSlotId, titleTextId, adornmentId, imageGridId, sourceNodeId].filter(Boolean);
    const uniqueIds = Array.from(new Set(ids));

    const infoMap = new Map();
    const ensureDoc = async (nodeId) => {
      if (!nodeId) return null;
      if (infoMap.has(nodeId)) return infoMap.get(nodeId);
      try {
        const doc = await this.sendCommand('get_node_info', { nodeId });
        if (doc) infoMap.set(nodeId, doc);
        return doc || null;
      } catch (error) {
        console.warn(`⚠️ 获取节点 ${nodeId} 信息失败:`, error.message || error);
        return null;
      }
    };

    try {
      const bulk = await this.sendCommand('get_nodes_info', { nodeIds: uniqueIds });
      if (Array.isArray(bulk)) {
        for (const entry of bulk) {
          const nodeId = entry?.nodeId || entry?.id;
          const doc = entry?.document || entry;
          if (nodeId && doc) {
            infoMap.set(nodeId, doc);
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ 批量获取节点信息失败:', error.message || error);
    }

    const extractBounds = (doc) => {
      if (!doc) return null;
      const bounds = doc.absoluteRenderBounds || doc.absoluteBoundingBox;
      if (!bounds) return null;
      const width = (typeof bounds.width === 'number' ? bounds.width : 0);
      const height = (typeof bounds.height === 'number' ? bounds.height : 0);
      const x = (typeof bounds.x === 'number' ? bounds.x : 0);
      const y = (typeof bounds.y === 'number' ? bounds.y : 0);
      return {
        x,
        y,
        width,
        height,
        top: y,
        left: x,
        bottom: y + height,
        right: x + width
      };
    };

    const rootDoc = await ensureDoc(rootId);
    const gridDoc = await ensureDoc(imageGridId);

    if (!rootDoc || !gridDoc) {
      console.warn('⚠️ 缺少根节点或图片网格信息，无法重排');
      return;
    }

    const titleSlotDoc = await ensureDoc(titleSlotId);
    const titleTextDoc = await ensureDoc(titleTextId);
    const adornmentDoc = await ensureDoc(adornmentId);
    const sourceDoc = await ensureDoc(sourceNodeId);

    const rootBounds = extractBounds(rootDoc);
    const gridBounds = extractBounds(gridDoc);
    if (!rootBounds || !gridBounds) {
      console.warn('⚠️ 无法获取根节点或网格的尺寸信息');
      return;
    }

    const titleSlotBounds = extractBounds(titleSlotDoc);
    const titleTextBounds = extractBounds(titleTextDoc);
    const adornmentBounds = extractBounds(adornmentDoc);
    const sourceBounds = extractBounds(sourceDoc);

    const currentGridLocalX = gridBounds.left - rootBounds.left;
    const currentGridLocalY = gridBounds.top - rootBounds.top;
    const gridHeight = gridBounds.height;

    let titleBottom = titleSlotBounds ? titleSlotBounds.bottom : (rootBounds.top + TITLE_TO_GRID_GAP);

    if (hasTitle && titleSlotId && titleSlotBounds) {
      const bottoms = [];
      if (titleTextBounds) bottoms.push(titleTextBounds.bottom);
      if (adornmentBounds) bottoms.push(adornmentBounds.bottom);
      if (bottoms.length) {
        const desiredBottom = Math.max(...bottoms);
        const currentHeight = titleSlotBounds.height;
        const desiredHeight = Math.max(desiredBottom - titleSlotBounds.top, 0);
        if (Math.abs(desiredHeight - currentHeight) > 0.5) {
          try {
            const safeWidth = Math.max(titleSlotBounds.width, titleSlotBounds.right - titleSlotBounds.left, 0);
            await this.sendCommand('resize_node', {
              nodeId: titleSlotId,
              width: safeWidth,
              height: desiredHeight
            });
            titleBottom = titleSlotBounds.top + desiredHeight;
          } catch (error) {
            console.warn('⚠️ 调整标题容器高度失败:', error.message || error);
            titleBottom = Math.max(desiredBottom, titleSlotBounds.bottom);
          }
        } else {
          titleBottom = Math.max(desiredBottom, titleSlotBounds.bottom);
        }
      } else {
        titleBottom = titleSlotBounds.bottom;
      }
    } else if (titleSlotBounds) {
      titleBottom = titleSlotBounds.bottom;
    }

    const targetGridLocalY = hasTitle && titleSlotBounds
      ? Math.max(titleBottom + TITLE_TO_GRID_GAP - rootBounds.top, TITLE_TO_GRID_GAP)
      : Math.max(currentGridLocalY, TITLE_TO_GRID_GAP);

    if (Math.abs(targetGridLocalY - currentGridLocalY) > 0.5) {
      try {
        await this.sendCommand('move_node', {
          nodeId: imageGridId,
          x: currentGridLocalX,
          y: targetGridLocalY
        });
      } catch (error) {
        console.warn('⚠️ 移动图片网格失败:', error.message || error);
      }
    }

    if (sourceNodeId && hasSource) {
      const sourceLocalX = sourceBounds ? (sourceBounds.left - rootBounds.left) : 0;
      const currentSourceLocalY = sourceBounds ? (sourceBounds.top - rootBounds.top) : null;
      const targetSourceLocalY = targetGridLocalY + gridHeight + GRID_TO_SOURCE_GAP;
      if (currentSourceLocalY === null || Math.abs(targetSourceLocalY - currentSourceLocalY) > 0.5) {
        try {
          await this.sendCommand('move_node', {
            nodeId: sourceNodeId,
            x: sourceLocalX,
            y: targetSourceLocalY
          });
        } catch (error) {
          console.warn('⚠️ 移动来源节点失败:', error.message || error);
        }
      }
    }

    try {
      await this.sendCommand('flush_layout', {});
    } catch (error) {
      console.warn('⚠️ reflow flush 失败:', error.message || error);
    }
    await this.sleep(80);

    console.log('✅ 布局重排完成');
  }

  async discoverImageTargets(rootNodeId, expectedCount) {
    // 智能发现图片槽位，按优先级查找
    const candidates = [];
    const seen = new Set();

    // 优先查找命名槽位 imgSlot1-4
    const slotNames = ['imgSlot1', 'imgSlot2', 'imgSlot3', 'imgSlot4'];
    for (const name of slotNames) {
      if (candidates.length >= expectedCount) break;

      try {
        const slotId = await this.findChildByName(rootNodeId, name);
        if (slotId && !seen.has(slotId)) {
          const info = await this.sendCommand('get_node_info', { nodeId: slotId });
          if (info && info.visible !== false) {
            seen.add(slotId);
            candidates.push(slotId);
          }
        }
      } catch (error) {
        console.warn(`⚠️ 查找槽位 ${name} 失败:`, error.message);
      }
    }

    // 如果命名槽位不够，扫描 IMAGE_GRID 容器
    if (candidates.length < expectedCount) {
      try {
        const gridId = await this.findChildByName(rootNodeId, 'slot:IMAGE_GRID');
        if (gridId) {
          const gridInfo = await this.sendCommand('get_node_info', { nodeId: gridId });
          if (gridInfo && gridInfo.children) {
            // 遍历子节点查找可填充的框架
            const scanQueue = [...gridInfo.children];
            while (scanQueue.length && candidates.length < expectedCount) {
              const node = scanQueue.shift();
              if (!node || node.visible === false) continue;

              // 可填充类型：FRAME, RECTANGLE, VECTOR, ELLIPSE
              const isFillable = ['FRAME', 'RECTANGLE', 'VECTOR', 'ELLIPSE'].includes(node.type);
              const isNamedSlot = /^imgSlot\d+$/i.test(node.name || '');

              if ((isNamedSlot || (isFillable && node.type !== 'FRAME')) && !seen.has(node.id)) {
                seen.add(node.id);
                candidates.push(node.id);
              }

              // 继续搜索子节点
              if (node.children) {
                scanQueue.push(...node.children);
              }
            }
          }
        }
      } catch (error) {
        console.warn('⚠️ 扫描 IMAGE_GRID 失败:', error.message);
      }
    }

    console.log(`🔍 发现 ${candidates.length} 个图片槽位 (需要 ${expectedCount} 个)`);
    return candidates;
  }

  async fillShortCard(instanceId, item, lang) {
    const figures = item.figures || [];
    const hasTitle = figures.some(f => !!f.title);
    const firstTitle = hasTitle ? figures.find(f => !!f.title)?.title : '';

    const primaryFigure = figures.find((fig) => {
      const tokens = Array.isArray(fig?.credit_tokens) ? fig.credit_tokens.filter(Boolean) : [];
      const raw = fig?.credit ? String(fig.credit).trim() : '';
      return tokens.length > 0 || !!raw;
    }) || figures[0] || null;
    const formattedSourceText = this.formatSourceText(primaryFigure, lang);
    const hasSourceData = figures.some((fig) => {
      const tokens = Array.isArray(fig?.credit_tokens) ? fig.credit_tokens.filter(Boolean) : [];
      const raw = fig?.credit ? String(fig.credit).trim() : '';
      return tokens.length > 0 || !!raw;
    });
    const initialHasSource = hasSourceData || !!formattedSourceText;

    // 收集图片（只获取 asset_id）
    const imageAssetIds = figures
      .map(f => f.image?.asset_id)
      .filter(id => !!id);

    await this.applyVisibilityControl(instanceId, {
      hasTitle,
      hasSource: initialHasSource,
      imageCount: imageAssetIds.length
    });

    // 准备根节点 - 这会改变节点结构
    let rootId = instanceId;
    try {
      const result = await this.sendCommand('prepare_card_root', {
        nodeId: instanceId
      });
      const prep = parsePrepareCardRootResultUtil(result);
      if (prep && prep.rootId) {
        rootId = prep.rootId;
        console.log(`✅ 根节点准备完成: ${prep.rootId}`);
      }
    } catch (error) {
      console.warn('⚠️ prepare_card_root 失败，使用原始 ID');
    }

    const titleSlotId = await this.findChildByName(rootId, 'slot:TITLE');
    const decorationId = await this.findChildByName(rootId, '路径');
    const imageGridId = await this.findChildByName(rootId, 'slot:IMAGE_GRID');

    // 清理动态内容（保留品牌元素）
    try {
      await this.sendCommand('clear_card_content', {
        cardId: rootId,
        mode: 'safe',
        preserveNames: ['SignalPlus Logo', '背景', 'Logo', 'Background']
      });
      console.log('🧹 已清理卡片动态内容');
    } catch (error) {
      console.warn('⚠️ 清理内容失败:', error.message);
    }

    // 强制布局刷新，避免立即填图导致测量为 0
    try {
      await this.sendCommand('flush_layout', {});
    } catch {}
    await this.sleep(80);

    // 设置标题文本并自动调整高度
    let titleId = null;
    if (hasTitle) {
      try {
        titleId = await this.findChildByName(rootId, 'titleText');
        if (titleId) {
          await this.sendCommand('set_text_auto_resize', {
            nodeId: titleId,
            autoResize: 'HEIGHT'
          });
          await this.sendCommand('set_text_content', {
            nodeId: titleId,
            text: firstTitle
          });
          try {
            await this.sendCommand('flush_layout', {});
          } catch (error) {
            console.warn('⚠️ 标题 flush 失败:', error.message || error);
          }
          await this.sleep(80);
          console.log('📝 标题已设置并启用高度自适应');
        }
      } catch (error) {
        console.warn('⚠️ 设置标题失败:', error.message);
      }
    }

    // 填充图片
    await this.fillImages(rootId, imageAssetIds, lang);

    const sourceResult = await this.fillSource(rootId, formattedSourceText);

    await this.reflowShortCard(rootId, {
      titleSlotId,
      titleTextId: titleId,
      adornmentId: decorationId,
      imageGridId,
      sourceNodeId: sourceResult.nodeId,
      hasTitle,
      hasSource: sourceResult.hasSource
    });

    await this.applyVisibilityFallback(rootId, {
      hasTitle,
      hasSource: sourceResult.hasSource,
      imageCount: imageAssetIds.length
    });

    return rootId;
  }

  async fillImages(rootId, imageAssetIds, lang) {
    const contentPath = this.contentPaths[lang];

    // 使用智能发现查找图片槽位
    const candidates = await this.discoverImageTargets(rootId, imageAssetIds.length);
    const used = new Set();

    for (let i = 0; i < imageAssetIds.length; i++) {
      let placed = false;

      // 尝试每个候选槽位
      for (const slotId of candidates) {
        if (used.has(slotId)) continue;

        const assetId = imageAssetIds[i];
        const url = `${this.staticUrl}/${assetId}.png`;

        let success = false;
        let lastError = null;

        // 先尝试 URL 填充
        try {
          const res = await this.sendCommand('set_image_fill', {
            nodeId: slotId,
            imageUrl: url,
            scaleMode: 'FIT',
            opacity: 1
          });
          // 检查返回值确认成功
          success = !res || res.success !== false;
        } catch (error) {
          lastError = error;
        }

        // URL 失败则尝试 Base64
        if (!success) {
          try {
            const base64 = await this.imageToBase64(assetId, contentPath);
            if (base64) {
              await this.throttleBase64();
              const resFallback = await this.sendCommand('set_image_fill', {
                nodeId: slotId,
                imageBase64: base64,
                scaleMode: 'FIT',
                opacity: 1
              });
              success = !resFallback || resFallback.success !== false;
            } else {
              console.warn(`⚠️ Base64 降级不可用于槽位 ${slotId}`);
            }
          } catch (fallbackError) {
            lastError = fallbackError;
          }
        }

        if (!success) {
          const reason = lastError ? (lastError.message || lastError) : '未知原因';
          console.warn(`⚠️ 填充失败于 ${slotId}，尝试下一个槽位: ${reason}`);
          continue;
        }

        // 成功填充
        used.add(slotId);
        placed = true;
        console.log(`✅ 图片 ${i + 1} 已填充到槽位`);

        if (THROTTLE_MS > 0) {
          await this.sleep(THROTTLE_MS);
        }
        break;
      }

      if (!placed) {
        console.warn(`⚠️ 无可用槽位用于图片 #${i + 1}`);
      }
    }
  }

  async fillSource(rootId, sourceText) {
    const hasSource = !!sourceText;
    const sourceFrameId = await this.findChildByName(rootId, 'slot:SOURCE');
    let textNodeId = null;

    if (sourceFrameId) {
      const candidates = ['sourceText', 'slot:SOURCE', 'SOURCE', 'Source', '来源'];
      for (const name of candidates) {
        const candidateId = await this.findChildByName(sourceFrameId, name);
        if (candidateId) {
          const info = await this.sendCommand('get_node_info', { nodeId: candidateId });
          if (info?.type === 'TEXT') {
            textNodeId = candidateId;
            break;
          }
        }
      }

      if (!textNodeId) {
        try {
          const frameInfo = await this.sendCommand('get_node_info', { nodeId: sourceFrameId });
          const queue = (frameInfo?.children || []).slice();
          while (queue.length) {
            const node = queue.shift();
            if (!node) continue;
            if (node.type === 'TEXT') {
              textNodeId = node.id;
              break;
            }
            if (node.children) queue.push(...node.children);
          }
        } catch (error) {
          console.warn('⚠️ 解析 slot:SOURCE 子节点失败:', error.message || error);
        }
      }
    }

    if (!textNodeId) {
      textNodeId = await this.findSourceTextNodeId(rootId);
    }

    if (textNodeId) {
      try {
        await this.sendCommand('set_text_content', {
          nodeId: textNodeId,
          text: sourceText || ''
        });
      } catch (error) {
        console.warn('⚠️ 设置来源文本失败:', error.message || error);
      }

      try {
        await this.sendCommand('set_text_auto_resize', {
          nodeId: textNodeId,
          autoResize: 'HEIGHT'
        });
      } catch (error) {
        console.warn('⚠️ set_text_auto_resize(source) 失败:', error.message || error);
      }
    }

    if (sourceFrameId) {
      try {
        await this.sendCommand('set_layout_sizing', {
          nodeId: sourceFrameId,
          layoutSizingHorizontal: 'FILL',
          layoutSizingVertical: 'HUG'
        });
      } catch (error) {
        console.warn('⚠️ set_layout_sizing(slot:SOURCE) 失败:', error.message || error);
      }
    }

    try { await this.sendCommand('flush_layout', {}); } catch {}
    await this.sleep(80);

    return { hasSource, nodeId: textNodeId, frameId: sourceFrameId };
  }

  async findChildByName(parentId, name) {
    try {
      const nodeInfo = await this.sendCommand('get_node_info', { nodeId: parentId });

      const target = normalizeNameUtil(name);

      const shallow = findShallowByNameUtil(nodeInfo?.children, name);
      if (shallow && shallow.id) {
        return shallow.id;
      }

      // DFS 搜索
      const search = (node) => {
        if (normalizeNameUtil(node?.name) === target) return node.id;

        if (node.children) {
          for (const child of node.children) {
            const found = search(child);
            if (found) return found;
          }
        }
        return null;
      };

      return search(nodeInfo);
    } catch (error) {
      console.warn(`⚠️ 查找子节点 ${name} 失败:`, error.message);
      return null;
    }
  }

  formatSourceText(block, locale = 'en-US') {
    if (!block) return '';
    const tokens = Array.isArray(block.credit_tokens)
      ? block.credit_tokens.filter(Boolean).map((t) => String(t).trim())
      : [];
    const raw = block.credit ? String(block.credit).trim() : '';
    const joined = tokens.length ? tokens.join(', ') : raw;
    if (!joined) return '';
    return (`Source: ${joined}`).replace(/^(?:Source:\s*)+/i, 'Source: ');
  }

  async findSourceTextNodeId(rootId) {
    if (!rootId) return null;
    const frameId = await this.findChildByName(rootId, 'slot:SOURCE');
    const searchQueue = [];
    const candidates = ['sourceText', 'slot:SOURCE', 'SOURCE', 'Source', '来源'];

    if (frameId) {
      for (const name of candidates) {
        const nodeId = await this.findChildByName(frameId, name);
        if (nodeId) {
          const info = await this.sendCommand('get_node_info', { nodeId });
          if (info?.type === 'TEXT') return nodeId;
        }
      }
      try {
        const frameInfo = await this.sendCommand('get_node_info', { nodeId: frameId });
        if (frameInfo?.children) {
          searchQueue.push(...frameInfo.children);
        }
      } catch (error) {
        console.warn('⚠️ 获取 slot:SOURCE 信息失败:', error.message || error);
      }
    }

    if (!searchQueue.length) {
      try {
        const rootInfo = await this.sendCommand('get_node_info', { nodeId: rootId });
        if (rootInfo?.children) {
          searchQueue.push(...rootInfo.children);
        }
      } catch (error) {}
    }

    while (searchQueue.length) {
      const node = searchQueue.shift();
      if (!node) continue;
      if (node.type === 'TEXT') return node.id;
      if (node.children) {
        searchQueue.push(...node.children);
      }
    }

    return null;
  }

  async resizeShortRootToContent(posterId, bottomPadding = 150) {
    if (!posterId) return null;
    try {
      await this.sendCommand('flush_layout', {});
    } catch {}
    await this.sleep(120);

    let shortCardId = await this.findChildByName(posterId, 'shortCard');
    if (!shortCardId) {
      const posterInfo = await this.sendCommand('get_node_info', { nodeId: posterId });
      if (posterInfo && normalizeNameUtil(posterInfo.name) === normalizeNameUtil('shortCard')) {
        shortCardId = posterId;
      }
      if (!shortCardId) {
        const fallbacks = ['ContentAndPlate', 'ContentContainer', 'content_anchor', 'slot:CONTENT', 'slot:IMAGE_GRID'];
        for (const name of fallbacks) {
          shortCardId = await this.findChildByName(posterId, name);
          if (shortCardId) break;
        }
      }
    }

    const containerId = shortCardId || posterId;
    let result = null;
    try {
      result = await this.sendCommand('hug_frame_to_content', {
        posterId,
        containerId,
        padding: bottomPadding
      });
    } catch (error) {
      console.warn('⚠️ hug_frame_to_content 首次执行失败:', error.message || error);
    }

    try {
      await this.sendCommand('flush_layout', {});
    } catch {}
    await this.sleep(80);

    if (containerId && shortCardId) {
      try {
        const scInfo = await this.sendCommand('get_node_info', { nodeId: containerId });
        const posterInfo = await this.sendCommand('get_node_info', { nodeId: posterId });
        const posterHeight = posterInfo?.height ?? posterInfo?.absoluteBoundingBox?.height ?? 0;
        const posterTop = posterInfo?.absoluteRenderBounds?.y ?? posterInfo?.absoluteBoundingBox?.y ?? posterInfo?.absoluteTransform?.[1]?.[2] ?? 0;
        const scBottom = (() => {
          if (scInfo?.absoluteRenderBounds) return scInfo.absoluteRenderBounds.y + scInfo.absoluteRenderBounds.height;
          if (scInfo?.absoluteBoundingBox) return scInfo.absoluteBoundingBox.y + scInfo.absoluteBoundingBox.height;
          return posterTop + posterHeight;
        })();
        const expectedHeight = Math.max(0, scBottom - posterTop) + bottomPadding;
        if (posterHeight < expectedHeight - 2) {
          try {
            result = await this.sendCommand('hug_frame_to_content', {
              posterId,
              containerId,
              padding: bottomPadding
            });
            try { await this.sendCommand('flush_layout', {}); } catch {}
            await this.sleep(60);
          } catch (error) {
            console.warn('⚠️ hug_frame_to_content 二次执行失败:', error.message || error);
          }
        }
      } catch (error) {
        console.warn('⚠️ 校验 Hug 结果失败:', error.message || error);
      }
    }

    return result;
  }

  async imageToBase64(assetId, contentPath) {
    try {
      // 动态资产路径
      const assetDir = this.assetDir || 'assets/250915';  // 默认值作为后备
      const fullPath = path.resolve(path.dirname(contentPath), assetDir, `${assetId}.png`);

      const data = await fs.readFile(fullPath);
      const base64 = data.toString('base64');

      return `data:image/png;base64,${base64}`;
    } catch (error) {
      console.warn(`⚠️ 读取图片失败: ${error.message}`);
      return null;
    }
  }

  async throttleBase64() {
    const now = Date.now();
    const elapsed = now - this.lastBase64Time;

    if (elapsed < BASE64_THROTTLE_MS) {
      await this.sleep(BASE64_THROTTLE_MS - elapsed);
    }

    this.lastBase64Time = Date.now();
  }

  async exportCard(cardId, filename) {
    if (!this.enableAutoExport) {
      return null;
    }

    try {
      await fs.mkdir(this.outputDir, { recursive: true });

      const result = await this.sendCommand('export_frame', {
        nodeId: cardId,
        format: 'PNG',
        scale: 2
      });

      if (result && result.base64) {
        const base64Data = result.base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filepath = path.join(this.outputDir, filename);

        await fs.writeFile(filepath, buffer);
        console.log(`💾 已导出: ${filepath}`);
        return filepath;
      }
    } catch (error) {
      console.warn(`⚠️ 导出失败: ${error.message}`);
      return null;
    }
  }

  async processLanguageVersion(lang) {
    const content = this.contents[lang];
    if (!content || !content.items) {
      console.log(`⏭️ 跳过 ${lang} 版本（无内容）`);
      return;
    }

    console.log(`\n🌍 处理 ${lang} 版本: ${content.items.length} 条内容`);

    const component = await this.findShortCardComponent();
    const results = [];

    // 计算布局位置
    const spacing = 2000;  // 卡片间距
    let x = 0;
    let y = 0;

    for (let i = 0; i < content.items.length; i++) {
      const item = content.items[i];

      if (!item.figures || item.figures.length === 0) {
        continue;
      }

      console.log(`\n📝 [${lang}] 处理第 ${i + 1}/${content.items.length} 条`);

      try {
        const instanceId = await this.createShortCardInstance(component, x, y);
        const cardId = await this.fillShortCard(instanceId, item, lang);

        try { await this.sendCommand('flush_layout', {}); } catch {}
        await this.sleep(80);

        await this.resizeShortRootToContent(cardId, 150);

        const filename = `${lang}_card_${String(i + 1).padStart(3, '0')}.png`;
        const exportPath = await this.exportCard(cardId, filename);

        results.push({
          index: i,
          instanceId,
          cardId,
          exportPath
        });

        x += spacing;
        if ((i + 1) % 5 === 0) {
          x = 0;
          y += 3500;
        }

      } catch (error) {
        console.error(`❌ [${lang}] 第 ${i + 1} 条处理失败:`, error.message);
      }

      if (THROTTLE_MS > 0) {
        await this.sleep(THROTTLE_MS);
      }
    }

    console.log(`\n✅ [${lang}] 完成: 生成 ${results.length} 张配图`);
    return results;
  }

  async run() {
    try {
      console.log('🚀 Article Images Generator 启动');
      console.log(`📋 参数: channel=${this.channel}, template=${this.templateName}`);
      console.log(`📤 自动导出: ${this.enableAutoExport ? '启用' : '禁用'}`);

      // 加载内容
      await this.loadAllContents();

      // 启动服务
      await this.ensureStaticServer();
      await this.connectWS();  // join channel 已集成在此方法中

      // 处理各语言版本
      const allResults = {};

      for (const lang of ['zh', 'en', 'tc']) {
        if (this.contents[lang]) {
          allResults[lang] = await this.processLanguageVersion(lang);
        }
      }

      // 输出汇总
      console.log('\n' + '='.repeat(50));
      console.log('📊 生成汇总:');

      for (const [lang, results] of Object.entries(allResults)) {
        if (results) {
          console.log(`  ${lang}: ${results.length} 张配图`);
          if (this.enableAutoExport) {
            const exported = results.filter(r => r.exportPath).length;
            console.log(`    已导出: ${exported}/${results.length}`);
          }
        }
      }

      console.log('='.repeat(50));
      console.log('✨ 所有任务完成！');

    } catch (error) {
      console.error('❌ 运行失败:', error);
      process.exit(1);
    } finally {
      this.close();
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
    if (this.staticServer) {
      this.staticServer.close();
    }
  }

  sleep(ms) {
    return sleepUtil(ms);
  }
}

// 主程序入口
const runner = new ArticleImageRunner();

runner.run().catch(error => {
  console.error('❌ 程序异常:', error);
  process.exit(1);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n⏹️ 收到中断信号，正在关闭...');
  runner.close();
  process.exit(0);
});

export default ArticleImageRunner;
