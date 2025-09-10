#!/usr/bin/env node

/**
 * 基于搜索最佳实践的简化测试
 * 参考：mattdesl/figma-plugin-websockets 成功模式
 */

import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:3055');

ws.on('open', () => {
  console.log('🎯 基于GitHub最佳实践的简化测试');
  console.log('✅ WebSocket连接成功\n');
  
  // Step 1: 立即测试频道连接
  console.log('📍 测试频道连接...');
  ws.send(JSON.stringify({
    id: 1,
    type: 'join',
    channel: 'jbhiocqe'
  }));
  
  // Step 2: 等2秒后测试直造（给频道连接时间）
  setTimeout(() => {
    console.log('📍 测试Seedless直造（只传componentId）...');
    ws.send(JSON.stringify({
      id: 2,
      type: 'message',
      channel: 'jbhiocqe',
      message: {
        id: 2,
        command: 'create_component_instance',
        params: {
          componentId: '194:56',  // 只传这一个参数！
          parentId: '194:51',
          x: 0,
          y: 0
        }
      }
    }));
  }, 2000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log('📨 收到:', JSON.stringify(msg, null, 2));
    
    // 如果是创建成功的回应
    if (msg.message && msg.message.result && msg.message.result.success) {
      const result = msg.message.result;
      console.log('\n🎊 SUCCESS!');
      console.log(`✅ 实例创建成功: ${result.name} (${result.id})`);
      console.log(`🏭 方法: ${result.method}`);
      console.log('📋 Seedless直造工程验证通过！');
      
      // 关闭连接
      setTimeout(() => ws.close(), 1000);
    }
  } catch (e) {
    console.log('📨 原始:', data.toString());
  }
});

ws.on('error', (err) => {
  console.error('❌ 连接错误:', err.message);
});

ws.on('close', () => {
  console.log('🔌 连接关闭');
  process.exit(0);
});

console.log('⏳ 连接中...');
console.log('基于搜索的GitHub最佳实践模式');
console.log('预期：2秒内完成频道连接+Seedless直造验证\n');