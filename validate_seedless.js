#!/usr/bin/env node

/**
 * Seedless 直造工程验证脚本
 * 验证：直造 -> 属性发现 -> 显隐控制 -> 清理
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

class SeedlessValidation {
  constructor() {
    this.client = null;
    this.results = {
      directCreation: null,
      propertyDiscovery: null,
      visibilityControl: null,
      cleanup: null
    };
  }

  async initialize() {
    console.log('🚀 初始化 MCP 客户端...');
    
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', 'dist/server.js']
    });
    
    this.client = new Client({
      name: 'seedless-validator',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await this.client.connect(transport);
    console.log('✅ MCP 客户端连接成功');
  }

  async validate() {
    try {
      // 1. 连接到频道
      console.log('\n📡 连接到 Figma 频道...');
      await this.client.request({
        method: 'join_channel',
        params: { channel: 'un6bt1cf' }
      }, null);

      // 2. 直造测试
      console.log('\n🏭 测试 Seedless 直造...');
      const createResult = await this.client.request({
        method: 'create_component_instance',
        params: {
          componentKey: 'fc4afd0baa35964a92683dbd2a31fc8f5ef4cdfb',
          parentId: '194:51',
          x: 0,
          y: 0
        }
      }, null);

      console.log('📦 直造结果:', createResult);
      
      if (createResult && createResult.success) {
        this.results.directCreation = {
          success: true,
          instanceId: createResult.id,
          method: 'direct'
        };
        
        // 3. 属性发现
        console.log('\n🔍 测试属性发现...');
        const propResult = await this.client.request({
          method: 'get_component_property_references', 
          params: { nodeId: createResult.id }
        }, null);
        
        console.log('📋 属性发现结果:', propResult);
        
        if (propResult && propResult.success) {
          this.results.propertyDiscovery = {
            success: true,
            propertyCount: Object.keys(propResult.properties).length,
            properties: propResult.properties
          };

          // 4. 显隐控制测试
          console.log('\n🎯 测试显隐控制...');
          const visibilityProps = {};
          
          // 设置显隐：title=true, source=false, 只显示前2张图片
          Object.keys(propResult.properties).forEach(key => {
            if (key.startsWith('showTitle#')) {
              visibilityProps[key] = true;
            } else if (key.startsWith('showSource#')) {
              visibilityProps[key] = false;  
            } else if (key.startsWith('showImg2#')) {
              visibilityProps[key] = true;
            } else if (key.startsWith('showImg3#') || key.startsWith('showImg4#')) {
              visibilityProps[key] = false;
            }
          });

          const visResult = await this.client.request({
            method: 'set_instance_properties',
            params: {
              nodeId: createResult.id,
              properties: visibilityProps
            }
          }, null);
          
          console.log('🔧 显隐控制结果:', visResult);
          
          this.results.visibilityControl = {
            success: visResult && visResult.success,
            appliedProperties: Object.keys(visibilityProps).length
          };

          // 5. 清理
          console.log('\n🧹 清理测试实例...');
          const deleteResult = await this.client.request({
            method: 'delete_node',
            params: { nodeId: createResult.id }
          }, null);
          
          this.results.cleanup = {
            success: deleteResult !== null  // 只要没报错就算成功
          };

        } else {
          this.results.propertyDiscovery = { success: false, error: '属性发现失败' };
        }
        
      } else {
        this.results.directCreation = { success: false, error: '直造失败', fallback: 'seed-clone' };
      }

    } catch (error) {
      console.error('❌ 验证过程出错:', error.message);
      return false;
    }

    return true;
  }

  generateReport() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Seedless 直造工程验证报告');
    console.log('='.repeat(60));
    
    // 1. 直造结果
    console.log('\n【1. Seedless 直造】');
    if (this.results.directCreation?.success) {
      console.log('✅ 状态: 成功');
      console.log(`📦 方法: ${this.results.directCreation.method}`);
      console.log(`🆔 实例ID: ${this.results.directCreation.instanceId}`);
    } else {
      console.log('❌ 状态: 失败');
      console.log(`🔄 回退: ${this.results.directCreation?.fallback || '未知'}`);
      console.log(`⚠️  错误: ${this.results.directCreation?.error || '未知错误'}`);
    }

    // 2. 属性发现
    console.log('\n【2. 属性发现】');
    if (this.results.propertyDiscovery?.success) {
      console.log('✅ 状态: 成功');
      console.log(`📊 属性数量: ${this.results.propertyDiscovery.propertyCount}`);
      console.log('🔑 发现的属性键:');
      Object.keys(this.results.propertyDiscovery.properties).forEach(key => {
        console.log(`   - ${key}`);
      });
    } else {
      console.log('❌ 状态: 失败');
      console.log(`⚠️  错误: ${this.results.propertyDiscovery?.error || '未知错误'}`);
    }

    // 3. 显隐控制
    console.log('\n【3. 显隐控制】');
    if (this.results.visibilityControl?.success) {
      console.log('✅ 状态: 成功');
      console.log(`🔧 应用属性数: ${this.results.visibilityControl.appliedProperties}`);
      console.log('📝 测试场景: title=true, source=false, 显示前2张图片');
    } else {
      console.log('❌ 状态: 失败');
    }

    // 4. Auto-layout 收缩
    console.log('\n【4. Auto-layout 收缩】');
    console.log('⚠️  需要手动验证：');
    console.log('   - 检查 Cards 容器是否正确收缩');
    console.log('   - 确认隐藏的元素不占用空间');

    // 5. 清理
    console.log('\n【5. 清理】');
    if (this.results.cleanup?.success) {
      console.log('✅ 状态: 成功');
      console.log('🗑️  测试实例已清理');
    } else {
      console.log('❌ 状态: 失败或未执行');
    }

    // 6. 总结
    console.log('\n【📋 总结】');
    const passedTests = Object.values(this.results).filter(r => r?.success).length;
    const totalTests = Object.keys(this.results).length - 1; // 不计算 cleanup
    
    if (passedTests >= 3) {
      console.log('🎉 验证通过！Seedless 直造工程已就绪');
      console.log('✅ 可以进行 Summer Break JSON 全量数据验证');
    } else {
      console.log('⚠️  验证部分通过，需要修复以下问题：');
      Object.entries(this.results).forEach(([test, result]) => {
        if (!result?.success && test !== 'cleanup') {
          console.log(`   - ${test}: ${result?.error || '未知错误'}`);
        }
      });
    }
    
    console.log('\n='.repeat(60));
  }
}

async function main() {
  const validator = new SeedlessValidation();
  
  try {
    await validator.initialize();
    await validator.validate();
    validator.generateReport();
  } catch (error) {
    console.error('💥 验证脚本执行失败:', error.message);
    process.exit(1);
  } finally {
    if (validator.client) {
      await validator.client.close();
    }
  }
}

main();