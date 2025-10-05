# 开发指南

> **目标受众**: 想要基于本项目开发自定义 Figma 自动化脚本的开发者
>
> **前置知识**: JavaScript/Node.js 基础、Figma 基本使用、了解 WebSocket 通信
>
> **最后更新**: 2025-10-05

---

## 一、开发环境设置

### 1.1 环境要求

- **已完成**: [docs/INSTALLATION.md](INSTALLATION.md) 中的所有安装步骤
- **已启动**: WebSocket 服务器 (`bun socket`)
- **已运行**: Figma Desktop + 插件（已加入频道）

### 1.2 推荐工具

- **编辑器**: VS Code / Cursor / Claude Code
- **调试工具**: Chrome DevTools（查看 WebSocket 消息）
- **Git 客户端**: 用于版本管理

### 1.3 项目本地开发模式

**编辑 MCP 配置** (`~/.claude/mcp.json` 或 `~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "bun",
      "args": ["/path-to-repo/src/talk_to_figma_mcp/server.ts"]
    }
  }
}
```

**优势**: 直接运行 TypeScript 源码，无需每次修改后重新构建。

---

## 二、Figma 组件设计最佳实践

### 2.1 核心原则: 使用 Frame 而非 Group

**❌ 错误做法**:
```
Group
├─ Text "标题"
└─ Rectangle "背景"
```

**✅ 正确做法**:
```
Frame (Auto Layout)
├─ Text "标题"
└─ Rectangle "背景"
```

**原因**:
1. **Frame 支持 Auto Layout**: 可以自动调整尺寸、间距、对齐
2. **Group 无法设置 constraints**: 子元素布局难以控制
3. **Frame 可以设置 padding**: 内容与边框自动保持间距
4. **Frame 支持 clip content**: 防止内容溢出

### 2.2 命名规范

**使用语义化名称**（支持脚本查找）:
```
✅ slot:IMAGE_GRID      # 图片网格槽位
✅ slot:TITLE          # 标题槽位
✅ slot:SOURCE         # 来源槽位
✅ titleText           # 标题文本节点
✅ sourceText          # 来源文本节点
✅ imgSlot1, imgSlot2  # 图片槽位（编号）

❌ Layer 1             # 无意义
❌ Group 2             # 无意义
❌ Frame 123           # 无意义
```

**名称标准化规则** (自动处理):
- Unicode NFKC 规范化（处理全角/半角）
- 自动去除空格与零宽字符
- 大小写不敏感（使用 `normalizeName()` 匹配）

### 2.3 组件属性设计

**使用布尔属性控制可见性**:
```
Component Properties:
├─ showTitle (Boolean) → 控制标题显示/隐藏
├─ showSource (Boolean) → 控制来源显示/隐藏
├─ showImgSlot1 (Boolean) → 控制图片槽位 1
├─ showImgSlot2 (Boolean) → 控制图片槽位 2
└─ ...
```

**脚本侧使用** (`set_instance_properties_by_base`):
```javascript
await sendCommand('set_instance_properties_by_base', {
  nodeId: instanceId,
  properties: {
    showTitle: true,        // 显示标题
    showSource: true,       // 显示来源
    showImgSlot1: true,     // 显示图片 1
    showImgSlot2: false,    // 隐藏图片 2
  }
});
```

**自动模糊匹配**: 属性名可能是 `showImgSlot1` 或 `showImgSlot1#123:456`，脚本会自动匹配。

### 2.4 布局设计要点

**Auto Layout 配置建议**:
```
Frame (卡片根容器)
├─ layoutMode: VERTICAL           # 垂直排列
├─ primaryAxisAlignItems: MIN     # 顶部对齐
├─ counterAxisAlignItems: CENTER  # 水平居中
├─ itemSpacing: 16                # 子元素间距
├─ padding: {top: 24, right: 24, bottom: 24, left: 24}
└─ layoutSizingHorizontal: FIXED  # 固定宽度
    layoutSizingVertical: HUG      # 高度自适应内容
```

**文本节点配置**:
```
Text Node
├─ textAutoResize: HEIGHT          # 高度自适应（固定宽度）
└─ layoutSizingHorizontal: FILL    # 填满父容器宽度
```

**图片节点配置**:
```
Frame (图片槽位)
├─ layoutSizingHorizontal: FIXED   # 固定宽度
├─ layoutSizingVertical: FIXED     # 固定高度
└─ scaleMode: FILL                 # 填充模式（或 FIT）
```

---

## 三、复用现有脚本

### 3.1 参考脚本: run_weekly_poster.js

**功能**: 周报三海报自动化生成

**核心流程**:
```javascript
// 1. 加载配置与内容
const config = loadConfig();
const content = await loadContent(contentPath);

// 2. 启动静态服务器
await ensureStaticServerAvailable();

// 3. 连接 WebSocket + 加入频道
const figma = new FigmaIPC(wsUrl);
await figma.connect();
await figma.joinChannel(channelName);

// 4. 定位锚点（容器、卡片堆栈）
const containerInfo = await findAnchor('slot:CONTENT');
const cardsStackInfo = await findAnchor('slot:CARDS_STACK');

// 5. 创建内容流
const flow = buildContentFlow(content);

// 6. 循环处理每个海报
for (const posterName of posterNames) {
  await processPoster(posterName, flow);
}

// 7. 统一调整海报高度
await fitAllPostersAtEnd();

// 8. 导出（可选）
await exportPosters();
```

**可复用函数** (来自 `figma-ipc.js`):
- `sendCommand(cmd, params)`: 发送 Figma 命令
- `fillImage(nodeId, url, asset)`: 图片填充（URL → Base64 降级）
- `flushLayout()`: 强制布局刷新
- `setText(nodeId, text, options)`: 设置文本 + 自动调整
- `parsePrepareCardRootResult(raw)`: 解析 prepare_card_root 返回值
- `normalizeName(name)`: 标准化节点名称
- `findShallowByName(children, name)`: 浅层查找节点
- `deepFindByName(rootId, name)`: 深度查找节点

### 3.2 参考脚本: run_article_images.js

**功能**: 多语言文章短图生成

**核心流程**:
```javascript
// 1. 加载多语言内容
const contentFiles = ['zh-CN.json', 'en-US.json', 'ja-JP.json'];
const allContent = contentFiles.flatMap(f => loadContent(f));

// 2. 启动静态服务器 + 连接 WebSocket
await startStaticServer();
const figma = new FigmaIPC(wsUrl);
await figma.connect();
await figma.joinChannel(channelName);

// 3. 查找 shortCard 组件
const component = await findComponent('shortCard');

// 4. 循环处理每个内容项
for (const item of allContent) {
  // 创建组件实例
  const instanceId = await createInstance(component.id);

  // 应用可见性控制
  await applyVisibilityControl(instanceId, item);

  // 准备根节点 + 清理内容
  const rootId = await prepareRoot(instanceId);
  await clearContent(rootId);

  // 强制布局刷新（关键！）
  await flushLayout();
  await sleep(80);

  // 填充内容
  await fillTitle(rootId, item.title);
  await fillImages(rootId, item.images);
  await fillSource(rootId, item.source);

  // 重排标题区
  await reflowTitle(rootId);

  // 海报高度自适应
  await resizePosterToFit(rootId);

  // 导出（可选）
  await exportCard(rootId);
}
```

**可复用模式**:
- **可见性控制**: `set_instance_properties_by_base` + 属性模糊匹配
- **准备根节点**: `prepare_card_root` + `parsePrepareCardRootResult`
- **清理内容**: `clear_card_content` (mode: 'safe' / 'aggressive')
- **图片填充**: `fillImage` (URL-first + Base64 fallback)
- **文本填充**: `setText` (auto-resize + flush)
- **海报调整**: `resize_poster_to_fit` (anchor-based + exclude regex)

### 3.3 复用 figma-ipc.js

**核心类**: `FigmaIPC`

**基本用法**:
```javascript
import { FigmaIPC } from './figma-ipc.js';

// 1. 创建实例
const figma = new FigmaIPC('ws://localhost:3055');

// 2. 连接 WebSocket
await figma.connect();

// 3. 加入频道
await figma.joinChannel('my-channel');

// 4. 发送命令
const result = await figma.sendCommand('get_document_info', {});
console.log('文档信息:', result);

// 5. 关闭连接（可选）
figma.close();
```

**高级封装函数**:
```javascript
// 图片填充（自动降级）
await figma.fillImage(nodeId, url, assetData);

// 布局刷新（flush + sleep）
await figma.flushLayout();

// 文本设置（set_text_content + auto_resize + layout_sizing + flush）
await figma.setText(nodeId, '标题文本', {
  autoResize: 'HEIGHT',        // 高度自适应
  layoutSizingH: 'FILL',       // 宽度填满
  flush: true                  // 自动刷新布局
});

// 节点查找（浅 → 深 → 选区降级）
const shallow = findShallowByName(children, 'slot:IMAGE_GRID');
if (!shallow) {
  const deep = await figma.deepFindByName(rootId, 'slot:IMAGE_GRID');
}
```

---

## 四、开发自定义脚本

### 4.1 脚本模板

创建 `scripts/my_custom_script.js`:

```javascript
import { FigmaIPC, normalizeName, findShallowByName } from './figma-ipc.js';
import { loadConfig } from '../src/config-resolver.js';

// =====================
// 1. 配置与初始化
// =====================
const config = loadConfig();
const wsUrl = `ws://${config.websocket.host}:${config.websocket.port}`;
const channelName = process.argv.includes('--channel')
  ? process.argv[process.argv.indexOf('--channel') + 1]
  : 'my-custom-channel';

// =====================
// 2. 核心业务逻辑
// =====================
async function main() {
  console.log('🚀 开始执行自定义脚本');

  // 连接 WebSocket
  const figma = new FigmaIPC(wsUrl);
  await figma.connect();
  console.log('✅ 连接 WebSocket:', wsUrl);

  // 加入频道
  await figma.joinChannel(channelName);
  console.log('✅ 加入频道:', channelName);

  // 获取文档信息
  const docInfo = await figma.sendCommand('get_document_info', {});
  console.log('📄 文档名称:', docInfo.name);

  // 查找组件
  const components = await figma.sendCommand('get_local_components', {});
  const myComponent = components.find(c => c.name === 'MyComponent');
  if (!myComponent) {
    throw new Error('找不到组件 MyComponent');
  }
  console.log('🔍 找到组件:', myComponent.name);

  // 创建组件实例
  const instanceResult = await figma.sendCommand('create_component_instance', {
    componentKey: myComponent.key,
    x: 0,
    y: 0
  });
  const instanceId = instanceResult.id;
  console.log('✅ 创建实例:', instanceId);

  // 准备根节点
  const prepResult = await figma.sendCommand('prepare_card_root', {nodeId: instanceId});
  const prep = parsePrepareCardRootResult(prepResult);
  const rootId = prep?.rootId || instanceId;

  // 清理内容
  await figma.sendCommand('clear_card_content', {
    cardId: rootId,
    mode: 'safe',
    preserveNames: ['Logo', '背景']
  });

  // 强制布局刷新（关键！）
  await figma.flushLayout();
  await sleep(80);

  // 填充内容（示例：文本 + 图片）
  await figma.setText(rootId + ':titleText', '自定义标题', {
    autoResize: 'HEIGHT',
    layoutSizingH: 'FILL',
    flush: true
  });

  await figma.fillImage(rootId + ':imageSlot', 'https://example.com/image.png', null);

  // 海报高度自适应
  await figma.sendCommand('resize_poster_to_fit', {
    posterId: rootId,
    anchorNames: ['ContentAndPlate'],
    bottomPadding: 200,
    allowShrink: true,
    excludeByNameRegex: '(?:^背景$|^Background$)'
  });

  console.log('🎉 脚本执行完成!');

  // 关闭连接
  figma.close();
}

// 辅助函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parsePrepareCardRootResult(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && raw.rootId) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

// =====================
// 3. 错误处理与启动
// =====================
main().catch(error => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
```

### 4.2 运行自定义脚本

```bash
# 确保 WebSocket 服务器运行
bun socket

# 在另一个终端运行脚本
node scripts/my_custom_script.js --channel my-custom-channel
```

### 4.3 调试技巧

**启用详细日志** (在脚本中添加):
```javascript
figma.on('message', (msg) => {
  console.log('📨 Received:', JSON.stringify(msg, null, 2));
});
```

**检查节点信息**:
```javascript
const info = await figma.sendCommand('get_node_info', {nodeId});
console.log('节点信息:', JSON.stringify(info, null, 2));
```

**检查 WebSocket 连接**:
```javascript
figma.ws.on('open', () => console.log('✅ WebSocket 已连接'));
figma.ws.on('close', () => console.log('❌ WebSocket 已断开'));
figma.ws.on('error', (err) => console.error('❌ WebSocket 错误:', err));
```

---

## 五、Claude Code / Cursor 在开发中的角色

### 5.1 使用场景

**适合使用 AI 辅助的场景**:
1. **生成脚本框架**: 描述需求，让 AI 生成基础代码结构
2. **调试错误**: 提供错误信息，让 AI 分析根因并提供修复建议
3. **优化代码**: 让 AI 识别重复代码并提取共享函数
4. **学习 API**: 询问 MCP 工具的使用方法（AI 可以查看工具文档）

**不适合的场景**:
1. **复杂业务逻辑**: AI 不了解项目特定的业务规则
2. **Figma 文件结构**: AI 无法访问您的 Figma 文件，需要您提供节点结构
3. **性能优化**: 需要实际测试与测量，AI 只能提供理论建议

### 5.2 与 AI 协作示例

**示例 1: 生成脚本框架**

**User**: 我想创建一个脚本，自动生成产品卡片。每个卡片包含：产品名称、价格、描述、图片。组件名称是 `ProductCard`。

**AI** (Claude Code):
```javascript
// 生成脚本框架
import { FigmaIPC } from './figma-ipc.js';

async function main() {
  const figma = new FigmaIPC('ws://localhost:3055');
  await figma.connect();
  await figma.joinChannel('product-cards');

  // 加载产品数据（您需要实现）
  const products = loadProducts();

  // 查找 ProductCard 组件
  const components = await figma.sendCommand('get_local_components', {});
  const productCard = components.find(c => c.name === 'ProductCard');

  // 循环生成卡片
  for (const product of products) {
    const instance = await figma.sendCommand('create_component_instance', {
      componentKey: productCard.key,
      x: 0,
      y: 0
    });

    // 填充内容（您需要根据实际节点名称调整）
    await figma.setText(instance.id + ':productName', product.name);
    await figma.setText(instance.id + ':price', product.price);
    await figma.setText(instance.id + ':description', product.description);
    await figma.fillImage(instance.id + ':productImage', product.imageUrl);
  }

  figma.close();
}

main().catch(console.error);
```

**示例 2: 调试错误**

**User**: 我运行脚本时遇到错误: `Cannot read property 'id' of undefined`，发生在 `await figma.fillImage(rootId + ':imageSlot', url)` 这一行。

**AI** (Claude Code):
可能的原因：
1. `rootId` 为 `undefined`（检查 `prepare_card_root` 返回值）
2. 节点名称不匹配（检查 Figma 中是否存在名为 `imageSlot` 的子节点）
3. 节点查找失败（使用 `get_node_info` 先检查子节点列表）

建议添加调试代码：
```javascript
console.log('rootId:', rootId);
const info = await figma.sendCommand('get_node_info', {nodeId: rootId});
console.log('子节点:', info.children?.map(c => c.name));
```

### 5.3 mcp-config.json 的作用

当您在 Claude Code 或 Cursor 中配置了 MCP 服务器后，AI 可以直接调用 Figma MCP 工具。

**示例对话**:

**User**: 帮我读取当前 Figma 文件的文档信息

**AI** (使用 MCP 工具):
```javascript
// AI 自动调用 MCP 工具
await mcp.call('talk-to-figma', 'get_document_info', {});
```

**AI 返回**:
```json
{
  "name": "我的设计文件",
  "id": "abc123",
  "pages": [...]
}
```

**重要提示**: AI 只能调用 MCP 工具，无法直接操作 Figma。您仍然需要：
1. 启动 WebSocket 服务器 (`bun socket`)
2. 在 Figma 中运行插件并加入频道
3. 确保 AI 调用的频道名称与插件一致

---

## 六、测试与调试

### 6.1 单元测试（可选）

**安装测试框架**:
```bash
bun add -d vitest
```

**创建测试文件** `scripts/__tests__/figma-ipc.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { normalizeName, findShallowByName } from '../figma-ipc.js';

describe('normalizeName', () => {
  it('should normalize unicode characters', () => {
    expect(normalizeName('ｓｌｏｔ：ＩＭＡＧＥ')).toBe('slot:IMAGE');
  });

  it('should trim whitespace', () => {
    expect(normalizeName('  slot:IMAGE  ')).toBe('slot:IMAGE');
  });
});

describe('findShallowByName', () => {
  it('should find node by exact name', () => {
    const children = [{name: 'titleText', id: '123'}, {name: 'sourceText', id: '456'}];
    const result = findShallowByName(children, 'titleText');
    expect(result.id).toBe('123');
  });
});
```

**运行测试**:
```bash
bun test
```

### 6.2 集成测试

**创建测试脚本** `scripts/test_integration.js`:
```javascript
import { FigmaIPC } from './figma-ipc.js';

async function test() {
  console.log('🧪 开始集成测试');

  // 1. 测试连接
  const figma = new FigmaIPC('ws://localhost:3055');
  await figma.connect();
  console.log('✅ WebSocket 连接成功');

  // 2. 测试频道加入
  await figma.joinChannel('test-channel');
  console.log('✅ 加入频道成功');

  // 3. 测试获取文档信息
  const docInfo = await figma.sendCommand('get_document_info', {});
  console.log('✅ 获取文档信息成功:', docInfo.name);

  // 4. 测试获取选区
  const selection = await figma.sendCommand('get_selection', {});
  console.log('✅ 获取选区成功:', selection.selection?.length || 0, '个节点');

  figma.close();
  console.log('🎉 集成测试完成');
}

test().catch(console.error);
```

**运行集成测试**:
```bash
# 确保 WebSocket 服务器运行 + Figma 插件已启动
node scripts/test_integration.js
```

### 6.3 调试 WebSocket 通信

**使用 Chrome DevTools**:

1. 打开 Chrome 浏览器
2. 访问 `chrome://inspect`
3. 点击 **Open dedicated DevTools for Node**
4. 在 **Console** 中运行脚本
5. 在 **Network** > **WS** 中查看 WebSocket 消息

**使用 wscat（命令行工具）**:
```bash
# 安装
npm install -g wscat

# 连接 WebSocket
wscat -c ws://localhost:3055

# 手动发送消息（测试）
{"type":"join_channel","channel":"test"}
```

---

## 七、常见开发问题

### Q1: 如何获取节点的完整子树结构？

```javascript
async function getFullTree(figma, nodeId, depth = 0) {
  const info = await figma.sendCommand('get_node_info', {nodeId});
  const indent = '  '.repeat(depth);
  console.log(`${indent}├─ ${info.name} (${info.type}) [${info.id}]`);

  if (info.children) {
    for (const child of info.children) {
      await getFullTree(figma, child.id, depth + 1);
    }
  }
}

// 使用
await getFullTree(figma, rootId);
```

### Q2: 如何批量处理多个节点？

```javascript
// ❌ 错误：顺序处理（慢）
for (const nodeId of nodeIds) {
  await figma.sendCommand('set_fill_color', {nodeId, r: 1, g: 0, b: 0});
}

// ✅ 正确：并行处理（快）
await Promise.all(
  nodeIds.map(nodeId =>
    figma.sendCommand('set_fill_color', {nodeId, r: 1, g: 0, b: 0})
  )
);
```

### Q3: 如何处理异步错误？

```javascript
// ✅ 使用 try-catch
try {
  await figma.sendCommand('get_node_info', {nodeId: 'invalid-id'});
} catch (error) {
  console.error('获取节点信息失败:', error.message);
  // 降级处理
  const selection = await figma.sendCommand('get_selection', {});
  if (selection.selection?.[0]) {
    nodeId = selection.selection[0].id;
  }
}
```

### Q4: 如何实现进度条？

```javascript
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  await processItem(figma, item);

  // 显示进度
  const progress = Math.round((i + 1) / items.length * 100);
  console.log(`进度: ${progress}% (${i + 1}/${items.length})`);
}
```

---

## 八、贡献指南

### 8.1 提交代码

**Git 提交信息格式**:
```
<type>: <subject>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```

**type 类型**:
- `feat`: 新功能
- `fix`: 修复 bug
- `refactor`: 重构代码
- `docs`: 文档更新
- `test`: 测试相关
- `chore`: 其他杂项

**示例**:
```
feat: 添加产品卡片生成脚本

- 实现 run_product_cards.js
- 支持批量生成
- 包含图片填充与文本自适应

🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```

### 8.2 代码风格

- 使用 2 空格缩进
- 使用单引号 (`'string'`)
- 函数名使用 camelCase (`myFunction`)
- 常量使用 UPPER_SNAKE_CASE (`MAX_RETRIES`)
- 添加必要的注释（中文）

### 8.3 文档更新

如果您的修改涉及以下内容，请同步更新文档：
- 新增脚本 → 更新 `README.md` + `docs/DEVELOPMENT.md`
- 新增 MCP 工具 → 更新 `README.md` 的 "MCP Tools" 章节
- 发现新坑 → 更新 `docs/PITFALLS.md`
- 修复 bug → 在提交信息中说明根因与解决方案

---

## 九、下一步

### 完成本文档后

- ✅ 阅读 [⚠️ docs/PITFALLS.md](PITFALLS.md)（避免踩坑）
- ✅ 查看 [📐 docs/architecture-flow.md](architecture-flow.md)（理解架构）
- ✅ 研究 `scripts/run_weekly_poster.js` 和 `scripts/run_article_images.js`（学习实战代码）

### 开始开发自定义脚本

1. 复制 `scripts/my_custom_script.js` 模板
2. 根据需求修改业务逻辑
3. 设计 Figma 组件（遵循最佳实践）
4. 测试与调试
5. 提交代码（遵循提交规范）

---

**祝开发顺利！** 🚀

**文档版本**: v1.0
**维护者**: logicrw
**最后更新**: 2025-10-05
