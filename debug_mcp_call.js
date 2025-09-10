#!/usr/bin/env node

/**
 * 调试MCP客户端调用
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function debugMcpCall() {
  console.log('🚀 调试 MCP 客户端调用...');
  
  try {
    // Initialize MCP client
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', 'dist/server.js']
    });
    
    const client = new Client({
      name: 'debug-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await client.connect(transport);
    console.log('✅ MCP 客户端连接成功');

    // Test join_channel call
    console.log('\n📡 测试连接 Figma 频道 xa55y91p...');
    const joinResult = await client.request({
      method: 'tools/call',
      params: { 
        name: 'join_channel',
        arguments: { channel: 'xa55y91p' }
      }
    }, null);
    
    console.log('Join result:', JSON.stringify(joinResult, null, 2));
    
    // Test get_document_info call
    console.log('\n📋 测试获取文档信息...');
    const docResult = await client.request({
      method: 'tools/call',
      params: { 
        name: 'get_document_info',
        arguments: {}
      }
    }, null);
    
    console.log('Document info result:', JSON.stringify(docResult, null, 2));
    
    await client.close();
    console.log('✅ 调试完成');
    
  } catch (error) {
    console.error('❌ 调试失败:', error.message);
    console.error(error.stack);
  }
}

debugMcpCall();