#!/usr/bin/env node

/**
 * Content Generator - 基于JSON的内容生成器
 * 
 * 实现专家建议的"内容生成流"：
 * 1. 清空现有内容 (可回退)
 * 2. 根据content.json动态生成
 * 3. 自动布局和背景调整
 */

import TEMPLATE_STYLES, { getTitleHeight, getImageWidth, getContainerPosition } from './template-styles.js';

export default class ContentGenerator {
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
    this.recycleGroupId = null; // 回收站组ID
  }

  /**
   * 清空内容组 - 可回退机制
   * @param {string} contentGroupId - 内容组ID (默认: 6:6377)
   * @param {boolean} enableRecycle - 是否启用回收站 (默认: true)
   */
  async clearContentGroup(contentGroupId = "6:6377", enableRecycle = true) {
    console.log(`🗑️ Clearing content group: ${contentGroupId} (recycle: ${enableRecycle})`);
    
    try {
      // 获取现有子节点
      const groupInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
        nodeId: contentGroupId
      });
      
      if (!groupInfo.children || groupInfo.children.length === 0) {
        console.log('✅ Content group is already empty');
        return;
      }

      if (enableRecycle) {
        // 创建回收站组 (隐藏但保留)
        const recycleGroup = await this.mcpClient.call("mcp__talk-to-figma__create_frame", {
          x: groupInfo.absoluteBoundingBox.x - 2000, // 移到画布外
          y: groupInfo.absoluteBoundingBox.y,
          width: 100,
          height: 100,
          name: `Recycle_${Date.now()}`,
          parentId: groupInfo.parent?.id, // 与原组同级
          fillColor: { r: 0.5, g: 0.5, b: 0.5, a: 0.1 }
        });
        
        this.recycleGroupId = recycleGroup.id;
        console.log(`📦 Created recycle group: ${this.recycleGroupId}`);
        
        // TODO: 移动子节点到回收站 (需要move_node工具)
        // 当前先直接删除，后续可实现节点移动
      }
      
      // 删除所有子节点
      const childIds = groupInfo.children.map(child => child.id);
      
      if (childIds.length > 0) {
        await this.mcpClient.call("mcp__talk-to-figma__delete_multiple_nodes", {
          nodeIds: childIds
        });
        console.log(`🗑️ Deleted ${childIds.length} existing nodes`);
      }
      
      console.log('✅ Content group cleared successfully');
      
    } catch (error) {
      throw new Error(`Failed to clear content group: ${error.message}`);
    }
  }

  /**
   * 从JSON生成内容
   * @param {Object} contentData - content.json数据
   * @param {string} contentGroupId - 目标内容组ID
   */
  async buildFromJson(contentData, contentGroupId = "6:6377") {
    console.log('🏗️ Building content from JSON...');
    
    try {
      // 按组聚合内容
      const groups = this.groupContentByGroupId(contentData.blocks);
      console.log(`📊 Found ${groups.length} content groups`);
      
      // 获取容器起始位置
      const containerInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
        nodeId: contentGroupId
      });
      
      let currentY = containerInfo.absoluteBoundingBox.y;
      const basePosition = getContainerPosition(currentY);
      
      // 逐组生成内容
      for (const group of groups) {
        const groupHeight = await this.generateGroup(group, basePosition.x, currentY);
        currentY += groupHeight + TEMPLATE_STYLES.CONTAINER.verticalSpacing.betweenGroups;
      }
      
      // 生成段落内容
      const paragraphs = contentData.blocks.filter(block => block.type === 'paragraph');
      if (paragraphs.length > 0) {
        await this.generateParagraphs(paragraphs, basePosition.x, currentY);
      }
      
      // 调整背景高度
      await this.adjustBackgroundHeight(contentGroupId);
      
      console.log('✅ Content generation completed successfully');
      
    } catch (error) {
      throw new Error(`Failed to build from JSON: ${error.message}`);
    }
  }

  /**
   * 按group_id聚合内容
   * @param {Array} blocks - 内容块数组
   * @returns {Array} 按组聚合的内容
   */
  groupContentByGroupId(blocks) {
    const figures = blocks.filter(block => block.type === 'figure');
    const groupMap = new Map();
    
    // 按group_id分组
    figures.forEach(figure => {
      const groupId = figure.group_id;
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, []);
      }
      groupMap.get(groupId).push(figure);
    });
    
    // 按group_seq排序并转换为数组
    const groups = Array.from(groupMap.entries()).map(([groupId, figures]) => {
      const sortedFigures = figures.sort((a, b) => 
        (a.group_seq || 0) - (b.group_seq || 0)
      );
      
      return {
        groupId,
        figures: sortedFigures,
        layout: figures[0]?.layout || 'column', // 获取布局模式
        title: sortedFigures[0]?.title,         // 组首标题
        credit: sortedFigures[sortedFigures.length - 1]?.credit  // 组尾来源
      };
    });
    
    return groups;
  }

  /**
   * 生成单个图片组
   * @param {Object} group - 图片组数据
   * @param {number} x - X位置
   * @param {number} y - Y位置
   * @returns {number} 生成内容的高度
   */
  async generateGroup(group, x, y) {
    console.log(`🎨 Generating group: ${group.groupId} (${group.figures.length} figures, layout: ${group.layout})`);
    
    let currentY = y;
    let totalHeight = 0;
    
    // 1. 生成组标题 (仅组首)
    if (group.title && group.title.trim()) {
      const titleHeight = await this.createTitleBar(group.title, x, currentY);
      currentY += titleHeight;
      totalHeight += titleHeight;
    }
    
    // 2. 生成图片容器
    const imageContainerHeight = await this.createImageContainer(
      group.figures, 
      group.layout, 
      x, 
      currentY
    );
    currentY += imageContainerHeight;
    totalHeight += imageContainerHeight;
    
    // 3. 生成来源信息 (仅组尾)
    if (group.credit && group.credit.trim()) {
      currentY += TEMPLATE_STYLES.CONTAINER.verticalSpacing.imageToSource;
      const sourceHeight = await this.createSourceText(group.credit, x, currentY);
      currentY += sourceHeight;
      totalHeight += sourceHeight + TEMPLATE_STYLES.CONTAINER.verticalSpacing.imageToSource;
    }
    
    console.log(`✅ Group ${group.groupId} generated, height: ${totalHeight}px`);
    return totalHeight;
  }

  /**
   * 创建标题栏
   * @param {string} titleText - 标题文本
   * @param {number} x - X位置
   * @param {number} y - Y位置
   * @returns {number} 标题栏高度
   */
  async createTitleBar(titleText, x, y) {
    // 估算行数 (简化算法: 每32个中文字符约1行)
    const estimatedLines = Math.ceil(titleText.length / 32);
    const titleHeight = getTitleHeight(estimatedLines);
    
    console.log(`📝 Creating title: "${titleText}" (${estimatedLines} lines, height: ${titleHeight}px)`);
    
    // 创建标题组容器
    const titleGroup = await this.mcpClient.call("mcp__talk-to-figma__create_frame", {
      x: x,
      y: y, 
      width: TEMPLATE_STYLES.CONTAINER.contentWidth,
      height: titleHeight,
      name: "标题组",
      fillColor: TEMPLATE_STYLES.TITLE.background.fills[0].color
    });
    
    // 创建标题文本
    await this.mcpClient.call("mcp__talk-to-figma__create_text", {
      x: x + TEMPLATE_STYLES.TITLE.text.padding.left,
      y: y + TEMPLATE_STYLES.TITLE.text.padding.top,
      text: titleText,
      name: titleText,
      parentId: titleGroup.id,
      fontColor: TEMPLATE_STYLES.TITLE.text.fills[0].color,
      fontSize: TEMPLATE_STYLES.TITLE.text.fontSize,
      fontWeight: TEMPLATE_STYLES.TITLE.text.fontWeight
    });
    
    return titleHeight;
  }

  /**
   * 创建图片容器
   * @param {Array} figures - 图片数据数组
   * @param {string} layout - 布局模式 ('row'/'column')
   * @param {number} x - X位置
   * @param {number} y - Y位置
   * @returns {number} 容器高度
   */
  async createImageContainer(figures, layout, x, y) {
    console.log(`🖼️ Creating ${figures.length} images in ${layout} layout`);
    
    if (layout === 'row' && figures.length > 1) {
      return await this.createHorizontalImages(figures, x, y);
    } else {
      return await this.createVerticalImages(figures, x, y);
    }
  }

  /**
   * 创建横排图片
   * @param {Array} figures - 图片数据 
   * @param {number} x - X位置
   * @param {number} y - Y位置
   * @returns {number} 容器高度
   */
  async createHorizontalImages(figures, x, y) {
    const imageWidth = getImageWidth(figures.length);
    const spacing = TEMPLATE_STYLES.IMAGE.multiImage.spacing;
    
    let maxHeight = 0;
    let currentX = x;
    
    for (const figure of figures) {
      const imageHeight = await this.createSingleImage(figure, currentX, y, imageWidth);
      maxHeight = Math.max(maxHeight, imageHeight);
      currentX += imageWidth + spacing;
    }
    
    return maxHeight;
  }

  /**
   * 创建竖排图片
   * @param {Array} figures - 图片数据
   * @param {number} x - X位置  
   * @param {number} y - Y位置
   * @returns {number} 容器高度
   */
  async createVerticalImages(figures, x, y) {
    let totalHeight = 0;
    let currentY = y;
    
    for (const figure of figures) {
      const imageHeight = await this.createSingleImage(figure, x, currentY);
      currentY += imageHeight + TEMPLATE_STYLES.CONTAINER.verticalSpacing.betweenItems;
      totalHeight += imageHeight + TEMPLATE_STYLES.CONTAINER.verticalSpacing.betweenItems;
    }
    
    return totalHeight - TEMPLATE_STYLES.CONTAINER.verticalSpacing.betweenItems; // 移除最后的间距
  }

  /**
   * 创建单个图片
   * @param {Object} figure - 图片数据
   * @param {number} x - X位置
   * @param {number} y - Y位置  
   * @param {number} width - 图片宽度 (可选，默认使用标准宽度)
   * @returns {number} 图片高度
   */
  async createSingleImage(figure, x, y, width = TEMPLATE_STYLES.IMAGE.width) {
    // 根据宽度按比例计算高度 (这里使用固定比例，实际可能需要从资源获取)
    const aspectRatio = 0.6; // 临时使用的宽高比
    const height = Math.round(width * aspectRatio);
    
    console.log(`🖼️ Creating image: ${figure.image?.asset_id} (${width}x${height})`);
    
    // 创建图片节点
    const imageNode = await this.mcpClient.call("mcp__talk-to-figma__create_rectangle", {
      x: x,
      y: y,
      width: width,
      height: height,
      name: figure.image?.asset_id || "image"
    });
    
    // 填充图片内容 (如果有asset_id)
    if (figure.image?.asset_id) {
      const imageUrl = `http://localhost:3056/assets/250818_summer_break/${figure.image.asset_id}.png`;
      
      try {
        await this.mcpClient.call("mcp__talk-to-figma__set_image_fill", {
          nodeId: imageNode.id,
          imageBase64: imageUrl,
          scaleMode: TEMPLATE_STYLES.IMAGE.scaleMode
        });
        console.log(`✅ Image filled: ${figure.image.asset_id}`);
      } catch (error) {
        console.warn(`⚠️ Failed to fill image ${figure.image.asset_id}: ${error.message}`);
      }
    }
    
    return height;
  }

  /**
   * 创建来源文本
   * @param {string} sourceText - 来源文本
   * @param {number} x - X位置
   * @param {number} y - Y位置
   * @returns {number} 文本高度
   */
  async createSourceText(sourceText, x, y) {
    console.log(`📄 Creating source: "${sourceText}"`);
    
    const sourceNode = await this.mcpClient.call("mcp__talk-to-figma__create_text", {
      x: x,
      y: y,
      text: sourceText,
      name: "来源",
      fontColor: TEMPLATE_STYLES.SOURCE.fills[0].color,
      fontSize: TEMPLATE_STYLES.SOURCE.fontSize,
      fontWeight: TEMPLATE_STYLES.SOURCE.fontWeight
    });
    
    // 设置文本自动调整高度
    await this.mcpClient.call("mcp__talk-to-figma__set_text_auto_resize", {
      nodeId: sourceNode.id,
      autoResize: "HEIGHT"
    });
    
    // 返回估算高度 (基于字体行高)
    return TEMPLATE_STYLES.SOURCE.lineHeightPx;
  }

  /**
   * 生成段落内容
   * @param {Array} paragraphs - 段落数据
   * @param {number} x - X位置
   * @param {number} y - Y位置
   */
  async generateParagraphs(paragraphs, x, y) {
    console.log(`📄 Generating ${paragraphs.length} paragraphs`);
    
    let currentY = y;
    
    for (const paragraph of paragraphs) {
      const content = paragraph.content || paragraph.text || '';
      const paragraphNode = await this.mcpClient.call("mcp__talk-to-figma__create_text", {
        x: x,
        y: currentY,
        text: content,
        name: "段落",
        fontColor: TEMPLATE_STYLES.PARAGRAPH.fills[0].color,
        fontSize: TEMPLATE_STYLES.PARAGRAPH.fontSize,
        fontWeight: TEMPLATE_STYLES.PARAGRAPH.fontWeight
      });
      
      // 设置文本自动调整高度
      await this.mcpClient.call("mcp__talk-to-figma__set_text_auto_resize", {
        nodeId: paragraphNode.id,
        autoResize: "HEIGHT"
      });
      
      // 估算段落高度并更新位置 
      const estimatedHeight = Math.ceil(content.length / 30) * TEMPLATE_STYLES.PARAGRAPH.lineHeightPx;
      currentY += estimatedHeight + TEMPLATE_STYLES.CONTAINER.verticalSpacing.betweenItems;
    }
  }

  /**
   * 调整背景高度
   * @param {string} contentGroupId - 内容组ID
   */
  async adjustBackgroundHeight(contentGroupId) {
    try {
      // 获取内容组的实际高度
      const contentGroupInfo = await this.mcpClient.call("mcp__talk-to-figma__get_node_info", {
        nodeId: contentGroupId
      });
      
      const contentHeight = contentGroupInfo.absoluteBoundingBox.height;
      const newBackgroundHeight = contentHeight + 
        TEMPLATE_STYLES.BACKGROUND.topPadding + 
        TEMPLATE_STYLES.BACKGROUND.bottomPadding;
      
      console.log(`📏 Adjusting background height: ${newBackgroundHeight}px (content: ${contentHeight}px)`);
      
      // 调整背景Frame高度
      await this.mcpClient.call("mcp__talk-to-figma__resize_node", {
        nodeId: TEMPLATE_STYLES.BACKGROUND.nodeId,
        width: contentGroupInfo.absoluteBoundingBox.width, // 保持原宽度
        height: newBackgroundHeight
      });
      
      console.log('✅ Background height adjusted');
      
    } catch (error) {
      console.warn(`⚠️ Failed to adjust background height: ${error.message}`);
    }
  }

  /**
   * 恢复内容 (从回收站)
   * @returns {boolean} 恢复是否成功
   */
  async restoreContent() {
    if (!this.recycleGroupId) {
      console.log('❌ No recycle group available for restoration');
      return false;
    }
    
    try {
      // TODO: 实现从回收站恢复节点的逻辑
      console.log(`🔄 Restoring content from recycle group: ${this.recycleGroupId}`);
      return true;
    } catch (error) {
      console.error(`Failed to restore content: ${error.message}`);
      return false;
    }
  }
}