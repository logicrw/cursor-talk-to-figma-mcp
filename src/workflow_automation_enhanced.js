#!/usr/bin/env node

/**
 * Enhanced End-to-End Workflow Automation: DOCX to Figma Poster
 * 
 * This script implements the complete TODO list with real MCP calls,
 * robust channel management, and smart content mapping.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import FigmaChannelManager from './figma-channel-manager.js';
import { resolveContentPath, parseArgs } from './config-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration - contentPath will be resolved dynamically
const CONFIG = {
  nodeMappingPath: path.join(__dirname, '../config/node_name_map.json'),
  runStatePath: path.join(__dirname, '../config/run_state.json'),
  assetsPath: path.join(__dirname, '../docx2json/assets/media'),
  staticServerUrl: 'http://localhost:3056/assets'
};

class EnhancedFigmaWorkflowAutomator {
  constructor() {
    this.contentData = null;
    this.nodeMapping = null;
    this.runState = null;
    this.processedGroups = 0;
    this.channelManager = null; // Will be initialized with mcpClient
    this.mcpClient = null; // Will be set by integration
  }

  async initialize(mcpClient, channelId = null, contentFile = null) {
    console.log('🚀 Initializing Enhanced Figma Workflow Automator...');
    this.mcpClient = mcpClient;
    this.channelManager = new FigmaChannelManager(mcpClient);
    
    // Connect to channel (requires manual channel ID now)
    if (channelId) {
      await this.channelManager.connect(channelId);
      console.log(`📡 Connected to channel: ${channelId}`);
    } else if (this.channelManager.currentChannel) {
      await this.channelManager.healthCheck();
      console.log(`📡 Using existing channel: ${this.channelManager.currentChannel}`);
    } else {
      console.warn('⚠️ No channel specified. Use :connect <channelId> command to establish connection.');
    }
    
    // Resolve content file path with priority system
    const cliArgs = parseArgs();
    const { contentPath } = resolveContentPath(path.join(__dirname, '..'), {
      initParam: contentFile,
      cliArg: cliArgs.content,
      envVar: process.env.CONTENT_JSON_PATH
    });
    
    // Load configuration files
    this.contentData = JSON.parse(await fs.readFile(contentPath, 'utf8'));
    this.nodeMapping = JSON.parse(await fs.readFile(CONFIG.nodeMappingPath, 'utf8'));
    
    // Initialize or load run state
    try {
      this.runState = JSON.parse(await fs.readFile(CONFIG.runStatePath, 'utf8'));
    } catch {
      this.runState = {
        current_phase: 'initialization',
        did_write_fixed_text: false,
        last_processed_group_index: -1,
        execution_started_at: null
      };
    }
    
    console.log(`📄 Loaded content with ${this.contentData.blocks.length} blocks`);
    console.log(`🗺️ Loaded node mapping with ${Object.keys(this.nodeMapping.nodes).length} base nodes`);
    console.log(`📊 Current run state: ${this.runState.current_phase}`);
  }

  async processWorkflow() {
    console.log('\n🔄 Starting enhanced end-to-end workflow processing...');
    
    // Update run state
    this.runState.execution_started_at = new Date().toISOString();
    this.runState.current_phase = 'workflow_execution';
    await this.updateRunState();
    
    try {
      // Step 1: Fixed text (doc_title, date)
      if (!this.runState.did_write_fixed_text) {
        await this.writeFixedText();
        this.runState.did_write_fixed_text = true;
        await this.updateRunState();
      }

      // Step 2: Group content blocks by group_id
      const contentGroups = this.groupContentBlocks();
      console.log(`📦 Found ${Object.keys(contentGroups).length} content groups`);
      
      // Step 3: Process each group
      let groupIndex = this.runState.last_processed_group_index + 1;
      const groupEntries = Object.entries(contentGroups);
      
      for (; groupIndex < groupEntries.length; groupIndex++) {
        const [groupId, groupBlocks] = groupEntries[groupIndex];
        console.log(`\n📝 Processing ${groupId} (${groupIndex + 1}/${groupEntries.length})`);
        
        await this.processContentGroup(groupId, groupBlocks, groupIndex);
        
        this.runState.last_processed_group_index = groupIndex;
        await this.updateRunState();
      }

      // Step 4: Auto-resize text nodes to prevent truncation
      await this.applyTextAutoResize();

      // Step 5: Adjust background height
      await this.adjustBackgroundHeight();

      console.log('\n✅ Enhanced workflow processing completed!');
      this.runState.current_phase = 'completed';
      await this.updateRunState();
      
    } catch (error) {
      console.error('💥 Workflow failed:', error.message);
      this.runState.current_phase = 'failed';
      this.runState.last_error = error.message;
      await this.updateRunState();
      throw error;
    }
  }

  async writeFixedText() {
    console.log('📝 Writing fixed text (doc_title, date)...');
    
    const textUpdates = [];
    
    // Document title
    if (this.nodeMapping.nodes.doc_title && this.contentData.doc?.title) {
      textUpdates.push({
        nodeId: this.nodeMapping.nodes.doc_title.id,
        text: this.contentData.doc.title
      });
    }

    // Date components
    if (this.nodeMapping.nodes.date && this.contentData.doc?.date) {
      const date = new Date(this.contentData.doc.date);
      textUpdates.push({
        nodeId: this.nodeMapping.nodes.date.id,
        text: date.getDate().toString()
      });
    }

    if (this.nodeMapping.nodes.date_month && this.contentData.doc?.date) {
      const date = new Date(this.contentData.doc.date);
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 
                      'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      textUpdates.push({
        nodeId: this.nodeMapping.nodes.date_month.id,
        text: months[date.getMonth()]
      });
    }

    if (textUpdates.length > 0) {
      const result = await this.mcpClient.call("mcp__talk-to-figma__set_multiple_text_contents", {
        nodeId: this.nodeMapping.nodes.BackgroundFrame.id, // Container context
        text: textUpdates
      });
      console.log(`✅ Updated ${textUpdates.length} fixed text elements`);
    }
  }

  groupContentBlocks() {
    const groups = {};
    
    for (const block of this.contentData.blocks) {
      if (block.group_id) {
        if (!groups[block.group_id]) {
          groups[block.group_id] = [];
        }
        groups[block.group_id].push(block);
      }
    }
    
    return groups;
  }

  async processContentGroup(groupId, blocks, groupIndex) {
    const { images, title_groups, sources, paragraphs } = this.nodeMapping.content_elements;
    
    // Sort blocks by group_seq
    blocks.sort((a, b) => (a.group_seq || 0) - (b.group_seq || 0));
    
    for (const block of blocks) {
      switch (block.type) {
        case 'figure':
          await this.processFigureBlock(block, groupIndex, images, title_groups, sources);
          break;
        case 'paragraph':
          await this.processParagraphBlock(block, groupIndex, paragraphs);
          break;
        default:
          console.warn(`⚠️  Unknown block type: ${block.type}`);
      }
    }
  }

  async processFigureBlock(block, groupIndex, images, titleGroups, sources) {
    console.log(`  🖼️  Processing figure: ${block.title?.substring(0, 50)}...`);
    
    // Ensure sufficient cards
    await this.ensureSufficientCards(groupIndex, images.length);
    
    // Map image using set_image_fill
    if (block.image && images[groupIndex]) {
      const imageNode = images[groupIndex];
      const imageUrl = `${CONFIG.staticServerUrl}/${block.image.asset_id}.png`;
      
      try {
        const result = await this.mcpClient.call("mcp__talk-to-figma__set_image_fill", {
          nodeId: imageNode.id,
          imageUrl: imageUrl,
          scaleMode: 'FILL',
          opacity: 1
        });
        console.log(`    ✅ Set image for node ${imageNode.id}: ${block.image.asset_id}`);
      } catch (error) {
        console.error(`    ❌ Failed to set image ${imageUrl}:`, error.message);
      }
    }
    
    // Map title using set_text_content  
    if (block.title && titleGroups[groupIndex]) {
      const titleNode = titleGroups[groupIndex];
      try {
        const result = await this.mcpClient.call("mcp__talk-to-figma__set_text_content", {
          nodeId: titleNode.id,
          text: block.title
        });
        console.log(`    ✅ Set title for node ${titleNode.id}`);
      } catch (error) {
        console.error(`    ❌ Failed to set title:`, error.message);
      }
    }
    
    // Map credit using set_text_content
    if (block.credit && sources[groupIndex]) {
      const sourceNode = sources[groupIndex];
      try {
        const result = await this.mcpClient.call("mcp__talk-to-figma__set_text_content", {
          nodeId: sourceNode.id,
          text: `Source: ${block.credit}`
        });
        console.log(`    ✅ Set source for node ${sourceNode.id}`);
      } catch (error) {
        console.error(`    ❌ Failed to set source:`, error.message);
      }
    }
  }

  async processParagraphBlock(block, groupIndex, paragraphs) {
    console.log(`  📄 Processing paragraph: ${block.text.substring(0, 50)}...`);
    
    if (paragraphs[groupIndex]) {
      const paragraphNode = paragraphs[groupIndex];
      try {
        const result = await this.mcpClient.call("mcp__talk-to-figma__set_text_content", {
          nodeId: paragraphNode.id,
          text: block.text
        });
        console.log(`    ✅ Set paragraph for node ${paragraphNode.id}`);
      } catch (error) {
        console.error(`    ❌ Failed to set paragraph:`, error.message);
      }
    }
  }

  async ensureSufficientCards(requiredIndex, availableCards) {
    if (requiredIndex >= availableCards) {
      const cardsToAdd = requiredIndex - availableCards + 1;
      console.log(`  📋 Adding ${cardsToAdd} cards to accommodate content`);
      
      for (let i = 0; i < cardsToAdd; i++) {
        try {
          const result = await this.mcpClient.call("mcp__talk-to-figma__append_card_to_container", {
            containerId: this.nodeMapping.nodes.ContentGroup.id,
            templateId: this.nodeMapping.content_elements.images[0].id, // Use first image as template
            insertIndex: -1 // Append at end
          });
          console.log(`    ✅ Appended card ${i + 1}/${cardsToAdd}`);
        } catch (error) {
          console.error(`    ❌ Failed to append card:`, error.message);
        }
      }
    }
  }

  async applyTextAutoResize() {
    console.log('📏 Applying text auto-resize to prevent truncation...');
    
    const textNodes = [
      ...this.nodeMapping.content_elements.title_groups,
      ...this.nodeMapping.content_elements.paragraphs,
      ...this.nodeMapping.content_elements.sources
    ];

    for (const textNode of textNodes) {
      try {
        await this.mcpClient.call("mcp__talk-to-figma__set_text_auto_resize", {
          nodeId: textNode.id,
          autoResize: 'HEIGHT'
        });
      } catch (error) {
        console.warn(`⚠️  Failed to set auto-resize for ${textNode.id}:`, error.message);
      }
    }
    
    console.log(`✅ Applied auto-resize to ${textNodes.length} text nodes`);
  }

  async adjustBackgroundHeight() {
    console.log('📐 Adjusting background height based on content...');
    
    try {
      // Get ContentGroup height
      const contentInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
        nodeId: this.nodeMapping.nodes.ContentGroup.id
      });
      
      if (contentInfo.content?.[0]?.text) {
        const nodeData = JSON.parse(contentInfo.content[0].text);
        const contentHeight = nodeData.height;
        const backgroundHeight = contentHeight + 240; // 120px top + 120px bottom padding
        
        await this.mcpClient.call("mcp__talk-to-figma__resize_node", {
          nodeId: this.nodeMapping.nodes.BackgroundFrame.id,
          width: nodeData.width || 1920, // Maintain width
          height: backgroundHeight
        });
        
        console.log(`✅ Adjusted background height to ${backgroundHeight}px (content: ${contentHeight}px)`);
      }
    } catch (error) {
      console.error('❌ Failed to adjust background height:', error.message);
    }
  }

  async updateRunState() {
    await fs.writeFile(CONFIG.runStatePath, JSON.stringify(this.runState, null, 2));
  }

  async generateExecutionReport() {
    const report = {
      execution_completed_at: new Date().toISOString(),
      content_summary: {
        total_blocks: this.contentData.blocks.length,
        figures: this.contentData.blocks.filter(b => b.type === 'figure').length,
        paragraphs: this.contentData.blocks.filter(b => b.type === 'paragraph').length,
        groups_processed: this.runState.last_processed_group_index + 1
      },
      template_mapping: {
        background_frame: this.nodeMapping.nodes.BackgroundFrame?.id,
        content_group: this.nodeMapping.nodes.ContentGroup?.id,
        available_images: this.nodeMapping.content_elements.images?.length,
        available_titles: this.nodeMapping.content_elements.title_groups?.length,
        available_sources: this.nodeMapping.content_elements.sources?.length,
        available_paragraphs: this.nodeMapping.content_elements.paragraphs?.length
      },
      status: this.runState.current_phase,
      errors: this.runState.last_error ? [this.runState.last_error] : []
    };

    console.log('\n📊 Execution Report:');
    console.log(JSON.stringify(report, null, 2));
    
    return report;
  }
}

export default EnhancedFigmaWorkflowAutomator;

// CLI usage for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Enhanced Workflow Automator - requires MCP client integration');
  console.log('Use: import EnhancedFigmaWorkflowAutomator from "./workflow_automation_enhanced.js"');
}