#!/usr/bin/env node

import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
const CONFIG_PATH = path.join(__dirname, '../config/server-config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Backward-compatible configuration resolution
const staticCfg = config.static_server || {};
const PORT = process.env.STATIC_PORT || staticCfg.port;
const HOST = process.env.STATIC_HOST || staticCfg.host;
const PUBLIC_ROUTE = staticCfg.publicRoute || '/assets';

// Determine base directory:
// 1) Prefer explicit baseDir (e.g., ../docx2json/assets)
// 2) Fallback to parent of legacy assets_path (which may include dataset subdir)
// 3) Final fallback to ../docx2json/assets
const legacyAssetsPath = staticCfg.assets_path
  ? path.resolve(__dirname, staticCfg.assets_path)
  : null;
const BASE_DIR = path.resolve(
  __dirname,
  staticCfg.baseDir || (legacyAssetsPath ? path.join(legacyAssetsPath, '..') : '../docx2json/assets')
);

function sanitizeFileName(name) {
  return String(name || '').replace(/[\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
}

async function handleUpload(req, res, urlObj) {
  try {
    const fileParam = urlObj.searchParams.get('file') || 'poster.png';
    const safeName = sanitizeFileName(fileParam);
    const outDir = path.join(process.cwd(), 'out');
    await fs.promises.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, safeName);
    const writeStream = fs.createWriteStream(outPath);
    let total = 0;
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        total += chunk.length;
        if (!writeStream.write(chunk)) {
          req.pause();
          writeStream.once('drain', () => req.resume());
        }
      });
      req.on('end', () => {
        writeStream.end();
        resolve();
      });
      req.on('error', reject);
      writeStream.on('error', reject);
    });
    const relPath = path.join('out', safeName);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ ok: true, path: relPath, size: total }));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const baseUrl = `http://localhost:${PORT}`;
    const urlObj = new URL(req.url, baseUrl);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/upload') {
      await handleUpload(req, res, urlObj);
      return;
    }

    const urlPath = urlObj.pathname;

  if (urlPath.startsWith(PUBLIC_ROUTE + '/')) {
    // Strip public route prefix and decode
    const relUrlPath = decodeURIComponent(urlPath.slice(PUBLIC_ROUTE.length + 1));

    // Normalize and resolve to prevent path traversal
    const normalizedRel = path.normalize(relUrlPath);
    const absolutePath = path.resolve(BASE_DIR, normalizedRel);
    const relToBase = path.relative(BASE_DIR, absolutePath);

    // Security: ensure the final path stays within BASE_DIR
    if (relToBase.startsWith('..') || path.isAbsolute(relToBase)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Check file existence
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // Content-Type resolution
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' :
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
      ext === '.gif' ? 'image/gif' :
      ext === '.webp' ? 'image/webp' :
      'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour cache

    const stream = fs.createReadStream(absolutePath);
    stream.pipe(res);

      console.log(`Served: ${path.relative(BASE_DIR, absolutePath)} (${contentType})`);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Static file server running on http://${HOST}:${PORT}`);
  console.log(`Public route: ${PUBLIC_ROUTE}`);
  console.log(`Serving base dir: ${BASE_DIR}`);
  console.log(`Config loaded from: ${CONFIG_PATH}`);
});
