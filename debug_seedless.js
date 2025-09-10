#!/usr/bin/env node

/**
 * Debug版本的 Seedless 验证脚本
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import fs from 'fs/promises';
import { resolveContentPath, parseArgs } from './src/config-resolver.js';

async function debugContentPath() {
  console.log('🔍 调试内容路径解析...');
  
  // 模拟工作流自动化器中的逻辑
  const projectRoot = path.join(process.cwd(), 'src', '..');
  console.log('Project root:', projectRoot);
  
  const cliArgs = parseArgs();
  console.log('CLI args:', cliArgs);
  
  // 读取服务器配置
  const configPath = path.join(process.cwd(), 'config/server-config.json');
  console.log('Config path:', configPath);
  
  try {
    const serverConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    console.log('Server config loaded, current_content_file:', serverConfig.workflow.current_content_file);
    
    const result = resolveContentPath(projectRoot, {
      initParam: '250818_summer_break_content.json',
      cliArg: cliArgs.content,
      envVar: process.env.CONTENT_JSON_PATH,
      configDefault: serverConfig.workflow.current_content_file
    });
    
    console.log('resolveContentPath result:', result);
    
    if (result && result.contentPath) {
      console.log('✅ Content path resolved:', result.contentPath);
      
      // 测试读取文件
      try {
        const content = await fs.readFile(result.contentPath, 'utf8');
        const data = JSON.parse(content);
        console.log('✅ Content loaded, blocks count:', data.blocks?.length);
      } catch (error) {
        console.log('❌ Failed to read content file:', error.message);
      }
    } else {
      console.log('❌ Content path not resolved');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error(error.stack);
  }
}

debugContentPath();