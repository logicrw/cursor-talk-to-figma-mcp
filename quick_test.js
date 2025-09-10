#!/usr/bin/env node
/**
 * 快速测试修复后的Seedless直造
 */
import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:3055');
let msgId = 1;

ws.on('open', async () => {
  console.log('🚀 开始 Seedless 直造测试...');
  
  // 1. 连接频道
  console.log('📡 连接频道 jbhiocqe...');
  ws.send(JSON.stringify({
    id: msgId++,
    command: 'join_channel',
    channel: 'jbhiocqe'
  }));
  
  // 2. 等待后测试直造（2秒后）
  setTimeout(() => {
    console.log('🏭 测试 Seedless 直造...');
    ws.send(JSON.stringify({
      id: msgId++,
      command: 'create_component_instance',
      componentId: '194:56',  // 只传componentId，不传componentKey
      parentId: '194:51',
      x: 50,
      y: 50
    }));
  }, 2000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log('📨 收到:', msg);
    
    // 如果创建成功，改名并测试属性
    if (msg.result && msg.result.success && msg.result.method) {
      console.log(`✅ 直造成功! 方法: ${msg.result.method}`);
      console.log(`🆔 实例ID: ${msg.result.id}`);
      
      // 重命名为识别符
      setTimeout(() => {
        console.log('📝 重命名实例...');
        ws.send(JSON.stringify({
          id: msgId++,
          command: 'set_text_content', 
          nodeId: msg.result.id,
          text: '00_tmp_seedless_test'
        }));
      }, 1000);
    }
    
  } catch (e) {
    console.log('📨 原始:', data.toString());
  }
});

ws.on('error', (err) => console.error('❌ 错误:', err.message));
ws.on('close', () => {
  console.log('🔌 连接关闭');
  process.exit(0);
});

console.log('⏳ 等待插件连接...');
console.log('请确保Figma插件正在运行并连接到 channel: jbhiocqe');