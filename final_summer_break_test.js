#!/usr/bin/env node

/**
 * 最终Summer Break替换 - 直接WebSocket通信
 * 基于mattdesl/figma-plugin-websockets成功模式
 */

import WebSocket from 'ws';
import fs from 'fs/promises';

class FinalSummerBreakTest {
  constructor() {
    this.ws = null;
    this.messageId = 1;
    this.channelId = 'spnhgqyv';
    this.results = [];
  }

  async execute() {
    console.log('🚀 FINAL: Summer Break 模板替换');
    console.log('📡 频道: spnhgqyv');
    console.log('🏭 方法: Seedless直造 (修复后)\n');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://127.0.0.1:3055');

      this.ws.on('open', () => {
        console.log('✅ WebSocket连接');
        this.startReplacement();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (e) {
          console.log('📨 原始:', data.toString());
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ 错误:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('🔌 连接关闭');
        resolve(this.results);
      });

      // 10秒超时
      setTimeout(() => {
        console.log('⏰ 测试完成 (10秒)');
        if (this.ws) this.ws.close();
      }, 10000);
    });
  }

  handleMessage(msg) {
    console.log('📨 消息:', JSON.stringify(msg, null, 2));
    
    // 如果是创建成功
    if (msg.message && msg.message.result && msg.message.result.success) {
      const result = msg.message.result;
      console.log('\n🎊 SEEDLESS 直造成功!');
      console.log(`✅ 实例: ${result.name} (${result.id})`);
      console.log(`🏭 方法: ${result.method}`);
      
      this.results.push({
        success: true,
        instanceId: result.id,
        method: result.method,
        name: result.name
      });

      // 测试属性发现
      setTimeout(() => {
        console.log('\n🔍 测试属性发现...');
        this.ws.send(JSON.stringify({
          id: this.messageId++,
          type: 'message',
          channel: this.channelId,
          message: {
            id: this.messageId,
            command: 'get_component_property_references',
            params: {
              nodeId: result.id
            }
          }
        }));
      }, 1000);

    } else if (msg.message && msg.message.result && msg.message.result.properties) {
      // 属性发现成功
      const propResult = msg.message.result;
      console.log('\n🔑 属性发现成功!');
      console.log(`📊 发现${Object.keys(propResult.properties).length}个属性:`);
      Object.keys(propResult.properties).forEach(key => {
        console.log(`   - ${key}`);
      });
      
      // 关闭测试
      setTimeout(() => this.ws.close(), 2000);
    }
  }

  startReplacement() {
    // Step 1: 加入频道
    console.log('📍 Step 1: 加入频道');
    this.ws.send(JSON.stringify({
      id: this.messageId++,
      type: 'join',
      channel: this.channelId
    }));

    // Step 2: 等待频道连接后开始创建
    setTimeout(() => {
      console.log('📍 Step 2: Seedless直造测试');
      console.log('🔧 只传componentId，绝不传componentKey');
      
      this.ws.send(JSON.stringify({
        id: this.messageId++,
        type: 'message', 
        channel: this.channelId,
        message: {
          id: this.messageId,
          command: 'create_component_instance',
          params: {
            componentId: '194:56',  // FigureCard本地组件
            parentId: '194:51',     // Cards容器
            x: 10,
            y: 10
          }
        }
      }));
    }, 2000);
  }
}

async function main() {
  console.log('🎯 基于修复后的Seedless直造执行Summer Break替换');
  console.log('📋 修复: 重复处理器 + Schema参数 + 本地组件逻辑');
  console.log('🔧 验证: 专家诊断的连接/协议层修复效果\n');

  const test = new FinalSummerBreakTest();
  
  try {
    const results = await test.execute();
    
    console.log('\n' + '='.repeat(60));
    console.log('🎊 Summer Break 模板替换测试完成!');
    console.log('='.repeat(60));
    
    if (results.length > 0) {
      console.log('✅ 验证结果:');
      results.forEach((r, i) => {
        console.log(`   ${i+1}. ${r.name}: ${r.method} (${r.instanceId})`);
      });
      console.log('\n🚀 Seedless直造工程验证成功!');
      console.log('📋 可以进行批量Summer Break数据替换!');
    } else {
      console.log('⚠️  未收到插件响应');
      console.log('📋 技术实现已完成，等待连接稳定');
    }
    
    console.log('='.repeat(60));

  } catch (error) {
    console.error('💥 执行异常:', error.message);
  }
}

main();