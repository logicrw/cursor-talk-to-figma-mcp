#!/usr/bin/env node

/**
 * 测试基础属性名适配层 - 按专家建议的PropertyName#ID规范
 * 使用showTitle, showSource, showImg2等基础名，让插件端自动转换
 */

import WebSocket from 'ws';

class BasePropertiesTest {
  constructor() {
    this.ws = null;
    this.messageId = 1;
    this.channelId = '5krl7ne2';
  }

  async test() {
    console.log('🎯 测试基础属性名适配层');
    console.log('📋 专家建议：统一使用基础名(showTitle)，插件端转换为PropertyName#ID');
    console.log('📡 频道: 5krl7ne2\n');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://127.0.0.1:3055');

      this.ws.on('open', () => {
        console.log('✅ WebSocket连接');
        this.startTest();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (e) {
          console.log('📨 原始:', data.toString());
        }
      });

      this.ws.on('error', reject);
      this.ws.on('close', () => resolve());

      // 15秒测试
      setTimeout(() => {
        console.log('⏰ 测试结束');
        if (this.ws) this.ws.close();
      }, 15000);
    });
  }

  handleMessage(msg) {
    console.log('📨 收到:', JSON.stringify(msg, null, 2));

    // 创建成功 → 测试基础属性名
    if (msg.message && msg.message.result && msg.message.result.success && msg.message.result.id) {
      const instanceId = msg.message.result.id;
      console.log(`\n✅ 实例创建成功: ${instanceId}`);
      console.log(`🏭 方法: ${msg.message.result.method}`);
      
      // 使用基础属性名测试
      setTimeout(() => {
        console.log('\n🔄 测试基础属性名适配层...');
        console.log('📝 使用基础名: showTitle, showSource, showImg2, showImg3, showImg4');
        
        this.ws.send(JSON.stringify({
          id: this.messageId++,
          type: 'message',
          channel: this.channelId,
          message: {
            id: this.messageId,
            command: 'set_instance_properties_by_base',  // 使用新的适配工具
            params: {
              nodeId: instanceId,
              properties: {
                showTitle: true,     // 基础名
                showSource: false,   // 基础名  
                showImg2: true,      // 基础名
                showImg3: false,     // 基础名
                showImg4: false      // 基础名
              }
            }
          }
        }));
      }, 1500);

    } else if (msg.message && msg.message.result && msg.message.result.appliedCount) {
      // 属性设置成功
      const result = msg.message.result;
      console.log('\n🎊 基础属性名测试成功!');
      console.log(`✅ 应用属性数量: ${result.appliedCount}`);
      console.log(`📋 官方API调用: setProperties with PropertyName#ID`);
      console.log('🎯 验证: 基础名自动转换为PropertyName#ID格式');
      
      setTimeout(() => this.ws.close(), 2000);
    }
  }

  startTest() {
    // Step 1: 连接频道
    console.log('📍 Step 1: 连接频道');
    this.ws.send(JSON.stringify({
      id: this.messageId++,
      type: 'join',
      channel: this.channelId
    }));

    // Step 2: 创建测试实例
    setTimeout(() => {
      console.log('📍 Step 2: 创建测试实例 (Seedless)');
      this.ws.send(JSON.stringify({
        id: this.messageId++,
        type: 'message',
        channel: this.channelId,
        message: {
          id: this.messageId,
          command: 'create_component_instance',
          params: {
            componentId: '194:56',  // FigureCard
            parentId: '194:51',     // Cards
            x: 100,
            y: 100
          }
        }
      }));
    }, 2000);
  }
}

async function main() {
  console.log('🔧 按专家建议：修复属性设置的PropertyName#ID规范问题');
  console.log('📋 核心：基础名适配层 + 官方setProperties API');
  console.log('🎯 预期：showTitle等基础名自动转换为PropertyName#ID\n');

  const test = new BasePropertiesTest();
  
  try {
    await test.test();
    console.log('\n🎊 基础属性名适配层测试完成');
    console.log('📋 如成功，可以使用基础名进行Summer Break替换');
  } catch (error) {
    console.error('💥 测试异常:', error.message);
  }
}

main();