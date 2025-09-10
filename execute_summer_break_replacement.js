#!/usr/bin/env node

/**
 * Summer Break 海报模板替换 - 生产执行脚本
 * 使用 Seedless 直造工程执行 250818_summer_break_content.json 替换
 */

import WebSocket from 'ws';
import fs from 'fs/promises';

class SummerBreakReplacer {
  constructor() {
    this.ws = null;
    this.messageId = 1;
    this.pendingMessages = new Map();
    this.connected = false;
  }

  async initialize() {
    console.log('🚀 Summer Break 海报模板替换启动...');
    console.log('📋 目标: 250818_summer_break_content.json (22 blocks)');
    console.log('🏭 方法: Seedless 直造 (componentId)');
    console.log('📡 频道: spnhgqyv\n');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://127.0.0.1:3055');

      this.ws.on('open', () => {
        console.log('✅ WebSocket 连接成功');
        this.connected = true;
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.log('📨 Raw message:', data.toString());
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket 错误:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('🔌 WebSocket 连接关闭');
        this.connected = false;
      });
    });
  }

  handleMessage(message) {
    if (message.id && this.pendingMessages.has(message.id)) {
      const { resolve } = this.pendingMessages.get(message.id);
      this.pendingMessages.delete(message.id);
      resolve(message);
    } else {
      console.log('📡 频道消息:', message.data || message);
    }
  }

  async sendCommand(command, params = {}) {
    if (!this.connected) {
      throw new Error('WebSocket 未连接');
    }

    const message = {
      id: this.messageId++,
      command: command,
      ...params
    };

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(message.id, { resolve, reject });
      this.ws.send(JSON.stringify(message));

      // 30秒超时
      setTimeout(() => {
        if (this.pendingMessages.has(message.id)) {
          this.pendingMessages.delete(message.id);
          reject(new Error(`命令超时: ${command}`));
        }
      }, 30000);
    });
  }

  async executeReplacement() {
    try {
      console.log('📡 连接频道 spnhgqyv...');
      const joinResult = await this.sendCommand('join_channel', { 
        channel: 'spnhgqyv' 
      });
      console.log('✅ 频道连接成功');

      console.log('\n🔍 验证文档结构...');
      const docInfo = await this.sendCommand('get_document_info');
      console.log('✅ 文档信息获取成功');

      // 验证组件存在
      const components = await this.sendCommand('get_local_components');
      console.log('✅ 找到组件:', components.components?.map(c => c.name).join(', '));

      // 加载 Summer Break 数据
      console.log('\n📄 加载 Summer Break 数据...');
      const content = JSON.parse(
        await fs.readFile('./docx2json/250818_summer_break_content.json', 'utf-8')
      );
      console.log(`✅ 加载成功: ${content.blocks?.length || 0} 个数据块`);

      const figureBlocks = content.blocks?.filter(b => b.type === 'figure') || [];
      console.log(`🖼️  图片块数量: ${figureBlocks.length}`);

      console.log('\n🏗️ 开始批量创建 FigureCard 实例...');
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < Math.min(figureBlocks.length, 5); i++) {
        const block = figureBlocks[i];
        console.log(`\n📦 创建第 ${i + 1} 张卡片...`);
        
        try {
          // 使用 Seedless 直造
          const createResult = await this.sendCommand('create_component_instance', {
            componentId: '194:56',  // FigureCard
            parentId: '194:51',     // Cards 容器
            x: 0,
            y: i * 400  // 垂直排列
          });

          if (createResult.success) {
            console.log(`✅ 直造成功: ${createResult.name} (${createResult.id})`);
            console.log(`   方法: ${createResult.method || 'direct-local'}`);
            
            // 设置属性（显隐控制）
            const hasTitle = block.title && block.title.trim() !== '';
            const hasSource = block.credit && block.credit.trim() !== '';
            const imageCount = 1; // 基础一张图

            const properties = {
              'showTitle#I194:57:showTitle': hasTitle,
              'showSource#I194:64:showSource': hasSource,
              'showImg2#I194:61:showImg2': imageCount >= 2,
              'showImg3#I194:62:showImg3': imageCount >= 3,
              'showImg4#I194:63:showImg4': imageCount >= 4
            };

            const propResult = await this.sendCommand('set_instance_properties', {
              nodeId: createResult.id,
              properties: properties
            });

            if (propResult.success) {
              console.log(`   属性设置: ✅ ${Object.keys(properties).length} 个属性`);
              successCount++;
            } else {
              console.log(`   属性设置: ❌ ${propResult.message}`);
            }

          } else {
            console.log(`❌ 创建失败: ${createResult.message}`);
            failCount++;
          }

        } catch (error) {
          console.log(`❌ 操作异常: ${error.message}`);
          failCount++;
        }

        // 避免过快操作
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log('\n' + '='.repeat(60));
      console.log('🎊 Summer Break 模板替换完成!');
      console.log('='.repeat(60));
      console.log(`✅ 成功: ${successCount} 张卡片`);
      console.log(`❌ 失败: ${failCount} 张卡片`);
      console.log(`🏭 方法: Seedless 直造 (componentId)`);
      console.log(`📊 数据: Summer Break JSON (${figureBlocks.length} 图片块)`);
      console.log(`🎯 属性: 官方 setProperties API 控制`);
      
      if (successCount > 0) {
        console.log(`\n🔍 请查看 Figma 中的 Cards 容器验证结果:`);
        console.log(`   - 卡片是否正确创建`);
        console.log(`   - 显隐控制是否生效`);
        console.log(`   - Auto-layout 是否正确收缩`);
      }
      
      console.log('\n='.repeat(60));

    } catch (error) {
      console.error('\n💥 执行失败:', error.message);
      console.log('\n🔧 故障排查建议:');
      console.log('1. 确认 Figma 插件正在运行');
      console.log('2. 确认插件已重新加载最新代码');
      console.log('3. 确认目标文档已打开');
      console.log('4. 确认组件 ID 正确 (194:56)');
      console.log('5. 确认容器 ID 正确 (194:51)');
    }
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function main() {
  const replacer = new SummerBreakReplacer();
  
  try {
    await replacer.initialize();
    await replacer.executeReplacement();
  } catch (error) {
    console.error('🚨 程序异常:', error.message);
  } finally {
    await replacer.close();
  }
}

console.log('🔥 开始执行 Summer Break 海报模板替换!');
console.log('🎯 Seedless 直造工程 - 生产环境验证');
console.log('📋 250818_summer_break_content.json → Figma 模板');
console.log('');

main();