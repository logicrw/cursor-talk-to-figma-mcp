#!/usr/bin/env node

/**
 * Figma Channel Manager - Simplified Connection Handler
 * 
 * Lightweight connector for Figma plugin communication:
 * - Memory-only channel storage
 * - Direct connect/health check methods
 * - Optional environment variable default
 */

// No file system imports needed - pure memory approach

class FigmaChannelManager {
  constructor(mcpClient = null) {
    this.mcpClient = mcpClient;
    this.currentChannel = process.env.FIGMA_CHANNEL || null;
    this.maxRetries = 2; // Simplified retry logic
  }

  // DEPRECATED: Config file support removed
  async loadChannelConfig() {
    console.warn('DEPRECATED: loadChannelConfig() - config file support removed. Use connect(channelId) instead.');
    return { deprecated: true };
  }

  // DEPRECATED: Config file support removed  
  async saveChannelConfig(config) {
    console.warn('DEPRECATED: saveChannelConfig() - config file support removed. Channel stored in memory only.');
  }

  // Core connection method
  async connect(channelId) {
    if (!this.mcpClient) {
      throw new Error('MCP client not provided. Use: new FigmaChannelManager(mcpClient)');
    }
    
    try {
      console.log(`Connecting to channel: ${channelId}`);
      
      // Step 1: Join channel
      await this.mcpClient.call("mcp__talk-to-figma__join_channel", { 
        channel: channelId 
      });
      
      // Step 2: Set current channel (needed for healthCheck)
      this.currentChannel = channelId;
      
      // Step 3: Health check with get_selection
      await this.mcpClient.call("mcp__talk-to-figma__get_selection", {});
      
      console.log(`✅ Connected to channel: ${channelId}`);
      return channelId;
    } catch (error) {
      // Clear channel on failure
      this.currentChannel = null;
      throw new Error(`Failed to connect to channel ${channelId}: ${error.message}`);
    }
  }
  
  async healthCheck() {
    if (!this.mcpClient) {
      throw new Error('MCP client not available');
    }
    
    if (!this.currentChannel) {
      throw new Error('No active channel. Use connect(channelId) first.');
    }
    
    try {
      // Use get_selection as lightweight health check
      const result = await this.mcpClient.call("mcp__talk-to-figma__get_selection", {});
      console.log(`✅ Health check passed for channel: ${this.currentChannel}`);
      return true;
    } catch (error) {
      throw new Error(`Health check failed: ${error.message}. Check if plugin is running and Frame is selected.`);
    }
  }

  // DEPRECATED: Auto-discovery removed
  async findWorkingChannel(mcpClient) {
    console.warn('DEPRECATED: findWorkingChannel() - auto-discovery disabled. Use connect(channelId) instead.');
    throw new Error('Auto-discovery disabled. Please provide channel ID via connect(channelId) method.');
  }

  // DEPRECATED: Channel history removed
  updateChannelHistory(newChannel) {
    console.warn('DEPRECATED: updateChannelHistory() - channel history tracking removed.');
    return [];
  }

  // Simplified channel registration - just connect
  async registerNewChannel(channelId) {
    console.warn('DEPRECATED: registerNewChannel() - use connect(channelId) instead.');
    return await this.connect(channelId);
  }

  // Simplified connection with retry
  async ensureConnection(channelId, maxAttempts = 2) {
    if (!channelId && !this.currentChannel) {
      throw new Error('No channel specified. Use connect(channelId) or provide channelId parameter.');
    }
    
    const targetChannel = channelId || this.currentChannel;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`Connection attempt ${attempt}/${maxAttempts}`);
        return await this.connect(targetChannel);
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }
        console.log('Retrying in 1s...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  // Command interface methods
  getCurrentChannel() {
    return this.currentChannel || 'No channel connected';
  }
  
  async reconnect(channelId) {
    console.log('🔄 Reconnecting...');
    return await this.connect(channelId);
  }
}

// Export for use in other modules
export default FigmaChannelManager;

// Command interface for interactive usage
export function parseCommand(input, manager) {
  const trimmed = input.trim();
  
  if (trimmed.startsWith(':connect ')) {
    const channelId = trimmed.substring(9).trim();
    if (!channelId) {
      throw new Error('Usage: :connect <channel-id>');
    }
    return { command: 'connect', channelId };
  }
  
  if (trimmed === ':health') {
    return { command: 'health' };
  }
  
  if (trimmed === ':channel') {
    return { command: 'channel' };
  }
  
  return null; // Not a recognized command
}

// CLI usage (simplified)
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`
Figma Channel Manager - Simplified Connection Handler

For interactive usage, create instance with MCP client:
  const manager = new FigmaChannelManager(mcpClient);
  await manager.connect(channelId);

Commands in Claude Code:
  :connect <channel-id>  Connect to specific channel
  :health               Check current connection
  :channel              Show current channel

Environment variable: FIGMA_CHANNEL (optional default)
  `);
}