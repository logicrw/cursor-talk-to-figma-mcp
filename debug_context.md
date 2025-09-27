# 短图高度自适应问题调试上下文

## 问题描述

执行短图生成脚本后，短图根 Frame（短图-tc-xx）没有根据 shortCard 的实际长度进行高度调整。

## 最近的修复提交

```bash
commit: bded5473117256b2299fa5eb7d61b22b94fe6406
Date: Sat Sep 27 17:28:02 2025 +0800

fix(plugin): resolve poster height auto-resize issues

主要修改：
- 修复锚点名称大小写敏感匹配问题 (shortCard, ContentAndPlate, etc.)
- 改进 _pickAnchorsUnderPoster 使用规范化名称比较
- 添加全面的调试日志
- 增强错误报告
```

## 相关代码片段

### 1. 插件端 resizePosterToFit 函数 (src/cursor_mcp_plugin/code.js)

```javascript
// 工具：在 poster 内寻找锚点（大小写不敏感匹配）
function _pickAnchorsUnderPoster(poster, names) {
  if (!poster || !('findAll' in poster)) return [];
  var normalizedNames = (names || []).map(function (n) {
    return String(n || '').trim().toLowerCase().replace(/[_\-\s]/g, '');
  });

  return poster.findAll(function (node) {
    if (!node || !node.name) return false;
    if (node.visible === false) return false;
    // 不再限制必须有 children，因为有些锚点可能是叶子节点
    var nodeName = String(node.name || '').trim().toLowerCase().replace(/[_\-\s]/g, '');

    // 精确匹配或包含匹配
    for (var i = 0; i < normalizedNames.length; i++) {
      if (nodeName === normalizedNames[i] || nodeName.indexOf(normalizedNames[i]) !== -1) {
        return true;
      }
    }
    return false;
  }) || [];
}

// 主体：把 poster 高度调为 anchor 底 + padding
async function resizePosterToFit(params) {
  var posterId = params && params.posterId;
  var anchorId = params && params.anchorId;
  var bottomPadding = (params && typeof params.bottomPadding === 'number') ? params.bottomPadding : DEFAULT_RESIZE_PADDING;
  var minHeight = (params && typeof params.minHeight === 'number') ? params.minHeight : 0;
  var maxHeight = (params && typeof params.maxHeight === 'number') ? params.maxHeight : 1000000;

  if (!posterId) {
    console.error('❌ resizePosterToFit: Missing posterId');
    throw new Error("Missing posterId");
  }

  console.log('🔍 resizePosterToFit: Starting with params:', {
    posterId: posterId,
    anchorId: anchorId,
    bottomPadding: bottomPadding,
    minHeight: minHeight,
    maxHeight: maxHeight
  });

  var poster = await figma.getNodeByIdAsync(posterId);
  if (!poster || poster.type !== 'FRAME') {
    console.error(`❌ resizePosterToFit: Invalid poster - type: ${poster ? poster.type : 'null'}`);
    return { success: false, message: "poster not a FRAME" };
  }

  console.log(`📋 Found poster: "${poster.name}" (${poster.width}x${poster.height})`);

  await _flushLayoutAsync();

  // 选锚点
  var anchors = [];
  if (anchorId) {
    console.log(`🔍 Looking for anchor by ID: ${anchorId}`);
    var a = await figma.getNodeByIdAsync(anchorId);
    if (a && a.visible !== false) {
      anchors.push(a);
      console.log(`✅ Found anchor by ID: "${a.name}"`);
    } else {
      console.warn(`⚠️ Anchor ID ${anchorId} not found or invisible`);
    }
  }
  if (anchors.length === 0) {
    console.log('🔍 Searching for anchors by name under poster...');
    anchors = _pickAnchorsUnderPoster(poster, ['shortCard','ContentAndPlate','ContentContainer','content_anchor','Odaily固定板','EXIO固定板','干货铺固定板','slot:IMAGE_GRID']);
    if (anchors.length > 0) {
      console.log(`✅ Found ${anchors.length} anchor(s) by name:`, anchors.map(function(a) { return a.name; }));
    }
  }
  if (anchors.length === 0) {
    console.error('❌ No anchor found under poster');
    return { success: false, message: "no anchor found under poster" };
  }

  // ... 后续测量和调整逻辑
}
```

### 2. 脚本端调用 (scripts/run_article_images.js)

```javascript
async resizeShortRootToContent(posterId, bottomPadding = 150, anchorId) {
  if (!posterId) return null;
  try { await this.sendCommand('flush_layout', {}); } catch {}
  await this.sleep(120);

  try {
    await this.sendCommand('resize_poster_to_fit', {
      posterId,
      anchorId,
      bottomPadding
    });
  } catch (error) {
    console.warn('⚠️ resize_poster_to_fit 失败:', error.message || error);
  }

  try { await this.sendCommand('flush_layout', {}); } catch {}
  await this.sleep(80);
}

// 在处理每张短图时的调用
const posterId = this.findShortRootFrame(cardId);
if (posterId) {
  const posterName = `短图-${lang}-${i}`;
  try { await this.sendCommand('set_node_name', { nodeId: posterId, name: posterName }); } catch (error) {
    console.warn('⚠️ 重命名短图失败:', error.message || error);
  }
  // 统一命令：明确以 shortCard 实例作为 anchor
  await this.resizeShortRootToContent(posterId, 150, cardId);
} else {
  console.warn('⚠️ 无法确定短图根 Frame，跳过自适应高度');
}
```

## 执行日志分析

从执行日志中可以看到：

1. **成功创建组件实例**
```
✅ 创建组件实例: 758:218
✅ 根节点准备完成: 758:232
```

2. **成功填充内容**
```
✅ 图片 1 已填充到槽位
📝 标题已设置并启用高度自适应
✅ 布局重排完成
```

3. **调用 resize_poster_to_fit**
```
📤 Sending command: resize_poster_to_fit (id: 35)
✅ Got result for command id: 35
```

但是没有看到插件端的调试日志输出（应该有 `🔍 resizePosterToFit: Starting with params:` 等日志）。

## 可能的问题

1. **posterId 可能不是根 Frame**
   - `findShortRootFrame` 函数可能返回了错误的节点 ID
   - 需要确认 `posterId` 是否真的是 "短图-tc-xx" 这个根 Frame

2. **anchorId (cardId) 可能不正确**
   - 传递的 `cardId` 可能不是 shortCard 实例的 ID
   - 可能是 detach 后 ID 发生了变化

3. **插件端日志未显示**
   - 插件端的 console.log 可能没有正确输出
   - 或者日志被其他地方的 try/catch 吞掉了

## 需要进一步检查的点

1. **验证 findShortRootFrame 函数**
```javascript
findShortRootFrame(nodeId) {
  // 需要检查这个函数是否正确找到了根 Frame
}
```

2. **验证传递的参数**
   - posterId 是否是 "短图-tc-xx" 的 ID
   - anchorId 是否是 shortCard 实例的 ID

3. **检查插件控制台**
   - 在 Figma 插件控制台查看是否有错误日志
   - 查看 resizePosterToFit 函数是否被调用

## 执行命令

```bash
node scripts/run_article_images.js \
    --channel 3fspxu5k \
    --content-tc "/Users/chenrongwei/Projects/cursor-talk-to-figma-mcp/docx2json/250922-市場泡沫_zh-HK.json" \
    --template "shortCard"
```

## Figma 结构观察

从截图可以看到：
- 每个 "短图-tc-xx" Frame 下包含一个 shortCard 实例
- shortCard 下有背景节点
- 根 Frame 的高度没有根据 shortCard 内容调整

## 建议排查步骤

1. 在插件端添加更多日志，特别是在命令分发处
2. 验证 findShortRootFrame 返回的是否是正确的节点
3. 检查 prepare_card_root 是否改变了节点 ID
4. 确认 Figma 插件控制台的错误信息