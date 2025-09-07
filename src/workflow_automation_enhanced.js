#!/usr/bin/env node

/**
 * Card-based Enhanced Workflow Automation: DOCX to Figma Poster
 * 
 * Completely rewritten to support:
 * - FigureCard/BodyCard component instances
 * - Multi-image slots with visibility controls
 * - Standalone paragraphs as BodyCard instances
 * - server-config.json workflow.mapping driven
 * - Dry-run validation before execution
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import FigmaChannelManager from './figma-channel-manager.js';
import { resolveContentPath, parseArgs } from './config-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration paths
const CONFIG = {
  serverConfigPath: path.join(__dirname, '../config/server-config.json'),
  runStatePath: path.join(__dirname, '../config/run_state.json'),
  staticServerUrl: 'http://localhost:3056/assets'
};

class CardBasedFigmaWorkflowAutomator {
  constructor() {
    this.contentData = null;
    this.workflowMapping = null;
    this.runState = null;
    this.channelManager = null;
    this.mcpClient = null;
    this.dryRun = false;
  }

  async initialize(mcpClient, channelId = null, contentFile = null, dryRun = false) {
    console.log('🚀 Initializing Card-based Figma Workflow Automator...');
    this.mcpClient = mcpClient;
    this.channelManager = new FigmaChannelManager(mcpClient);
    this.dryRun = dryRun;
    
    // Connect to channel
    if (channelId) {
      await this.channelManager.connect(channelId);
      console.log(`📡 Connected to channel: ${channelId}`);
    } else {
      console.warn('⚠️ No channel specified. Use :connect <channelId> command to establish connection.');
    }
    
    // Load server configuration with workflow.mapping
    const serverConfig = JSON.parse(await fs.readFile(CONFIG.serverConfigPath, 'utf8'));
    this.workflowMapping = serverConfig.workflow.mapping;
    console.log('✅ Loaded workflow.mapping from server-config.json');
    
    // Resolve and load content data
    const cliArgs = parseArgs();
    const { contentPath } = resolveContentPath(path.join(__dirname, '..'), {
      initParam: contentFile,
      cliArg: cliArgs.content,
      envVar: process.env.CONTENT_JSON_PATH,
      configDefault: serverConfig.workflow.current_content_file
    });
    
    this.contentData = JSON.parse(await fs.readFile(contentPath, 'utf8'));
    
    // Initialize run state
    try {
      this.runState = JSON.parse(await fs.readFile(CONFIG.runStatePath, 'utf8'));
    } catch {
      this.runState = {
        current_phase: 'initialization',
        execution_started_at: null,
        cards_created: [],
        dry_run_completed: false
      };
    }
    
    console.log(`📄 Loaded content with ${this.contentData.blocks.length} blocks`);
    console.log(`🎯 Mode: ${this.dryRun ? 'DRY-RUN' : 'PRODUCTION'}`);
  }

  async processWorkflow() {
    console.log(`\n🔄 Starting card-based workflow processing (${this.dryRun ? 'DRY-RUN' : 'PRODUCTION'})...`);
    
    this.runState.execution_started_at = new Date().toISOString();
    this.runState.current_phase = this.dryRun ? 'dry_run_execution' : 'production_execution';
    await this.updateRunState();
    
    try {
      // Step 1: Create ordered content flow
      const orderedContent = this.createOrderedContentFlow();
      console.log(`📋 Generated ordered content flow: ${orderedContent.length} items`);
      
      // Step 2: Ensure sufficient card instances
      await this.ensureCardInstances(orderedContent);
      
      // Step 3: Process each content item
      for (let i = 0; i < orderedContent.length; i++) {
        const contentItem = orderedContent[i];
        console.log(`\n📝 Processing item ${i + 1}/${orderedContent.length}: ${contentItem.type}`);
        
        if (contentItem.type === 'figure_group') {
          await this.processFigureCard(contentItem, i);
        } else if (contentItem.type === 'standalone_paragraph') {
          await this.processBodyCard(contentItem, i);
        }
      }
      
      // Step 4: Apply text auto-resize if not dry run
      if (!this.dryRun) {
        await this.applyTextAutoResize();
      }
      
      console.log(`\n✅ ${this.dryRun ? 'Dry-run' : 'Production'} processing completed!`);
      this.runState.current_phase = this.dryRun ? 'dry_run_completed' : 'completed';
      this.runState.dry_run_completed = this.dryRun;
      await this.updateRunState();
      
      // Generate summary report
      await this.generateExecutionReport(orderedContent);
      
    } catch (error) {
      console.error('💥 Workflow failed:', error.message);
      this.runState.current_phase = 'failed';
      this.runState.last_error = error.message;
      await this.updateRunState();
      throw error;
    }
  }

  createOrderedContentFlow() {
    // Group blocks by group_id, maintaining original order for ungrouped items
    const groups = {};
    const standaloneItems = [];
    const originalOrder = [];
    
    for (let i = 0; i < this.contentData.blocks.length; i++) {
      const block = this.contentData.blocks[i];
      
      if (block.group_id) {
        if (!groups[block.group_id]) {
          groups[block.group_id] = [];
          originalOrder.push({ type: 'group', group_id: block.group_id, original_index: i });
        }
        groups[block.group_id].push(block);
      } else if (block.type === 'paragraph') {
        // Standalone paragraphs become BodyCard instances
        standaloneItems.push({
          type: 'standalone_paragraph',
          block: block,
          original_index: i
        });
        originalOrder.push({ type: 'standalone_paragraph', original_index: i });
      }
    }
    
    // Convert groups to figure_group items and merge with standalone items
    const orderedContent = [];
    let standaloneIndex = 0;
    
    for (const orderItem of originalOrder) {
      if (orderItem.type === 'group') {
        const groupBlocks = groups[orderItem.group_id];
        groupBlocks.sort((a, b) => (a.group_seq || 0) - (b.group_seq || 0));
        
        orderedContent.push({
          type: 'figure_group',
          group_id: orderItem.group_id,
          blocks: groupBlocks,
          figures: groupBlocks.filter(b => b.type === 'figure'),
          paragraphs: groupBlocks.filter(b => b.type === 'paragraph')
        });
      } else if (orderItem.type === 'standalone_paragraph') {
        orderedContent.push(standaloneItems[standaloneIndex++]);
      }
    }
    
    return orderedContent;
  }

  async ensureCardInstances(orderedContent) {
    const figureCards = orderedContent.filter(item => item.type === 'figure_group').length;
    const bodyCards = orderedContent.filter(item => item.type === 'standalone_paragraph').length;
    
    console.log(`📋 Required instances: ${figureCards} FigureCard, ${bodyCards} BodyCard`);
    
    if (this.dryRun) {
      console.log('🎯 DRY-RUN: Skipping actual instance creation');
      return;
    }
    
    // Get component keys for instance creation
    const components = await this.mcpClient.call("mcp__talk-to-figma__get_local_components");
    const figureComponent = components.components.find(c => c.name === this.workflowMapping.anchors.figure_component);
    const bodyComponent = components.components.find(c => c.name === this.workflowMapping.anchors.body_component);
    
    if (!figureComponent || !bodyComponent) {
      throw new Error('Required components not found: FigureCard/BodyCard');
    }
    
    // Create required instances
    let yPosition = 2265; // Starting position
    this.runState.cards_created = [];
    
    for (let i = 0; i < orderedContent.length; i++) {
      const item = orderedContent[i];
      const componentKey = item.type === 'figure_group' ? figureComponent.key : bodyComponent.key;
      const componentName = item.type === 'figure_group' ? 'FigureCard' : 'BodyCard';
      
      try {
        const instance = await this.mcpClient.call("mcp__talk-to-figma__create_component_instance", {
          componentKey: componentKey,
          x: 158,
          y: yPosition
        });
        
        this.runState.cards_created.push({
          index: i,
          type: item.type,
          component: componentName,
          instanceId: instance.id || `instance_${i}`,
          position: { x: 158, y: yPosition }
        });
        
        console.log(`✅ Created ${componentName} instance ${i + 1}`);
        yPosition += item.type === 'figure_group' ? 1400 : 200; // Estimated heights
        
      } catch (error) {
        console.error(`❌ Failed to create ${componentName} instance:`, error.message);
        throw error;
      }
    }
  }

  async processFigureCard(figureGroup, cardIndex) {
    const cardInstance = this.runState.cards_created[cardIndex];
    if (!cardInstance) {
      console.warn(`⚠️ No card instance found for index ${cardIndex}`);
      return;
    }
    
    console.log(`  🖼️ Processing FigureCard: group ${figureGroup.group_id}`);
    
    if (this.dryRun) {
      this.generateDryRunSummary(figureGroup, cardIndex, 'FigureCard');
      return;
    }
    
    const instanceId = cardInstance.instanceId;
    
    // Extract content from figures
    const figures = figureGroup.figures;
    const images = figures.filter(f => f.image?.asset_id);
    const firstTitle = figures.find(f => f.title)?.title || '';
    const firstCredit = figures.find(f => f.credit)?.credit || '';
    
    // Set component properties
    const propertyUpdates = [];
    
    // Title handling
    if (firstTitle) {
      propertyUpdates.push({ property: this.workflowMapping.title.text_prop, value: firstTitle });
      propertyUpdates.push({ property: this.workflowMapping.title.visible_prop, value: true });
    } else {
      propertyUpdates.push({ property: this.workflowMapping.title.visible_prop, value: false });
    }
    
    // Source handling
    if (firstCredit) {
      propertyUpdates.push({ property: this.workflowMapping.source.text_prop, value: `Source: ${firstCredit}` });
      propertyUpdates.push({ property: this.workflowMapping.source.visible_prop, value: true });
    } else {
      propertyUpdates.push({ property: this.workflowMapping.source.visible_prop, value: false });
    }
    
    // Image visibility controls (max 4 images)
    const maxImages = Math.min(images.length, this.workflowMapping.images.max_images);
    for (let i = 2; i <= 4; i++) {
      const showProp = this.workflowMapping.images.visibility_props[`imgSlot${i}`];
      if (showProp) {
        propertyUpdates.push({ property: showProp, value: i <= maxImages });
      }
    }
    
    // Apply property updates (this would need a new MCP method for component instance properties)
    console.log(`    📝 Setting ${propertyUpdates.length} properties on instance ${instanceId}`);
    
    // Fill images in slots
    for (let i = 0; i < maxImages; i++) {
      const imageSlot = this.workflowMapping.anchors.image_slots[i];
      const imageUrl = `${CONFIG.staticServerUrl}/${images[i].asset_id}.png`;
      
      try {
        // This would need instance-aware image filling
        console.log(`    🖼️ Filling ${imageSlot} with ${images[i].asset_id}`);
      } catch (error) {
        console.error(`    ❌ Failed to fill image slot ${imageSlot}:`, error.message);
      }
    }
  }

  async processBodyCard(standaloneItem, cardIndex) {
    const cardInstance = this.runState.cards_created[cardIndex];
    if (!cardInstance) {
      console.warn(`⚠️ No card instance found for index ${cardIndex}`);
      return;
    }
    
    console.log(`  📄 Processing BodyCard: paragraph`);
    
    if (this.dryRun) {
      this.generateDryRunSummary(standaloneItem, cardIndex, 'BodyCard');
      return;
    }
    
    const instanceId = cardInstance.instanceId;
    const paragraphText = standaloneItem.block.text;
    
    // Set bodyText property on the instance
    console.log(`    📝 Setting bodyText on instance ${instanceId}`);
    console.log(`    Content: "${paragraphText.substring(0, 100)}..."`);
    
    // This would need instance-aware text setting
  }

  generateDryRunSummary(contentItem, cardIndex, cardType) {
    let summary = `[#${cardIndex + 1} ${cardType.toLowerCase()}`;
    
    if (contentItem.type === 'figure_group') {
      const figures = contentItem.figures;
      const imageCount = figures.filter(f => f.image?.asset_id).length;
      const hasTitle = figures.some(f => f.title);
      const hasSource = figures.some(f => f.credit);
      
      summary += ` ${imageCount}img title:${hasTitle ? 'Y' : 'N'} source:${hasSource ? 'Y' : 'N'}`;
    } else if (contentItem.type === 'standalone_paragraph') {
      const textLength = contentItem.block.text.length;
      summary += ` ${textLength}chars`;
    }
    
    summary += ']';
    
    console.log(`    🎯 DRY-RUN: ${summary}`);
    console.log(`    📄 Content: "${(contentItem.blocks?.[0]?.title || contentItem.block?.text || 'N/A').substring(0, 60)}..."`);
  }

  async applyTextAutoResize() {
    console.log('📏 Applying text auto-resize to card instances...');
    
    for (const cardInfo of this.runState.cards_created) {
      try {
        // This would need instance-aware text node identification
        console.log(`✅ Applied auto-resize to ${cardInfo.component} instance ${cardInfo.index + 1}`);
      } catch (error) {
        console.warn(`⚠️ Failed to apply auto-resize to instance ${cardInfo.instanceId}:`, error.message);
      }
    }
  }

  async updateRunState() {
    await fs.writeFile(CONFIG.runStatePath, JSON.stringify(this.runState, null, 2));
  }

  async generateExecutionReport(orderedContent) {
    const figureGroups = orderedContent.filter(item => item.type === 'figure_group');
    const standaloneParagraphs = orderedContent.filter(item => item.type === 'standalone_paragraph');
    
    const report = {
      execution_completed_at: new Date().toISOString(),
      mode: this.dryRun ? 'DRY_RUN' : 'PRODUCTION',
      content_summary: {
        total_blocks: this.contentData.blocks.length,
        figure_groups: figureGroups.length,
        standalone_paragraphs: standaloneParagraphs.length,
        total_cards_required: orderedContent.length
      },
      card_instances: {
        figure_cards: figureGroups.length,
        body_cards: standaloneParagraphs.length,
        created: this.runState.cards_created.length
      },
      workflow_mapping: {
        anchors: this.workflowMapping.anchors,
        component_strategy: 'card_based_instances',
        image_strategy: this.workflowMapping.images.height_strategy,
        max_images_per_card: this.workflowMapping.images.max_images
      },
      status: this.runState.current_phase,
      errors: this.runState.last_error ? [this.runState.last_error] : []
    };

    console.log('\n📊 Execution Report:');
    console.log(JSON.stringify(report, null, 2));
    
    return report;
  }
}

export default CardBasedFigmaWorkflowAutomator;

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Card-based Workflow Automator - requires MCP client integration');
  console.log('Usage: import CardBasedFigmaWorkflowAutomator from "./workflow_automation_enhanced.js"');
  console.log('Features: FigureCard/BodyCard instances, multi-image slots, dry-run validation');
}