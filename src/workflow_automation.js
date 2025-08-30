#!/usr/bin/env node

/**
 * End-to-End Workflow Automation: DOCX to Figma Poster
 * 
 * This script processes content.json data and applies it to Figma template
 * using the MCP tools through WebSocket communication.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  contentPath: path.join(__dirname, '../docx2json/content.json'),
  nodeMappingPath: path.join(__dirname, '../config/node_name_map.json'),
  runStatePath: path.join(__dirname, '../config/run_state.json'),
  assetsPath: path.join(__dirname, '../docx2json/assets/media'),
  
  // WebSocket connection (this would need to be implemented)
  websocketUrl: 'ws://localhost:3055',
  channel: 'rdgea13n', // Current active channel
};

class FigmaWorkflowAutomator {
  constructor() {
    this.contentData = null;
    this.nodeMapping = null;
    this.runState = null;
    this.processedGroups = 0;
  }

  async initialize() {
    console.log('🚀 Initializing Figma Workflow Automator...');
    
    // Load configuration files
    this.contentData = JSON.parse(await fs.readFile(CONFIG.contentPath, 'utf8'));
    this.nodeMapping = JSON.parse(await fs.readFile(CONFIG.nodeMappingPath, 'utf8'));
    this.runState = JSON.parse(await fs.readFile(CONFIG.runStatePath, 'utf8'));
    
    console.log(`📄 Loaded content with ${this.contentData.blocks.length} blocks`);
    console.log(`🗺️ Loaded node mapping with ${Object.keys(this.nodeMapping.nodes).length} base nodes`);
    console.log(`📊 Current run state: ${this.runState.current_phase}`);
  }

  async processWorkflow() {
    console.log('\n🔄 Starting end-to-end workflow processing...');
    
    // Update run state
    this.runState.execution_started_at = new Date().toISOString();
    this.runState.current_phase = 'workflow_execution';
    await this.updateRunState();
    
    // Group content blocks by group_id
    const contentGroups = this.groupContentBlocks();
    console.log(`📦 Found ${Object.keys(contentGroups).length} content groups`);
    
    // Process each group
    let groupIndex = 0;
    for (const [groupId, groupBlocks] of Object.entries(contentGroups)) {
      console.log(`\n📝 Processing ${groupId} (${groupIndex + 1}/${Object.keys(contentGroups).length})`);
      await this.processContentGroup(groupId, groupBlocks, groupIndex);
      
      groupIndex++;
      this.runState.last_processed_group_index = groupIndex - 1;
      await this.updateRunState();
    }
    
    console.log('\n✅ Workflow processing completed!');
    this.runState.current_phase = 'completed';
    await this.updateRunState();
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
    console.log(`  🖼️  Processing figure: ${block.title}`);
    
    // Map image using set_image_fill
    if (block.image && images[groupIndex]) {
      const imageNode = images[groupIndex];
      const imagePath = path.join(CONFIG.assetsPath, `${block.image.asset_id}.png`);
      
      try {
        const imageBase64 = await this.loadImageAsBase64(imagePath);
        console.log(`    📁 Loading image: ${block.image.asset_id}`);
        // TODO: Call MCP set_image_fill tool
        console.log(`    ✅ Would call set_image_fill for node ${imageNode.id}`);
      } catch (error) {
        console.error(`    ❌ Failed to load image ${imagePath}:`, error.message);
      }
    }
    
    // Map title using set_text_content  
    if (block.title && titleGroups[groupIndex]) {
      const titleNode = titleGroups[groupIndex];
      console.log(`    📝 Setting title: ${block.title.substring(0, 30)}...`);
      // TODO: Call MCP set_text_content tool
      console.log(`    ✅ Would call set_text_content for node ${titleNode.id}`);
    }
    
    // Map credit using set_text_content
    if (block.credit && sources[groupIndex]) {
      const sourceNode = sources[groupIndex];
      console.log(`    📄 Setting source: ${block.credit}`);
      // TODO: Call MCP set_text_content tool  
      console.log(`    ✅ Would call set_text_content for node ${sourceNode.id}`);
    }
  }

  async processParagraphBlock(block, groupIndex, paragraphs) {
    console.log(`  📄 Processing paragraph: ${block.text.substring(0, 50)}...`);
    
    if (paragraphs[groupIndex]) {
      const paragraphNode = paragraphs[groupIndex];
      // TODO: Call MCP set_text_content tool
      console.log(`    ✅ Would call set_text_content for node ${paragraphNode.id}`);
    }
  }

  async loadImageAsBase64(imagePath) {
    try {
      const imageBuffer = await fs.readFile(imagePath);
      const base64Data = imageBuffer.toString('base64');
      return `data:image/png;base64,${base64Data}`;
    } catch (error) {
      throw new Error(`Cannot load image: ${imagePath}`);
    }
  }

  async updateRunState() {
    await fs.writeFile(CONFIG.runStatePath, JSON.stringify(this.runState, null, 2));
  }
}

// Main execution
async function main() {
  try {
    const automator = new FigmaWorkflowAutomator();
    await automator.initialize();
    await automator.processWorkflow();
  } catch (error) {
    console.error('💥 Workflow automation failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}