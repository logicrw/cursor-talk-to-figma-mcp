#!/usr/bin/env node

/**
 * Figma Channel Manager - 方案B自动跟随机制
 * 
 * 自动检测和管理Figma插件频道，实现稳定的连接控制
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHANNEL_CONFIG_PATH = path.join(__dirname, '../config/figma_channel.json');

class FigmaChannelManager {
  constructor() {
    this.currentChannel = null;
    this.lastWorkingChannel = null;
    this.channelHistory = [];
    this.maxRetries = 3;
  }

  async loadChannelConfig() {
    try {
      const config = JSON.parse(await fs.readFile(CHANNEL_CONFIG_PATH, 'utf8'));
      this.currentChannel = config.default_channel;
      this.lastWorkingChannel = config.last_working_channel || config.default_channel;
      this.channelHistory = config.channel_history || [];
      return config;
    } catch (error) {
      console.warn('Channel config not found, using defaults');
      return {
        default_channel: null,
        last_working_channel: null,
        channel_history: []
      };
    }
  }

  async saveChannelConfig(config) {
    const fullConfig = {
      ...config,
      last_updated: new Date().toISOString(),
      note: "Auto-updated by channel manager",
      strategy: "auto_follow_plan_b"
    };
    
    await fs.writeFile(CHANNEL_CONFIG_PATH, JSON.stringify(fullConfig, null, 2));
  }

  async testChannelConnection(channelId, mcpClient) {
    try {
      console.log(`Testing channel: ${channelId}`);
      
      // Join channel
      const joinResult = await mcpClient.call("mcp__talk-to-figma__join_channel", { 
        channel: channelId 
      });
      
      if (!joinResult?.content?.[0]?.text?.includes('Successfully joined')) {
        return false;
      }

      // Quick test with document info
      const docResult = await mcpClient.call("mcp__talk-to-figma__get_document_info", {});
      
      return !docResult?.content?.[0]?.text?.includes('timeout');
    } catch (error) {
      console.warn(`Channel ${channelId} test failed:`, error.message);
      return false;
    }
  }

  async findWorkingChannel(mcpClient) {
    await this.loadChannelConfig();
    
    // Test sequence: current -> last working -> history -> give up
    const testChannels = [
      this.currentChannel,
      this.lastWorkingChannel,
      ...this.channelHistory.slice(-5).reverse() // Recent 5 channels, newest first
    ].filter(Boolean);

    // Remove duplicates while preserving order
    const uniqueChannels = [...new Set(testChannels)];
    
    console.log(`Testing ${uniqueChannels.length} known channels...`);
    
    for (const channelId of uniqueChannels) {
      const isWorking = await this.testChannelConnection(channelId, mcpClient);
      
      if (isWorking) {
        console.log(`✅ Found working channel: ${channelId}`);
        
        // Update config
        await this.saveChannelConfig({
          default_channel: channelId,
          last_working_channel: channelId,
          channel_history: this.updateChannelHistory(channelId)
        });
        
        return channelId;
      }
    }
    
    console.error('❌ No working channels found');
    return null;
  }

  updateChannelHistory(newChannel) {
    const history = this.channelHistory.filter(ch => ch !== newChannel);
    history.push(newChannel);
    return history.slice(-10); // Keep last 10 channels
  }

  async registerNewChannel(channelId) {
    await this.loadChannelConfig();
    
    await this.saveChannelConfig({
      default_channel: channelId,
      last_working_channel: channelId,
      channel_history: this.updateChannelHistory(channelId)
    });
    
    console.log(`📝 Registered new channel: ${channelId}`);
  }

  // Auto-recovery mechanism
  async ensureConnection(mcpClient, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Connection attempt ${attempt}/${maxAttempts}`);
      
      const workingChannel = await this.findWorkingChannel(mcpClient);
      
      if (workingChannel) {
        return workingChannel;
      }
      
      if (attempt < maxAttempts) {
        console.log('Waiting 2s before retry...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    throw new Error('Failed to establish Figma connection after all attempts');
  }
}

// Export for use in other modules
export default FigmaChannelManager;

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const manager = new FigmaChannelManager();
  
  const command = process.argv[2];
  const channelId = process.argv[3];
  
  switch (command) {
    case 'register':
      if (!channelId) {
        console.error('Usage: node figma-channel-manager.js register <channel-id>');
        process.exit(1);
      }
      await manager.registerNewChannel(channelId);
      break;
      
    case 'test':
      console.log('Channel connection testing requires MCP client integration');
      break;
      
    default:
      console.log(`
Figma Channel Manager - 方案B自动跟随机制

Commands:
  register <channel-id>  Register a new working channel
  test                   Test current channels (requires integration)

Config file: ${CHANNEL_CONFIG_PATH}
      `);
  }
}