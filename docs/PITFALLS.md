# 避坑指南 - 常见错误总结

> **目标受众**: 所有使用本项目的开发者（强烈建议在开发前仔细阅读）
>
> **内容来源**: 146+ 个提交中的 bug 修复与优化经验
>
> **最后更新**: 2025-10-05

---

## 概述

本文档记录了在开发 Figma 自动化脚本过程中遇到的所有重大问题及其解决方案。这些是经过实际生产验证的经验总结，遵循这些建议可以有效避免常见错误。

---

## ⚠️ 坑 1: flush_layout 时机问题

### 问题描述

不调用 `flush_layout` 会导致布局测量为 0，图片填充、文本调整、海报高度计算全部失败。

### 错误示例

```javascript
// ❌ 错误：clear 后立即填图
await sendCommand('clear_card_content', {cardId});
await sendCommand('set_image_fill', {nodeId, imageUrl});  // 可能失败！宽度为 0
```

### 正确做法

```javascript
// ✅ 正确：clear 后必须 flush + sleep
await sendCommand('clear_card_content', {cardId});
await sendCommand('flush_layout', {});  // 强制 Figma 重新计算布局
await sleep(80);                        // 给 Figma 时间更新
await sendCommand('set_image_fill', {nodeId, imageUrl});  // 现在可以正确填充
```

### 何时必须调用

| 操作 | 原因 | 等待时间 |
|------|------|----------|
| `clear_card_content` 后 | 清理内容后布局未更新 | 80ms |
| 设置可见性属性后 | 显示/隐藏节点后尺寸变化 | 80ms |
| 填充文本/图片后 | 内容变化影响布局 | 50ms |
| 重排布局前 | 确保尺寸正确计算 | 80ms |
| 调整海报高度前 | 必须先获取准确的锚点位置 | 100ms |
| 导出前 | 确保所有变更已渲染 | 100ms |

### 相关 commit

- `84d307f` refactor: Phase 1 优化完成 - 统一图片填充与布局刷新
- `088c553` refactor: 提取共享函数，减少重复代码

### 解决方案（统一 API）

使用 `figma-ipc.js` 中的封装函数：
```javascript
// 自动包含 flush_layout + sleep(80)
await figma.flushLayout();

// 或者使用 setText 时自动刷新
await figma.setText(nodeId, '文本内容', {flush: true});
```

---

## ⚠️ 坑 2: 海报高度调整时机

### 问题描述

早期版本在每个海报处理后立即调整高度，导致后续海报布局错乱、锚点查找失败、高度计算不准。

### 错误示例

```javascript
// ❌ 旧版本（已废弃）
for (const posterName of posterNames) {
  await processPoster(posterName, flow);
  await resizePosterHeightToContent(posterId);  // ❌ 过早调整，影响后续海报
}
```

### 根本原因

1. **调整第一个海报高度** → Figma 重新布局整个文档
2. **后续海报位置变化** → 锚点查找失败（坐标已变）
3. **循环中的高度调整相互干扰** → 最终高度不稳定

### 正确做法

```javascript
// ✅ 新版本（正确）
for (const posterName of posterNames) {
  await processPoster(posterName, flow);
  // 不调整高度，仅填充内容
}

// 统一调整所有海报
await fitAllPostersAtEnd();  // ✅ 在最后统一调整，避免相互干扰
```

### 统一调整函数示例

```javascript
async function fitAllPostersAtEnd() {
  console.log('📐 统一调整所有海报高度');

  for (const posterName of posterNames) {
    const posterId = posterIds[posterName];

    await sendCommand('resize_poster_to_fit', {
      posterId,
      anchorNames: ['ContentAndPlate', 'ContentContainer'],
      bottomPadding: 200,
      allowShrink: true,
      excludeByNameRegex: '(?:^背景$|^Background$|SignalPlus Logo)'
    });

    console.log(`✅ ${posterName}: 高度调整完成`);
  }
}
```

### 相关 commit

- `a8721f4` fix: scope anchors and reflow slot layout
- `d05b3de` fix: 统一周报海报高度调整时机
- `d7976e9` fix: stabilize poster auto resize flow

---

## ⚠️ 坑 3: 锚点查找范围

### 问题描述

`resize_poster_to_fit` 会扫描整个文档查找锚点，可能找到错误的同名节点（例如其他海报中的 `ContentAndPlate`），导致高度计算错误或海报互相影响。

### 错误示例

```javascript
// ❌ 错误：未限制查找范围
await sendCommand('resize_poster_to_fit', {
  posterId,
  anchorNames: ['ContentAndPlate'],  // 可能找到其他海报的同名节点！
  bottomPadding: 200
});
```

### 正确做法

```javascript
// ✅ 正确：使用 excludeByNameRegex 排除无关节点
await sendCommand('resize_poster_to_fit', {
  posterId,
  anchorNames: ['ContentAndPlate', 'ContentContainer'],
  bottomPadding: 200,
  allowShrink: true,
  excludeByNameRegex: '(?:^背景$|^Background$|SignalPlus Logo|^周报二$|^周报三$)'
});
```

### 排除规则设计

| 节点类型 | 排除原因 | 正则表达式示例 |
|---------|---------|---------------|
| 背景元素 | 不是内容锚点 | `(?:^背景$\|^Background$)` |
| Logo / 品牌元素 | 不是内容锚点 | `SignalPlus Logo\|^Logo$` |
| 其他海报 | 防止跨海报干扰 | `^周报二$\|^周报三$` |
| 装饰元素 | 不参与高度计算 | `^装饰\|^Decoration` |

### 锚点查找策略

```javascript
// 推荐：提供多个候选锚点（降级策略）
anchorNames: [
  'ContentAndPlate',      // 首选：完整内容区
  'ContentContainer',     // 备选：内容容器
  'slot:CARDS_STACK'      // 降级：卡片堆栈
]
```

### 相关 commit

- `9a431d3` fix: limit poster resize anchor scope
- `66efff7` refactor: revert resize delta fallback

---

## ⚠️ 坑 4: prepare_card_root 返回格式

### 问题描述

Figma 插件返回格式不一致，有时是 JSON 字符串，有时是对象，有时包含额外字段，直接访问 `.rootId` 会报错。

### 错误示例

```javascript
// ❌ 错误：假设返回格式固定
const result = await sendCommand('prepare_card_root', {nodeId});
const rootId = result.rootId;  // 可能 undefined！
```

### 正确解析

```javascript
// ✅ 正确：使用 parsePrepareCardRootResult 统一处理
import { parsePrepareCardRootResult } from './figma-ipc.js';

const raw = await sendCommand('prepare_card_root', {nodeId});
const prep = parsePrepareCardRootResult(raw);  // 自动处理多种格式

if (prep && prep.rootId) {
  rootId = prep.rootId;
  console.log('分离次数:', prep.detachedTimes);
  console.log('后代分离次数:', prep.descendantDetaches);
} else {
  console.warn('prepare_card_root 失败，使用原节点');
  rootId = nodeId;
}
```

### parsePrepareCardRootResult 实现

```javascript
export function parsePrepareCardRootResult(raw) {
  if (!raw) return null;

  // 已经是对象
  if (typeof raw === 'object' && raw.rootId) {
    return raw;
  }

  // 是 JSON 字符串
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.rootId) return parsed;
    } catch (error) {
      console.warn('解析 prepare_card_root 结果失败:', error);
    }
  }

  return null;
}
```

### 返回值结构

```typescript
interface PrepareCardRootResult {
  rootId: string;              // 分离后的根节点 ID
  detachedTimes: number;       // 分离次数（0 = 未分离）
  descendantDetaches: number;  // 后代分离次数
}
```

---

## ⚠️ 坑 5: Base64 传输限流

### 问题描述

不限流会导致 WebSocket 消息队列阻塞，Figma 插件崩溃或无响应，图片填充失败率极高。

### 错误示例

```javascript
// ❌ 错误：循环中连续发送 Base64
for (const image of images) {
  const base64 = await imageToBase64(image);
  await sendCommand('set_image_fill', {nodeId, imageBase64: base64});  // 阻塞！
}
```

### 正确做法

```javascript
// ✅ 正确：使用滑动窗口限流
class FigmaIPC {
  constructor(wsUrl) {
    // ...
    this.base64Timestamps = [];  // 记录发送时间戳
    this.base64RateLimit = 30;   // 每秒最多 30 次
  }

  async throttleBase64() {
    const now = Date.now();
    const windowMs = 1000;  // 1 秒窗口

    // 清理 1 秒前的时间戳
    this.base64Timestamps = this.base64Timestamps.filter(t => now - t < windowMs);

    // 如果达到限制，等待
    if (this.base64Timestamps.length >= this.base64RateLimit) {
      const oldestTimestamp = this.base64Timestamps[0];
      const waitMs = windowMs - (now - oldestTimestamp) + 10;
      console.log(`⏳ Base64 限流: 等待 ${waitMs}ms`);
      await sleep(waitMs);
    }

    // 记录当前发送
    this.base64Timestamps.push(Date.now());
  }
}

// 使用
for (const image of images) {
  const base64 = await imageToBase64(image);
  await figma.throttleBase64();  // 自动限流
  await figma.sendCommand('set_image_fill', {nodeId, imageBase64: base64});
}
```

### 配置限流参数

在 `config/server-config.json` 中调整：
```json
{
  "asset_transfer": {
    "base64_rate_limit": 30,      // 每秒最多 30 次
    "base64_max_size": 5242880    // 最大 5MB（可选）
  }
}
```

### 推荐策略: URL-first + Base64 fallback

```javascript
// ✅ 优先 URL，失败再 Base64
let success = false;

// 尝试 URL（无限流）
try {
  const url = `http://localhost:3056/assets/${dataset}/${filename}`;
  const res = await sendCommand('set_image_fill', {nodeId, imageUrl: url});
  success = !res || res.success !== false;
} catch (error) {
  console.warn('URL 填充失败，尝试 Base64');
}

// 降级 Base64（限流）
if (!success) {
  const base64 = await imageToBase64(asset);
  if (base64) {
    await figma.throttleBase64();  // 关键：限流
    await sendCommand('set_image_fill', {nodeId, imageBase64: base64});
  }
}
```

### 相关 commit

- `96292d6` feat(images): URL-first set_image_fill with automatic Base64 fallback

---

## ⚠️ 坑 6: 节点名称标准化

### 问题描述

Figma 节点名称可能包含零宽字符、全角/半角差异、Unicode 变体字符，导致字符串匹配失败。

### 错误示例

```javascript
// ❌ 错误：直接字符串匹配
const target = 'slot:IMAGE_GRID';
const node = children.find(c => c.name === target);  // 可能找不到！

// 实际节点名称可能是:
// 'ｓｌｏｔ：ＩＭＡＧＥ＿ＧＲＩＤ'  (全角)
// 'slot:IMAGE_GRID '          (末尾空格)
// 'slot:\u200BIMAGE_GRID'     (零宽字符)
```

### 正确做法

```javascript
// ✅ 正确：使用 normalizeName 统一标准化
import { normalizeName } from './figma-ipc.js';

const target = normalizeName('slot:IMAGE_GRID');
const node = children.find(c => normalizeName(c.name) === target);
```

### normalizeName 实现

```javascript
export function normalizeName(name) {
  if (!name) return '';

  return name
    .normalize('NFKC')           // Unicode NFKC 规范化（全角→半角）
    .replace(/\s+/g, '')         // 去除所有空格
    .replace(/[\u200B-\u200D\uFEFF]/g, '');  // 去除零宽字符
}
```

### 标准化效果

| 原始名称 | 标准化后 | 说明 |
|---------|---------|------|
| `ｓｌｏｔ：ＩＭＡＧＥ` | `slot:IMAGE` | 全角 → 半角 |
| `slot: IMAGE` | `slot:IMAGE` | 去除空格 |
| `slot:\u200BIMAGE` | `slot:IMAGE` | 去除零宽字符 |
| `ＳＬＯＴ：ｉｍａｇｅ` | `SLOT:image` | 保留大小写 |

### 查找节点时的最佳实践

```javascript
// 推荐：标准化 + 大小写不敏感
function findNodeByName(children, targetName) {
  const normalized = normalizeName(targetName).toLowerCase();
  return children.find(c =>
    normalizeName(c.name).toLowerCase() === normalized
  );
}
```

### 相关 commit

- `4e62eb8` fix(e2e): robust anchor resolution with name normalization
- `df4db01` fix(workflow): apply normalized name matching

---

## ⚠️ 坑 7: 图片填充降级策略

### 问题描述

URL 填充失败时没有降级，导致图片丢失。常见失败原因：静态服务器未启动、网络问题、跨域限制、文件不存在。

### 错误示例

```javascript
// ❌ 错误：仅尝试 URL，失败不处理
await sendCommand('set_image_fill', {nodeId, imageUrl: url});  // 可能失败
```

### 正确做法

```javascript
// ✅ 正确：URL → Base64 降级策略
let success = false;

// 1. 尝试 URL（首选）
try {
  const url = `http://localhost:3056/assets/${dataset}/${filename}`;
  const res = await sendCommand('set_image_fill', {nodeId, imageUrl: url});
  success = !res || res.success !== false;
  console.log('✅ 图片填充成功 (URL)');
} catch (error) {
  console.warn('⚠️ URL 填充失败，尝试 Base64:', error.message);
}

// 2. 降级 Base64（备用）
if (!success && asset) {
  try {
    const base64 = await imageToBase64(asset);
    if (base64) {
      await figma.throttleBase64();  // 限流
      const res = await sendCommand('set_image_fill', {nodeId, imageBase64: base64});
      success = !res || res.success !== false;
      console.log('✅ 图片填充成功 (Base64)');
    }
  } catch (error) {
    console.error('❌ Base64 填充失败:', error.message);
  }
}

return success;
```

### 封装为共享函数

```javascript
// figma-ipc.js
export async function fillImage(nodeId, url, asset = null) {
  let success = false;

  // 尝试 URL
  try {
    const res = await this.sendCommand('set_image_fill', {nodeId, imageUrl: url});
    success = !res || res.success !== false;
  } catch (error) {
    console.warn('URL 填充失败:', error.message);
  }

  // 降级 Base64
  if (!success && asset) {
    try {
      const base64 = await imageToBase64(asset);
      if (base64) {
        await this.throttleBase64();
        const res = await this.sendCommand('set_image_fill', {nodeId, imageBase64: base64});
        success = !res || res.success !== false;
      }
    } catch (error) {
      console.warn('Base64 填充失败:', error.message);
    }
  }

  return success;
}

// 使用
await figma.fillImage(nodeId, url, assetData);
```

### 相关 commit

- `96292d6` feat(images): URL-first set_image_fill with automatic Base64 fallback
- `084d307f` refactor: Phase 1 优化完成 - 统一图片填充与布局刷新

---

## ⚠️ 坑 8: 可见性属性模糊匹配

### 问题描述

组件属性名可能是基础名称（`showImgSlot2`）或完整引用（`showImgSlot2#123:456`），硬编码属性名会导致设置失败。

### 错误示例

```javascript
// ❌ 错误：使用基础名称（可能失败）
await sendCommand('set_instance_properties', {
  nodeId,
  properties: {
    showImgSlot2: true  // 实际属性名可能是 showImgSlot2#123:456
  }
});
```

### 正确做法（方法 A: 模糊匹配）

```javascript
// ✅ 正确：获取完整属性引用 + 模糊匹配
const propRefs = await sendCommand('get_component_property_references', {nodeId});
const propertyKeys = propRefs.propertyKeys || Object.keys(propRefs.properties || {});

// 标准化函数
const normalizePropToken = (v) =>
  String(v).replace(/[^a-z0-9]/gi, '').toLowerCase();

// 构建映射
const entries = propertyKeys.map(key => ({
  key,
  base: key.includes('#') ? key.split('#')[0] : key,
  normalized: normalizePropToken(key)
}));

// 查找匹配
const properties = {};
const desiredProps = {showImgSlot2: true, showTitle: true};

for (const [baseName, value] of Object.entries(desiredProps)) {
  const match = entries.find(e =>
    e.normalized === normalizePropToken(baseName)
  );

  if (match) {
    properties[match.key] = value;  // 使用完整键名
    console.log(`✅ 映射: ${baseName} → ${match.key}`);
  } else {
    console.warn(`⚠️ 找不到属性: ${baseName}`);
  }
}

// 设置属性
await sendCommand('set_instance_properties', {nodeId, properties});
```

### 正确做法（方法 B: 使用封装 API）

```javascript
// ✅ 更简单：使用 set_instance_properties_by_base
await sendCommand('set_instance_properties_by_base', {
  nodeId,
  properties: {
    showImgSlot2: true,  // 自动查找 showImgSlot2#123:456
    showTitle: true,     // 自动查找 showTitle#789:012
    showSource: false    // 自动查找 showSource#345:678
  }
});
```

### 模糊匹配规则

| 基础名称 | 可匹配的完整名称 | 说明 |
|---------|-----------------|------|
| `showImgSlot2` | `showImgSlot2#123:456` | 标准格式 |
| `ShowimgSlot2` | `showImgSlot2#123:456` | 大小写不敏感 |
| `show_img_slot_2` | `showImgSlot2#123:456` | 符号不敏感 |
| `show-img-slot-2` | `showImgSlot2#123:456` | 符号不敏感 |

### 相关 commit

- `798d80a` feat(properties): robust discovery with case/dash/underscore tolerance
- `9bbdf0e` feat: implement official Figma API property control

---

## ⚠️ 坑 9: 文本自动调整失效

### 问题描述

设置文本后未调用 `set_text_auto_resize` 和 `set_layout_sizing`，导致文本溢出、截断或布局错乱。

### 错误示例

```javascript
// ❌ 错误：仅设置文本内容
await sendCommand('set_text_content', {nodeId, text: '很长的标题文本...'});
// 结果：文本可能被截断或溢出容器
```

### 正确做法

```javascript
// ✅ 正确：设置文本 + 自动调整 + 布局刷新
await sendCommand('set_text_content', {nodeId, text: '很长的标题文本...'});
await sendCommand('set_text_auto_resize', {nodeId, autoResize: 'HEIGHT'});
await sendCommand('set_layout_sizing', {nodeId, layoutSizingHorizontal: 'FILL'});
await sendCommand('flush_layout', {});
await sleep(50);
```

### 封装为统一 API

```javascript
// figma-ipc.js
export async function setText(nodeId, text, options = {}) {
  const {
    autoResize = 'HEIGHT',        // 高度自适应
    layoutSizingH = 'FILL',       // 宽度填满
    layoutSizingV = 'HUG',        // 高度收缩
    flush = true                  // 自动刷新布局
  } = options;

  // 1. 设置文本
  await this.sendCommand('set_text_content', {nodeId, text});

  // 2. 设置自动调整
  if (autoResize) {
    await this.sendCommand('set_text_auto_resize', {nodeId, autoResize});
  }

  // 3. 设置布局模式
  if (layoutSizingH || layoutSizingV) {
    await this.sendCommand('set_layout_sizing', {
      nodeId,
      layoutSizingHorizontal: layoutSizingH,
      layoutSizingVertical: layoutSizingV
    });
  }

  // 4. 刷新布局
  if (flush) {
    await this.flushLayout();
  }
}

// 使用
await figma.setText(titleNodeId, '标题文本', {
  autoResize: 'HEIGHT',
  layoutSizingH: 'FILL',
  flush: true
});
```

### 文本调整模式

| autoResize | layoutSizingH | layoutSizingV | 效果 |
|------------|---------------|---------------|------|
| `HEIGHT` | `FILL` | `HUG` | 宽度填满，高度自适应 |
| `WIDTH_AND_HEIGHT` | `HUG` | `HUG` | 宽高都自适应 |
| `NONE` | `FIXED` | `FIXED` | 固定尺寸（可能溢出） |

### 相关 commit

- `6b6f75f` refactor: Phase 2.4 完成 - 应用 setText() 统一文本接口
- `04d4b41` fix: 修复 slot:SOURCE 左对齐问题

---

## 总结：避坑清单

### 开发前检查

- [ ] 已阅读本文档所有内容
- [ ] 已理解 `flush_layout` 调用时机
- [ ] 已理解海报高度统一调整策略
- [ ] 已理解 URL → Base64 降级策略

### 编码时遵循

- [ ] 使用 `figma-ipc.js` 中的封装函数（`fillImage`, `flushLayout`, `setText`）
- [ ] 所有节点名称查找使用 `normalizeName()`
- [ ] 所有 `prepare_card_root` 结果使用 `parsePrepareCardRootResult()`
- [ ] 所有可见性属性使用 `set_instance_properties_by_base`
- [ ] 所有 Base64 传输前调用 `throttleBase64()`

### 测试前确认

- [ ] WebSocket 服务器正在运行
- [ ] Figma 插件已加入正确频道
- [ ] 静态服务器可访问（如使用 URL 图片）
- [ ] 配置文件路径正确（`config/server-config.json`）

### 出现问题时

1. **检查本文档对应章节**
2. **查看 Git commit 历史**（搜索关键词，可能已有修复）
3. **启用详细日志**（在脚本中添加 `console.log`）
4. **使用调试工具**（Chrome DevTools、wscat）
5. **提交 Issue**（GitHub Issues）

---

**文档版本**: v1.0
**维护者**: logicrw
**最后更新**: 2025-10-05
