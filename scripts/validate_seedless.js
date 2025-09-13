#!/usr/bin/env node
/**
 * Minimal MCP JSON-RPC client for "talk-to-figma" tools.
 * - Connects to ws://HOST:PORT (defaults 127.0.0.1:3055)
 * - Joins CHANNEL_ID (CLI --channel or env CHANNEL_ID)
 * - Provides call(method, params) helper
 *
 * Usage of all scripts:
 *   node <script> --channel <id> [--content <file.json>] [--dry-run]
 *
 * Assumptions:
 * - Server exposes methods like:
 *   mcp__talk-to-figma__join_channel
 *   mcp__talk-to-figma__get_document_info
 *   mcp__talk-to-figma__get_node_info
 *   mcp__talk-to-figma__get_local_components
 *   mcp__talk-to-figma__create_component_instance
 *   mcp__talk-to-figma__clone_node
 *   mcp__talk-to-figma__append_card_to_container
 *   mcp__talk-to-figma__set_text_content
 *   mcp__talk-to-figma__set_image_fill
 *   mcp__talk-to-figma__set_instance_overrides   // if available
 *   mcp__talk-to-figma__set_node_visible         // optional fallback
 *   mcp__talk-to-figma__delete_node              // optional cleanup
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import url from "url";
import WebSocket from "ws";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.replace(/^--/, "");
      const v = (i+1 < args.length && !args[i+1].startsWith("--")) ? args[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

function envOr(obj, key, fallback) {
  return process.env[key] ?? obj[key] ?? fallback;
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function getContentPath(projectRoot, options={}) {
  // priority: CLI --content > ENV CONTENT_JSON_PATH > server-config.workflow.current_content_file > autodiscover (latest *.json in docx2json)
  const cli = options.cliContent;
  if (cli) {
    const p = path.isAbsolute(cli) ? cli : path.join(projectRoot, "docx2json", cli);
    if (fs.existsSync(p)) return p;
  }
  const envP = process.env.CONTENT_JSON_PATH;
  if (envP) {
    const p = path.isAbsolute(envP) ? envP : path.join(projectRoot, "docx2json", envP);
    if (fs.existsSync(p)) return p;
  }
  // server-config.json
  try {
    const cfg = readJSON(path.join(projectRoot, "config", "server-config.json"));
    const dir = cfg?.workflow?.content_directory ? path.resolve(projectRoot, cfg.workflow.content_directory) : path.join(projectRoot, "docx2json");
    let base = cfg?.workflow?.current_content_file || null;
    if (base) {
      const p = path.isAbsolute(base) ? base : path.join(dir, base);
      if (fs.existsSync(p)) return p;
    }
    // autodiscover latest
    const files = fs.readdirSync(dir).filter(x => x.endsWith(".json"));
    if (files.length) {
      files.sort((a,b)=>fs.statSync(path.join(dir,b)).mtimeMs - fs.statSync(path.join(dir,a)).mtimeMs);
      return path.join(dir, files[0]);
    }
  } catch {}
  throw new Error("Cannot resolve content JSON path");
}

class MCPClient {
  constructor({host="127.0.0.1", port=3055, channel}) {
    this.url = `ws://${host}:${port}`;
    this.channel = channel;
    this.id = 0;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej)=>{
      this.ws.on("open", res);
      this.ws.on("error", rej);
    });
    this.ws.on("message", (data)=>{
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pending.has(msg.id)) {
          const {resolve, reject} = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || String(msg.error)));
          else resolve(msg.result);
        }
      } catch {}
    });
    if (this.channel) {
      await this.call("mcp__talk-to-figma__join_channel", { channel: this.channel });
    }
  }
  async call(method, params={}) {
    const id = ++this.id;
    const payload = { jsonrpc: "2.0", id, method, params };
    const p = new Promise((resolve, reject)=>{
      this.pending.set(id, {resolve, reject});
      setTimeout(()=>{
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout waiting for ${method}`));
        }
      }, 30000);
    });
    this.ws.send(JSON.stringify(payload));
    return p;
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function getWorkflowMapping(projectRoot) {
  const cfg = readJSON(path.join(projectRoot, "config", "server-config.json"));
  if (!cfg?.workflow?.mapping) throw new Error("workflow.mapping not found in server-config.json");
  return { cfg, mapping: cfg.workflow.mapping };
}

async function resolveAnchors(mcp, mapping) {
  // Find frame -> container -> cards stack
  const doc = await mcp.call("mcp__talk-to-figma__get_document_info", {});
  const frame = (doc.children || []).find(n => n.name === mapping.anchors.frame);
  if (!frame) throw new Error(`Frame "${mapping.anchors.frame}" not found`);
  const frameInfo = await mcp.call("mcp__talk-to-figma__get_node_info", { nodeId: frame.id });
  const container = (frameInfo.children || []).find(n => n.name === mapping.anchors.container);
  if (!container) throw new Error(`Container "${mapping.anchors.container}" not found`);
  const contInfo = await mcp.call("mcp__talk-to-figma__get_node_info", { nodeId: container.id });
  const cards = (contInfo.children || []).find(n => n.name === mapping.anchors.cards_stack);
  if (!cards) throw new Error(`Cards stack "${mapping.anchors.cards_stack}" not found`);
  return { frameId: frame.id, containerId: container.id, cardsId: cards.id };
}

async function resolveSeeds(mcp, mapping, frameId) {
  const out = { figureSeedId: null, bodySeedId: null };
  const seedsCfg = mapping.anchors?.seeds;
  if (!seedsCfg) return out;
  const frameInfo = await mcp.call("mcp__talk-to-figma__get_node_info", { nodeId: frameId });
  const seedsFrame = (frameInfo.children || []).find(n => n.name === seedsCfg.frame);
  if (!seedsFrame) return out;
  const seedsInfo = await mcp.call("mcp__talk-to-figma__get_node_info", { nodeId: seedsFrame.id });
  const fig = (seedsInfo.children || []).find(n => n.name === seedsCfg.figure);
  const body= (seedsInfo.children || []).find(n => n.name === seedsCfg.body);
  out.figureSeedId = fig?.id || null;
  out.bodySeedId   = body?.id || null;
  return out;
}

async function findChildByName(mcp, nodeId, name, maxDepth=3) {
  // BFS limited depth
  let frontier = [{id: nodeId, depth: 0}];
  while (frontier.length) {
    const {id, depth} = frontier.shift();
    if (depth>maxDepth) continue;
    const info = await mcp.call("mcp__talk-to-figma__get_node_info", { nodeId: id });
    const children = info.children || [];
    for (const c of children) {
      if (c.name === name) return c.id;
      frontier.push({id: c.id, depth: depth+1});
    }
  }
  return null;
}

function groupOrderedContent(content) {
  const blocks = content.blocks || [];
  const groupsMap = new Map();  // group_id -> arr
  const order = [];              // sequence of items: {type:"group", id} | {type:"paragraph", idx}
  blocks.forEach((b, i) => {
    if (b.group_id) {
      if (!groupsMap.has(b.group_id)) {
        groupsMap.set(b.group_id, []);
        order.push({ type: "group", group_id: b.group_id });
      }
      groupsMap.get(b.group_id).push(b);
    } else if (b.type === "paragraph") {
      order.push({ type: "paragraph", idx: i });
    }
  });
  // sort inside group by group_seq
  const sequence = [];
  order.forEach(item => {
    if (item.type === "group") {
      const arr = groupsMap.get(item.group_id) || [];
      arr.sort((a,b)=> (a.group_seq||0)-(b.group_seq||0));
      sequence.push({ type:"figure_group",
                      group_id: item.group_id,
                      blocks: arr,
                      figures: arr.filter(x=>x.type==="figure"),
                      paragraphs: arr.filter(x=>x.type==="paragraph") });
    } else {
      sequence.push({ type:"standalone_paragraph", blockIndex: item.idx });
    }
  });
  return sequence;
}

function byPath(obj, dotted) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

(async () => {
  const args = parseArgs();
  const host = envOr(args, "host", "127.0.0.1");
  const port = Number(envOr(args, "port", 3055));
  const channel = envOr(args, "channel", process.env.CHANNEL_ID || null);
  const projectRoot = path.resolve(__dirname, "..");
  const mcp = new MCPClient({host, port, channel});
  try {
    await mcp.connect();
    const { mapping } = await getWorkflowMapping(projectRoot);
    const { frameId, containerId, cardsId } = await resolveAnchors(mcp, mapping);

    // try local components by name
    const comps = await mcp.call("mcp__talk-to-figma__get_local_components", {});
    const fig = (comps.components||[]).find(c=>c.name===mapping.anchors.figure_component);
    const body= (comps.components||[]).find(c=>c.name===mapping.anchors.body_component);
    if (!fig || !body) throw new Error("Local components not found");

    // create 1 figure instance
    const res = await mcp.call("mcp__talk-to-figma__create_component_instance", {
      componentId: fig.id, parentId: cardsId, x: 0, y: 0
    });
    const instanceId = res.id || res.nodeId;
    if (!instanceId) throw new Error("Empty instance id from create_component_instance");

    // set overrides
    const overrides = {};
    if (mapping.title?.visible_prop) overrides[mapping.title.visible_prop] = true;
    if (mapping.source?.visible_prop) overrides[mapping.source.visible_prop] = false;
    if (mapping.images?.visibility_props?.imgSlot2) overrides[mapping.images.visibility_props.imgSlot2] = false;
    try {
      await mcp.call("mcp__talk-to-figma__set_instance_overrides", { nodeId: instanceId, overrides });
      console.log("✅ set_instance_overrides OK");
    } catch (e) {
      console.warn("⚠️ set_instance_overrides not available:", e.message);
    }

    // text
    const titleId = await findChildByName(mcp, instanceId, mapping.title?.text_prop || "titleText");
    if (titleId) await mcp.call("mcp__talk-to-figma__set_text_content", { nodeId: titleId, text: "[Validation] Title" });

    console.log("✅ Seedless validation passed");
    mcp.close();
  } catch (e) {
    console.error("💥 Validation failed:", e.stack || e.message);
    process.exitCode = 1;
  }
})();
