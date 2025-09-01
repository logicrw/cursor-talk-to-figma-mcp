#!/usr/bin/env node

/**
 * Template Styles - 固化的模板样式常量
 * 
 * 基于"Group 1000015016"的样式分析结果，固化所有视觉规范
 * 避免运行时测量，确保样式一致性
 */

export const TEMPLATE_STYLES = {
  // 容器尺寸和位置常量
  CONTAINER: {
    baseX: 42859,           // 左对齐基准X位置
    contentWidth: 1604,     // 内容区域宽度
    verticalSpacing: {
      betweenGroups: 60,    // 组间距
      betweenItems: 20,     // 组内元素间距
      titleToImage: 0,      // 标题到图片距离(紧贴)
      imageToSource: 40,    // 图片到来源距离
      sourceToNext: 60      // 来源到下一组距离
    }
  },

  // 图片样式
  IMAGE: {
    width: 1604,
    scaleMode: "FILL",
    fills: [{
      type: "IMAGE",
      blendMode: "NORMAL"
    }],
    // 多图布局时的宽度计算
    multiImage: {
      spacing: 20,          // 图片间距
      getWidth: (count) => Math.floor((1604 - (count - 1) * 20) / count)
    }
  },

  // 标题样式 (GROUP + RECTANGLE + TEXT)
  TITLE: {
    background: {
      fills: [{
        type: "SOLID",
        color: { r: 0, g: 70/255, b: 108/255 },  // #00476c
        blendMode: "NORMAL"
      }],
      width: 1604,
      height: {
        single: 140,        // 单行标题高度
        double: 240         // 双行标题高度  
      }
    },
    text: {
      fills: [{
        type: "SOLID", 
        color: { r: 1, g: 1, b: 1 },             // #ffffff
        blendMode: "NORMAL"
      }],
      fontFamily: "Source Han Sans CN",
      fontStyle: "Bold", 
      fontWeight: 700,
      fontSize: 64,
      textAlignHorizontal: "LEFT",
      letterSpacing: 0,
      lineHeightPx: 100,
      // 内边距
      padding: {
        left: 11.890625,    // 从分析结果得出
        top: 33.828125,
        right: 11.890625,
        bottom: 33.828125
      }
    }
  },

  // 来源样式 (TEXT)
  SOURCE: {
    fills: [{
      type: "SOLID",
      color: { r: 153/255, g: 153/255, b: 153/255 },  // #999999
      blendMode: "NORMAL"
    }],
    fontFamily: "DIN Pro",
    fontStyle: "Bold",
    fontWeight: 700,
    fontSize: 50,
    textAlignHorizontal: "LEFT", 
    letterSpacing: 0,
    lineHeightPx: 64.4,
    textAutoResize: "HEIGHT"
  },

  // 正文段落样式 (TEXT)
  PARAGRAPH: {
    fills: [{
      type: "SOLID",
      color: { r: 219/255, g: 219/255, b: 219/255 },  // #dbdbdb
      blendMode: "NORMAL"
    }],
    strokes: [{
      type: "SOLID", 
      color: { r: 0, g: 0, b: 0 },                    // #000000
      blendMode: "NORMAL"
    }],
    fontFamily: "Source Han Sans CN",
    fontStyle: "Bold",
    fontWeight: 700, 
    fontSize: 66,
    textAlignHorizontal: "LEFT",
    letterSpacing: 0,
    lineHeightPx: 110,
    textAutoResize: "HEIGHT"
  },

  // Auto Layout 容器样式
  AUTO_LAYOUT: {
    // 主内容组容器 (VERTICAL)
    contentGroup: {
      layoutMode: "VERTICAL",
      itemSpacing: 60,                    // 组间距
      paddingLeft: 0,
      paddingRight: 0, 
      paddingTop: 0,
      paddingBottom: 0,
      primaryAxisAlignItems: "MIN",       // 顶对齐
      counterAxisAlignItems: "MIN",       // 左对齐
      layoutSizingHorizontal: "FIXED",    // 固定宽度
      layoutSizingVertical: "HUG"         // 高度自适应内容
    },

    // 图片组容器 (VERTICAL)
    figureGroup: {
      layoutMode: "VERTICAL", 
      itemSpacing: 20,                    // 元素间距
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0, 
      paddingBottom: 0,
      primaryAxisAlignItems: "MIN",       // 顶对齐
      counterAxisAlignItems: "MIN",       // 左对齐  
      layoutSizingHorizontal: "FIXED",    // 固定宽度
      layoutSizingVertical: "HUG"         // 高度自适应
    },

    // 图片行容器 (HORIZONTAL/VERTICAL)
    imageContainer: {
      horizontal: {
        layoutMode: "HORIZONTAL",
        itemSpacing: 20,                  // 图片间距
        paddingLeft: 0,
        paddingRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        primaryAxisAlignItems: "MIN",     // 左对齐
        counterAxisAlignItems: "MIN",     // 顶对齐
        layoutSizingHorizontal: "FIXED", // 固定宽度
        layoutSizingVertical: "HUG"      // 高度自适应
      },
      vertical: {
        layoutMode: "VERTICAL", 
        itemSpacing: 20,                  // 图片间距
        paddingLeft: 0,
        paddingRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        primaryAxisAlignItems: "MIN",     // 顶对齐
        counterAxisAlignItems: "MIN",     // 左对齐
        layoutSizingHorizontal: "FIXED", // 固定宽度
        layoutSizingVertical: "HUG"      // 高度自适应
      }
    }
  },

  // 背景调整参数
  BACKGROUND: {
    nodeId: "6:5403",           // BackgroundFrame ID
    topPadding: 120,            // 内容上方留白
    bottomPadding: 120          // 内容下方留白
  }
};

/**
 * 计算标题背景高度 - 根据文本行数
 * @param {number} lineCount - 文本行数
 * @returns {number} 背景高度
 */
export function getTitleHeight(lineCount) {
  return lineCount <= 1 ? 
    TEMPLATE_STYLES.TITLE.background.height.single : 
    TEMPLATE_STYLES.TITLE.background.height.double;
}

/**
 * 计算多图布局中单图宽度
 * @param {number} imageCount - 图片数量
 * @returns {number} 单图宽度
 */
export function getImageWidth(imageCount) {
  if (imageCount === 1) {
    return TEMPLATE_STYLES.IMAGE.width;
  }
  return TEMPLATE_STYLES.IMAGE.multiImage.getWidth(imageCount);
}

/**
 * 获取容器位置信息
 * @param {number} yOffset - Y轴偏移
 * @returns {Object} 位置信息
 */
export function getContainerPosition(yOffset = 0) {
  return {
    x: TEMPLATE_STYLES.CONTAINER.baseX,
    y: yOffset,
    width: TEMPLATE_STYLES.CONTAINER.contentWidth
  };
}

export default TEMPLATE_STYLES;