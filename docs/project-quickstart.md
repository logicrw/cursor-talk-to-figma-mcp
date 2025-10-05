# Figma 海报生成系统 - 快速上手与避坑指南

> **目标受众**: 新接手此项目的开发者（包括 AI 助手）
> **最后更新**: 2025-01-05

---

## 一、项目核心架构

### 1.1 核心文件
```
scripts/
├── run_article_images.js    # 短图生成器（shortCard，多语言）
├── run_weekly_poster.js     # 周报海报生成器（3个海报，图文卡+纯文本卡）
└── figma-ipc.js            # WebSocket 通信层（共享）

src/
├── config-resolver.js       # 内容路径解析、资产推断
└── static-server.js        # HTTP 静态文件服务器

config/
└── server-config.json      # 映射规则、WebSocket 配置

docs/
├── architecture-flow.md    # 完整架构流程图（重要！）
└── refactoring-guide.md    # 重构建议（可选）
```

---

## 二、关键易错点（血泪教训）

### ⚠️ 坑 1: flush_layout 时机
**问题**: 不调用 `flush_layout` 会导致布局测量为 0，图片填充失败

**正确做法**:
```javascript
// ❌ 错误：clear 后立即填图
await sendCommand('clear_card_content', {cardId});
await sendCommand('set_image_fill', {nodeId, imageUrl});  // 可能失败！

// ✅ 正确：clear 后必须 flush + sleep
await sendCommand('clear_card_content', {cardId});
await sendCommand('flush_layout', {});
await sleep(80);  // 给 Figma 时间重新计算
await sendCommand('set_image_fill', {nodeId, imageUrl});
```

**何时必须调用**:
1. `clear_card_content` 后
2. 设置可见性属性后
3. 填充文本/图片后
4. 重排布局前
5. 调整海报高度前
6. 导出前

---

### ⚠️ 坑 2: 海报高度调整时机
**问题**: 早期版本在每个海报处理后立即调整高度，导致后续海报布局错乱

**解决方案**: 统一在所有海报处理完成后调整
```javascript
// ❌ 旧版本（已注释）
for (const posterName of posterNames) {
  await processPoster(posterName, flow);
  await resizePosterHeightToContent(posterId);  // ❌ 过早调整
}

// ✅ 新版本（正确）
for (const posterName of posterNames) {
  await processPoster(posterName, flow);
  // 不调整高度
}

// 统一调整
await fitAllPostersAtEnd();  // ✅ 在最后统一调整
```

**相关 commit**: `a8721f4 fix: scope anchors and reflow slot layout`

---

### ⚠️ 坑 3: 锚点查找范围
**问题**: `resize_poster_to_fit` 会扫描整个文档，可能找到错误的锚点

**解决方案**: 使用 `excludeByNameRegex` 排除无关节点
```javascript
await sendCommand('resize_poster_to_fit', {
  posterId,
  anchorNames: ['ContentAndPlate', 'ContentContainer'],
  bottomPadding: 200,
  allowShrink: true,
  excludeByNameRegex: '(?:^背景$|^Background$|SignalPlus Logo)'  // ✅ 排除品牌元素
});
```

**相关 commit**: `9a431d3 fix: limit poster resize anchor scope`

---

### ⚠️ 坑 4: prepare_card_root 返回格式
**问题**: Figma 插件返回格式不一致（有时是 JSON 字符串，有时是对象）

**正确解析**:
```javascript
// ✅ 使用 parsePrepareCardRootResult 统一处理
import { parsePrepareCardRootResult } from './figma-ipc.js';

const raw = await sendCommand('prepare_card_root', {nodeId});
const prep = parsePrepareCardRootResult(raw);  // 自动处理多种格式

if (prep && prep.rootId) {
  rootId = prep.rootId;
  // prep.detachedTimes, prep.descendantDetaches 也可用
}
```

---

### ⚠️ 坑 5: Base64 传输限流
**问题**: 不限流会导致 WebSocket 阻塞，Figma 插件崩溃

**正确做法**:
```javascript
// 配置限流（server-config.json）
{
  "asset_transfer": {
    "base64_rate_limit": 30  // 每秒最多 30 次
  }
}

// 代码中应用限流
await this.throttleBase64();  // 滑动窗口限流
await sendCommand('set_image_fill', {imageBase64});
```

---

### ⚠️ 坑 6: 节点名称标准化
**问题**: Figma 节点名称可能包含零宽字符、全角/半角差异

**正确做法**:
```javascript
// ✅ 使用 normalizeName 统一标准化
import { normalizeName } from './figma-ipc.js';

const target = normalizeName('slot:IMAGE_GRID');  // Unicode NFKC + 去空格
const node = children.find(c => normalizeName(c.name) === target);
```

---

### ⚠️ 坑 7: 图片填充降级策略
**问题**: URL 填充失败时没有降级，导致图片丢失

**正确做法**:
```javascript
// ✅ 先 URL，失败再 Base64
let success = false;

// 尝试 URL
try {
  const res = await sendCommand('set_image_fill', {imageUrl: url});
  success = !res || res.success !== false;
} catch (error) {
  console.warn('URL 填充失败，尝试 Base64');
}

// 降级 Base64
if (!success) {
  const base64 = await imageToBase64(asset);
  if (base64) {
    await throttleBase64();
    await sendCommand('set_image_fill', {imageBase64: base64});
  }
}
```

---

### ⚠️ 坑 8: 可见性属性模糊匹配
**问题**: 组件属性名可能是 `ShowimgSlot2` 或 `ShowimgSlot2#123:456`

**正确做法**:
```javascript
// ✅ 获取完整属性引用
const propRefs = await sendCommand('get_component_property_references', {nodeId});
const propertyKeys = propRefs.propertyKeys || Object.keys(propRefs.properties || {});

// 模糊匹配基础名
const normalizePropToken = (v) => String(v).replace(/[^a-z0-9]/gi, '').toLowerCase();

const entries = propertyKeys.map(key => ({
  key,
  base: key.includes('#') ? key.split('#')[0] : key,
  normalized: normalizePropToken(key)
}));

// 查找匹配
const match = entries.find(e => e.normalized === normalizePropToken('showImgSlot2'));
if (match) {
  properties[match.key] = true;  // 使用完整键名
}
```

---

## 三、核心执行流程

### 3.1 run_article_images.js 流程
```
1. 加载内容 (多语言 JSON)
2. 启动静态服务器 (HTTP :3056)
3. 连接 WebSocket + join channel
4. 查找 shortCard 组件
5. [循环每个内容项]
   ├─ 创建组件实例
   ├─ applyVisibilityControl (设置可见性)
   ├─ prepareRoot + clearContent
   ├─ flush_layout (关键！)
   ├─ 填充标题 + 自适应高度
   ├─ 填充图片 (URL → Base64)
   ├─ 填充来源
   ├─ reflow_shortcard_title (重排标题区)
   ├─ resize_poster_to_fit (海报高度自适应)
   └─ export (可选)
6. 输出汇总
```

### 3.2 run_weekly_poster.js 流程
```
1. 加载配置 (server-config.json)
2. 解析内容路径 (CLI > ENV > config > 自动发现)
3. 推断数据集 (inferDataset)
4. 确保静态服务器可用
5. 连接 WebSocket + join channel
6. 定位锚点 (container, cards_stack)
7. 创建内容流 (figure_group + standalone_paragraph)
8. [循环每个海报]
   ├─ 定位海报 Frame
   ├─ 清空卡片容器
   ├─ 更新标题区 (set_poster_title_and_date)
   ├─ [循环内容流]
   │   ├─ 创建卡片实例 (直接创建 or 克隆种子)
   │   ├─ prepareRoot + clearContent
   │   ├─ flush_layout (关键！)
   │   ├─ 填充文本 (title, source, body)
   │   └─ 填充图片 (discoverImageTargets + 降级策略)
   └─ (不调整高度，留到最后)
9. fitAllPostersAtEnd() (统一调整所有海报)
10. 导出 (可选)
```

---

## 四、配置文件关键字段

### server-config.json 重要字段
```json
{
  "websocket": {
    "host": "localhost",
    "port": 3055
  },
  "static_server": {
    "host": "localhost",
    "port": 3056,
    "publicRoute": "/assets"
  },
  "workflow": {
    "current_content_file": "250915-单向上行_zh-CN.json",
    "mapping": {
      "anchors": {
        "container": "slot:CONTENT",
        "cards_stack": "slot:CARDS_STACK",
        "slots": {
          "images": ["imgSlot1", "imgSlot2", "imgSlot3", "imgSlot4"],
          "figure": {
            "title_text": "titleText",
            "source_text": "sourceText",
            "image_grid": "slot:IMAGE_GRID"
          }
        }
      }
    }
  },
  "asset_transfer": {
    "base64_rate_limit": 30
  }
}
```

---

## 五、Figma 命令速查表

### 高频命令（必须掌握）
| 命令 | 用途 | 关键参数 | 易错点 |
|------|------|---------|--------|
| `get_node_info` | 获取节点信息 | `{nodeId}` | 返回的 `children` 可能为空 |
| `prepare_card_root` | 分离实例 | `{nodeId}` | 返回格式不一致，用 `parsePrepareCardRootResult` |
| `clear_card_content` | 清理内容 | `{cardId, mode, preserveNames}` | **必须后跟 flush_layout** |
| `set_image_fill` | 填充图片 | `{nodeId, imageUrl/imageBase64}` | URL 失败要降级 Base64 |
| `flush_layout` | 强制布局 | `{}` | **调用时机是关键** |
| `resize_poster_to_fit` | 海报自适应 | `{posterId, anchorNames, excludeRegex}` | 锚点查找要限制范围 |

### 降级命令（备用）
| 主命令 | 降级命令 | 触发条件 |
|--------|---------|---------|
| `set_instance_properties` | `hide_nodes_by_name` | 属性设置失败 |
| `hide_nodes_by_name` | `set_node_visible` (逐个) | 批量隐藏失败 |
| `create_component_instance` | `append_card_to_container` | 直接创建失败 |
| `findShallowByName` | `deepFindByName` | 浅层查找失败 |
| `deepFindByName` | `get_selection` (选区) | 深度查找失败 |

---

## 六、调试技巧

### 6.1 WebSocket 消息追踪
```javascript
// 在 onMessage 中添加详细日志
console.log(`📨 Received: ${msg.type} id=${msg.message?.id} cmd=${msg.message?.command}`);
console.log(`📦 Result:`, JSON.stringify(msg.message?.result, null, 2));
```

### 6.2 布局问题排查
```javascript
// 检查节点尺寸
const info = await sendCommand('get_node_info', {nodeId});
console.log('📐 BoundingBox:', info.absoluteBoundingBox);

// 检查 flush_layout 是否生效
await sendCommand('flush_layout', {});
await sleep(80);
const infoAfter = await sendCommand('get_node_info', {nodeId});
console.log('📐 After flush:', infoAfter.absoluteBoundingBox);
```

### 6.3 图片填充问题
```javascript
// 检查 URL 可达性
const testUrl = `${staticUrl}/${assetId}.png`;
const ok = await httpHeadOk(testUrl);
console.log(`🔗 URL reachable: ${ok} - ${testUrl}`);

// 检查 Base64 大小
const base64 = await imageToBase64(asset);
const sizeKB = Buffer.from(base64, 'base64').length / 1024;
console.log(`📊 Base64 size: ${sizeKB.toFixed(2)} KB`);
if (sizeKB > 1024) console.warn('⚠️ 图片过大，考虑压缩');
```

---

## 七、常见问题 FAQ

### Q1: 图片填充后是空白？
**A**: 99% 是 `flush_layout` 时机问题
- 检查 `clear_card_content` 后是否调用了 `flush_layout + sleep(80)`
- 检查节点 `visible` 属性是否为 `false`

### Q2: 海报高度不对？
**A**: 锚点查找范围问题
- 使用 `excludeByNameRegex` 排除背景/Logo
- 检查 `anchorNames` 是否在当前海报范围内
- 确认所有卡片填充完成后再调整

### Q3: WebSocket 超时？
**A**: 命令执行时间过长
- 检查 Figma 插件是否正常运行
- 增加 `COMMAND_TIMEOUT_MS` (默认 30 秒)
- 检查网络连接

### Q4: Base64 传输失败？
**A**: 限流问题
- 检查 `base64_rate_limit` 配置
- 确认 `throttleBase64()` 正常工作
- 考虑降低限流阈值

### Q5: 节点查找失败？
**A**: 名称不匹配
- 使用 `normalizeName()` 标准化
- 检查节点名称是否有全角/半角字符
- 尝试深度搜索 `deepFindByName()`

---

## 八、性能优化要点

1. **并行查找节点**: 使用 `Promise.all()`
2. **缓存节点 ID**: 避免重复查找
3. **批量设置属性**: 一次设置多个属性
4. **限制 Base64 使用**: 优先 URL，Base64 作为降级
5. **减少 flush_layout 调用**: 仅在必要时调用

---

## 九、Git 提交规范

### 相关 commit 历史
```
a8721f4 fix: scope anchors and reflow slot layout
9a431d3 fix: limit poster resize anchor scope
d7976e9 fix: stabilize poster auto resize flow
66efff7 refactor: revert resize delta fallback
8388c18 fix: sync title decoration height with slot
```

### 提交信息格式
```
<type>: <subject>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```

**type**: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

---

## 十、文档索引

| 文档 | 用途 | 优先级 |
|------|------|--------|
| `docs/architecture-flow.md` | 完整架构流程图 | ⭐⭐⭐ 必读 |
| `docs/refactoring-guide.md` | 重构建议 | ⭐⭐ 可选 |
| `docs/project-quickstart.md` | 本文档 | ⭐⭐⭐ 快速上手 |
| `config/server-config.json` | 配置参考 | ⭐⭐⭐ 必看 |

---

## 十一、下一步行动

### 新开发者首次上手
1. ✅ 读完本文档（10 分钟）
2. ✅ 浏览 `architecture-flow.md`（了解全局）
3. ✅ 查看 `server-config.json`（理解配置）
4. ✅ 运行一次 `run_article_images.js`（验证环境）
5. ✅ 运行一次 `run_weekly_poster.js`（理解流程）

### 开发新功能时
1. 参考 `architecture-flow.md` 第六章（可复用架构）
2. 复用 `figma-ipc.js` 中的工具函数
3. 遵循 `flush_layout` 调用规范
4. 添加降级策略（URL → Base64, 浅 → 深）

### 遇到问题时
1. 检查本文档「易错点」章节
2. 查看 FAQ
3. 启用详细日志追踪
4. 参考 Git commit 历史（可能已修复类似问题）

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
**维护者**: Claude Code
**项目状态**: ✅ 稳定运行中

---

## 附录：关键代码片段

### A. 标准卡片填充模板
```javascript
async function fillCard(instanceId, content) {
  // 1. 准备根节点
  let rootId = instanceId;
  try {
    const result = await sendCommand('prepare_card_root', {nodeId: instanceId});
    const prep = parsePrepareCardRootResult(result);
    if (prep?.rootId) rootId = prep.rootId;
  } catch (error) {
    console.warn('⚠️ prepare_card_root 失败');
  }

  // 2. 清理内容
  try {
    await sendCommand('clear_card_content', {
      cardId: rootId,
      mode: 'safe',
      preserveNames: ['Logo', '背景']
    });
  } catch (error) {
    console.warn('⚠️ clear_card_content 失败');
  }

  // 3. 强制布局刷新（关键！）
  try { await sendCommand('flush_layout', {}); } catch {}
  await sleep(80);

  // 4. 填充内容
  // ... (具体业务逻辑)

  return rootId;
}
```

### B. 图片填充降级模板
```javascript
async function fillImageWithFallback(nodeId, url, asset) {
  let success = false;

  // 尝试 URL
  try {
    const res = await sendCommand('set_image_fill', {nodeId, imageUrl: url});
    success = !res || res.success !== false;
  } catch (error) {
    console.warn('URL 填充失败:', error.message);
  }

  // 降级 Base64
  if (!success && asset) {
    try {
      const base64 = await imageToBase64(asset);
      if (base64) {
        await throttleBase64();
        const res = await sendCommand('set_image_fill', {nodeId, imageBase64: base64});
        success = !res || res.success !== false;
      }
    } catch (error) {
      console.warn('Base64 填充失败:', error.message);
    }
  }

  return success;
}
```

### C. 智能节点查找模板
```javascript
async function findNodeSmart(rootId, targetName) {
  // 1. 浅层查找
  try {
    const info = await sendCommand('get_node_info', {nodeId: rootId});
    const shallow = findShallowByName(info.children, targetName);
    if (shallow?.id) return shallow.id;
  } catch {}

  // 2. 深度搜索
  try {
    const deep = await deepFindByName(rootId, targetName);
    if (deep?.id) return deep.id;
  } catch {}

  // 3. 选区降级
  try {
    const sel = await sendCommand('get_selection', {});
    const first = sel.selection?.[0];
    if (first) {
      console.warn('⚠️ 使用选区降级');
      return first.id;
    }
  } catch {}

  return null;
}
```

---

**祝开发顺利！遇到问题随时参考本文档。** 🚀
