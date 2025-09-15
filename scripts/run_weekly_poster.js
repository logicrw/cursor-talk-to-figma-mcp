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
    this.base64Rate = 30; // per second
    this.base64Sent = [];
  }

  async loadConfig() {
    const cfgPath = path.join(process.cwd(), 'config/server-config.json');
    this.config = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    this.mapping = this.config.workflow.mapping;
    this.staticUrl = computeStaticServerUrl(this.config);
    this.base64Rate = Number(this.config.asset_transfer?.base64_rate_limit ?? 30);
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

  async locateAnchors() {
    const doc = await this.sendCommand('get_document_info', {});
    const wantedFrameName = this.mapping.anchors.frame;

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

    // Resolve container (deep, normalized)
    const frameInfo = await this.sendCommand('get_node_info', { nodeId: frame.id });
    let container = this.findShallowByName(frameInfo.children, this.mapping.anchors.container);
    if (!container) {
      container = await this.deepFindByName(frame.id, this.mapping.anchors.container);
    }
    if (!container) throw new Error(`Container not found: ${this.mapping.anchors.container}`);

    // Resolve cards stack
    const containerInfo = await this.sendCommand('get_node_info', { nodeId: container.id });
    let cards = this.findShallowByName(containerInfo.children, this.mapping.anchors.cards_stack);
    if (!cards) {
      cards = await this.deepFindByName(container.id, this.mapping.anchors.cards_stack);
    }
    if (!cards) throw new Error(`Cards stack not found: ${this.mapping.anchors.cards_stack}`);
    this.cardsContainerId = cards.id;
    console.log(`🔗 Resolved cards stack id by name: ${cards.id}`);

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

  async throttleBase64() {
    const now = Date.now();
    // remove >1s
    this.base64Sent = this.base64Sent.filter(t => now - t < 1000);
    if (this.base64Sent.length >= this.base64Rate) {
      const wait = 1000 - (now - this.base64Sent[0]);
      await this.sleep(Math.max(0, wait));
      this.base64Sent = this.base64Sent.filter(t => Date.now() - t < 1000);
    }
    this.base64Sent.push(Date.now());
  }

  // ---- Image target discovery helpers ----
  // Only shape types count as primary fill targets
  isFillType(type) {
    return ['RECTANGLE','VECTOR','ELLIPSE','POLYGON','STAR'].includes(type);
  }

  // Prefer shape nodes; if no shapes found, fallback to FRAME
  async resolveFillTargetPreferShape(nodeId) {
    try {
      const root = await this.sendCommand('get_node_info', { nodeId });
      if (!root) return null;
      // Pass 1: shapes
      const q1 = [root];
      while (q1.length) {
        const n = q1.shift();
        if (!n) continue;
        if (this.isFillType(n.type)) return n.id;
        if (n.children) q1.push(...n.children);
      }
      // Pass 2: frame fallback
      const q2 = [root];
      while (q2.length) {
        const n = q2.shift();
        if (!n) continue;
        if (n.type === 'FRAME') return n.id;
        if (n.children) q2.push(...n.children);
      }
    } catch {}
    return null;
  }

  async resolveFillTarget(nodeId) {
    try {
      const root = await this.sendCommand('get_node_info', { nodeId });
      if (this.isFillType(root?.type)) return root.id;
      const q = [root];
      while (q.length) {
        const n = q.shift();
        if (n?.children) q.push(...n.children);
        if (this.isFillType(n?.type)) return n.id;
      }
    } catch {}
    return null;
  }

  async discoverImageTargets(instanceId, images) {
    const slots = this.mapping.anchors?.slots || {};
    const slotNames = (slots.images || this.mapping.anchors.image_slots || []).slice();
    const candidates = [];
    const seen = new Set();

    // 1) explicit slot names
    for (const name of slotNames) {
      const id = await this.dfsFindChildIdByName(instanceId, name);
      const fillId = id ? await this.resolveFillTargetPreferShape(id) : null;
      if (fillId && !seen.has(fillId)) { seen.add(fillId); candidates.push(fillId); }
    }
    if (candidates.length >= images.length) return candidates;

    // 2) IMAGE_GRID fallback: scan visual order
    const gridName = slots.figure?.image_grid || 'slot:IMAGE_GRID';
    const gridId = await this.dfsFindChildIdByName(instanceId, gridName);
    if (gridId) {
      const root = await this.sendCommand('get_node_info', { nodeId: gridId });
      const q = [root];
      const shapeIds = [];
      const frameIds = [];
      while (q.length) {
        const n = q.shift();
        if (!n) continue;
        if (n.children) q.push(...n.children);
        if (n.id) {
          if (this.isFillType(n.type)) shapeIds.push(n.id);
          else if (n.type === 'FRAME') frameIds.push(n.id);
        }
      }
      let added = 0;
      for (const id of shapeIds) {
        if (!seen.has(id)) { seen.add(id); candidates.push(id); added++; }
      }
      if (candidates.length < images.length) {
        for (const id of frameIds) {
          if (!seen.has(id)) { seen.add(id); candidates.push(id); added++; }
          if (candidates.length >= images.length) break;
        }
      }
      console.log(`🔍 Fallback: scanned IMAGE_GRID -> shapes=${shapeIds.length} frames=${frameIds.length} added=${added}`);
    }
    return candidates;
  }

  async fillFigureCard(instanceId, group) {
    const slots = this.mapping.anchors?.slots || {};
    const figures = group.figures || [];
    const hasTitle = figures.some(f => !!f.title);
    const firstTitle = (figures.find(f => f.title)?.title) || '';
    // Aggregate credits across figures → unique tokens
    const sCfg = this.mapping.source || {};
    const prefix = sCfg.prefix ?? 'Source: ';
    const mode = sCfg.mode || 'inline'; // inline | label
    const splitRe = /[、，,;；／/|]+/;
    const stripPrefix = (t) => String(t||'').replace(/^(?:source|来源)\s*[:：]\s*/i, '').trim();
    const creditsTokens = [];
    const seen = new Set();
    for (const f of figures) {
      const raw = String(f?.credit || '');
      if (!raw) continue;
      for (const tok of raw.split(splitRe)) {
        const clean = stripPrefix(tok);
        const key = clean.toLowerCase();
        if (clean && !seen.has(key)) { seen.add(key); creditsTokens.push(clean); }
      }
    }
    const hasSource = creditsTokens.length > 0;
    const assetPath = this.mapping.images?.asset_path || 'image.asset_id';
    const images = figures.map(f => ({ asset_id: this.getByPath(f, assetPath) })).filter(x => !!x.asset_id);

    // title
    const titleName = slots.figure?.title_text || 'titleText';
    const titleId = await this.dfsFindChildIdByName(instanceId, titleName);
    if (titleId) await this.setText(titleId, firstTitle);
    // source (renderer-owned labeling)
    const sourceName = slots.figure?.source_text || 'sourceText';
    const sourceId = await this.dfsFindChildIdByName(instanceId, sourceName);
    if (sourceId) {
      let text = '';
      if (hasSource) {
        const inlineText = creditsTokens.join(', ');
        text = (mode === 'inline') ? (prefix + inlineText) : inlineText;
        // collapse duplicate prefixes
        text = text.replace(/^(?:Source:\s*)+/i, 'Source: ');
      }
      await this.sendCommand('set_text_content', { nodeId: sourceId, text });
      const resizeMode = this.mapping.source?.resizeMode || this.mapping.source?.auto_size || 'WIDTH_AND_HEIGHT';
      if (resizeMode === 'WIDTH_AND_HEIGHT') {
        await this.sendCommand('set_text_auto_resize', { nodeId: sourceId, autoResize: 'WIDTH_AND_HEIGHT' });
        // enforce Hug sizing for stable single-row behavior
        try {
          await this.sendCommand('set_layout_sizing', { nodeId: sourceId, layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG' });
          console.log('🧱 Source sizing: horizontal=HUG vertical=HUG');
        } catch {}
      } else if (resizeMode === 'HEIGHT') {
        await this.sendCommand('set_text_auto_resize', { nodeId: sourceId, autoResize: 'HEIGHT' });
        const containerName = slots.figure?.source || 'slot:SOURCE';
        const containerId = await this.dfsFindChildIdByName(instanceId, containerName);
        if (containerId) {
          const box = await this.sendCommand('get_node_info', { nodeId: containerId });
          const srcInfo = await this.sendCommand('get_node_info', { nodeId: sourceId });
          const w = box?.absoluteBoundingBox?.width;
          const h = srcInfo?.absoluteBoundingBox?.height;
          if (w && h) {
            await this.sendCommand('resize_node', { nodeId: sourceId, width: w, height: h });
            console.log(`📐 Source resized width=${w}`);
          }
        }
      }
      console.log(`📄 Source mode=${mode} text="${text}" credits=${JSON.stringify(creditsTokens)}`);
    }
    // visibility
    const props = {};
    const titleProp = this.mapping.title?.visible_prop || 'showTitle';
    const sourceProp = this.mapping.source?.visible_prop || 'showSource';
    props[titleProp] = !!hasTitle;
    props[sourceProp] = !!hasSource;
    // optional label visibility (best-effort)
    props['showSourceLabel'] = (mode === 'label');
    const imgSlots = (slots.images || this.mapping.anchors.image_slots || []);
    for (let i = 2; i <= Math.min(imgSlots.length, this.mapping.images?.max_images || imgSlots.length); i++) {
      const slotName = imgSlots[i-1];
      const visibilityProp = (this.mapping.images?.visibility_props || {})[slotName];
      if (visibilityProp) props[visibilityProp] = images.length >= i;
    }
    await this.sendCommand('set_instance_properties_by_base', { nodeId: instanceId, properties: props });

    // images (discover real fill targets; fallback to IMAGE_GRID; try-next on failure)
    const candidates = await this.discoverImageTargets(instanceId, images);
    const used = new Set();
    const scaleMode = (this.mapping.imageFill?.scaleMode || 'FILL');
    for (let i = 0; i < images.length; i++) {
      let placed = false;
      for (let j = 0; j < candidates.length; j++) {
        const imgNodeId = candidates[j];
        if (used.has(imgNodeId)) continue;
        const url = buildAssetUrl(this.staticUrl, this.content.assets || [], images[i].asset_id, this.contentPath);
        try {
          if (await this.httpHeadOk(url)) {
            try {
              await this.sendCommand('set_image_fill', { nodeId: imgNodeId, imageUrl: url, scaleMode: 'FIT', opacity: 1 });
            } catch (errUrl) {
              const ext = getAssetExtension(images[i].asset_id, this.content.assets || []);
              const localPath = path.join(
                process.cwd(), 'docx2json', 'assets', this.dataset,
                `${images[i].asset_id}.${ext || 'png'}`
              );
              const buf = await fs.readFile(localPath);
              const b64 = buf.toString('base64');
              await this.throttleBase64();
              await this.sendCommand('set_image_fill', { nodeId: imgNodeId, imageBase64: b64, scaleMode: 'FIT', opacity: 1 });
            }
          } else {
            const ext = getAssetExtension(images[i].asset_id, this.content.assets || []);
            const localPath = path.join(
              process.cwd(), 'docx2json', 'assets', this.dataset,
              `${images[i].asset_id}.${ext || 'png'}`
            );
            const buf = await fs.readFile(localPath);
            const b64 = buf.toString('base64');
            await this.throttleBase64();
            await this.sendCommand('set_image_fill', { nodeId: imgNodeId, imageBase64: b64, scaleMode: 'FIT', opacity: 1 });
          }
          used.add(imgNodeId);
          placed = true;
          break;
        } catch (e) {
          console.warn(`⚠️ Fill failed on ${imgNodeId}, trying next candidate: ${e.message}`);
          continue;
        }
      }
      if (!placed) console.warn(`⚠️ No available target for image #${i+1}`);
    }
  }

  async fillBodyCard(instanceId, item) {
    const slots = this.mapping.anchors?.slots || {};
    const bodySlot = slots.body?.body || 'slot:BODY';
    const bodyId = await this.dfsFindChildIdByName(instanceId, bodySlot);
    if (bodyId) await this.setText(bodyId, item.block?.text || '');
  }

  getByPath(obj, pathStr) {
    try { return (pathStr || '').split('.').reduce((o,k)=> (o && o[k] != null ? o[k] : undefined), obj); } catch { return undefined; }
  }

  async fillHeader() {
    try {
      const doc = await this.sendCommand('get_document_info', {});
      const frame = (doc.children || []).find((c) => c.name === this.mapping.anchors.frame);
      if (!frame) return;
      const frameInfo = await this.sendCommand('get_node_info', { nodeId: frame.id });
      const header = this.mapping.anchors.header || {};
      const meta = this.content.doc || {};
      const month = this.formatMonth(meta.date || '');
      const setByName = async (name, text) => {
        if (!name) return;
        const id = await this.dfsFindChildIdByName(frame.id, name);
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

  async run() {
    console.log('🚀 Weekly Poster Orchestration starting...');
    await this.loadConfig();
    await this.resolveContent();
    await this.ensureStaticServer();
    await this.connectWS();
    await this.locateAnchors();
    await this.fillHeader();

    const flow = this.createOrderedContentFlow();
    console.log(`📋 Content flow items: ${flow.length}`);

    for (let i = 0; i < flow.length; i++) {
      const item = flow[i];
      const kind = item.type === 'figure_group' ? 'figure' : 'body';
      try {
        const inst = await this.createCardInstance(kind);
        this.report.created.push({ index: i, id: inst.id, method: inst.method, kind });
        if (kind === 'figure') await this.fillFigureCard(inst.id, item);
        else await this.fillBodyCard(inst.id, item);
        console.log(`✅ Filled #${i+1} ${kind} card`);
      } catch (e) {
        console.error(`❌ Failed item #${i+1}:`, e.message);
        this.report.errors.push({ index: i, error: e.message });
      }
    }

    // Summary
    const summary = {
      dataset: this.dataset,
      staticServer: this.staticUrl,
      channel: this.channel,
      total: flow.length,
      created: this.report.created.length,
      errors: this.report.errors.length,
      createdDetails: this.report.created.slice(0,10)
    };
    console.log('\n📊 Run Summary:');
    console.log(JSON.stringify(summary, null, 2));
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
