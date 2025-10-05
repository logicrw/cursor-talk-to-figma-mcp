# Cursor Talk to Figma MCP

> **Fork 版本说明 (Fork Version Notice)**
>
> 本项目是 [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp) 的 fork 版本。
>
> **Fork 起点**: Commit [8513030](https://github.com/grab/cursor-talk-to-figma-mcp/commit/8513030755c4f6fcf43a930f42ba9afcbfab29bd) (2025-08-30)
>
> **当前状态**: 154 个提交，包含大量功能改进与代码优化
>
> **核心改进**:
> - 无种子组件创建（Seedless Architecture）- 基于 Figma 官方 `setProperties` API
> - URL-first 图片填充策略 - 静态服务器 + Base64 降级 + 限流机制
> - 海报高度自适应系统 - 递归锚点测量 + 范围限制 + 统一调整时机
> - 生产级自动化脚本 - `run_weekly_poster.js` + `run_article_images.js`
> - 代码优化与清理 - 统一 API，删除 3783 行废弃代码，净减少业务逻辑 91 行
>
> **文档**: 本 Fork 版本提供完整的中文文档，详见下方[文档索引](#文档索引)。

---

## 项目定位

本 Fork 版本专注于**生产级 Figma 自动化脚本开发**，适用于批量内容生成、周期性海报制作等场景。

### 核心能力

- **周报海报自动化**: 自动生成三联海报（`run_weekly_poster.js`）
- **多语言短图生成**: 批量生成文章配图（`run_article_images.js`）
- **图片填充策略**: URL-first + Base64 降级 + 限流机制
- **布局自适应**: 海报高度自动调整、文本自动换行
- **组件控制**: 基于 Figma 官方 API 的组件属性控制

### 与原项目的对比

| 对比项 | 原作者版本 | 本 Fork 版本 |
|--------|-----------|------------|
| **定位** | MCP 工具库（需配合 AI） | 生产级自动化脚本（独立运行） |
| **使用方式** | 在 Claude Code 中用自然语言操作 | 直接运行 Node.js 脚本 |
| **核心产物** | 57 个 MCP 工具 | 2 个完整工作流脚本 + 优化后的 MCP 工具 |
| **适用场景** | 探索性设计、AI 辅助设计 | 批量内容生成、周期性自动化 |
| **稳定性** | 实验性 | 生产验证（148 commits） |

### 使用模式

**模式 1: 直接运行脚本（推荐，无需 MCP）**

```bash
# 启动 WebSocket 服务器
bun socket

# 运行周报海报生成脚本
node scripts/run_weekly_poster.js --channel test-channel
```

适用场景：批量生成海报、定期自动化任务、生产环境部署

**模式 2: 配合 Claude Code 使用（需配置 MCP）**

```bash
# 在 Claude Code 中用自然语言操作 Figma
"帮我创建一个卡片，标题是 XXX，图片是 XXX"
"把这个节点的颜色改成红色"
"导出当前选中的节点为 PNG"
```

适用场景：探索性设计、原型验证、开发调试

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **Bun** >= 1.0
- **Figma Desktop** 应用（必须是桌面版，不支持浏览器版）

### 安装步骤

**步骤 1: 克隆项目**

```bash
git clone https://github.com/logicrw/cursor-talk-to-figma-mcp.git
cd cursor-talk-to-figma-mcp
```

**步骤 2: 安装依赖并构建**

```bash
bun install
bun run build
```

**步骤 3: 导入 Figma 插件**

> **重要**: 本 Fork 版本对插件进行了大量修改，**必须本地导入**，不能使用 Figma 社区的原版插件。

1. 打开 Figma Desktop 应用
2. 菜单栏选择 **Plugins** > **Development** > **Import plugin from manifest...**
3. 选择文件：`src/cursor_mcp_plugin/manifest.json`
4. 插件将出现在开发插件列表中，名称为 **Cursor MCP Plugin**

**步骤 4: 启动 WebSocket 服务器**

```bash
bun socket
```

保持此终端窗口运行。

**步骤 5: 运行示例脚本**

打开新的终端窗口：

```bash
# 在 Figma 中运行插件，输入频道名称 "test-channel" 并点击 Join
# 然后在终端执行：
node scripts/run_weekly_poster.js --channel test-channel
```

如果在 Figma 中看到海报生成，说明安装成功。

---

**完整安装指南**: [docs/INSTALLATION.md](docs/INSTALLATION.md)

**遇到问题**: [docs/PITFALLS.md](docs/PITFALLS.md)

---

## 项目结构

```
cursor-talk-to-figma-mcp/
├── scripts/                          # 生产脚本
│   ├── run_weekly_poster.js          # 周报三海报生成器
│   ├── run_article_images.js         # 多语言短图生成器
│   └── figma-ipc.js                  # 共享通信层（可复用）
│
├── src/
│   ├── talk_to_figma_mcp/            # MCP 服务器（57 个工具）
│   ├── cursor_mcp_plugin/            # Figma 插件（已大量修改）
│   ├── socket.ts                     # WebSocket 中继服务器
│   ├── config-resolver.js            # 内容路径解析
│   └── static-server.js              # 静态资源服务器
│
├── config/
│   └── server-config.json            # 核心配置文件
│
└── docs/                             # 文档目录
    ├── INSTALLATION.md               # 安装指南
    ├── DEVELOPMENT.md                # 开发指南
    ├── PITFALLS.md                   # 避坑指南
    ├── FIGMA_COMPONENT_GUIDE.md      # Figma 组件设计规范
    ├── ARCHITECTURE_FLOW.md          # 架构流程图
    └── OPTIMIZATION_SUMMARY.md       # 优化记录
```

---

## 文档索引

### 新手必读（按顺序阅读）

1. **README.md（本文档）** - 理解项目定位与使用模式
2. [docs/INSTALLATION.md](docs/INSTALLATION.md) - 完成安装配置（约 15 分钟）
3. [docs/PITFALLS.md](docs/PITFALLS.md) - 避免常见错误（强烈推荐）
4. [docs/FIGMA_COMPONENT_GUIDE.md](docs/FIGMA_COMPONENT_GUIDE.md) - Figma 组件设计规范（设计师必读）
5. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 开发自定义脚本（开发者）

### 完整文档列表

| 文档 | 用途 | 适用人群 |
|------|------|---------|
| [INSTALLATION.md](docs/INSTALLATION.md) | 安装与配置指南 | 所有用户 |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发自定义脚本 | 开发者 |
| [PITFALLS.md](docs/PITFALLS.md) | 避坑指南（9 个常见错误） | 所有用户 |
| [FIGMA_COMPONENT_GUIDE.md](docs/FIGMA_COMPONENT_GUIDE.md) | Figma 组件设计规范 | 设计师、开发者 |
| [ARCHITECTURE_FLOW.md](docs/ARCHITECTURE_FLOW.md) | 架构流程图 | 开发者 |
| [OPTIMIZATION_SUMMARY.md](docs/OPTIMIZATION_SUMMARY.md) | 代码优化记录 | 开发者 |

---

## 常见问题

<details>
<summary><b>Q1: 我需要配置 MCP 吗？</b></summary>

**答**：大多数情况下不需要。

- **不需要 MCP**: 直接运行脚本生成海报（推荐）
- **需要 MCP**: 在 Claude Code 中用自然语言操作 Figma

详见 [INSTALLATION.md 第五章](docs/INSTALLATION.md#五配置-mcp-服务器可选---仅-ai-辅助时需要)
</details>

<details>
<summary><b>Q2: 能用 Figma 社区的插件吗？</b></summary>

**答**：不能。本 Fork 版本对插件进行了大量修改，必须本地导入。

详见 [INSTALLATION.md 第三章](docs/INSTALLATION.md#三配置-figma-插件)
</details>

<details>
<summary><b>Q3: 脚本运行失败怎么办？</b></summary>

**答**：常见问题及解决方案见 [PITFALLS.md](docs/PITFALLS.md)。

最常见的 3 个问题：
1. `flush_layout` 调用时机不正确
2. 海报高度调整时机不正确
3. 误用了原版插件而非 Fork 版本插件
</details>

<details>
<summary><b>Q4: 为什么脚本报错"找不到节点"或"高度调整失败"？</b></summary>

**答**：通常是因为 Figma 组件设计不符合要求。

| 错误现象 | 可能原因 | 解决方案 |
|---------|---------|---------|
| 找不到节点 | 节点命名不规范 | 使用 `slot:XXX` 格式命名 |
| 高度调整失败 | 根容器使用了 Group | 转换为 Frame（快捷键 `F`） |
| 图片填充失败 | 图片容器使用了 Group | 使用 Frame 或 Rectangle |
| 文本溢出 | 未设置 textAutoResize | 设置为 `HEIGHT` |
| Auto Layout 不生效 | 使用了 Group | Group 不支持 Auto Layout |

详见 [FIGMA_COMPONENT_GUIDE.md](docs/FIGMA_COMPONENT_GUIDE.md)
</details>

<details>
<summary><b>Q5: MCP 对开发脚本有什么帮助？</b></summary>

**答**：MCP 在开发调试阶段有用，但生产环境不需要。

主要用途：
- 快速验证节点名称与结构
- 测试 API 调用参数
- 用 AI 生成脚本框架
- 错误分析

推荐工作流：
1. **开发阶段**: 用 MCP + Claude Code 探索文件结构、验证 API
2. **生产阶段**: 直接运行脚本，无需 MCP

详见 [INSTALLATION.md - MCP 对脚本开发的帮助](docs/INSTALLATION.md#mcp-对脚本开发的帮助)
</details>

---

## 原作者内容 (Original Author's Content)

> **注意**: 以下内容来自原作者 [@sonnylazuardi](https://github.com/sonnylazuardi)，保留用于参考。
>
> 本 Fork 版本已提供更完整的中文文档，建议优先阅读上述[文档索引](#文档索引)。

### 视频教程 (Original Video Tutorial)

原作者演示视频: [LinkedIn 视频链接](https://www.linkedin.com/posts/sonnylazuardi_just-wanted-to-share-my-latest-experiment-activity-7307821553654657024-yrh8)

### 设计自动化示例 (Original Design Automation Examples)

**批量文本内容替换**

贡献者 [@dusskapark](https://github.com/dusskapark) 的批量文本替换功能。[演示视频](https://www.youtube.com/watch?v=j05gGT3xfCs)

**组件实例覆盖传播**

贡献者 [@dusskapark](https://github.com/dusskapark) 的组件实例覆盖传播功能，可将源组件实例的覆盖属性传播到多个目标实例。[演示视频](https://youtu.be/uvuT8LByroI)

### MCP 工具完整列表 (Complete MCP Tools Reference)

<details>
<summary>展开查看 57 个 MCP 工具详细说明</summary>

MCP 服务器提供以下工具与 Figma 交互：

#### Document & Selection

- `get_document_info` - Get information about the current Figma document
- `get_selection` - Get information about the current selection
- `read_my_design` - Get detailed node information about the current selection without parameters
- `get_node_info` - Get detailed information about a specific node
- `get_nodes_info` - Get detailed information about multiple nodes by providing an array of node IDs
- `set_focus` - Set focus on a specific node by selecting it and scrolling viewport to it
- `set_selections` - Set selection to multiple nodes and scroll viewport to show them

#### Annotations

- `get_annotations` - Get all annotations in the current document or specific node
- `set_annotation` - Create or update an annotation with markdown support
- `set_multiple_annotations` - Batch create/update multiple annotations efficiently
- `scan_nodes_by_types` - Scan for nodes with specific types (useful for finding annotation targets)

#### Prototyping & Connections

- `get_reactions` - Get all prototype reactions from nodes with visual highlight animation
- `set_default_connector` - Set a copied FigJam connector as the default connector style
- `create_connections` - Create FigJam connector lines between nodes

#### Creating Elements

- `create_rectangle` - Create a new rectangle with position, size, and optional name
- `create_frame` - Create a new frame with position, size, and optional name
- `create_text` - Create a new text node with customizable font properties

#### Modifying Text Content

- `scan_text_nodes` - Scan text nodes with intelligent chunking for large designs
- `set_text_content` - Set the text content of a single text node
- `set_multiple_text_contents` - Batch update multiple text nodes efficiently

#### Auto Layout & Spacing

- `set_layout_mode` - Set the layout mode and wrap behavior of a frame
- `set_padding` - Set padding values for an auto-layout frame
- `set_axis_align` - Set primary and counter axis alignment for auto-layout frames
- `set_layout_sizing` - Set horizontal and vertical sizing modes for auto-layout frames
- `set_item_spacing` - Set distance between children in an auto-layout frame

#### Styling

- `set_fill_color` - Set the fill color of a node (RGBA)
- `set_stroke_color` - Set the stroke color and weight of a node
- `set_corner_radius` - Set the corner radius of a node with optional per-corner control

#### Layout & Organization

- `move_node` - Move a node to a new position
- `resize_node` - Resize a node with new dimensions
- `delete_node` - Delete a node
- `delete_multiple_nodes` - Delete multiple nodes at once efficiently
- `clone_node` - Create a copy of an existing node with optional position offset

#### Components & Styles

- `get_styles` - Get information about local styles
- `get_local_components` - Get information about local components
- `create_component_instance` - Create an instance of a component
- `get_instance_overrides` - Extract override properties from a selected component instance
- `set_instance_overrides` - Apply extracted overrides to target instances

#### Export & Advanced

- `export_node_as_image` - Export a node as an image (PNG, JPG, SVG, or PDF)

#### Connection Management

- `join_channel` - Join a specific channel to communicate with Figma

#### MCP Prompts

- `design_strategy` - Best practices for working with Figma designs
- `read_design_strategy` - Best practices for reading Figma designs
- `text_replacement_strategy` - Systematic approach for replacing text in Figma designs
- `annotation_conversion_strategy` - Strategy for converting manual annotations to Figma's native annotations
- `swap_overrides_instances` - Strategy for transferring overrides between component instances
- `reaction_to_connector_strategy` - Strategy for converting Figma prototype reactions to connector lines

</details>

### 原作者安装指南 (Original Installation Guide)

<details>
<summary>展开查看原作者的安装与配置说明</summary>

> **注意**: 本 Fork 版本已提供更完整的中文安装指南，详见 [docs/INSTALLATION.md](docs/INSTALLATION.md)。

#### MCP 服务器配置 (MCP Server Setup)

将服务器添加到 Cursor MCP 配置 `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "bunx",
      "args": ["cursor-talk-to-figma-mcp@latest"]
    }
  }
}
```

#### 开发环境配置 (Development Setup)

开发时，更新 MCP 配置指向本地目录：

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

#### WebSocket 服务器 (WebSocket Server)

启动 WebSocket 服务器:

```bash
bun socket
```

#### Figma 插件 (Figma Plugin)

1. 在 Figma 中，点击 Plugins > Development > New Plugin
2. 选择 "Link existing plugin"
3. 选择 `src/cursor_mcp_plugin/manifest.json` 文件
4. 插件现在应该出现在 Figma 开发插件列表中

#### Windows + WSL 指南 (Windows + WSL Guide)

1. 通过 PowerShell 安装 Bun:

```bash
powershell -c "irm bun.sh/install.ps1|iex"
```

2. 取消注释 `src/socket.ts` 中的 hostname `0.0.0.0`:

```typescript
// uncomment this to allow connections in windows wsl
hostname: "0.0.0.0",
```

3. 启动 WebSocket:

```bash
bun socket
```

#### 使用方法 (Usage)

1. 启动 WebSocket 服务器
2. 在 Cursor 中安装 MCP 服务器
3. 打开 Figma 并运行 Cursor MCP 插件
4. 使用 `join_channel` 加入频道，连接插件到 WebSocket 服务器
5. 使用 Cursor 通过 MCP 工具与 Figma 通信

</details>

### 最佳实践 (Original Best Practices)

<details>
<summary>展开查看原作者的最佳实践建议</summary>

使用 Figma MCP 时：

1. 发送命令前始终加入频道
2. 首先使用 `get_document_info` 获取文档概览
3. 修改前使用 `get_selection` 检查当前选区
4. 根据需求使用适当的创建工具
5. 使用 `get_node_info` 验证更改
6. 尽可能使用组件实例以保持一致性
7. 适当处理错误，所有命令都可能抛出异常
8. 对于大型设计，在 `scan_text_nodes` 中使用分块参数
9. 对于文本操作，尽可能使用批量操作
10. 对于转换旧版注释，使用 `get_annotations` 和 `set_multiple_annotations`

</details>

---

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request。

贡献前请阅读 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

---

**文档版本**: v2.0
**维护者**: logicrw
**原作者**: [@sonnylazuardi](https://github.com/sonnylazuardi)
**最后更新**: 2025-10-05
