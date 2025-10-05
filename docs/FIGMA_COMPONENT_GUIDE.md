# Figma 组件设计规范（脚本自动化专用）

> **目标受众**: 需要创建可被脚本控制的 Figma 组件的设计师和开发者
>
> **重要性**: 遵循本规范可确保脚本正常运行，违反会导致脚本失败
>
> **文档依据**: Figma 官方文档（2024-2025）
>
> **最后更新**: 2025-10-05

---

## 零、快速检查清单

在开始设计组件前，请确认以下所有项：

- [ ] 使用 **Frame**（按 `F`），不使用 Group（按 `Cmd/Ctrl + G`）
- [ ] 根容器启用 **Auto Layout**（按 `Shift + A`）
- [ ] 为可见性控制创建 **Boolean Component Properties**
- [ ] 所有节点使用**语义化命名**（如 `slot:IMAGE_GRID`、`titleText`）
- [ ] 图片容器是 **Frame 或 Rectangle**（不是 Group 或 Ellipse）
- [ ] 文本节点设置 **textAutoResize** 为 `HEIGHT` 或 `WIDTH_AND_HEIGHT`
- [ ] 子节点设置正确的 **layoutSizing**（`FILL` / `HUG` / `FIXED`）

---

## 一、Frame vs Group：黄金规则

### 1.1 官方定义

> **来源**: [Figma Help Center - The difference between frames and groups](https://help.figma.com/hc/en-us/articles/360039832054-The-difference-between-frames-and-groups)

**Group（组）**:
- 默认情况下，**组的尺寸由子元素决定**
- 组的边界会随子元素调整而自动变化
- **不支持相对定位**（无法使用 constraints）
- **无法设置样式属性**（填充、描边、效果等）
- 快捷键：`Cmd/Ctrl + G`

**Frame（框架）**:
- 尺寸由您**明确设置**，独立于子元素
- 可以定义 constraints 影响子元素的调整行为
- **支持 Auto Layout、Layout Guides、Constraints、Prototyping**
- 可以设置填充、描边、圆角、阴影等样式
- 快捷键：`F`

### 1.2 为什么脚本必须使用 Frame？

| 脚本需求 | Frame 支持 | Group 支持 | 后果 |
|---------|-----------|-----------|------|
| **Auto Layout** | ✅ | ❌ | Group 无法自动调整间距、对齐 |
| **动态调整高度** | ✅ | ❌ | `resize_poster_to_fit` 会失败 |
| **Constraints** | ✅ | ❌ | 子元素无法响应父容器变化 |
| **Clip Content** | ✅ | ❌ | 内容溢出容器无法裁剪 |
| **设置填充/描边** | ✅ | ❌ | 脚本无法控制样式 |
| **插入图片填充** | ✅ | ❌ | `set_image_fill` 需要支持 fills 属性 |
| **获取精确尺寸** | ✅ | ⚠️ | Group 尺寸不稳定，依赖子元素 |

### 1.3 错误示例与修正

#### ❌ 错误做法

```
Group "卡片容器"               # 使用 Group（错误）
├─ Text "标题"
├─ Rectangle "背景"
└─ Group "图片容器"            # 嵌套 Group（错误）
    └─ Rectangle "图片"
```

**后果**:
- 脚本无法调用 `resize_poster_to_fit`（无 Auto Layout）
- 高度计算不准确（Group 尺寸随子元素变化）
- 无法控制内边距与间距

#### ✅ 正确做法

```
Frame "卡片容器" (Auto Layout)   # 使用 Frame + Auto Layout
├─ Frame "图片容器" (Fixed)      # 嵌套 Frame
│   └─ Rectangle "图片"
├─ Text "标题"
└─ Text "描述"
```

**配置**:
```typescript
// Frame 属性配置
layoutMode: "VERTICAL"                  // 垂直排列
primaryAxisAlignItems: "MIN"            // 顶部对齐
counterAxisAlignItems: "CENTER"         // 水平居中
itemSpacing: 16                         // 子元素间距 16px
padding: {top: 24, right: 24, bottom: 24, left: 24}  // 内边距
layoutSizingVertical: "HUG"             // 高度自适应内容
```

---

## 二、Auto Layout 配置

### 2.1 官方文档参考

> **来源**: [Figma Help Center - Guide to auto layout](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)

**Auto Layout** 允许 Frame 根据内容变化动态调整尺寸、间距和对齐方式。

**启用方式**:
- 选中 Frame → 按 `Shift + A`
- 或在右侧栏点击 **Add auto layout**

### 2.2 核心属性

| 属性 | 可选值 | 说明 | 脚本影响 |
|------|-------|------|---------|
| **layoutMode** | `NONE` / `HORIZONTAL` / `VERTICAL` | 排列方向 | 影响子元素布局计算 |
| **primaryAxisAlignItems** | `MIN` / `MAX` / `CENTER` / `SPACE_BETWEEN` | 主轴对齐 | `SPACE_BETWEEN` 会忽略 itemSpacing |
| **counterAxisAlignItems** | `MIN` / `MAX` / `CENTER` / `BASELINE` | 交叉轴对齐 | 影响子元素在垂直/水平方向的位置 |
| **itemSpacing** | 数字（像素） | 子元素间距 | 脚本需准确计算容器高度 |
| **padding** | `{top, right, bottom, left}` | 内边距 | 影响 `resize_poster_to_fit` 高度计算 |
| **layoutSizingHorizontal** | `FIXED` / `HUG` / `FILL` | 水平尺寸模式 | `FILL` 需要父容器是 Auto Layout |
| **layoutSizingVertical** | `FIXED` / `HUG` / `FILL` | 垂直尺寸模式 | `HUG` 会根据内容自动调整 |
| **layoutWrap** | `NO_WRAP` / `WRAP` | 是否换行 | 影响多列布局 |

### 2.3 布局模式示例

#### 垂直排列（常用于卡片内容）

```typescript
Frame "卡片内容区"
├─ layoutMode: "VERTICAL"
├─ primaryAxisAlignItems: "MIN"       // 顶部对齐
├─ counterAxisAlignItems: "CENTER"    // 水平居中
├─ itemSpacing: 16                    // 子元素间距 16px
├─ padding: {top: 32, right: 24, bottom: 32, left: 24}
└─ layoutSizingVertical: "HUG"        // 高度自适应
```

#### 水平排列（常用于按钮组、标签栏）

```typescript
Frame "按钮组"
├─ layoutMode: "HORIZONTAL"
├─ primaryAxisAlignItems: "CENTER"    // 水平居中
├─ counterAxisAlignItems: "CENTER"    // 垂直居中
├─ itemSpacing: 12                    // 按钮间距 12px
└─ layoutSizingHorizontal: "HUG"      // 宽度自适应
```

---

## 三、Component Properties（组件属性）

### 3.1 官方文档参考

> **来源**: [Figma Help Center - Explore component properties](https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties)

**Boolean Properties** 用于控制图层的可见性，值为 `true` 显示，`false` 隐藏。

### 3.2 创建 Boolean Property

**步骤**:
1. 选中 **Main Component** 或 Component Set
2. 在右侧栏的 **Properties** 区域点击 **+**
3. 从下拉菜单选择 **Boolean**
4. 命名属性（如 `showTitle`、`showImgSlot2`）
5. 选中要控制的**子图层**
6. 在 **Appearance** 区域点击 **Apply variable/property** 图标
7. 选择刚创建的 Boolean 属性

### 3.3 命名规范

| 推荐命名 | 说明 | 脚本调用 |
|---------|------|---------|
| `showTitle` | 控制标题显示 | `properties: {showTitle: true}` |
| `showSource` | 控制来源显示 | `properties: {showSource: false}` |
| `showImgSlot1` | 控制图片槽位 1 | `properties: {showImgSlot1: true}` |
| `showImgSlot2` | 控制图片槽位 2 | `properties: {showImgSlot2: false}` |

**脚本侧使用** (支持模糊匹配):
```javascript
// 使用 set_instance_properties_by_base（推荐）
await sendCommand('set_instance_properties_by_base', {
  nodeId: instanceId,
  properties: {
    showTitle: true,      // 自动匹配 showTitle#123:456
    showImgSlot2: false   // 自动匹配 showImgSlot2#789:012
  }
});
```

### 3.4 完整属性引用格式

Figma API 内部使用 **PropertyName#ID** 格式（如 `showTitle#123:456`），但本项目的 `set_instance_properties_by_base` 命令已实现**自动模糊匹配**，无需手动查询完整属性名。

**匹配规则**:
- 大小写不敏感（`ShowTitle` = `showTitle`）
- 符号不敏感（`show_title` = `show-title` = `showTitle`）

---

## 四、节点命名规范

### 4.1 语义化命名

脚本通过节点名称查找目标节点，因此命名必须清晰、一致。

| 命名格式 | 示例 | 用途 |
|---------|------|------|
| `slot:XXX` | `slot:IMAGE_GRID` | 内容槽位（容器） |
| `slot:YYY` | `slot:TITLE`, `slot:SOURCE` | 文本/图片槽位 |
| `xxxText` | `titleText`, `sourceText` | 文本节点 |
| `imgSlotN` | `imgSlot1`, `imgSlot2` | 图片槽位（编号） |
| `xxxContainer` | `ContentContainer` | 容器节点 |

### 4.2 名称标准化

脚本会自动标准化节点名称（Unicode NFKC + 去除空格/零宽字符），但建议手动遵循以下规范：

- ✅ 使用半角字符（`slot:IMAGE` 而非 `ｓｌｏｔ：ＩＭＡＧＥ`）
- ✅ 避免末尾空格（`titleText` 而非 `titleText `）
- ✅ 避免特殊字符（零宽字符、控制字符）

---

## 五、文本节点配置

### 5.1 文本自动调整模式

| textAutoResize | 效果 | 适用场景 |
|----------------|------|---------|
| `HEIGHT` | 固定宽度，高度自适应 | 标题、段落文本（推荐） |
| `WIDTH_AND_HEIGHT` | 宽高都自适应 | 标签、按钮文本 |
| `NONE` | 固定尺寸（可能截断） | 特殊用途，不推荐 |

### 5.2 布局尺寸模式（layoutSizing）

| layoutSizingHorizontal | layoutSizingVertical | 效果 | 适用场景 |
|----------------------|---------------------|------|---------|
| `FILL` | `HUG` | 宽度填满父容器，高度自适应 | 卡片标题、描述 |
| `HUG` | `HUG` | 宽高都自适应内容 | 标签、按钮 |
| `FIXED` | `FIXED` | 固定尺寸 | 特殊用途 |

### 5.3 推荐配置

```typescript
Text "标题"
├─ textAutoResize: "HEIGHT"              // 高度自适应
├─ layoutSizingHorizontal: "FILL"        // 宽度填满
├─ layoutSizingVertical: "HUG"           // 高度收缩
└─ textAlignHorizontal: "LEFT"           // 左对齐
```

**脚本侧调用**:
```javascript
await figma.setText(titleNodeId, '标题文本', {
  autoResize: 'HEIGHT',      // 高度自适应
  layoutSizingH: 'FILL',     // 宽度填满
  flush: true                // 刷新布局
});
```

---

## 六、图片节点配置

### 6.1 支持图片填充的节点类型

| 节点类型 | 支持 fills | 推荐用途 |
|---------|-----------|---------|
| **Frame** | ✅ | 图片容器（可设置圆角、阴影） |
| **Rectangle** | ✅ | 简单图片（推荐） |
| **Ellipse** | ✅ | 圆形头像 |
| **Polygon / Star** | ✅ | 特殊形状图片 |
| **Group** | ❌ | 不支持（无法填充） |
| **Text** | ❌ | 不支持 |

### 6.2 图片容器推荐配置

```typescript
Frame "图片槽位"
├─ layoutSizingHorizontal: "FIXED"      // 固定宽度
├─ layoutSizingVertical: "FIXED"        // 固定高度
├─ clipsContent: true                   // 裁剪溢出内容
└─ fills: [{type: "IMAGE", scaleMode: "FILL"}]  // 图片填充模式
```

**scaleMode 选项**:
- `FILL`: 填满容器（推荐，可能裁剪）
- `FIT`: 完整显示图片（可能留白）
- `CROP`: 裁剪模式
- `TILE`: 平铺模式

### 6.3 脚本侧调用

```javascript
// URL-first + Base64 fallback（推荐）
await figma.fillImage(nodeId, imageUrl, assetData);

// 或手动调用
await sendCommand('set_image_fill', {
  nodeId,
  imageUrl: 'http://localhost:3056/assets/image.png',
  scaleMode: 'FILL',
  opacity: 1
});
```

---

## 七、高度自适应配置

### 7.1 resize_poster_to_fit 要求

脚本使用 `resize_poster_to_fit` 命令自动调整海报高度，需要满足：

**前提条件**:
1. **根容器必须是 Frame**（不能是 Group）
2. **根容器启用 Auto Layout**（layoutMode 不为 `NONE`）
3. **锚点节点存在且可查找**（名称匹配）
4. **锚点节点在根容器内部**（直接或间接子节点）

### 7.2 锚点命名规范

| 锚点名称 | 作用 | 说明 |
|---------|------|------|
| `ContentAndPlate` | 主要内容区 + 装饰板 | 首选锚点 |
| `ContentContainer` | 内容容器 | 备选锚点 |
| `slot:CARDS_STACK` | 卡片堆栈 | 降级锚点 |

**脚本侧配置**:
```javascript
await sendCommand('resize_poster_to_fit', {
  posterId: rootId,
  anchorNames: ['ContentAndPlate', 'ContentContainer', 'slot:CARDS_STACK'],
  bottomPadding: 200,                    // 底部留白
  allowShrink: true,                     // 允许缩小
  excludeByNameRegex: '(?:^背景$|^Background$|SignalPlus Logo)'
});
```

### 7.3 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `找不到锚点` | 锚点名称不匹配 | 检查节点名称拼写 |
| `高度调整失败` | 根容器不是 Frame | 使用 Frame 替代 Group |
| `高度计算不准` | 未调用 flush_layout | 调用前先 `await figma.flushLayout()` |
| `锚点找到错误的节点` | 多个海报有同名节点 | 使用 excludeByNameRegex 排除其他海报 |

---

## 八、完整组件示例

### 8.1 标准卡片组件结构

```
Component "shortCard" (主组件)
│
├─ Frame "卡片根容器" (Auto Layout VERTICAL)
│   ├─ layoutMode: VERTICAL
│   ├─ primaryAxisAlignItems: MIN
│   ├─ itemSpacing: 16
│   ├─ padding: {24, 24, 24, 24}
│   ├─ layoutSizingHorizontal: FIXED (1080px)
│   └─ layoutSizingVertical: HUG
│
│   ├─ Frame "slot:IMAGE_GRID" (图片网格)
│   │   ├─ layoutMode: HORIZONTAL
│   │   ├─ itemSpacing: 8
│   │   ├─ layoutSizingHorizontal: FILL
│   │   ├─ layoutSizingVertical: FIXED (600px)
│   │   │
│   │   ├─ Frame "imgSlot1" (图片槽位 1)
│   │   │   ├─ layoutSizingHorizontal: FILL
│   │   │   ├─ layoutSizingVertical: FILL
│   │   │   ├─ clipsContent: true
│   │   │   └─ fills: [{type: "IMAGE", scaleMode: "FILL"}]
│   │   │
│   │   └─ Frame "imgSlot2" (图片槽位 2)
│   │       └─ (同 imgSlot1 配置)
│   │
│   ├─ Frame "slot:TITLE" (标题容器)
│   │   ├─ layoutSizingHorizontal: FILL
│   │   └─ Text "titleText"
│   │       ├─ textAutoResize: HEIGHT
│   │       ├─ layoutSizingHorizontal: FILL
│   │       └─ fontSize: 32, fontWeight: 700
│   │
│   └─ Frame "slot:SOURCE" (来源容器)
│       ├─ layoutSizingHorizontal: FILL
│       └─ Text "sourceText"
│           ├─ textAutoResize: HEIGHT
│           ├─ layoutSizingHorizontal: FILL
│           └─ fontSize: 18, fontWeight: 400
│
└─ Component Properties
    ├─ showTitle (Boolean) → 控制 slot:TITLE 可见性
    ├─ showSource (Boolean) → 控制 slot:SOURCE 可见性
    ├─ showImgSlot1 (Boolean) → 控制 imgSlot1 可见性
    └─ showImgSlot2 (Boolean) → 控制 imgSlot2 可见性
```

### 8.2 组件属性绑定

**在 Figma 中操作**:
1. 选中 `slot:TITLE` Frame
2. 在右侧栏 **Appearance** 区域点击 **Visible** 旁的图标
3. 选择 **showTitle** Boolean 属性
4. 对其他槽位重复此操作

**验证**:
- 在组件实例中切换 `showTitle` 开关，对应槽位应显示/隐藏

---

## 九、调试检查清单

### 9.1 组件设计验证

运行脚本前，请在 Figma 中验证：

- [ ] 根容器是 **Frame**（点击查看图层类型）
- [ ] 根容器已启用 **Auto Layout**（右侧栏显示 Auto Layout 属性）
- [ ] 所有图片槽位是 **Frame 或 Rectangle**
- [ ] 文本节点设置了 **textAutoResize: HEIGHT**
- [ ] Component Properties 已正确绑定到对应图层的 **Visible** 属性
- [ ] 节点命名符合规范（无拼写错误、无多余空格）

### 9.2 脚本运行前检查

- [ ] WebSocket 服务器正在运行（`bun socket`）
- [ ] Figma 插件已加入正确频道
- [ ] 组件已发布（Publish Component）
- [ ] 使用本 Fork 版本的插件（不是 Figma 社区原版）

### 9.3 常见错误与排查

| 错误信息 | 可能原因 | 排查方法 |
|---------|---------|---------|
| `找不到组件 XXX` | 组件未发布或名称错误 | 检查组件名称拼写 |
| `找不到节点 slot:YYY` | 节点名称不匹配 | 使用 `get_node_info` 查看子节点列表 |
| `set_image_fill 失败` | 节点不支持 fills | 确认节点是 Frame/Rectangle |
| `resize_poster_to_fit 失败` | 根容器不是 Frame | 转换 Group 为 Frame |
| `文本溢出容器` | 未设置 textAutoResize | 设置为 HEIGHT |
| `高度计算不准` | 未调用 flush_layout | 调用 `await figma.flushLayout()` |

---

## 十、参考资源

### 10.1 Figma 官方文档

- [The difference between frames and groups](https://help.figma.com/hc/en-us/articles/360039832054-The-difference-between-frames-and-groups)
- [Guide to auto layout](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)
- [Explore component properties](https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties)
- [Figma Plugin API - Node Types](https://www.figma.com/plugin-docs/api/nodes/)
- [Figma Plugin API - FrameNode](https://www.figma.com/plugin-docs/api/FrameNode/)

### 10.2 本项目文档

- [INSTALLATION.md](INSTALLATION.md) - 安装与配置
- [DEVELOPMENT.md](DEVELOPMENT.md) - 开发自定义脚本
- [PITFALLS.md](PITFALLS.md) - 避坑指南（9 个常见错误）
- [ARCHITECTURE_FLOW.md](ARCHITECTURE_FLOW.md) - 架构流程图

---

**文档版本**: v1.0
**维护者**: logicrw
**基于**: Figma Official Documentation (2024-2025)
**最后更新**: 2025-10-05
