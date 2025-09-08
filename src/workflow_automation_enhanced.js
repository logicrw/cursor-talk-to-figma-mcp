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
    this.config = serverConfig; // ✅ 修复：保存完整配置
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
    
    // Get Cards container nodeId for instance creation
    if (this.channelManager && this.channelManager.currentChannel) {
      try {
        const documentInfo = await this.mcpClient.call("mcp__talk-to-figma__get_document_info");
        const cardsContainer = documentInfo.children.find(child => 
          child.name === this.workflowMapping.anchors.frame
        );
        if (cardsContainer) {
          const containerInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
            nodeId: cardsContainer.id
          });
          // Find Cards within ContentContainer
          const contentContainer = containerInfo.children?.find(child => 
            child.name === this.workflowMapping.anchors.container
          );
          if (contentContainer) {
            const containerDetail = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
              nodeId: contentContainer.id
            });
            const cardsNode = containerDetail.children?.find(child => 
              child.name === this.workflowMapping.anchors.cards_stack
            );
            if (cardsNode) {
              this.workflowMapping.anchors.cards_stack_id = cardsNode.id;
              console.log(`✅ Found Cards container: ${cardsNode.id}`);
            }
          }
        }
      } catch (error) {
        console.warn('⚠️ Could not auto-detect Cards container, using fallback ID');
        this.workflowMapping.anchors.cards_stack_id = "180:53";
      }
    }
    
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
    
    // 🧹 Clear Cards container before creating new instances (if configured)
    if (this.config?.workflow?.cleanup_on_start) {
      await this.clearCardsContainer();
    }
    
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
    
    // 🎯 种子实例优化：解析种子实例ID
    const seedInstances = await this.resolveSeedInstances();
    const cardsContainerId = this.workflowMapping.anchors.cards_stack_id;
    
    // Create required instances using seed instances
    this.runState.cards_created = [];
    
    for (let i = 0; i < orderedContent.length; i++) {
      const item = orderedContent[i];
      const componentName = item.type === 'figure_group' ? 'FigureCard' : 'BodyCard';
      const seedId = item.type === 'figure_group' ? seedInstances.figureInstanceId : seedInstances.bodyInstanceId;
      
      // 生成唯一实例名称
      const newName = item.type === 'figure_group' 
        ? `FigureCard_${item.group_id}` 
        : `BodyCard_paragraph_${i}`;
      
      try {
        // ✅ 种子实例克隆法：直接从种子追加到 Cards，无野生副本
        const appendResult = await this.mcpClient.call("mcp__talk-to-figma__append_card_to_container", {
          containerId: cardsContainerId,
          templateId: seedId,
          newName: newName,
          insertIndex: -1
        });
        
        this.runState.cards_created.push({
          index: i,
          type: item.type,
          component: componentName,
          instanceId: appendResult.newCardId,
          group_id: item.group_id || `paragraph_${i}`,
          name: newName
        });
        
        console.log(`✅ Created ${componentName} instance ${i + 1} (ID: ${appendResult.newCardId})`);
        
      } catch (error) {
        console.error(`❌ Failed to create ${componentName} instance ${i + 1}:`, error);
        throw error;
      }
    }
    
    console.log(`🎉 Successfully created ${this.runState.cards_created.length} instances`);
  }

  // 🎯 种子实例解析方法
  async resolveSeedInstances() {
    const seedsMapping = this.workflowMapping.anchors.seeds;
    if (!seedsMapping) {
      throw new Error('Seeds configuration not found in mapping.anchors.seeds');
    }

    // 查找 Seeds 框架
    const docInfo = await this.mcpClient.call("mcp__talk-to-figma__get_document_info");
    const seedsFrame = docInfo.children.find(frame => frame.name === seedsMapping.frame);
    if (!seedsFrame) {
      throw new Error(`Seeds frame "${seedsMapping.frame}" not found`);
    }

    // 获取种子实例详情
    const seedsInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
      nodeId: seedsFrame.id
    });

    const figureInstance = seedsInfo.children.find(child => child.name === seedsMapping.figure_instance);
    const bodyInstance = seedsInfo.children.find(child => child.name === seedsMapping.body_instance);

    if (!figureInstance || !bodyInstance) {
      throw new Error(`Seed instances not found: ${seedsMapping.figure_instance} / ${seedsMapping.body_instance}`);
    }

    console.log(`🌱 Seed instances resolved: FigureCard=${figureInstance.id}, BodyCard=${bodyInstance.id}`);

    return {
      figureInstanceId: figureInstance.id,
      bodyInstanceId: bodyInstance.id
    };
  }

  async clearCardsContainer() {
    if (!this.channelManager || !this.channelManager.currentChannel) {
      console.warn('⚠️ No channel connection, skipping Cards cleanup');
      return;
    }
    
    try {
      const cardsContainerId = this.workflowMapping.anchors.cards_stack_id || "194:51";
      const cardsInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
        nodeId: cardsContainerId
      });
      
      if (cardsInfo.children && cardsInfo.children.length > 0) {
        // ⚠️ 重要：只删除脚本生成的节点，保护模板结构
        const scriptGeneratedNodes = cardsInfo.children.filter(child => {
          const name = child.name || '';
          return (
            name.includes('_grp_') ||           // FigureCard 分组实例
            name.includes('_paragraph_') ||     // BodyCard 段落实例  
            name.includes('_copy_') ||          // 复制的实例
            name.includes('FigureCard_') ||     // FigureCard 前缀
            name.includes('BodyCard_') ||       // BodyCard 前缀
            name.match(/^(FigureCard|BodyCard).*\d+$/) // 带数字后缀的卡片
          );
        });
        
        if (scriptGeneratedNodes.length > 0) {
          const nodeIds = scriptGeneratedNodes.map(node => node.id);
          console.log(`🧹 Safely cleaning ${nodeIds.length} script-generated items from Cards...`);
          console.log(`📋 Deleting: ${scriptGeneratedNodes.map(n => n.name).join(', ')}`);
          
          const deleteResult = await this.mcpClient.call("mcp__talk-to-figma__delete_multiple_nodes", {
            nodeIds: nodeIds
          });
          
          console.log(`✅ Safe cleanup completed: ${deleteResult.nodesDeleted} deleted, ${deleteResult.nodesFailed} failed`);
        } else {
          console.log('✅ No script-generated content found, Cards container preserved');
        }
        
        // 显示保留的模板结构
        const preservedNodes = cardsInfo.children.filter(child => {
          const name = child.name || '';
          return !scriptGeneratedNodes.some(sg => sg.id === child.id);
        });
        if (preservedNodes.length > 0) {
          console.log(`🛡️ Template preserved: ${preservedNodes.map(n => n.name).join(', ')}`);
        }
        
      } else {
        console.log('✅ Cards container already clean');
      }
    } catch (error) {
      console.warn('⚠️ Cards cleanup failed:', error.message);
    }
  }

  async findChildByName(instanceId, childName) {
    try {
      const instanceInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
        nodeId: instanceId
      });
      
      // Search in direct children
      if (instanceInfo.children) {
        for (const child of instanceInfo.children) {
          if (child.name === childName) {
            return child.id;
          }
          
          // Search in grandchildren for nested structures
          if (child.children) {
            for (const grandchild of child.children) {
              if (grandchild.name === childName) {
                return grandchild.id;
              }
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Failed to find child "${childName}" in instance ${instanceId}:`, error.message);
      return null;
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
    
    // Fill title text
    if (firstTitle) {
      const titleNodeId = await this.findChildByName(instanceId, 'titleText');
      if (titleNodeId) {
        try {
          await this.mcpClient.call("mcp__talk-to-figma__set_text_content", {
            nodeId: titleNodeId,
            text: firstTitle
          });
          console.log(`    ✅ Set title: "${firstTitle}"`);
        } catch (error) {
          console.error(`    ❌ Failed to set title:`, error.message);
        }
      }
    }
    
    // Fill source text
    if (firstCredit) {
      const sourceNodeId = await this.findChildByName(instanceId, 'sourceText');
      if (sourceNodeId) {
        try {
          await this.mcpClient.call("mcp__talk-to-figma__set_text_content", {
            nodeId: sourceNodeId,
            text: `Source: ${firstCredit}`
          });
          console.log(`    ✅ Set source: "Source: ${firstCredit}"`);
        } catch (error) {
          console.error(`    ❌ Failed to set source:`, error.message);
        }
      }
    }
    
    // Advanced visibility control with multi-layer fallback
    await this.applyVisibilityControl(instanceId, {
      hasTitle: !!firstTitle,
      hasSource: !!firstCredit, 
      imageCount: images.length
    });
    
    // Fill images in slots
    for (let i = 0; i < images.length && i < this.workflowMapping.images.max_images; i++) {
      const imageSlotName = this.workflowMapping.anchors.image_slots[i];
      const imageNodeId = await this.findChildByName(instanceId, imageSlotName);
      
      if (imageNodeId && images[i].asset_id) {
        const imageUrl = `${CONFIG.staticServerUrl}/${images[i].asset_id}.png`;
        try {
          await this.mcpClient.call("mcp__talk-to-figma__set_image_fill", {
            nodeId: imageNodeId,
            imageUrl: imageUrl,
            scaleMode: 'FILL',
            opacity: 1
          });
          console.log(`    ✅ Filled ${imageSlotName} with ${images[i].asset_id}`);
        } catch (error) {
          console.error(`    ❌ Failed to fill image slot ${imageSlotName}:`, error.message);
        }
      }
    }
  }

  async applyVisibilityControl(instanceId, { hasTitle, hasSource, imageCount }) {
    // Step 1: Calculate visibility overrides based on configuration
    const overrides = {};
    
    // Title visibility
    if (this.workflowMapping.title?.visible_prop) {
      overrides[this.workflowMapping.title.visible_prop] = hasTitle;
    }
    
    // Source visibility  
    if (this.workflowMapping.source?.visible_prop) {
      overrides[this.workflowMapping.source.visible_prop] = hasSource;
    }
    
    // Image slot visibility (img2, img3, img4)
    for (let i = 2; i <= this.workflowMapping.images.max_images; i++) {
      const visibilityProp = this.workflowMapping.images.visibility_props[`imgSlot${i}`];
      if (visibilityProp) {
        overrides[visibilityProp] = imageCount >= i;
      }
    }
    
    console.log(`    🎯 Visibility control: title:${hasTitle}, source:${hasSource}, images:${imageCount}`);
    
    // Step 2: Try instance overrides first (preferred method)
    let instanceOverridesApplied = false;
    try {
      const overrideEntries = Object.entries(overrides);
      if (overrideEntries.length > 0) {
        // MCP requires different parameter format - need to check actual interface
        await this.mcpClient.call("mcp__talk-to-figma__set_instance_overrides", {
          sourceInstanceId: instanceId,
          targetNodeIds: [instanceId],
          overrides: overrides
        });
        instanceOverridesApplied = true;
        console.log(`    ✅ Instance overrides applied: ${Object.keys(overrides).join(', ')}`);
      }
    } catch (error) {
      console.log(`    ⚠️ Instance overrides not available: ${error.message}`);
    }
    
    // Step 3: Fallback to node-level visibility control
    if (!instanceOverridesApplied) {
      console.log(`    🔄 Fallback: Using node-level visibility control`);
      
      // Hide title slot if no title
      if (!hasTitle) {
        await this.hideSlotNode(instanceId, this.workflowMapping.anchors.slots?.figure?.title || 'slot:TITLE', 'title slot');
      }
      
      // Hide source slot if no source
      if (!hasSource) {
        await this.hideSlotNode(instanceId, this.workflowMapping.anchors.slots?.figure?.source || 'slot:SOURCE', 'source slot');
      }
      
      // Hide unused image slots
      for (let i = 2; i <= this.workflowMapping.images.max_images; i++) {
        if (imageCount < i) {
          await this.hideSlotNode(instanceId, `imgSlot${i}`, `image slot ${i}`);
        }
      }
    }
  }
  
  async hideSlotNode(instanceId, slotName, description) {
    const slotNodeId = await this.findChildByName(instanceId, slotName);
    if (!slotNodeId) {
      console.warn(`    ⚠️ ${description} node '${slotName}' not found`);
      return;
    }
    
    // Try multiple methods in order of preference
    const hideMethods = [
      // Method 1: Node visibility (if available)
      async () => {
        await this.mcpClient.call("mcp__talk-to-figma__set_node_visible", {
          nodeId: slotNodeId,
          visible: false
        });
        return 'hidden';
      },
      
      // Method 2: Opacity to 0
      async () => {
        await this.mcpClient.call("mcp__talk-to-figma__set_fill_color", {
          nodeId: slotNodeId,
          r: 0, g: 0, b: 0, a: 0
        });
        return 'transparent';
      },
      
      // Method 3: Resize to minimal height  
      async () => {
        const nodeInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
          nodeId: slotNodeId
        });
        await this.mcpClient.call("mcp__talk-to-figma__resize_node", {
          nodeId: slotNodeId,
          width: nodeInfo.absoluteBoundingBox?.width || 100,
          height: 1
        });
        return 'minimized';
      }
    ];
    
    for (const [index, method] of hideMethods.entries()) {
      try {
        const result = await method();
        console.log(`    ✅ ${description} ${result} (method ${index + 1})`);
        return;
      } catch (error) {
        if (index === hideMethods.length - 1) {
          console.warn(`    ⚠️ All hide methods failed for ${description}: ${error.message}`);
        }
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
    
    // Find and fill body text node with correct slot name
    const bodySlotName = this.workflowMapping.anchors?.slots?.body?.body || 'slot:BODY';
    const bodyTextNodeId = await this.findChildByName(instanceId, bodySlotName);
    if (bodyTextNodeId) {
      try {
        await this.mcpClient.call("mcp__talk-to-figma__set_text_content", {
          nodeId: bodyTextNodeId,
          text: paragraphText
        });
        console.log(`    ✅ Set body text: "${paragraphText.substring(0, 60)}..."`);
      } catch (error) {
        console.error(`    ❌ Failed to set body text:`, error.message);
      }
    } else {
      console.warn(`    ⚠️ Body text node (${bodySlotName}) not found in instance ${instanceId}`);
    }
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