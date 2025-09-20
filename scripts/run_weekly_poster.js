#!/usr/bin/env node

/**
 * Weekly Poster Orchestration (E2E hardened)
 * - Resolve latest content → Infer dataset → Ensure static server
 * - Validate template & properties → Create instances (direct→seed fallback)
 * - Fill header/cards → Report summary
 */

import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import http from 'http';
import { resolveContentPath, inferDataset, buildAssetUrl, computeStaticServerUrl, getAssetExtension } from '../src/config-resolver.js';

const THROTTLE_MS = 0;

function normalizeBase64(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const match = trimmed.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.*)$/);
  return match ? match[1] : trimmed;
}

class WeeklyPosterRunner {
  constructor() {
    this.ws = null;
    this.messageId = 1;
    this.pending = new Map();
    this.connected = false;
    this.channel = process.env.CHANNEL || '';
    this.config = null;
    this.mapping = null;
    this.staticUrl = 'http://localhost:3056/assets';
    this.staticServerProc = null;
    this.content = null;
    this.contentPath = null;
    this.dataset = null;
    this.cardsContainerId = null;
    this.seeds = { figure: null, body: null };
    this.report = { created: [], errors: [] };
    this.base64Rate = 30;
    this.base64Sent = [];
    this.fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
    this.posterFrameId = null;
    this.rootFrameId = null;
    const postersArg = this.getArg('--posters');
    const defaultPosters = 'Odaily特供海报,EXIO特供海报,干货铺特供海报';
    this.posterNames = (postersArg || defaultPosters).split(',').map((s) => s.trim()).filter(Boolean);
    this.exportDir = this.getArg('--exportDir') || 'out';
    const scaleArg = this.getArg('--exportScale');
    const parsedScale = scaleArg ? Number(scaleArg) : NaN;
    this.exportScale = Number.isFinite(parsedScale) && parsedScale > 0 ? parsedScale : 2;
    this.documentRootId = null;
    this.currentPosterName = null;
    const autoFlagIndex = process.argv.indexOf('--auto-export');
    this.enableAutoExport = process.env.AUTO_EXPORT === '1' || autoFlagIndex !== -1;
  }

  buildUploadUrl() {
    const base = String(this.staticUrl || '').trim();
    if (!base) return 'http://localhost:3056/upload';
    if (/\/upload\/?$/.test(base)) return base;
    if (/\/assets\/?$/.test(base)) return base.replace(/\/assets\/?$/, '/upload');
    return base.endsWith('/') ? base + 'upload' : base + '/upload';
  }

  async writeBase64Image(outPath, base64Raw) {
    const base64 = normalizeBase64(base64Raw);
    if (!base64) throw new Error('Missing base64 payload for export');
    const absoluteDir = path.resolve(path.dirname(outPath));
    await fs.mkdir(absoluteDir, { recursive: true });
    const buffer = Buffer.from(base64, 'base64');
    await fs.writeFile(outPath, buffer);
    const stats = await fs.stat(outPath);
    if (!stats || !stats.isFile() || !stats.size) {
      throw new Error(`File write verification failed for ${outPath}`);
    }
    console.log('✅ Wrote PNG:', outPath, 'size=', stats.size, 'bytes');
    return outPath;
  }

  async loadConfig() {
    const cfgPath = path.join(process.cwd(), 'config/server-config.json');
    this.config = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    this.mapping = this.config.workflow.mapping;
    this.staticUrl = computeStaticServerUrl(this.config);
    this.base64Rate = Number(this.config.asset_transfer?.base64_rate_limit ?? 30);
    this.base64Sent = [];
  }

  async resolveContent() {
    const { contentPath } = resolveContentPath(process.cwd(), {
      initParam: null,
      cliArg: this.getArg('--content'),
      envVar: process.env.CONTENT_JSON_PATH,
      configDefault: this.config.workflow.current_content_file
    });
    this.contentPath = contentPath;
    this.content = JSON.parse(await fs.readFile(contentPath, 'utf8'));
    this.dataset = inferDataset(this.content.assets || [], contentPath);
  }

  getArg(name) {
    const idx = process.argv.indexOf(name);
    if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1];
    return null;
  }

  async ensureStaticServer() {
    const asset = (this.content.assets || [])[0];
    if (!asset) return; // nothing to verify
    const testUrl = buildAssetUrl(this.staticUrl, this.content.assets || [], asset.asset_id, this.contentPath);
    const ok = await this.httpHeadOk(testUrl);
    if (ok) {
      console.log(`✅ Static server reachable: ${testUrl}`);
      return;
    }
    console.log('⚠️ Static server unreachable, starting local server...');
    this.staticServerProc = spawn(process.execPath, [path.join(process.cwd(), 'src/static-server.js')], {
      stdio: 'inherit'
    });
    // wait up to 3s
    for (let i = 0; i < 6; i++) {
      await this.sleep(500);
      if (await this.httpHeadOk(testUrl)) {
        console.log('✅ Static server started');
        return;
      }
    }
    console.log('⚠️ Static server still unreachable; will use Base64 fallback for images');
  }

  httpHeadOk(url) {
    return new Promise((resolve) => {
      try {
        const req = http.request(url, { method: 'HEAD', timeout: 1500 }, (res) => {
          resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 400);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { try { req.destroy(); } catch {} resolve(false); });
        req.end();
      } catch {
        resolve(false);
      }
    });
  }

  async throttleBase64() {
    if (!this.base64Rate || this.base64Rate <= 0) return;
    const now = Date.now();
    const windowMs = 1000;
    this.base64Sent = this.base64Sent.filter((t) => now - t < windowMs);
    if (this.base64Sent.length >= this.base64Rate) {
      const wait = windowMs - (now - this.base64Sent[0]);
      await this.sleep(Math.max(0, wait));
      const refreshed = Date.now();
      this.base64Sent = this.base64Sent.filter((t) => refreshed - t < windowMs);
    }
    this.base64Sent.push(Date.now());
  }

  async imageToBase64(image, url) {
    if (image && image.asset_id && this.dataset) {
      const ext = getAssetExtension(image.asset_id, this.content.assets || []);
      if (ext) {
        const localPath = path.join(
          process.cwd(),
          'docx2json',
          'assets',
          this.dataset,
          `${image.asset_id}.${ext}`
        );
        try {
          const buf = await fs.readFile(localPath);
          return buf.toString('base64');
        } catch (error) {
          // fall through to fetching via URL
        }
      }
    }
    if (!url) return null;
    try {
      const fetchFn = this.fetchImpl;
      if (!fetchFn) {
        console.warn('⚠️ Global fetch unavailable; skip non-local image fallback');
        return null;
      }
      const resp = await fetchFn(url);
      if (!resp.ok) return null;
      const arrayBuffer = await resp.arrayBuffer();
      return Buffer.from(arrayBuffer).toString('base64');
    } catch (error) {
      console.warn('⚠️ imageToBase64 fetch failed:', error.message || error);
      return null;
    }
  }

  async connectWS() {
    const host = this.config.websocket.host || 'localhost';
    const port = this.config.websocket.port || 3055;
    const url = `ws://${host}:${port}`;
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (e) => reject(e));
      this.ws.on('message', (data) => this.onMessage(data));
    });
    console.log(`✅ WebSocket connected: ${url}`);
    // Join channel
    const joinChan = (this.getArg('--channel') || this.channel || 'weekly-poster').trim();
    await this.wsSend({ type: 'join', channel: joinChan });
    this.channel = joinChan;
    console.log(`📡 Joined channel: ${this.channel}`);
  }

  onMessage(raw) {
    try {
      const msg = JSON.parse(raw.toString());
      console.log(`📨 Received message type: ${msg.type}${msg.message?.id ? ` (id: ${msg.message.id})` : ''}`);

      // Handle broadcast messages (responses from Figma)
      if (msg.type === 'broadcast' && msg.message) {
        const inner = msg.message;
        // Only process if this message has a result (skip command echo)
        if (inner.id && this.pending.has(inner.id) && inner.result !== undefined) {
          const { resolve } = this.pending.get(inner.id);
          this.pending.delete(inner.id);
          console.log(`✅ Got result for command id: ${inner.id}`);
          resolve(inner.result);
          return;
        }
      }
      // Handle system messages
      if (msg.type === 'system') {
        // Channel join confirmation
        if (msg.message && typeof msg.message === 'object' && msg.message.result) {
          console.log(`✅ Channel confirmed: ${msg.channel}`);
        }
      }
    } catch (e) {
      console.error('Message parse error:', e);
    }
  }

  wsSend(payload) {
    return new Promise((resolve, reject) => {
      try {
        this.ws.send(JSON.stringify(payload));
        resolve(true);
      } catch (e) {
        reject(e);
      }
    });
  }

  sendCommand(command, params = {}) {
    const id = String(this.messageId++);
    console.log(`📤 Sending command: ${command} (id: ${id})`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.wsSend({
        id,
        type: 'message',
        channel: this.channel,
        message: { id, command, params }
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          console.error(`❌ Timeout for command ${command} (id: ${id})`);
          reject(new Error(`Timeout for command ${command}`));
        }
      }, 30000);
    });
  }

  async ensureCommandReady(commandName, retries = 3, delayMs = 500, params = {}) {
    let attempt = 0;
    let lastError = null;
    while (attempt < retries) {
      try {
        return await this.sendCommand(commandName, params);
      } catch (error) {
        lastError = error;
        attempt += 1;
        const message = error && error.message ? error.message : String(error);
        console.warn(`[${commandName}] attempt ${attempt} failed: ${message}`);
        if (attempt < retries) {
          await this.sleep(Math.max(delayMs, 200));
        }
      }
    }
    const hint = `Failed to execute ${commandName} after ${retries} attempts. ` +
      `Ensure the Figma plugin is running and connected (open the plugin UI if needed).`;
    throw new Error(lastError ? `${lastError.message || lastError}. ${hint}` : hint);
  }

  async getDocumentInfoWithRetry(retries = 3, delayMs = 500) {
    return await this.ensureCommandReady('get_document_info', retries, delayMs, {});
  }

  parsePrepareCardRootResult(raw) {
    if (!raw) return null;
    let direct = raw;
    if (typeof raw === 'string') {
      try {
        direct = JSON.parse(raw);
      } catch (error) {
        console.warn('⚠️ prepare_card_root string payload parse failed:', error.message || error);
        return null;
      }
    }
    if (typeof direct === 'object') {
      if (direct && typeof direct.rootId === 'string') {
        return direct;
      }
      if (direct && Array.isArray(direct.content)) {
        for (let i = 0; i < direct.content.length; i++) {
          const entry = direct.content[i];
          if (entry && typeof entry.text === 'string') {
            try {
              const parsed = JSON.parse(entry.text);
              if (parsed && typeof parsed.rootId === 'string') {
                return parsed;
              }
            } catch (error) {
              console.warn('⚠️ prepare_card_root legacy text parse failed:', error.message || error);
            }
          }
        }
      }
    }
    return null;
  }

  // Robust name normalization: remove spaces/zero-width chars and normalize width
  normalizeName(s) {
    return String(s || '')
      .normalize('NFKC')
      .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  async deepFindByName(rootNodeId, targetName, types = ['FRAME','SECTION','GROUP','COMPONENT','INSTANCE']) {
    const T = this.normalizeName(targetName);
    try {
      const res = await this.sendCommand('scan_nodes_by_types', { nodeId: rootNodeId, types });
      const hit = (res.nodes || res.matchingNodes || []).find(n => this.normalizeName(n.name) === T);
      return hit || null;
    } catch {
      return null;
    }
  }

  findShallowByName(children, targetName) {
    const T = this.normalizeName(targetName);
    return (children || []).find(c => this.normalizeName(c.name) === T) || null;
  }

  async configurePosterFrame(frameId, posterName) {
    if (!frameId) throw new Error('Missing poster frame id');
    this.posterFrameId = frameId;
    this.rootFrameId = frameId;
    this.currentPosterName = posterName || null;

    const frameInfo = await this.sendCommand('get_node_info', { nodeId: frameId });
    let container = this.findShallowByName(frameInfo.children, this.mapping.anchors.container);
    if (!container) {
      container = await this.deepFindByName(frameId, this.mapping.anchors.container, ['FRAME', 'GROUP']);
    }
    if (!container) {
      throw new Error(`[${posterName}] container not found under poster scope: ${this.mapping.anchors.container}`);
    }

    const containerInfo = await this.sendCommand('get_node_info', { nodeId: container.id });
    let cards = this.findShallowByName(containerInfo.children, this.mapping.anchors.cards_stack);
    if (!cards) {
      cards = await this.deepFindByName(container.id, this.mapping.anchors.cards_stack, ['FRAME', 'GROUP']);
    }
    if (!cards) {
      throw new Error(`[${posterName}] cards stack not found under container scope: ${this.mapping.anchors.cards_stack}`);
    }

    this.cardsContainerId = cards.id;
    console.log(`🧭 Poster=${posterName || 'unknown'} frame=${frameId} container=${container.id} cards=${cards.id}`);
    return frameId;
  }

  async findPosterFrameIdByName(posterName) {
    if (!posterName) return null;
    const doc = await this.getDocumentInfoWithRetry();
    this.documentRootId = doc.id;
    const direct = this.findShallowByName(doc.children, posterName);
    if (direct) return direct.id;
    const deep = await this.deepFindByName(doc.id, posterName, ['FRAME']);
    return deep ? deep.id : null;
  }

  sanitizeFileName(name) {
    return String(name || '').replace(/[\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  }

  async exportPosterFrame(posterName, posterId) {
    const frameId = posterId || this.posterFrameId;
    if (!frameId) return null;
    if (!this.enableAutoExport) return null;
    try {
      try { await this.sendCommand('flush_layout', {}); } catch {}
      await this.sleep(160);

      const meta = this.content && this.content.doc;
      const dateStr = this.sanitizeFileName(meta && meta.date ? meta.date : 'unknown');
      const safeName = this.sanitizeFileName(posterName || this.currentPosterName || 'poster');
      const ext = (this.exportFormat && String(this.exportFormat).toUpperCase() === 'JPG') ? 'jpg' : 'png';
      const fileName = `${safeName}_${dateStr}.${ext}`;
      const uploadUrl = this.buildUploadUrl();

      const res = await this.sendCommand('export_frame', {
        nodeId: frameId,
        format: this.exportFormat || 'PNG',
        scale: this.exportScale,
        url: uploadUrl,
        file: fileName
      });

      const payload = res || {};
      const outDirAbs = path.resolve(this.exportDir || 'out');
      const absolutePath = path.join(outDirAbs, fileName);

      if (payload && payload.ok && (payload.path || payload.relativePath)) {
        const remotePath = payload.path || payload.relativePath;
        const resolved = path.isAbsolute(remotePath) ? remotePath : path.resolve(process.cwd(), remotePath);
        try {
          const stats = await fs.stat(resolved);
          if (stats && stats.isFile() && stats.size) {
            console.log(`📦 Exported poster: ${resolved}`);
            try { await this.sendCommand('flush_layout', {}); } catch {}
            await this.sleep(160);
            return resolved;
          }
          console.warn('⚠️ export_frame reported path but verification failed:', resolved);
        } catch (statError) {
          console.warn('⚠️ export_frame path stat failed, fallback to base64:', statError && statError.message ? statError.message : statError);
        }
      }

      let raw = payload && (payload.base64 || payload.data || payload.dataUrl);
      if (!raw && payload && payload.response) {
        raw = payload.response.base64 || payload.response.data || payload.response.dataUrl;
      }
      if (!raw && res && res.base64) raw = res.base64;
      if (!raw && res && res.content && Array.isArray(res.content) && res.content[0] && res.content[0].text) {
        raw = res.content[0].text;
      }

      if (!raw) {
        console.warn('⚠️ export_frame missing payload, export aborted:', payload);
        return null;
      }

      await this.writeBase64Image(absolutePath, raw);
      console.log(`📦 Exported poster (base64 fallback): ${absolutePath}`);
      try { await this.sendCommand('flush_layout', {}); } catch {}
      await this.sleep(160);
      return absolutePath;
    } catch (error) {
      console.warn('⚠️ export_frame failed:', error && error.message ? error.message : error);
      return null;
    }
  }

  async clearCardsContainer() {
    if (!this.cardsContainerId) return;
    try {
      const containerInfo = await this.sendCommand('get_node_info', { nodeId: this.cardsContainerId });
      const children = (containerInfo && containerInfo.children) ? containerInfo.children : [];
      const deletable = children.map((child) => child.id).filter(Boolean);
      if (deletable.length > 0) {
        await this.sendCommand('delete_multiple_nodes', { nodeIds: deletable });
        console.log(`🧹 Cleared ${deletable.length} card nodes from container ${this.cardsContainerId}`);
      }
    } catch (error) {
      console.warn('⚠️ clearCardsContainer failed:', error && error.message ? error.message : error);
    }
  }

  async populateCards(flow) {
    this.report = { created: [], errors: [] };
    for (let i = 0; i < flow.length; i++) {
      const item = flow[i];
      const kind = item.type === 'figure_group' ? 'figure' : 'body';
      try {
        const inst = await this.createCardInstance(kind);
        this.report.created.push({ index: i, id: inst.id, method: inst.method, kind });
        if (kind === 'figure') await this.fillFigureCard(inst.id, item);
        else await this.fillBodyCard(inst.id, item);
        console.log(`✅ Filled #${i + 1} ${kind} card`);
      } catch (e) {
        console.error(`❌ Failed item #${i + 1}:`, e.message);
        this.report.errors.push({ index: i, error: e.message });
      }
    }
  }

  async processPoster(posterName, flow) {
    console.log(`\n🎯 Processing poster: ${posterName}`);
    const posterId = await this.findPosterFrameIdByName(posterName);
    if (!posterId) {
      console.warn(`⚠️ Poster frame not found: ${posterName}`);
      return null;
    }

    try {
      await this.configurePosterFrame(posterId, posterName);
    } catch (error) {
      console.warn(`⚠️ configurePosterFrame failed for ${posterName}:`, error && error.message ? error.message : error);
      return null;
    }

    await this.clearCardsContainer();
    try { await this.sendCommand('flush_layout', {}); } catch {}
    await this.sleep(120);
    await this.fillHeader(posterId);
    await this.updatePosterMetaFromDoc(posterId);
    try { await this.sendCommand('flush_layout', {}); } catch {}
    await this.sleep(120);

    const createdBefore = Array.isArray(this.report?.created) ? this.report.created.length : 0;
    await this.populateCards(flow);
    const createdAfter = Array.isArray(this.report?.created) ? this.report.created.length : 0;
    const createdThisPoster = createdAfter - createdBefore;

    if (createdThisPoster <= 0) {
      console.warn(`⚠️ No cards created for poster ${posterName}; skipping resize and export`);
      return {
        name: posterName,
        created: createdThisPoster,
        errors: this.report.errors.length,
        exportPath: null
      };
    }

    await this.resizePosterHeightToContent(posterId);
    try { await this.sendCommand('flush_layout', {}); } catch {}
    await this.sleep(160);
    const exportPath = await this.exportPosterFrame(posterName, posterId);

    return {
      name: posterName,
      created: createdThisPoster,
      errors: this.report.errors.length,
      exportPath
    };
  }

  async locateAnchors(preferredFrameName) {
    const doc = await this.getDocumentInfoWithRetry();
    this.documentRootId = doc.id;
    const wantedFrameName = preferredFrameName || this.mapping.anchors.frame;

    // 1) Try shallow match on current page
    let frame = this.findShallowByName(doc.children, wantedFrameName);
    // 2) Deep search as fallback
    if (!frame) {
      frame = await this.deepFindByName(doc.id, wantedFrameName);
      if (frame) console.log(`🔎 Resolved frame by deep search: ${frame.name} (${frame.id})`);
    }
    // 3) Selection fallback
    if (!frame) {
      const sel = await this.sendCommand('get_selection', {});
      const first = (sel.selection || []).find(n => n.type === 'FRAME') || sel.selection?.[0];
      if (first) {
        console.warn(`⚠️ Anchor fallback: using selected node "${first.name}" (${first.id})`);
        frame = first;
      }
    }
    if (!frame) throw new Error(`Frame not found after fallback: ${wantedFrameName}`);
    await this.configurePosterFrame(frame.id, frame.name);
    console.log(`🔗 Resolved cards stack id by name: ${this.cardsContainerId}`);

    // Seeds (best-effort)
    const seedsFrame = this.findShallowByName(doc.children, this.mapping.anchors.seeds.frame) || await this.deepFindByName(doc.id, this.mapping.anchors.seeds.frame);
    if (seedsFrame) {
      const seedsInfo = await this.sendCommand('get_node_info', { nodeId: seedsFrame.id });
      const figSeed = this.findShallowByName(seedsInfo.children, this.mapping.anchors.seeds.figure_instance) || await this.deepFindByName(seedsFrame.id, this.mapping.anchors.seeds.figure_instance);
      const bodySeed = this.findShallowByName(seedsInfo.children, this.mapping.anchors.seeds.body_instance) || await this.deepFindByName(seedsFrame.id, this.mapping.anchors.seeds.body_instance);
      this.seeds.figure = figSeed?.id || null;
      this.seeds.body = bodySeed?.id || null;
    }
  }

  createOrderedContentFlow() {
    const blocks = this.content.blocks || [];
    const groups = {};
    const standalone = [];
    const order = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.group_id) {
        if (!groups[b.group_id]) { groups[b.group_id] = []; order.push({ type: 'group', group_id: b.group_id, original_index: i }); }
        groups[b.group_id].push(b);
      } else if (b.type === 'paragraph') {
        standalone.push({ type: 'standalone_paragraph', block: b, original_index: i });
        order.push({ type: 'standalone_paragraph', original_index: i });
      }
    }
    const flow = [];
    let si = 0;
    for (const item of order) {
      if (item.type === 'group') {
        const arr = groups[item.group_id] || [];
        arr.sort((a,b)=> (a.group_seq||0)-(b.group_seq||0));
        flow.push({ type: 'figure_group', group_id: item.group_id, blocks: arr, figures: arr.filter(x=>x.type==='figure'), paragraphs: arr.filter(x=>x.type==='paragraph') });
      } else {
        flow.push(standalone[si++]);
      }
    }
    return flow;
  }

  async createCardInstance(kind) {
    const cfg = this.mapping[kind] || {};
    // Try direct instance creation
    if (cfg.componentId || cfg.componentKey) {
      const direct = await this.sendCommand('create_component_instance', {
        parentId: this.cardsContainerId,
        componentId: cfg.componentId || undefined,
        componentKey: cfg.componentKey || undefined,
        x: 0, y: 0
      });
      if (direct?.success && direct.id) {
        return { id: direct.id, name: direct.name, method: direct.method || 'direct' };
      }
    }
    // Fallback to seed cloning
    const seedId = kind === 'figure' ? this.seeds.figure : this.seeds.body;
    if (!seedId) throw new Error(`No seed instance id for ${kind}`);
    const clone = await this.sendCommand('append_card_to_container', {
      containerId: this.cardsContainerId,
      templateId: seedId,
      insertIndex: -1
    });
    if (clone?.success && clone.newNodeId) return { id: clone.newNodeId, name: clone.newNodeName || 'Cloned Card', method: 'seed-clone' };
    // Some builds return text; attempt parse
    if (clone && clone.containerName && clone.newNodeId) return { id: clone.newNodeId, name: clone.newNodeName || 'Cloned Card', method: 'seed-clone' };
    throw new Error(`Failed to create card: ${JSON.stringify(clone)}`);
  }

  async dfsFindChildIdByName(nodeId, name) {
    const info = await this.sendCommand('get_node_info', { nodeId });
    const target = String(name || '').trim();
    const stack = [info];
    while (stack.length) {
      const n = stack.pop();
      if (n?.name === target) return n.id;
      if (n?.children) for (const ch of n.children) stack.push(ch);
    }
    return null;
  }

  async setText(nodeId, text) {
    await this.sendCommand('set_text_content', { nodeId, text: text || '' });
    // caller decides the auto-resize mode
  }

  // ---- Image target discovery helpers ----
  // Only shape types count as primary fill targets
  isFillType(type) {
    return ['RECTANGLE','VECTOR','ELLIPSE','POLYGON','STAR'].includes(type);
  }

  async discoverImageTargets(rootNodeId, images) {
    const slots = this.mapping.anchors?.slots || {};
    const slotNames = (slots.images || this.mapping.anchors.image_slots || []).slice();
    const candidates = [];
    const seen = new Set();

    const pushIfFrame = async (id, reason) => {
      if (!id || seen.has(id)) return;
      let info = null;
      try {
        info = await this.sendCommand('get_node_info', { nodeId: id });
      } catch (error) {
        console.warn(`⚠️ get_node_info failed for ${reason}:`, error.message || error);
        return;
      }
      if (!info) return;
      if (info.visible === false) return;
      const name = String(info.name || '');
      if (!/^(imgSlot\d+)$/i.test(name)) return;
      if (info.type !== 'FRAME' && info.type !== 'RECTANGLE') return;
      seen.add(id);
      candidates.push(id);
    };

    for (const name of slotNames) {
      const slotId = await this.dfsFindChildIdByName(rootNodeId, name);
      await pushIfFrame(slotId, `slot ${name}`);
      if (candidates.length >= images.length) return candidates;
    }

    const gridName = slots.figure?.image_grid || 'slot:IMAGE_GRID';
    const gridId = await this.dfsFindChildIdByName(rootNodeId, gridName);
    if (gridId) {
      const root = await this.sendCommand('get_node_info', { nodeId: gridId });
      const q = [root];
      const frameIds = [];
      const shapeIds = [];
      while (q.length) {
        const n = q.shift();
        if (!n) continue;
        if (n.visible === false) continue;
        if (n.children) q.push(...n.children);
        if (!n.id) continue;
        if (n.type === 'FRAME' || n.type === 'GROUP') {
          frameIds.push(n.id);
        } else if (this.isFillType(n.type)) {
          shapeIds.push(n.id);
        }
      }
      for (const id of frameIds) {
        await pushIfFrame(id, 'grid frame');
        if (candidates.length >= images.length) break;
      }
      if (candidates.length < images.length) {
        for (const id of shapeIds) {
          await pushIfFrame(id, 'grid shape');
          if (candidates.length >= images.length) break;
        }
      }
      console.log(`🔍 Fallback: scanned IMAGE_GRID -> frames=${frameIds.length} shapes=${shapeIds.length} selected=${candidates.length}`);
    }
    return candidates;
  }

  async fillFigureCard(instanceId, group) {
    const slots = this.mapping.anchors?.slots || {};
    const figures = group.figures || [];
    const hasTitle = figures.some(f => !!f.title);
    const firstWithTitle = figures.find(f => !!f.title);
    const firstTitle = firstWithTitle ? firstWithTitle.title : '';

    const sCfg = this.mapping.source || {};
    const prefix = typeof sCfg.prefix === 'string' ? sCfg.prefix : 'Source: ';
    const mode = sCfg.mode || 'inline';
    const splitRe = /[、，,;；／/|]+/;
    const stripPrefix = (t) => String(t || '').replace(/^(?:source|来源)\s*[:：]\s*/i, '').trim();
    const creditsTokens = [];
    const seen = new Set();
    for (let idx = 0; idx < figures.length; idx++) {
      const raw = String((figures[idx] && figures[idx].credit) || '');
      if (!raw) continue;
      const pieces = raw.split(splitRe);
      for (let j = 0; j < pieces.length; j++) {
        const clean = stripPrefix(pieces[j]);
        const key = clean.toLowerCase();
        if (clean && !seen.has(key)) {
          seen.add(key);
          creditsTokens.push(clean);
        }
      }
    }
    const hasSource = creditsTokens.length > 0;

    const assetPath = this.mapping.images?.asset_path || 'image.asset_id';
    const images = figures
      .map((f) => ({ asset_id: this.getByPath(f, assetPath) }))
      .filter((entry) => !!entry.asset_id);

    const props = {};
    const titleProp = this.mapping.title?.visible_prop || 'showTitle';
    const sourceProp = this.mapping.source?.visible_prop || 'showSource';
    props[titleProp] = !!hasTitle;
    props[sourceProp] = !!hasSource;
    props['showSourceLabel'] = mode === 'label';
    const imgSlots = (slots.images || this.mapping.anchors.image_slots || []);
    const maxImages = this.mapping.images?.max_images || imgSlots.length;
    for (let i = 2; i <= Math.min(imgSlots.length, maxImages); i++) {
      const slotName = imgSlots[i - 1];
      const visibilityProp = (this.mapping.images?.visibility_props || {})[slotName];
      if (visibilityProp) {
        props[visibilityProp] = images.length >= i;
      }
    }
    try {
      await this.sendCommand('set_instance_properties_by_base', { nodeId: instanceId, properties: props });
    } catch (error) {
      console.warn('⚠️ set_instance_properties_by_base failed:', error.message || error);
    }

    let rootId = instanceId;
    try {
      const raw = await this.sendCommand('prepare_card_root', { nodeId: instanceId });
      const prep = this.parsePrepareCardRootResult(raw);
      if (prep && prep.rootId) {
        rootId = prep.rootId;
        const times = typeof prep.detachedTimes === 'number' ? prep.detachedTimes : 'unknown';
        const deep = typeof prep.descendantDetaches === 'number' ? prep.descendantDetaches : 'unknown';
        console.log(`[prepare_card_root] figure root prepared rootId=${rootId} detachedTimes=${times} deep=${deep}`);
      } else {
        console.warn('⚠️ prepare_card_root returned unexpected payload, using instanceId');
      }
    } catch (error) {
      console.warn('⚠️ prepare_card_root failed, continuing without detach:', error.message || error);
    }

    try {
      await this.sendCommand('clear_card_content', {
        cardId: rootId,
        mode: 'safe',
        targetNames: ['ContentContainer', '正文容器', '图文容器'],
        removeNamePrefixes: ['Item', 'Bullet', 'Chip', 'Tag', 'Dyn', 'Tmp', '临时'],
        preserveNames: ['ContentAndPlate', 'Odaily固定板', 'EXIO固定板', '干货铺固定板', 'Logo', '水印', '背景', '光效']
      });
    } catch (error) {
      console.warn('⚠️ clear_card_content (figure) failed:', error && error.message ? error.message : error);
    }

    const titleName = slots.figure?.title_text || 'titleText';
    const titleId = await this.dfsFindChildIdByName(rootId, titleName);
    if (titleId) {
      await this.setText(titleId, firstTitle);
    }

    const sourceName = slots.figure?.source_text || 'sourceText';
    const sourceId = await this.dfsFindChildIdByName(rootId, sourceName);
    if (sourceId) {
      let text = '';
      if (hasSource) {
        const inlineText = creditsTokens.join(', ');
        text = mode === 'inline' ? (prefix + inlineText) : inlineText;
        text = text.replace(/^(?:Source:\s*)+/i, 'Source: ');
      }
      await this.sendCommand('set_text_content', { nodeId: sourceId, text });
      const resizeMode = this.mapping.source?.resizeMode || this.mapping.source?.auto_size || 'WIDTH_AND_HEIGHT';
      if (resizeMode === 'WIDTH_AND_HEIGHT') {
        await this.sendCommand('set_text_auto_resize', { nodeId: sourceId, autoResize: 'WIDTH_AND_HEIGHT' });
        try {
          await this.sendCommand('set_layout_sizing', { nodeId: sourceId, layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG' });
          console.log('🧱 Source sizing: horizontal=HUG vertical=HUG');
        } catch (error) {
          console.warn('⚠️ set_layout_sizing failed for source:', error.message || error);
        }
      } else if (resizeMode === 'HEIGHT') {
        await this.sendCommand('set_text_auto_resize', { nodeId: sourceId, autoResize: 'HEIGHT' });
        const containerName = slots.figure?.source || 'slot:SOURCE';
        const containerId = await this.dfsFindChildIdByName(rootId, containerName);
        if (containerId) {
          try {
            const box = await this.sendCommand('get_node_info', { nodeId: containerId });
            const srcInfo = await this.sendCommand('get_node_info', { nodeId: sourceId });
            const w = box && box.absoluteBoundingBox ? box.absoluteBoundingBox.width : null;
            const h = srcInfo && srcInfo.absoluteBoundingBox ? srcInfo.absoluteBoundingBox.height : null;
            if (w && h) {
              await this.sendCommand('resize_node', { nodeId: sourceId, width: w, height: h });
              console.log(`📐 Source resized width=${w}`);
            }
          } catch (error) {
            console.warn('⚠️ resize_node failed for source:', error.message || error);
          }
        }
      }
      console.log(`📄 Source mode=${mode} text="${text}" credits=${JSON.stringify(creditsTokens)}`);
    }

    const candidates = await this.discoverImageTargets(rootId, images);
    const used = new Set();
    for (let i = 0; i < images.length; i++) {
      let placed = false;
      for (let j = 0; j < candidates.length; j++) {
        const imgNodeId = candidates[j];
        if (used.has(imgNodeId)) continue;
        const url = buildAssetUrl(this.staticUrl, this.content.assets || [], images[i].asset_id, this.contentPath);
        let success = false;
        let lastError = null;
        try {
          const res = await this.sendCommand('set_image_fill', { nodeId: imgNodeId, imageUrl: url, scaleMode: 'FIT', opacity: 1 });
          success = !res || res.success !== false;
        } catch (error) {
          lastError = error;
        }

        if (!success) {
          try {
            const b64 = await this.imageToBase64(images[i], url);
            if (b64) {
              await this.throttleBase64();
              const resFallback = await this.sendCommand('set_image_fill', { nodeId: imgNodeId, imageBase64: b64, scaleMode: 'FIT', opacity: 1 });
              success = !resFallback || resFallback.success !== false;
            } else {
              console.warn(`⚠️ Base64 fallback unavailable for ${imgNodeId}`);
            }
          } catch (fallbackError) {
            lastError = fallbackError;
          }
        }

        if (!success) {
          const reason = lastError ? (lastError.message || lastError) : 'unknown reason';
          console.warn(`⚠️ Fill failed on ${imgNodeId}, trying next candidate: ${reason}`);
          continue;
        }

        used.add(imgNodeId);
        placed = true;
        if (THROTTLE_MS > 0) {
          await this.sleep(THROTTLE_MS);
        }
        break;
      }
      if (!placed) {
        console.warn(`⚠️ No available target for image #${i + 1}`);
      }
    }
  }

  async fillBodyCard(instanceId, item) {
    // Detach card root for body card as well
    let rootId = instanceId;
    try {
      const raw = await this.sendCommand('prepare_card_root', { nodeId: instanceId });
      const prep = this.parsePrepareCardRootResult(raw);
      if (prep && prep.rootId) {
        rootId = prep.rootId;
        const times = typeof prep.detachedTimes === 'number' ? prep.detachedTimes : 'unknown';
        const deep = typeof prep.descendantDetaches === 'number' ? prep.descendantDetaches : 'unknown';
        console.log(`[prepare_card_root] body root prepared rootId=${rootId} detachedTimes=${times} deep=${deep}`);
      } else {
        console.warn('⚠️ prepare_card_root returned unexpected payload for body, using instanceId');
      }
    } catch (error) {
      console.warn('⚠️ prepare_card_root failed for body, continuing:', error.message || error);
    }
    try {
      await this.sendCommand('clear_card_content', {
        cardId: rootId,
        mode: 'safe',
        targetNames: ['ContentContainer', '正文容器', '图文容器'],
        removeNamePrefixes: ['Item', 'Bullet', 'Chip', 'Tag', 'Dyn', 'Tmp', '临时'],
        preserveNames: ['ContentAndPlate', 'Odaily固定板', 'EXIO固定板', '干货铺固定板', 'Logo', '水印', '背景', '光效']
      });
    } catch (error) {
      console.warn('⚠️ clear_card_content (body) failed:', error && error.message ? error.message : error);
    }
    const slots = this.mapping.anchors?.slots || {};
    const bodySlot = slots.body?.body || 'slot:BODY';
    const bodyId = await this.dfsFindChildIdByName(rootId, bodySlot);
    if (bodyId) await this.setText(bodyId, item.block?.text || '');
  }

  getByPath(obj, pathStr) {
    try { return (pathStr || '').split('.').reduce((o,k)=> (o && o[k] != null ? o[k] : undefined), obj); } catch { return undefined; }
  }

  async fillHeader(frameId) {
    try {
      const targetFrameId = frameId;
      if (!targetFrameId) return;
      const frameInfo = await this.sendCommand('get_node_info', { nodeId: targetFrameId });
      const header = this.mapping.anchors.header || {};
      const meta = this.content.doc || {};
      const month = this.formatMonth(meta.date || '');
      const setByName = async (name, text) => {
        if (!name) return;
        const id = await this.dfsFindChildIdByName(targetFrameId, name);
        if (id) await this.setText(id, text);
      };
      await setByName(header.title, meta.title || '');
      await setByName(header.date, meta.date || '');
      await setByName(header.month, month || '');
    } catch (e) {
      console.warn('⚠️ fillHeader skipped:', e.message);
    }
  }

  formatMonth(dateStr) {
    const m = String(dateStr||'').match(/\d{4}-(\d{2})-\d{2}/); if (m) return m[1];
    const m2 = String(dateStr||'').match(/\d{4}(\d{2})\d{2}/); if (m2) return m2[1];
    return '';
  }

  async resizePosterHeightToContent(posterId) {
    if (!posterId) return;

    const anchorsCfg = this.mapping.anchors || {};
    const candidateNames = [];
    if (typeof anchorsCfg.poster_content_anchor === 'string') candidateNames.push(anchorsCfg.poster_content_anchor);
    if (typeof anchorsCfg.content_anchor === 'string') candidateNames.push(anchorsCfg.content_anchor);
    candidateNames.push('ContentAndPlate', 'ContentContainer', 'Odaily固定板');

    let anchorId = null;
    for (let i = 0; i < candidateNames.length; i++) {
      const name = String(candidateNames[i] || '').trim();
      if (!name) continue;
      try {
        anchorId = await this.dfsFindChildIdByName(posterId, name);
      } catch (error) {
        console.warn('⚠️ Anchor search failed:', error.message || error);
        anchorId = null;
      }
      if (anchorId) break;
    }

    const toFinite = (value, fallback) => {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const payload = {
      posterId,
      bottomPadding: toFinite(anchorsCfg.poster_bottom_padding, 200),
    };
    if (this.cardsContainerId) payload.containerId = this.cardsContainerId;
    const minHeightVal = toFinite(anchorsCfg.poster_min_height, null);
    const maxHeightVal = toFinite(anchorsCfg.poster_max_height, null);
    if (anchorId) payload.anchorId = anchorId;
    if (minHeightVal !== null) payload.minHeight = minHeightVal;
    if (maxHeightVal !== null) payload.maxHeight = maxHeightVal;

    try {
      const res = await this.sendCommand('resize_poster_to_fit', payload);
      if (res && res.success) {
        console.log(`✅ Poster resized: height=${res.height}`);
      } else {
        console.warn('⚠️ Poster resize returned:', res);
      }
    } catch (error) {
      console.warn('⚠️ Poster resize failed:', error.message || error);
    }
  }

  async updatePosterMetaFromDoc(targetPosterId) {
    const posterId = targetPosterId || this.posterFrameId;
    const meta = this.content && this.content.doc;
    if (!posterId || !meta) return;

    const titleText = meta.title || "";
    const dateISO = meta.date || "";

    if (!titleText && !dateISO) return;

    await this.fillHeader(posterId);
    try {
      const result = await this.sendCommand('set_poster_title_and_date', {
        posterId,
        titleText,
        dateISO,
        locale: 'en-US'
      });
      if (!(result && result.success)) {
        console.warn('⚠️ set_poster_title_and_date returned:', result);
      }
    } catch (error) {
      console.warn('⚠️ set_poster_title_and_date failed:', error && error.message ? error.message : error);
    }
  }

  async run() {
    console.log('🚀 Weekly Poster Orchestration starting...');
    await this.loadConfig();
    await this.resolveContent();
    await this.ensureStaticServer();
    await this.connectWS();
    try {
      await this.locateAnchors(this.posterNames[0]);
    } catch (error) {
      console.warn('⚠️ locateAnchors with poster override failed, retrying with mapping frame:', error && error.message ? error.message : error);
      await this.locateAnchors();
    }

    const flow = this.createOrderedContentFlow();
    console.log(`📋 Content flow items per poster: ${flow.length}`);

    const posterSummaries = [];
    for (const posterName of this.posterNames) {
      const summary = await this.processPoster(posterName, flow);
      if (summary) posterSummaries.push(summary);
      try { await this.sendCommand('flush_layout', {}); } catch (error) {
        console.warn('⚠️ flush_layout between posters failed:', error && error.message ? error.message : error);
      }
      await this.sleep(500);
    }

    const overall = {
      dataset: this.dataset,
      staticServer: this.staticUrl,
      channel: this.channel,
      postersProcessed: posterSummaries.length,
      posters: posterSummaries
    };
    console.log('\n📊 Run Summary:');
    console.log(JSON.stringify(overall, null, 2));
  }

  async close() {
    try { if (this.ws) this.ws.close(); } catch {}
    if (this.staticServerProc) {
      try { this.staticServerProc.kill(); } catch {}
    }
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

async function main() {
  const runner = new WeeklyPosterRunner();
  try {
    await runner.run();
  } catch (e) {
    console.error('💥 Orchestration failed:', e.message);
  } finally {
    await runner.close();
  }
}

main();
