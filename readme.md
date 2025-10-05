# Cursor Talk to Figma MCP

> **🔱 Fork 版本说明 / Fork Version Notice**
>
> 本项目是 [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp) 的 fork 版本，在尊重原作者版权的基础上进行了大量改进与功能扩展。自 fork 点 [8513030](https://github.com/grab/cursor-talk-to-figma-mcp/commit/8513030755c4f6fcf43a930f42ba9afcbfab29bd) 以来，本项目已积累 **146+ 个提交**，包含以下核心改进：
>
> **核心改进 / Key Improvements:**
> - ✅ **无种子组件创建（Seedless Architecture）**: 使用 Figma 官方 `setProperties` API 直接控制组件，替代早期的 seed cloning 模式
> - ✅ **URL-first 图片填充策略**: 静态服务器 + Base64 降级 + 限流机制，解决大规模图片传输问题
> - ✅ **海报高度自适应系统**: 递归锚点测量 + 范围限制 + 统一调整时机，实现稳定的布局计算
> - ✅ **生产级脚本**: `run_weekly_poster.js`（周报三海报）+ `run_article_images.js`（多语言短图），完整工作流自动化
> - ✅ **代码优化与清理**: 统一 API（fillImage/flushLayout/setText），删除 3783 行废弃代码，净减少业务逻辑 91 行
>
> **安装与使用 / Installation & Usage:**
> 详见 [📖 docs/INSTALLATION.md](docs/INSTALLATION.md)（中文快速上手指南）
>
> **开发指南 / Development Guide:**
> 详见 [🛠️ docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)（如何基于本项目开发自定义脚本）
>
> **避坑指南 / Pitfalls Guide:**
> 详见 [⚠️ docs/PITFALLS.md](docs/PITFALLS.md)（血泪教训总结，防止重复踩坑）
>
> ---

本项目实现了 Model Context Protocol (MCP) 集成，连接 Cursor AI / Claude Code 与 Figma，允许 AI 读取设计文件并通过编程方式修改 Figma 设计。

https://github.com/user-attachments/assets/129a14d2-ed73-470f-9a4c-2240b2a4885c

## 项目结构

- `src/talk_to_figma_mcp/` - TypeScript MCP 服务器（Figma 集成）
- `src/cursor_mcp_plugin/` - Figma 插件（与 Cursor 通信）
- `src/socket.ts` - WebSocket 服务器（MCP 服务器与 Figma 插件之间的中继）
- `scripts/` - 生产级自动化脚本（周报海报、文章配图生成）
- `config/` - 配置文件（WebSocket、静态服务器、映射规则）

## 快速开始

**详细安装指南请查看 [📖 docs/INSTALLATION.md](docs/INSTALLATION.md)**

### 简要步骤

1. 安装 Bun（如果尚未安装）:

```bash
curl -fsSL https://bun.sh/install | bash
```

2. 运行安装脚本（会自动安装 MCP 到当前项目）:

```bash
bun setup
```

3. 启动 WebSocket 服务器:

```bash
bun socket
```

4. **新增** 从 [Figma 社区页面](https://www.figma.com/community/plugin/1485687494525374295/cursor-talk-to-figma-mcp-plugin) 安装插件，或[本地安装](#figma-插件)

## 视频教程

[视频链接](https://www.linkedin.com/posts/sonnylazuardi_just-wanted-to-share-my-latest-experiment-activity-7307821553654657024-yrh8)

## 设计自动化示例

**批量文本内容替换**

感谢 [@dusskapark](https://github.com/dusskapark) 贡献的批量文本替换功能。[演示视频](https://www.youtube.com/watch?v=j05gGT3xfCs)

**组件实例覆盖传播**

[@dusskapark](https://github.com/dusskapark) 的另一个贡献：将源组件实例的覆盖属性传播到多个目标实例，一键完成。显著减少处理相似组件自定义时的重复工作。[演示视频](https://youtu.be/uvuT8LByroI)

## 开发环境配置

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

## 手动安装与配置

### MCP 服务器: 与 Cursor 集成

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

### WebSocket 服务器

启动 WebSocket 服务器:

```bash
bun socket
```

### Figma 插件

1. 在 Figma 中，点击 Plugins > Development > New Plugin
2. 选择 "Link existing plugin"
3. 选择 `src/cursor_mcp_plugin/manifest.json` 文件
4. 插件现在应该出现在 Figma 开发插件列表中

## Windows + WSL 指南

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

## 使用方法

1. 启动 WebSocket 服务器
2. 在 Cursor 中安装 MCP 服务器
3. 打开 Figma 并运行 Cursor MCP 插件
4. 使用 `join_channel` 加入频道，连接插件到 WebSocket 服务器
5. 使用 Cursor 通过 MCP 工具与 Figma 通信

## 周报海报工作流 (DOCX → Figma)

本仓库包含端到端工作流，将周报 DOCX 内容（预先转换为 JSON）基于固定模板生成 Figma 海报。

### 步骤
- 启动 WebSocket 中继: `bun socket`
- 打开 Figma，运行 "Cursor Talk To Figma MCP" 插件
- 在插件 UI 中设置稳定的 `Channel`（或通过 `--channel` 参数传递给脚本）
- 运行编排脚本:

```bash
# 自动发现 docx2json/ 下的最新内容 JSON
node scripts/run_weekly_poster.js --channel my-weekly

# 或指定特定内容 JSON
node scripts/run_weekly_poster.js --content ./docx2json/250818_summer_break_content.json --channel weekly-250818
```

### 注意事项
- 每个数据集无需手动编辑配置。数据集从 `assets[0].filename` 或内容文件名推断。
- 图片优先通过 URL 获取。如果静态服务器不可用，脚本会自动降级到 Base64 模式并限流（`config.asset_transfer.base64_rate_limit`）。
- 标题字段（title/date/month）从 `content.doc` 填充，所有文本节点设置为自动调整高度（HEIGHT）。
- 可见性由运行时发现的组件布尔属性驱动（无硬编码 `PropertyName#ID`）。缺失的非必需图片可见性属性默认隐藏。

### 验收标准
- 每周零手动编辑；图片按数据集自动解析。
- 正确的卡片数量/顺序/可见性，标题已填充；文本自动调整。
- 频道通过 UI 字段或 `--channel` 参数显式指定且可复现。

## 静态资源服务器

静态服务器暴露 `docx2json/assets`，具有严格的路径规范化。

### 配置示例
```json
{
  "static_server": {
    "port": 3056,
    "host": "127.0.0.1",
    "baseDir": "../docx2json/assets",
    "publicRoute": "/assets"
  }
}
```

### 路由
- `GET /assets/<dataset>/<filename>` → 提供 `docx2json/assets/<dataset>/<filename>`（安全路径拼接）

### 快速检查
```bash
node src/static-server.js &
curl -I http://127.0.0.1:3056/assets/250818_summer_break/img_76f7bfb095b6.png   # 200
curl -I 'http://127.0.0.1:3056/assets/../../etc/passwd'                         # 403
curl -I http://127.0.0.1:3056/assets/250818_summer_break/not-exist.png          # 404
```

## Documentation / 文档索引

### 中文文档（Fork 版本专属）

| 文档 | 用途 | 适用人群 |
|------|------|---------|
| [📖 docs/INSTALLATION.md](docs/INSTALLATION.md) | 安装与快速上手指南 | 新用户、使用者 |
| [🛠️ docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发指南（如何开发自定义脚本） | 开发者 |
| [⚠️ docs/PITFALLS.md](docs/PITFALLS.md) | 避坑指南（血泪教训总结） | 所有人（强烈推荐） |
| [📐 docs/ARCHITECTURE-FLOW.md](docs/ARCHITECTURE-FLOW.md) | 架构流程图（完整技术架构） | 开发者 |
| [📊 docs/OPTIMIZATION_SUMMARY.md](docs/OPTIMIZATION_SUMMARY.md) | 优化记录（Phase 1-2 代码优化） | 开发者 |

### English Documentation (Original)

See sections below for original documentation in English.

---

## 故障排查

- **Figma 插件未连接**: 确保 `bun socket` 正在运行，并且 UI 和脚本中使用相同的频道名称。
- **图片不显示**: 验证静态服务器可访问；如果不可用，Base64 降级应自动启用（查看日志）。如需调整，修改 `config/server-config.json` 中的 `asset_transfer.base64_max_size`/`base64_rate_limit`。
- **属性发现快速失败**: 如果必需属性（如 `showTitle`、`showSource`）无法映射，工作流将停止并列出可用的基础名称—相应地重命名模板中的布尔属性。

详细避坑指南请查看 [⚠️ docs/PITFALLS.md](docs/PITFALLS.md)

## MCP 工具列表

MCP 服务器提供以下工具与 Figma 交互：

### Document & Selection

- `get_document_info` - Get information about the current Figma document
- `get_selection` - Get information about the current selection
- `read_my_design` - Get detailed node information about the current selection without parameters
- `get_node_info` - Get detailed information about a specific node
- `get_nodes_info` - Get detailed information about multiple nodes by providing an array of node IDs
- `set_focus` - Set focus on a specific node by selecting it and scrolling viewport to it
- `set_selections` - Set selection to multiple nodes and scroll viewport to show them

### Annotations

- `get_annotations` - Get all annotations in the current document or specific node
- `set_annotation` - Create or update an annotation with markdown support
- `set_multiple_annotations` - Batch create/update multiple annotations efficiently
- `scan_nodes_by_types` - Scan for nodes with specific types (useful for finding annotation targets)

### Prototyping & Connections

- `get_reactions` - Get all prototype reactions from nodes with visual highlight animation
- `set_default_connector` - Set a copied FigJam connector as the default connector style for creating connections (must be set before creating connections)
- `create_connections` - Create FigJam connector lines between nodes, based on prototype flows or custom mapping

### Creating Elements

- `create_rectangle` - Create a new rectangle with position, size, and optional name
- `create_frame` - Create a new frame with position, size, and optional name
- `create_text` - Create a new text node with customizable font properties

### Modifying text content

- `scan_text_nodes` - Scan text nodes with intelligent chunking for large designs
- `set_text_content` - Set the text content of a single text node
- `set_multiple_text_contents` - Batch update multiple text nodes efficiently

### Auto Layout & Spacing

- `set_layout_mode` - Set the layout mode and wrap behavior of a frame (NONE, HORIZONTAL, VERTICAL)
- `set_padding` - Set padding values for an auto-layout frame (top, right, bottom, left)
- `set_axis_align` - Set primary and counter axis alignment for auto-layout frames
- `set_layout_sizing` - Set horizontal and vertical sizing modes for auto-layout frames (FIXED, HUG, FILL)
- `set_item_spacing` - Set distance between children in an auto-layout frame

### Styling

- `set_fill_color` - Set the fill color of a node (RGBA)
- `set_stroke_color` - Set the stroke color and weight of a node
- `set_corner_radius` - Set the corner radius of a node with optional per-corner control

### Layout & Organization

- `move_node` - Move a node to a new position
- `resize_node` - Resize a node with new dimensions
- `delete_node` - Delete a node
- `delete_multiple_nodes` - Delete multiple nodes at once efficiently
- `clone_node` - Create a copy of an existing node with optional position offset

### Components & Styles

- `get_styles` - Get information about local styles
- `get_local_components` - Get information about local components
- `create_component_instance` - Create an instance of a component
- `get_instance_overrides` - Extract override properties from a selected component instance
- `set_instance_overrides` - Apply extracted overrides to target instances

### Export & Advanced

- `export_node_as_image` - Export a node as an image (PNG, JPG, SVG, or PDF) - limited support on image currently returning base64 as text

### Connection Management

- `join_channel` - Join a specific channel to communicate with Figma

### MCP Prompts

The MCP server includes several helper prompts to guide you through complex design tasks:

- `design_strategy` - Best practices for working with Figma designs
- `read_design_strategy` - Best practices for reading Figma designs
- `text_replacement_strategy` - Systematic approach for replacing text in Figma designs
- `annotation_conversion_strategy` - Strategy for converting manual annotations to Figma's native annotations
- `swap_overrides_instances` - Strategy for transferring overrides between component instances in Figma
- `reaction_to_connector_strategy` - Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions', and guiding the use 'create_connections' in sequence

## 开发

### 构建 Figma 插件

1. 导航到 Figma 插件目录:

   ```
   cd src/cursor_mcp_plugin
   ```

2. 编辑 code.js 和 ui.html

详细开发指南请查看 [🛠️ docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## 最佳实践

使用 Figma MCP 时：

1. 发送命令前始终加入频道
2. 首先使用 `get_document_info` 获取文档概览
3. 修改前使用 `get_selection` 检查当前选区
4. 根据需求使用适当的创建工具:
   - `create_frame` 用于容器
   - `create_rectangle` 用于基本形状
   - `create_text` 用于文本元素
5. 使用 `get_node_info` 验证更改
6. 尽可能使用组件实例以保持一致性
7. 适当处理错误，所有命令都可能抛出异常
8. 对于大型设计:
   - 在 `scan_text_nodes` 中使用分块参数
   - 通过 WebSocket 更新监控进度
   - 实现适当的错误处理
9. 对于文本操作:
   - 尽可能使用批量操作
   - 考虑结构关系
   - 通过定向导出验证更改
10. 对于转换旧版注释:
    - 扫描文本节点识别编号标记和描述
    - 使用 `scan_nodes_by_types` 查找注释引用的 UI 元素
    - 使用路径、名称或邻近度匹配标记与目标元素
    - 使用 `get_annotations` 适当分类注释
    - 使用 `set_multiple_annotations` 批量创建原生注释
    - 验证所有注释正确链接到目标
    - 成功转换后删除旧版注释节点
11. 将原型连线可视化为 FigJam 连接器:
    - 使用 `get_reactions` 提取原型流程
    - 使用 `set_default_connector` 设置默认连接器
    - 使用 `create_connections` 生成连接器线以清晰映射视觉流程

## 许可证

MIT
