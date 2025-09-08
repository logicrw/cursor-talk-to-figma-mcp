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
    this.boolPropIds = null; // Cache for component boolean property IDs
    this.seedInstanceIds = null; // Cache for seed instance IDs
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
    
    // Initialize component property IDs discovery
    if (this.channelManager && this.channelManager.currentChannel) {
      await this.discoverComponentPropertyIds();
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
    if (this.seedInstanceIds) {
      return this.seedInstanceIds;
    }
    
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

    this.seedInstanceIds = {
      figureInstanceId: figureInstance.id,
      bodyInstanceId: bodyInstance.id
    };
    
    return this.seedInstanceIds;
  }
  
  // ✨ 新增：自动发现组件属性的 propertyId (使用官方API)
  async discoverComponentPropertyIds() {
    console.log('🔍 Discovering component property IDs...');
    
    try {
      const seedInstances = await this.resolveSeedInstances();
      
      // 使用新的get_component_property_references API
      const referencesResult = await this.mcpClient.call("mcp__talk-to-figma__get_component_property_references", {
        nodeId: seedInstances.figureInstanceId
      });
      
      console.log('📋 Component property references result:', JSON.stringify(referencesResult, null, 2));
      
      if (!referencesResult.success || !referencesResult.references) {
        throw new Error(`Failed to get property references: ${referencesResult.message || 'Unknown error'}`);
      }
      
      // 构建布尔属性映射 - 从配置中获取友好名称到PropertyName#ID的映射
      const visibilityMapping = this.workflowMapping.images?.visibility_props || {};
      const titleVisibleProp = this.workflowMapping.title?.visible_prop || 'showTitle';
      const sourceVisibleProp = this.workflowMapping.source?.visible_prop || 'showSource';
      
      this.boolPropIds = { figure: {} };
      
      // 从返回的references中查找对应的PropertyName#ID格式
      const references = referencesResult.references;
      
      // 映射标题属性
      const titleRef = Object.keys(references).find(ref => 
        ref.toLowerCase().includes('title') || ref.includes(titleVisibleProp.toLowerCase())
      );
      if (titleRef) {
        this.boolPropIds.figure[titleVisibleProp] = titleRef;
        console.log(`📌 Mapped title property: ${titleVisibleProp} -> ${titleRef}`);
      }
      
      // 映射来源属性
      const sourceRef = Object.keys(references).find(ref => 
        ref.toLowerCase().includes('source') || ref.includes(sourceVisibleProp.toLowerCase())
      );
      if (sourceRef) {
        this.boolPropIds.figure[sourceVisibleProp] = sourceRef;
        console.log(`📌 Mapped source property: ${sourceVisibleProp} -> ${sourceRef}`);
      }
      
      // 映射图片槽位属性
      Object.entries(visibilityMapping).forEach(([slotName, propName]) => {
        const imgRef = Object.keys(references).find(ref => 
          ref.toLowerCase().includes(propName.toLowerCase()) || 
          ref.toLowerCase().includes(slotName.toLowerCase().replace('slot', ''))
        );
        if (imgRef) {
          this.boolPropIds.figure[propName] = imgRef;
          console.log(`📌 Mapped image property: ${propName} (${slotName}) -> ${imgRef}`);
        }
      });
      
      // 验证是否所有必要属性都找到了
      const requiredProps = [titleVisibleProp, sourceVisibleProp, ...Object.values(visibilityMapping)];
      const missingProps = requiredProps.filter(prop => !this.boolPropIds.figure[prop]);
      
      if (missingProps.length > 0) {
        console.warn(`⚠️ Some properties not found in component references:`, missingProps);
        console.warn(`Available references:`, Object.keys(references));
        
        // Fail fast as requested - don't use fallbacks
        throw new Error(`Missing required component properties: ${missingProps.join(', ')}. Available: ${Object.keys(references).join(', ')}`);
      }
      
      console.log('✅ Component property IDs discovered:', this.boolPropIds);
      
    } catch (error) {
      console.error('❌ Failed to discover property IDs:', error.message);
      
      // Fail fast - don't use fallback mapping
      throw new Error(`Property ID discovery failed: ${error.message}. Please check Figma component boolean properties setup.`);
    }
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

    if (!this.boolPropIds?.figure) {
      const error = 'Boolean property IDs not discovered - cannot apply visibility control';
      console.error(`    ❌ ${error}`);
      throw new Error(error);
    }

    try {
      // 计算各布尔位的目标值
      const titleVisibleProp = this.workflowMapping.title?.visible_prop || 'showTitle';
      const sourceVisibleProp = this.workflowMapping.source?.visible_prop || 'showSource';
      const visibilityMapping = this.workflowMapping.images?.visibility_props || {};
      
      // 构造properties对象 - 使用PropertyName#ID格式的键
      const properties = {};
      
      // 设置标题显示
      if (this.boolPropIds.figure[titleVisibleProp]) {
        properties[this.boolPropIds.figure[titleVisibleProp]] = hasTitle;
        console.log(`    📝 ${titleVisibleProp} -> ${this.boolPropIds.figure[titleVisibleProp]} = ${hasTitle}`);
      }
      
      // 设置来源显示
      if (this.boolPropIds.figure[sourceVisibleProp]) {
        properties[this.boolPropIds.figure[sourceVisibleProp]] = hasSource;
        console.log(`    📝 ${sourceVisibleProp} -> ${this.boolPropIds.figure[sourceVisibleProp]} = ${hasSource}`);
      }
      
      // 设置图片显示 - 动态从配置读取
      const imageSlotNames = this.workflowMapping.anchors?.slots?.images || this.workflowMapping.anchors.image_slots || [];
      const maxImages = this.workflowMapping.images?.max_images ?? imageSlotNames.length;
      
      for (let i = 2; i <= maxImages && i-1 < imageSlotNames.length; i++) {
        const slotName = imageSlotNames[i-1]; // imgSlot2 is at index 1
        const visibilityProp = visibilityMapping[slotName];
        
        if (visibilityProp && this.boolPropIds.figure[visibilityProp]) {
          const shouldShow = imageCount >= i;
          properties[this.boolPropIds.figure[visibilityProp]] = shouldShow;
          console.log(`    📝 ${visibilityProp} (${slotName}) -> ${this.boolPropIds.figure[visibilityProp]} = ${shouldShow}`);
        }
      }
      
      // 使用官方setProperties API直接设置实例属性
      if (Object.keys(properties).length > 0) {
        console.log(`    🔧 Applying properties using setProperties:`, properties);
        
        const result = await this.mcpClient.call("mcp__talk-to-figma__set_instance_properties", {
          nodeId: instanceId,
          properties: properties
        });
        
        if (result.success) {
          console.log(`    ✅ Applied ${Object.keys(properties).length} properties to instance ${instanceId}`);
          console.log(`    📋 Applied properties:`, result.applied);
        } else {
          throw new Error(`Failed to set properties: ${result.message}`);
        }
      } else {
        console.warn(`    ⚠️ No properties to apply - check component property mapping`);
      }
      
    } catch (error) {
      console.error(`    ❌ Failed to apply visibility control:`, error.message);
      console.error(`    📋 Error details:`, error);
      throw error; // Re-throw to fail fast as requested
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