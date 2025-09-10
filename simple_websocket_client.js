#!/usr/bin/env node

/**
 * 简单的WebSocket客户端，直接与Figma插件通信
 */

import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';

class SimpleFigmaClient {
  constructor() {
    this.ws = null;
    this.pendingRequests = new Map();
    this.currentChannel = null;
  }

  async connect() {
    console.log('🔌 连接到 Figma WebSocket 服务器...');
    
    this.ws = new WebSocket('ws://127.0.0.1:3055');
    
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => {
        console.log('✅ WebSocket 连接成功');
        resolve();
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ WebSocket 连接失败:', error.message);
        reject(error);
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.log('收到消息:', data.toString());
        }
      });
    });
  }

  handleMessage(message) {
    console.log('📨 收到消息:', JSON.stringify(message, null, 2));
    
    // Handle response to our requests
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      resolve(message);
    }
    
    // Handle nested message responses
    if (message.message && message.message.id && this.pendingRequests.has(message.message.id)) {
      const { resolve } = this.pendingRequests.get(message.message.id);
      this.pendingRequests.delete(message.message.id);
      resolve(message.message);
    }
  }

  async sendCommand(command, params = {}) {
    const id = uuidv4();
    const message = {
      id,
      type: command,
      channel: this.currentChannel,
      message: {
        id,
        command,
        params: { ...params, commandId: id }
      }
    };

    console.log('📤 发送命令:', command, JSON.stringify(params, null, 2));

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      this.ws.send(JSON.stringify(message));
      
      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Command timeout'));
        }
      }, 30000);
    });
  }

  async joinChannel(channel) {
    console.log(`📡 加入频道: ${channel}`);
    this.currentChannel = channel;
    const result = await this.sendCommand('join', { channel });
    return result;
  }

  async getDocumentInfo() {
    console.log('📋 获取文档信息...');
    const result = await this.sendCommand('get_document_info');
    return result;
  }

  async createComponentInstance(componentId, parentId) {
    console.log(`🏗️ 创建组件实例: ${componentId}`);
    const result = await this.sendCommand('create_component_instance', {
      componentId,
      parentId
    });
    return result;
  }

  async setInstanceProperties(instanceId, properties) {
    console.log(`⚙️ 设置实例属性: ${instanceId}`, properties);
    const result = await this.sendCommand('set_instance_properties', {
      instanceId,
      properties
    });
    return result;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function executeWorkflow() {
  const client = new SimpleFigmaClient();
  
  try {
    await client.connect();
    
    // Join channel
    await client.joinChannel('xa55y91p');
    console.log('✅ 频道连接成功');
    
    // Skip document info for now and proceed directly
    
    // Load Summer Break content
    const contentPath = '/Users/chenrongwei/Projects/cursor-talk-to-figma-mcp/docx2json/250818_summer_break_content.json';
    const contentData = JSON.parse(await fs.readFile(contentPath, 'utf8'));
    console.log(`📖 加载内容: ${contentData.blocks.length} 个块`);
    
    // Get server config for component IDs
    const configPath = '/Users/chenrongwei/Projects/cursor-talk-to-figma-mcp/config/server-config.json';
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    
    const figureComponentId = config.workflow.mapping.figure.componentId; // "194:56"
    console.log(`🎯 使用组件ID: ${figureComponentId}`);
    
    // Find Cards container (this would need to be dynamic in real implementation)
    const cardsContainerId = "194:51"; // This should be discovered from document
    
    console.log('\n🚀 开始执行 Summer Break 工作流...');
    console.log('='.repeat(60));
    
    // Process figure blocks
    let processedCount = 0;
    for (const block of contentData.blocks) {
      if (block.type === 'figure') {
        try {
          console.log(`\n📷 处理图片块 ${processedCount + 1}/${contentData.blocks.filter(b => b.type === 'figure').length}`);
          
          // Create instance
          const createResult = await client.createComponentInstance(figureComponentId, cardsContainerId);
          console.log('✅ 实例创建成功:', createResult.result?.newNodeId);
          
          if (createResult.result?.newNodeId) {
            // Set properties based on the block
            const properties = {};
            
            // Set visibility properties
            if (block.title) {
              properties['showTitle'] = true;
            }
            if (block.credit) {
              properties['showSource'] = true;  
            }
            
            // Set properties for multiple images in group
            if (block.group_len > 1) {
              properties['showImg2'] = true;
            }
            if (block.group_len > 2) {
              properties['showImg3'] = true;
            }
            if (block.group_len > 3) {
              properties['showImg4'] = true;
            }
            
            console.log('🔧 设置属性:', properties);
            await client.setInstanceProperties(createResult.result.newNodeId, properties);
            
            processedCount++;
          }
          
        } catch (error) {
          console.error('❌ 处理块失败:', error.message);
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`🎉 工作流执行完成! 处理了 ${processedCount} 个图片块`);
    console.log('📋 请检查 Figma 中的 Cards 容器');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('💥 工作流执行失败:', error.message);
    console.error(error.stack);
  } finally {
    client.close();
  }
}

executeWorkflow();