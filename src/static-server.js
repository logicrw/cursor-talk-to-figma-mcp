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

const ASSETS_PATH = path.join(__dirname, config.static_server.assets_path);
const PORT = process.env.STATIC_PORT || config.static_server.port;
const HOST = process.env.STATIC_HOST || config.static_server.host;

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL path
  const urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;
  
  if (urlPath.startsWith('/assets/')) {
    const filename = path.basename(urlPath);
    const filepath = path.join(ASSETS_PATH, filename);
    
    // Security check - ensure file is within assets directory
    if (!filepath.startsWith(ASSETS_PATH)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    
    // Check if file exists
    if (!fs.existsSync(filepath)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    
    // Serve the file
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 
                       ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                       'application/octet-stream';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour cache
    
    const stream = fs.createReadStream(filepath);
    stream.pipe(res);
    
    console.log(`Served: ${filename} (${contentType})`);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Static file server running on http://${HOST}:${PORT}`);
  console.log(`Serving files from: ${ASSETS_PATH}`);
  console.log(`Config loaded from: ${CONFIG_PATH}`);
});