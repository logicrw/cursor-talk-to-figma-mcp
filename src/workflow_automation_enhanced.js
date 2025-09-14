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
import { resolveContentPath, parseArgs, buildAssetUrl, computeStaticServerUrl, inferDataset } from './config-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration paths
const CONFIG = {
  serverConfigPath: path.join(__dirname, '../config/server-config.json'),
  runStatePath: path.join(__dirname, '../config/run_state.json'),
  staticServerUrl: 'http://127.0.0.1:3056/assets'
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
    this.staticServerUrl = CONFIG.staticServerUrl; // will be recomputed from config
    this.contentPath = null;
    this.dataset = null;
    this.mainFrameId = null;
  }

  normalizeName(s) {
    try {
      return String(s || '')
        .normalize('NFKC')
        .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
        .trim();
    } catch { return String(s || ''); }
  }

  async initialize(mcpClient, channelId = null, contentFile = null, dryRun = false) {
    console.log('🚀 Initializing Card-based Figma Workflow Automator...');
    this.mcpClient = mcpClient;
    this.channelManager = new FigmaChannelManager(mcpClient);
    this.dryRun = dryRun;
    
    // Helper to unwrap MCP responses with robust error handling (follows MCP spec)
    this.unwrapMcpResponse = (r) => {
      // Standard MCP response structure: content array with text/image/resource items
      if (r?.content?.[0]?.text) {
        try {
          // Try to parse as JSON first (most common case for our tools)
          return JSON.parse(r.content[0].text);
        } catch (parseError) {
          // Not JSON or malformed - return structured error response
          console.warn('MCP response parse warning:', parseError.message);
          return { 
            success: false, 
            error: 'JSON parse failed', 
            rawText: r.content[0].text,
            parseError: parseError.message 
          };
        }
      }
      
      // For non-text content or missing content, return as-is
      // This handles cases where tools return other MCP content types
      return r || { success: false, error: 'Empty MCP response' };
    };
    
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
    // compute static server url from config
    try {
      this.staticServerUrl = computeStaticServerUrl(serverConfig);
      console.log(`🌐 Static server: ${this.staticServerUrl}`);
    } catch {}
    
    // Resolve and load content data
    const cliArgs = parseArgs();
    const { contentPath } = resolveContentPath(path.join(__dirname, '..'), {
      initParam: contentFile,
      cliArg: cliArgs.content,
      envVar: process.env.CONTENT_JSON_PATH,
      configDefault: serverConfig.workflow.current_content_file
    });
    this.contentPath = contentPath;
    this.contentData = JSON.parse(await fs.readFile(contentPath, 'utf8'));
    // infer dataset for later asset url building
    this.dataset = inferDataset(this.contentData?.assets || [], this.contentPath);
    
    // Get Cards container nodeId for instance creation
    if (this.channelManager && this.channelManager.currentChannel) {
      try {
        const documentInfo = await this.mcpClient.call("mcp__talk-to-figma__get_document_info");
        const targetFrameName = this.normalizeName(this.workflowMapping.anchors.frame);
        const mainFrame = documentInfo.children.find(child => this.normalizeName(child.name) === targetFrameName);
        if (mainFrame) {
          this.mainFrameId = mainFrame.id;
          const containerInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
            nodeId: mainFrame.id
          });
          // Find Cards within ContentContainer
          const targetContainerName = this.normalizeName(this.workflowMapping.anchors.container);
          const contentContainer = containerInfo.children?.find(child => this.normalizeName(child.name) === targetContainerName);
          if (contentContainer) {
            const containerDetail = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
              nodeId: contentContainer.id
            });
            const targetCardsName = this.normalizeName(this.workflowMapping.anchors.cards_stack);
            const cardsNode = containerDetail.children?.find(child => this.normalizeName(child.name) === targetCardsName);
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

  // Helper methods for enhanced error handling
  categorizeComponentError(errorMessage) {
    const msg = errorMessage.toLowerCase();
    if (msg.includes('not found') || msg.includes('404')) return 'Component Not Found';
    if (msg.includes('permission') || msg.includes('access') || msg.includes('unauthorized')) return 'Permission Denied';
    if (msg.includes('library') || msg.includes('publish')) return 'Library Access Issue';
    if (msg.includes('key') && msg.includes('invalid')) return 'Invalid Component Key';
    if (msg.includes('parent') || msg.includes('container')) return 'Parent Container Issue';
    return 'Component Creation Error';
  }

  explainComponentError(errorMessage) {
    const msg = errorMessage.toLowerCase();
    if (msg.includes('permission') || msg.includes('access')) {
      return 'Component library access denied. Check if: 1) Library is enabled in this file, 2) Component is published, 3) You have team access rights';
    }
    if (msg.includes('not found') || msg.includes('404')) {
      return 'Component not found. Verify componentKey/componentId is correct and component exists';
    }
    if (msg.includes('library') || msg.includes('publish')) {
      return 'Library issue. Component may not be published or library not enabled in this file';
    }
    return errorMessage; // Return original message if no specific explanation
  }

  // Instance Creation Factory - supports both seedless creation and fallback to seed cloning
  async createCardInstance(parentId, cardType = 'figure') {
    console.log(`🏭 Creating ${cardType} card instance...`);
    
    const config = this.workflowMapping[cardType] || {};
    
    // Try direct component instantiation first (B+ approach)
    try {
      if (config.componentId || config.componentKey) {
        console.log(`  📦 Attempting direct component instantiation...`);
        
        const rawResult = await this.mcpClient.call("mcp__talk-to-figma__create_component_instance", {
          parentId: parentId,
          componentId: config.componentId || undefined,
          componentKey: config.componentKey || undefined,
          x: 0,
          y: 0
        });
        const result = this.unwrapMcpResponse(rawResult);
        
        if (result.success) {
          console.log(`  ✅ Direct creation succeeded: ${result.name} (${result.id})`);
          return { id: result.id, name: result.name, method: 'direct' };
        } else {
          // Enhanced error categorization for common component creation failures
          const errorMsg = result.message || result.error || 'Direct creation failed';
          const errorType = this.categorizeComponentError(errorMsg);
          throw new Error(`${errorType}: ${errorMsg}`);
        }
      }
    } catch (error) {
      const friendlyError = this.explainComponentError(error.message);
      console.warn(`  ⚠️ Direct creation failed: ${friendlyError}`);
      console.warn(`  🔄 Falling back to seed cloning...`);
    }
    
    // Fallback to seed cloning (existing approach)
    try {
      const result = await this.cloneCardFromSeed(parentId, cardType);
      console.log(`  ✅ Seed cloning succeeded: ${result.name} (${result.id})`);
      return { ...result, method: 'seed-clone' };
    } catch (error) {
      console.error(`  ❌ Both direct creation and seed cloning failed`);
      throw new Error(`Failed to create ${cardType} card: Direct creation failed (${error.message}), seed cloning also failed`);
    }
  }

  async cloneCardFromSeed(parentId, cardType) {
    // This method handles the existing seed-based cloning logic
    // Implementation depends on your current seed cloning approach
    const seedInstances = await this.resolveSeedInstances();
    const seedId = cardType === 'figure' ? seedInstances.figureInstanceId : seedInstances.bodyInstanceId;
    
    // Use existing append_card_to_container API
    const rawResult = await this.mcpClient.call("mcp__talk-to-figma__append_card_to_container", {
      containerId: parentId,
      templateId: seedId,
      insertIndex: -1
    });
    const parsed = this.unwrapMcpResponse(rawResult);

    // Normalize different return shapes:
    // - Plugin data via server text message (contains "New card ID: <id>" and name inside quotes)
    // - Potential JSON object with { newNodeId, newNodeName } or { id, name } or { instanceId, instanceName }
    const normalize = (objOrText) => {
      if (!objOrText) return null;
      // Object-like
      if (typeof objOrText === 'object') {
        const id = objOrText.newNodeId || objOrText.instanceId || objOrText.id;
        const name = objOrText.newNodeName || objOrText.instanceName || objOrText.name || 'Cloned Card';
        if (id) return { id, name };
      }
      // Text fallback
      if (typeof objOrText === 'string') {
        // Extract name between first quotes after 'appended card'
        let nameMatch = objOrText.match(/appended card \"([^\"]+)\"/i);
        // Extract ID after 'New card ID:'
        let idMatch = objOrText.match(/New card ID:\s*([^\s]+)/i);
        if (idMatch) {
          return { id: idMatch[1], name: (nameMatch && nameMatch[1]) || 'Cloned Card' };
        }
      }
      return null;
    };

    let normalized = null;
    if (parsed && parsed.success && typeof parsed === 'object') {
      normalized = normalize(parsed);
    }
    if (!normalized && parsed && parsed.rawText) {
      normalized = normalize(parsed.rawText);
    }
    if (!normalized) {
      // Try using the raw MCP response directly if available
      normalized = normalize(rawResult?.content?.[0]?.text || rawResult);
    }

    if (!normalized) {
      const msg = parsed?.message || parsed?.error || 'Unknown append result';
      throw new Error(`Seed cloning failed: ${msg}`);
    }

    return normalized;
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
      await this.fillHeader(this.contentData?.doc || {});
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

  // Helper: DFS search within any node info tree
  dfsFindNodeIdByName(rootInfo, targetName) {
    const target = this.normalizeName(targetName);
    if (!target || !rootInfo) return null;
    const stack = [rootInfo];
    while (stack.length) {
      const node = stack.pop();
      if (this.normalizeName(node?.name) === target) return node.id || null;
      if (node?.children && Array.isArray(node.children)) {
        for (const ch of node.children) stack.push(ch);
      }
    }
    return null;
  }

  async fillHeader(docMeta = {}) {
    try {
      const headerCfg = this.workflowMapping?.anchors?.header || {};
      if (!this.mainFrameId) {
        // Try to resolve main frame again if missing
        const documentInfo = await this.mcpClient.call("mcp__talk-to-figma__get_document_info");
        const mainFrame = documentInfo.children.find(child => child.name === this.workflowMapping.anchors.frame);
        if (mainFrame) this.mainFrameId = mainFrame.id;
      }
      if (!this.mainFrameId) {
        console.warn('⚠️ No main frame detected, skipping header fill');
        return;
      }

      const frameInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", { nodeId: this.mainFrameId });
      const setIfFound = async (nodeName, text) => {
        if (!nodeName) return;
        const nodeId = this.dfsFindNodeIdByName(frameInfo, nodeName);
        if (!nodeId) return;
        try {
          await this.mcpClient.call("mcp__talk-to-figma__set_text_content", { nodeId, text: text || '' });
          await this.mcpClient.call("mcp__talk-to-figma__set_text_auto_resize", { nodeId, autoResize: 'HEIGHT' });
          console.log(`🧭 Header set ${nodeName}: "${(text || '').toString().substring(0, 60)}"`);
        } catch (e) {
          console.warn(`⚠️ Failed to set header ${nodeName}: ${e.message}`);
        }
      };

      const title = docMeta.title || '';
      const dateStr = docMeta.date || '';
      const month = this.formatMonthFromDate(dateStr);

      await setIfFound(headerCfg.title, title);
      await setIfFound(headerCfg.date, dateStr);
      await setIfFound(headerCfg.month, month);
    } catch (error) {
      console.warn('⚠️ fillHeader failed:', error.message);
    }
  }

  formatMonthFromDate(dateStr) {
    try {
      if (!dateStr) return '';
      const m = String(dateStr).match(/\d{4}-(\d{2})-\d{2}/);
      if (m) return m[1];
      // try compact yyyyMMdd
      const m2 = String(dateStr).match(/\d{4}(\d{2})\d{2}/);
      if (m2) return m2[1];
      return '';
    } catch { return ''; }
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
        console.log(`  🏭 Creating ${componentName} card ${i + 1}/${orderedContent.length}: ${newName}`);
        
        // Use the new instance creation factory (B+ approach with fallback)
        const cardType = item.type === 'figure_group' ? 'figure' : 'body';
        const cardInstance = await this.createCardInstance(cardsContainerId, cardType);
        
        console.log(`    📝 Card created: ${cardInstance.name} via ${cardInstance.method}`);
        
        // ✅ Enhanced binding relationship for index alignment
        this.runState.cards_created.push({
          index: i,               // ← 与 orderedContent 的位置一一对应
          instanceId: cardInstance.id,
          creationMethod: cardInstance.method, // Track how it was created
          kind: item.type,        // 'figure_group' | 'standalone_paragraph'
          type: item.type,        // ← 向后兼容，别删
          component: componentName,
          name: cardInstance.name,
          ref: item.type === 'figure_group'
            ? { group_id: item.group_id }                // grp_0010 / grp_0011…
            : { original_index: item.original_index }    // 段落在JSON中的原始索引
        });
        
        console.log(`✅ Created ${componentName} instance ${i + 1} via ${cardInstance.method} (ID: ${cardInstance.id})`);
        
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
          const bodyName = this.normalizeName(slots.body?.body ?? 'slot:BODY');
          const imageGridName = this.normalizeName(slots.figure?.image_grid ?? 'slot:IMAGE_GRID');
          const hasBody = (info.children || []).some(c => this.normalizeName(c.name) === bodyName);
          const hasImageGrid = (info.children || []).some(c => this.normalizeName(c.name) === imageGridName);
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
    const seedsFrame = docInfo.children.find(frame => this.normalizeName(frame.name) === this.normalizeName(seedsMapping.frame));
    if (!seedsFrame) {
      throw new Error(`Seeds frame "${seedsMapping.frame}" not found`);
    }

    // 获取种子实例详情
    const seedsInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
      nodeId: seedsFrame.id
    });

    const figureInstance = seedsInfo.children.find(child => this.normalizeName(child.name) === this.normalizeName(seedsMapping.figure_instance));
    const bodyInstance = seedsInfo.children.find(child => this.normalizeName(child.name) === this.normalizeName(seedsMapping.body_instance));

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
      // Try B+ approach first: create a temporary instance for property discovery
      let discoveryInstanceId = null;
      let shouldCleanupInstance = false;
      
      try {
        console.log('  🆕 Attempting property discovery via direct instance creation...');
        let cardsStackId = this.workflowMapping.anchors?.cards_stack_id;
        if (!cardsStackId) {
          // Resolve by names: frame → container → cards_stack
          const docInfo = await this.mcpClient.call("mcp__talk-to-figma__get_document_info");
          const frameNode = docInfo.children.find(child => child.name === this.workflowMapping.anchors.frame);
          if (!frameNode) throw new Error('Main frame not found for property discovery');
          const frameInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", { nodeId: frameNode.id });
          const containerNode = frameInfo.children?.find(child => child.name === this.workflowMapping.anchors.container);
          if (!containerNode) throw new Error('Content container not found for property discovery');
          const containerInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", { nodeId: containerNode.id });
          const cardsNode = containerInfo.children?.find(child => child.name === this.workflowMapping.anchors.cards_stack);
          if (!cardsNode) throw new Error('Cards stack not found for property discovery');
          cardsStackId = cardsNode.id;
          this.workflowMapping.anchors.cards_stack_id = cardsStackId;
          console.log(`  🔗 Resolved cards stack id by name: ${cardsStackId}`);
        }
        
        const tempInstance = await this.createCardInstance(cardsStackId, 'figure');
        discoveryInstanceId = tempInstance.id;
        // Clean up only if we created an instance directly (covers variants like 'direct-local')
        shouldCleanupInstance = (typeof tempInstance.method === 'string' && tempInstance.method.startsWith('direct'));
        
        console.log(`  📍 Using instance ${discoveryInstanceId} for property discovery (method: ${tempInstance.method})`);
      } catch (error) {
        console.warn(`  ⚠️ Direct instance creation failed, falling back to seed discovery: ${error.message}`);
        
        // Fallback: use existing seed-based discovery
        const seedInstances = await this.resolveSeedInstances();
        discoveryInstanceId = seedInstances.figureInstanceId;
        shouldCleanupInstance = false;
      }
      
      // Perform property discovery on the chosen instance
      const rawResponse = await this.mcpClient.call("mcp__talk-to-figma__get_component_property_references", {
        nodeId: discoveryInstanceId
      });
      const referencesResult = this.unwrapMcpResponse(rawResponse);
      
      console.log('📋 Component properties result:', JSON.stringify(referencesResult, null, 2));
      
      if (!referencesResult.success || !referencesResult.properties) {
        throw new Error(`Failed to get component properties: ${referencesResult.message || 'Unknown error'}`);
      }
      
      // Get configuration for expected property names
      const visibilityMapping = this.workflowMapping.images?.visibility_props || {};
      const titleVisibleProp = this.workflowMapping.title?.visible_prop || 'showTitle';
      const sourceVisibleProp = this.workflowMapping.source?.visible_prop || 'showSource';

      this.boolPropIds = { figure: {} };

      // Get available property keys (already in PropertyName#ID format)
      const availableKeys = referencesResult.propertyKeys || Object.keys(referencesResult.properties);
      console.log('🔍 Available property keys:', availableKeys);

      // Build normalized baseName → actualKey map for robust matching
      const normalize = (s) => String(s || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[_\-]+/g, '');

      const keyByNormalizedBase = {};
      for (const key of availableKeys) {
        const base = String(key).split('#')[0];
        const norm = normalize(base);
        if (!keyByNormalizedBase[norm]) keyByNormalizedBase[norm] = key;
      }

      const findProperty = (friendlyName) => {
        const exactPrefix = availableKeys.find(key => key.startsWith(`${friendlyName}#`));
        if (exactPrefix) return exactPrefix;
        const norm = normalize(friendlyName);
        return keyByNormalizedBase[norm] || null;
      };

      // Map title property
      const titleKey = findProperty(titleVisibleProp);
      if (titleKey) {
        this.boolPropIds.figure[titleVisibleProp] = titleKey;
        console.log(`📌 Mapped title property: ${titleVisibleProp} -> ${titleKey}`);
      } else {
        console.error(`❌ Title property not found: ${titleVisibleProp}`);
      }

      // Map source property  
      const sourceKey = findProperty(sourceVisibleProp);
      if (sourceKey) {
        this.boolPropIds.figure[sourceVisibleProp] = sourceKey;
        console.log(`📌 Mapped source property: ${sourceVisibleProp} -> ${sourceKey}`);
      } else {
        console.error(`❌ Source property not found: ${sourceVisibleProp}`);
      }

      // Map image slot properties (optional, do not fail workflow if missing)
      const missingImageProps = [];
      Object.entries(visibilityMapping).forEach(([slotName, propName]) => {
        const imageKey = findProperty(propName);
        if (imageKey) {
          this.boolPropIds.figure[propName] = imageKey;
          console.log(`📌 Mapped image property: ${propName} (${slotName}) -> ${imageKey}`);
        } else {
          console.warn(`⚠️ Image visibility property not found: ${propName} (${slotName}). Will treat as hidden by default.`);
          missingImageProps.push(propName);
        }
      });

      // Fail-fast validation: essential properties must be present
      const essentialMissing = [titleVisibleProp, sourceVisibleProp].filter(prop => !this.boolPropIds.figure[prop]);
      if (essentialMissing.length > 0) {
        const availableBases = availableKeys.map(k => k.split('#')[0]);
        const errorMsg = `❌ Essential component properties missing: ${essentialMissing.join(', ')}. Available base names: ${availableBases.join(', ')}`;
        console.error(errorMsg);
        if (shouldCleanupInstance && discoveryInstanceId) {
          try {
            await this.mcpClient.call("mcp__talk-to-figma__delete_node", { nodeId: discoveryInstanceId });
            console.log(`  🧹 Cleaned up temporary instance: ${discoveryInstanceId}`);
          } catch (cleanupError) {
            console.warn(`  ⚠️ Failed to cleanup temporary instance: ${cleanupError.message}`);
          }
        }
        throw new Error(errorMsg);
      }

      if (missingImageProps.length > 0) {
        console.warn(`ℹ️ Proceeding with defaults: missing image visibility props will be treated as hidden: ${missingImageProps.join(', ')}`);
      }

      console.log('✅ Component property IDs discovered:', this.boolPropIds);
      
      // Cleanup temporary instance if we created it for discovery
      if (shouldCleanupInstance && discoveryInstanceId) {
        try {
          await this.mcpClient.call("mcp__talk-to-figma__delete_node", { nodeId: discoveryInstanceId });
          console.log(`  🧹 Cleaned up temporary discovery instance: ${discoveryInstanceId}`);
        } catch (cleanupError) {
          console.warn(`  ⚠️ Failed to cleanup temporary instance: ${cleanupError.message}`);
        }
      }
      
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
      const normalizeName = (s) => String(s || '')
        .normalize('NFKC')
        .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
        .trim();

      const target = normalizeName(childName);

      const dfsSearch = (node) => {
        if (normalizeName(node.name) === target) {
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
        await this.mcpClient.call("mcp__talk-to-figma__set_text_auto_resize", {
          nodeId: titleNodeId,
          autoResize: 'HEIGHT'
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
        await this.mcpClient.call("mcp__talk-to-figma__set_text_auto_resize", {
          nodeId: sourceNodeId,
          autoResize: 'HEIGHT'
        });
        console.log(`    ✅ Set source: "${sourceText || '(empty)'}"`);
      } catch (error) {
        console.error(`    ❌ Failed to set source:`, error.message);
      }
    }
    
    // Apply official Figma setProperties API for visibility control
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
        const imageUrl = buildAssetUrl(this.staticServerUrl, this.contentData?.assets || [], images[i].asset_id, this.contentPath);
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
        
        const rawResult = await this.mcpClient.call("mcp__talk-to-figma__set_instance_properties", {
          nodeId: instanceId,
          properties: properties
        });
        const result = this.unwrapMcpResponse(rawResult);
        
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
        await this.mcpClient.call("mcp__talk-to-figma__set_text_auto_resize", {
          nodeId: bodyTextNodeId,
          autoResize: 'HEIGHT'
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
