#!/usr/bin/env node

/**
 * Seedless 直造工程 - Summer Break 全量验证
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import CardBasedFigmaWorkflowAutomator from './src/workflow_automation_enhanced.js';

class SeedlessExecutor {
  constructor() {
    this.client = null;
    this.automator = null;
  }

  async initialize() {
    console.log('🚀 Seedless 直造工程启动...');
    
    // Initialize MCP client
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', 'dist/server.js']
    });
    
    this.client = new Client({
      name: 'seedless-executor',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await this.client.connect(transport);
    console.log('✅ MCP 客户端连接成功');

    // Initialize automator
    this.automator = new CardBasedFigmaWorkflowAutomator();
  }

  async execute() {
    try {
      console.log('\n📡 连接 Figma 频道 xa55y91p...');
      await this.client.request({
        method: 'tools/call',
        params: { 
          name: 'join_channel',
          arguments: { channel: 'xa55y91p' }
        }
      }, null);

      console.log('\n🏗️ 初始化 Seedless 工作流...');
      await this.automator.initialize(
        this.client,           // MCP client
        'xa55y91p',            // channel  
        '250818_summer_break_content.json',  // content file
        false                  // not dry run
      );

      console.log('\n🎯 执行 Summer Break JSON 验证...');
      console.log('期望结果: method: "direct-local"');
      console.log('数据: 22 blocks from Summer Break content');
      console.log('组件: FigureCard (194:56) → Cards (194:51)');
      console.log('属性: showTitle/Source/Img2/3/4 官方API控制\n');

      // Execute the workflow
      const result = await this.automator.execute();
      
      console.log('\n' + '='.repeat(60));
      console.log('🎉 SEEDLESS 验证结果');
      console.log('='.repeat(60));
      
      if (result) {
        console.log('✅ 状态: 成功完成');
        console.log('📋 详情: 检查 Figma 中的 Cards 容器');
        console.log('🔍 验证: 观察 Auto-layout 收缩行为');
        console.log('📊 日志: 查看控制台确认 method: "direct-local"');
      } else {
        console.log('❌ 状态: 执行失败');
        console.log('🔧 建议: 检查插件连接状态和权限');
      }

      console.log('\n' + '='.repeat(60));

    } catch (error) {
      console.error('💥 执行失败:', error.message);
      console.log('\n🔧 故障排查:');
      console.log('1. 确认 Figma 插件正在运行 (Plugins → Development → Run)');
      console.log('2. 确认频道连接 (xa55y91p)');
      console.log('3. 确认组件存在 (194:56 FigureCard)');
      console.log('4. 确认容器存在 (194:51 Cards)');
    } finally {
      if (this.client) {
        await this.client.close();
      }
    }
  }
}

async function main() {
  const executor = new SeedlessExecutor();
  
  try {
    await executor.initialize();
    await executor.execute();
  } catch (error) {
    console.error('🚨 启动失败:', error.message);
    process.exit(1);
  }
}

// 执行验证
console.log('🔥 开始执行 Seedless 直造工程验证!');
console.log('📋 目标: Summer Break JSON (22 blocks)');
console.log('🏭 方法: componentId 本地直造');
console.log('🎯 期望: method="direct-local" + Auto-layout收缩\n');

main();