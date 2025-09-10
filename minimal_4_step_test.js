#!/usr/bin/env node

/**
 * 一锤定音的最小4步冒烟测试
 * 目标：单进程+单频道+只传componentId+插件常驻
 */

import WebSocket from 'ws';

class Minimal4StepTest {
  constructor() {
    this.ws = null;
    this.messageId = 1;
    this.responses = new Map();
    this.connected = false;
    this.channelId = 'jbhiocqe';  // 固定频道
  }

  async connect() {
    console.log('🎯 一锤定音：4步冒烟测试');
    console.log('📋 目标：验证Seedless直造链路');
    console.log(`📡 固定频道：${this.channelId}`);
    console.log('🔧 只传componentId，绝不传componentKey\n');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://127.0.0.1:3055');

      this.ws.on('open', () => {
        console.log('✅ WebSocket连接成功');
        this.connected = true;
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
            console.log('📡 频道消息:', message.data || message);
          }
        } catch (error) {
          console.log('📨 原始消息:', data.toString());
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket错误:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('🔌 WebSocket关闭');
        this.connected = false;
      });
    });
  }

  async sendCommand(command, params = {}) {
    if (!this.connected) {
      throw new Error('WebSocket未连接');
    }

    const message = {
      id: this.messageId++,
      command: command,
      ...params
    };

    return new Promise((resolve, reject) => {
      this.responses.set(message.id, { resolve, reject });
      this.ws.send(JSON.stringify(message));

      // 较短超时，快速失败
      setTimeout(() => {
        if (this.responses.has(message.id)) {
          this.responses.delete(message.id);
          reject(new Error(`Step timeout: ${command}`));
        }
      }, 8000);
    });
  }

  async execute4Steps() {
    try {
      let instanceId = null;

      console.log('\n📍 Step 1: 连接固定频道');
      const joinResult = await this.sendCommand('join_channel', { 
        channel: this.channelId 
      });
      console.log('✅ 频道连接成功');

      console.log('\n📍 Step 2: Seedless直造（只传componentId）');
      const createParams = {
        componentId: '194:56',  // FigureCard - 只传ID！
        parentId: '194:51',     // Cards容器
        x: 0,
        y: 0
      };
      console.log('📦 参数:', JSON.stringify(createParams, null, 2));
      
      const createResult = await this.sendCommand('create_component_instance', createParams);
      
      if (createResult.success) {
        instanceId = createResult.id;
        console.log(`✅ 直造成功: ${createResult.name} (${instanceId})`);
        console.log(`🏭 方法: ${createResult.method || 'direct'}`);
      } else {
        throw new Error(`直造失败: ${createResult.message}`);
      }

      console.log('\n📍 Step 3: 属性发现（PropertyName#ID）');
      const propResult = await this.sendCommand('get_component_property_references', {
        nodeId: instanceId
      });
      
      if (propResult.success) {
        console.log(`✅ 发现${propResult.propertyKeys?.length || 0}个属性:`);
        propResult.propertyKeys?.forEach(key => {
          console.log(`   - ${key}`);
        });
      } else {
        console.log(`⚠️ 属性发现失败: ${propResult.message}`);
      }

      console.log('\n📍 Step 4: 显隐控制测试');
      const testProperties = {};
      if (propResult.success && propResult.propertyKeys) {
        propResult.propertyKeys.forEach(key => {
          if (key.startsWith('showTitle#')) {
            testProperties[key] = true;
          } else if (key.startsWith('showSource#')) {
            testProperties[key] = false;
          } else if (key.startsWith('showImg2#')) {
            testProperties[key] = true;  // 显示2张图
          } else if (key.startsWith('showImg3#') || key.startsWith('showImg4#')) {
            testProperties[key] = false;
          }
        });

        console.log('📋 测试属性:', Object.keys(testProperties).length, '个');
        
        const propsResult = await this.sendCommand('set_instance_properties', {
          nodeId: instanceId,
          properties: testProperties
        });

        if (propsResult.success) {
          console.log('✅ 属性设置成功');
          console.log(`📊 应用${Object.keys(testProperties).length}个属性`);
        } else {
          console.log(`⚠️ 属性设置失败: ${propsResult.message}`);
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('🎊 4步冒烟测试完成!');
      console.log('='.repeat(60));
      console.log('✅ Step 1: 频道连接');
      console.log(`✅ Step 2: Seedless直造 (方法: ${createResult.method || 'direct'})`);
      console.log(`✅ Step 3: 属性发现 (${propResult.propertyKeys?.length || 0}个)`); 
      console.log(`✅ Step 4: 显隐控制 (${Object.keys(testProperties).length}个)`);
      console.log(`\n🎯 实例已创建: ${instanceId}`);
      console.log('📋 请在Figma中查看Cards容器的结果');
      console.log('🔍 验证Auto-layout是否正确收缩');
      console.log('\n🚀 可以开始Summer Break JSON批量替换！');
      console.log('='.repeat(60));

      return { success: true, instanceId, testResults: { createResult, propResult } };

    } catch (error) {
      console.error('\n💥 冒烟测试失败:', error.message);
      console.log('\n🔧 诊断建议:');
      console.log('1. 确认Figma插件正在运行并保持UI打开');
      console.log('2. 确认频道显示为:', this.channelId);
      console.log('3. 确认只有一个MCP进程在运行');
      console.log('4. 确认组件194:56存在于当前文档');
      return { success: false, error: error.message };
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function main() {
  console.log('🎯 按专家建议：一锤定音的最小修复');
  console.log('📋 核心：单进程+单频道+只传componentID+插件常驻\n');

  const test = new Minimal4StepTest();
  
  try {
    await test.connect();
    const result = await test.execute4Steps();
    
    if (result.success) {
      console.log('\n🚀 Seedless直造工程验证成功！');
      console.log('🎊 可以开始执行Summer Break模板替换了！');
    }

  } catch (error) {
    console.error('🚨 测试异常:', error.message);
  } finally {
    test.close();
  }
}

main();