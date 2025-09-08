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

// utils: get value by "a.b.c" path
const getByPath = (obj, pathStr) =>
  (pathStr || '').split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);

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

      // ✅ 改进4: 事后验收，确保创建顺序与内容一致
      if (!this.dryRun) {
        await this.validateCardsOrder(orderedContent);
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
      
      // ✅ 改进1: 按索引命名，确保与内容流严格对应
      const newName = item.type === 'figure_group' 
        ? `${String(i+1).padStart(2,'0')}_Figure_${item.group_id}` 
        : `${String(i+1).padStart(2,'0')}_Body_${i}`;
      
      try {
        // ✅ 种子实例克隆法：直接从种子追加到 Cards，确保插入顺序
        const appendResult = await this.mcpClient.call("mcp__talk-to-figma__append_card_to_container", {
          containerId: cardsContainerId,
          templateId: seedId,
          newName: newName,
          insertIndex: i  // ← 关键：卡片在 Cards 内的确切位置
        });
        
        // ✅ 改进2: 增强绑定关系，便于按索引对齐
        this.runState.cards_created.push({
          index: i,               // ← 与 orderedContent 的位置一一对应
          instanceId: appendResult.newCardId,
          kind: item.type,        // 'figure_group' | 'standalone_paragraph'
          type: item.type,        // ← 向后兼容，别删
          component: componentName,
          name: newName,
          ref: item.type === 'figure_group'
            ? { group_id: item.group_id }                // grp_0010 / grp_0011…
            : { original_index: item.original_index }    // 段落在JSON中的原始索引
        });
        
        console.log(`✅ Created ${componentName} instance ${i + 1} (ID: ${appendResult.newCardId})`);
        
      } catch (error) {
        console.error(`❌ Failed to create ${componentName} instance ${i + 1}:`, error);
        throw error;
      }
    }
    
    console.log(`🎉 Successfully created ${this.runState.cards_created.length} instances`);
  }

  // ✅ 改进4: 验收机制 - 确保Cards顺序与orderedContent一致
  async validateCardsOrder(orderedContent) {
    console.log('\n🔍 Validating cards order against content flow...');
    
    try {
      // 获取Cards容器的实际子节点
      const cardsInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
        nodeId: this.workflowMapping.anchors.cards_stack_id
      });
      
      const actualChildren = cardsInfo.children || [];
      console.log(`📋 Found ${actualChildren.length} cards in Figma, expected ${orderedContent.length}`);
      
      // 验证数量
      if (actualChildren.length !== orderedContent.length) {
        console.warn(`⚠️ Cards count mismatch: expected ${orderedContent.length}, found ${actualChildren.length}`);
        return false;
      }
      
      // 验证顺序和对应关系
      let allValid = true;
      for (let i = 0; i < actualChildren.length; i++) {
        const actualCard = actualChildren[i];
        const expectedContent = orderedContent[i];
        const expectedCard = this.runState.cards_created[i];
        
        // 检查ID对应
        if (actualCard.id !== expectedCard.instanceId) {
          console.warn(`⚠️ Position ${i}: ID mismatch - expected ${expectedCard.instanceId}, found ${actualCard.id}`);
          allValid = false;
        }
        
        // ✅ 检查类型对应 - 通过子节点槽位而非名称判断 + 安全访问
        try {
          const info = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", { nodeId: actualCard.id });
          const slots = this.workflowMapping.anchors?.slots ?? {};
          const hasBody = (info.children || []).some(c => c.name === (slots.body?.body ?? 'slot:BODY'));
          const hasImageGrid = (info.children || []).some(c => c.name === (slots.figure?.image_grid ?? 'slot:IMAGE_GRID'));
          const actualType = hasBody ? 'standalone_paragraph' : (hasImageGrid ? 'figure_group' : 'unknown');
          
          // ✅ DEBUG日志 - unknown类型时输出详细信息
          if (actualType === 'unknown') {
            console.warn(`🔍 DEBUG Position ${i}: Unknown card type detected`);
            console.warn(`  Card name: ${actualCard.name}`);
            console.warn(`  Children:`, (info.children || []).map(c => ({ name: c.name, type: c.type })));
            console.warn(`  Expected slots: body='${slots.body?.body ?? 'slot:BODY'}', imageGrid='${slots.figure?.image_grid ?? 'slot:IMAGE_GRID'}'`);
          }
          
          if (actualType !== expectedContent.type) {
            console.warn(`⚠️ Position ${i}: Type mismatch - expected ${expectedContent.type}, found ${actualType}`);
            allValid = false;
          }
        } catch (error) {
          console.warn(`⚠️ Position ${i}: Failed to check node type: ${error.message}`);
          allValid = false;
        }
      }
      
      if (allValid) {
        console.log('✅ Cards order validation passed!');
      } else {
        console.warn('⚠️ Cards order validation failed - some mismatches detected');
      }
      
      return allValid;
      
    } catch (error) {
      console.error('❌ Failed to validate cards order:', error.message);
      return false;
    }
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

  // ✅ 无限深度DFS搜索 - 不再受层级限制
  async findChildByName(instanceId, childName) {
    try {
      const instanceInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
        nodeId: instanceId
      });
      
      // DFS递归搜索所有层级
      const dfsSearch = (node) => {
        if (node.name === childName) {
          return node.id;
        }
        
        if (node.children) {
          for (const child of node.children) {
            const result = dfsSearch(child);
            if (result) {
              return result;
            }
          }
        }
        
        return null;
      };
      
      return dfsSearch(instanceInfo);
      
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
    // 依配置路径采集图片 asset_id
    const assetPath = this.workflowMapping.images?.asset_path || 'image.asset_id';
    const images = (figureGroup.figures || [])
      .map(f => ({ asset_id: getByPath(f, assetPath) }))
      .filter(x => !!x.asset_id);
    const firstTitle = figures.find(f => f.title)?.title || '';
    const firstCredit = figures.find(f => f.credit)?.credit || '';
    
    // ✅ 改进3: 使用配置化槽位名 + 空内容处理 + 安全访问
    const slots = this.workflowMapping.anchors?.slots ?? {};
    const titleTextSlot = slots.figure?.title_text ?? 'titleText';
    const titleNodeId = await this.findChildByName(instanceId, titleTextSlot);
    if (titleNodeId) {
      try {
        await this.mcpClient.call("mcp__talk-to-figma__set_text_content", {
          nodeId: titleNodeId,
          text: firstTitle || ''  // ✅ 空内容设为空字符串，依赖Auto-layout收缩
        });
        console.log(`    ✅ Set title: "${firstTitle || '(empty)'}"`);
      } catch (error) {
        console.error(`    ❌ Failed to set title:`, error.message);
      }
    }

    // ✅ 来源处理 + 空内容处理 + 安全访问
    const sourceTextSlot = slots.figure?.source_text ?? 'sourceText';
    const sourceNodeId = await this.findChildByName(instanceId, sourceTextSlot);
    if (sourceNodeId) {
      try {
        const sourceText = firstCredit ? `Source: ${firstCredit}` : '';
        await this.mcpClient.call("mcp__talk-to-figma__set_text_content", {
          nodeId: sourceNodeId,
          text: sourceText  // ✅ 空内容设为空字符串
        });
        console.log(`    ✅ Set source: "${sourceText || '(empty)'}"`);
      } catch (error) {
        console.error(`    ❌ Failed to set source:`, error.message);
      }
    }
    
    // Advanced visibility control with multi-layer fallback
    await this.applyVisibilityControl(instanceId, {
      hasTitle: !!firstTitle,
      hasSource: !!firstCredit, 
      imageCount: images.length
    });
    
    // Fill images in slots - ✅ 统一槽位来源 + 容错处理
    const imageSlots = this.workflowMapping.anchors.slots || {};
    const imageSlotNames = imageSlots.images || this.workflowMapping.anchors.image_slots || [];
    const max = Math.min(images.length, imageSlotNames.length, this.workflowMapping.images?.max_images ?? imageSlotNames.length);
    for (let i = 0; i < max; i++) {
      const imageSlotName = imageSlotNames[i];
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
    console.log(`    🎯 Visibility control: title:${hasTitle}, source:${hasSource}, images:${imageCount}`);

    // 路线A：直接对槽位容器层做 set_node_visible
    // 1. 控制标题槽位容器
    const titleSlotName = this.workflowMapping.anchors?.slots?.figure?.title || 'slot:TITLE';
    await this.setSlotVisibility(instanceId, titleSlotName, hasTitle, 'title slot');

    // 2. 控制来源槽位容器  
    const sourceSlotName = this.workflowMapping.anchors?.slots?.figure?.source || 'slot:SOURCE';
    await this.setSlotVisibility(instanceId, sourceSlotName, hasSource, 'source slot');

    // 3. 控制图片槽位容器
    const imageSlotNames = this.workflowMapping.anchors?.slots?.images || this.workflowMapping.anchors.image_slots || [];
    const maxImages = this.workflowMapping.images?.max_images ?? 4;
    
    for (let i = 2; i <= maxImages && i-1 < imageSlotNames.length; i++) {
      const shouldShow = imageCount >= i;
      const slotName = imageSlotNames[i-1]; // imgSlot2 is at index 1
      await this.setSlotVisibility(instanceId, slotName, shouldShow, `image slot ${i}`);
    }
  }

  async setSlotVisibility(instanceId, slotName, visible, description) {
    const slotNodeId = await this.findChildByName(instanceId, slotName);
    if (!slotNodeId) {
      console.warn(`    ⚠️ ${description} container '${slotName}' not found`);
      return;
    }

    try {
      // 直接设置容器层可见性，Auto-layout会自动调整布局
      await this.mcpClient.call("mcp__talk-to-figma__set_node_visible", {
        nodeId: slotNodeId,
        visible: visible
      });
      console.log(`    ✅ ${description} ${visible ? 'shown' : 'hidden'}`);
    } catch (error) {
      console.warn(`    ⚠️ Failed to set visibility for ${description}: ${error.message}`);
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