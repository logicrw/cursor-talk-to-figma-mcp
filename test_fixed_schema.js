#!/usr/bin/env node

/**
 * 验证修复后的Schema - 简化版本
 * 重点测试：本地组件用componentId，不传空字符串
 */

import WebSocket from 'ws';

class SchemaFixTester {
  constructor() {
    this.ws = null;
    this.messageId = 1;
    this.responses = new Map();
  }

  async connect() {
    console.log('🔧 测试修复后的Schema处理...\n');
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://127.0.0.1:3055');
      
      this.ws.on('open', () => {
        console.log('✅ WebSocket连接成功');
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.id && this.responses.has(message.id)) {
            const { resolve } = this.responses.get(message.id);
            this.responses.delete(message.id);
            resolve(message);
          } else {
            console.log('📡 系统消息:', message.data || message);
          }
        } catch (e) {
          console.log('📨 原始消息:', data.toString());
        }
      });
      
      this.ws.on('error', reject);
    });
  }

  async sendCommand(command, params = {}) {
    const message = {
      id: this.messageId++,
      command,
      ...params
    };

    return new Promise((resolve, reject) => {
      this.responses.set(message.id, { resolve, reject });
      this.ws.send(JSON.stringify(message));
      
      setTimeout(() => {
        if (this.responses.has(message.id)) {
          this.responses.delete(message.id);
          reject(new Error(`${command} 超时`));
        }
      }, 10000);
    });
  }

  async testSchemaFix() {
    try {
      // 1. 连接频道
      console.log('📡 连接频道...');
      await this.sendCommand('join_channel', { channel: 'xa55y91p' });
      console.log('✅ 频道连接成功\n');

      // 2. 测试修复后的参数处理
      console.log('🧪 测试案例 1: 只传componentId (本地组件)');
      const result1 = await this.sendCommand('create_component_instance', {
        componentId: '194:56',  // 只传componentId，不传componentKey
        parentId: '194:51',
        x: 10,
        y: 10
      });
      
      console.log('📋 结果 1:', JSON.parse(result1.result || '{}'));
      
      // 3. 测试错误情况：两个都不传
      console.log('\n🧪 测试案例 2: 两个都不传 (应该返回错误)');
      const result2 = await this.sendCommand('create_component_instance', {
        x: 20,
        y: 20
      });
      
      console.log('📋 结果 2:', JSON.parse(result2.result || '{}'));
      
      // 4. 如果第一个成功了，清理
      const parsed1 = JSON.parse(result1.result || '{}');
      if (parsed1.success && parsed1.id) {
        console.log('\n🧹 清理测试实例...');
        const deleteResult = await this.sendCommand('delete_node', {
          nodeId: parsed1.id
        });
        console.log('✅ 清理完成');
      }

      console.log('\n' + '='.repeat(50));
      console.log('🎊 Schema修复验证完成!');
      console.log('='.repeat(50));
      console.log('✅ 核心修复:');
      console.log('  - 移除 .default("") - 不再传递空字符串');
      console.log('  - 手动参数验证 - 避免 -32602 错误');  
      console.log('  - 只传非空参数 - 避免插件端误判');
      console.log('✅ 期望结果:');
      console.log('  - 案例1: 成功创建 (method: direct-local)');
      console.log('  - 案例2: 明确错误信息');

    } catch (error) {
      console.error('❌ 测试失败:', error.message);
      console.log('\n🔧 故障排查:');
      console.log('1. 确认Figma插件正在运行');
      console.log('2. 确认MCP服务器已重新构建');
      console.log('3. 确认插件已重新加载');
    }
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  const tester = new SchemaFixTester();
  
  try {
    await tester.connect();
    await tester.testSchemaFix();
  } catch (error) {
    console.error('🚨 连接失败:', error.message);
  } finally {
    tester.close();
  }
}

console.log('🎯 专家建议验证：修复Schema参数漂移');
console.log('📋 核心问题：.default("") 导致空字符串误判');
console.log('🔧 修复方案：optional + 手动验证 + 只传非空参数\n');

main();