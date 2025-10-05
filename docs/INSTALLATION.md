# 安装与快速上手指南

> **目标受众**: 想要克隆并使用本项目的新用户（包括开发者和设计师）
>
> **预计时间**: 15-20 分钟
>
> **最后更新**: 2025-10-05

---

## 一、环境要求

在开始之前，请确保您的系统满足以下要求：

### 必需环境
- **Bun** >= 1.0（JavaScript 运行时，比 Node.js 更快）
- **Node.js** >= 18（用于运行脚本）
- **Figma Desktop** 应用（本地版，不是浏览器版）
- **操作系统**: macOS / Linux / Windows (WSL)

### 可选环境
- **Claude Code** 或 **Cursor**（如需在开发时使用 AI 辅助）

---

## 二、安装步骤

### Step 1: 安装 Bun

**macOS / Linux**:
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows (PowerShell)**:
```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

验证安装:
```bash
bun --version
```

### Step 2: 克隆项目

```bash
# 克隆本 fork 版本
git clone https://github.com/logicrw/cursor-talk-to-figma-mcp.git
cd cursor-talk-to-figma-mcp

# 查看远程仓库配置（确认克隆正确）
git remote -v
```

**预期输出**:
```bash
origin  https://github.com/logicrw/cursor-talk-to-figma-mcp.git (fetch)
origin  https://github.com/logicrw/cursor-talk-to-figma-mcp.git (push)
```

### Step 3: 安装依赖

```bash
bun install
```

### Step 4: 构建项目

```bash
bun run build
```

**预期输出**:
```bash
dist/
├── server.js    (MCP 服务器)
├── server.d.ts
└── ...
```

构建成功后，`dist/` 文件夹将包含编译后的 MCP 服务器代码。

---

## 三、配置 Figma 插件

### ⚠️ 重要：必须本地导入插件

**本 Fork 版本对 Figma 插件做了大量修改，不兼容原作者发布到 Figma 社区的版本。**

你**必须**使用本地导入方式，**不能**从 Figma Community 安装原版插件。

### 本地导入步骤

1. 打开 Figma Desktop 应用
2. 点击菜单 **Plugins** > **Development** > **Import plugin from manifest...**
3. 选择项目中的 `src/cursor_mcp_plugin/manifest.json` 文件
4. 插件将出现在 **Development** 插件列表中，名称为 **Cursor MCP Plugin**

**插件路径示例**:
```bash
/Users/你的用户名/Projects/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/manifest.json
```

### 与原版插件的区别

| 功能 | 原版插件 | 本 Fork 版本插件 |
|------|---------|----------------|
| `prepare_card_root` | 基础实现 | 增强：返回详细分离信息 |
| `clear_card_content` | 不支持 | 新增：自动清理卡片内容 |
| `resize_poster_to_fit` | 不支持 | 新增：海报高度自适应 |
| `set_instance_properties_by_base` | 不支持 | 新增：属性模糊匹配 |
| `fillImage` 策略 | 仅 Base64 | URL-first + Base64 降级 |
| 频道管理 | 基础 | 增强：持久化频道、UI 改进 |

**如果误用了原版插件，会出现以下问题**：
- ❌ `resize_poster_to_fit` 命令不存在
- ❌ `clear_card_content` 命令不存在
- ❌ `set_instance_properties_by_base` 命令不存在
- ❌ 脚本无法正常运行

---

## 四、启动 WebSocket 服务器

插件和 MCP 服务器之间通过 WebSocket 通信，需要先启动 WebSocket 中继服务器。

```bash
bun socket
```

**预期输出**:
```bash
WebSocket server listening on ws://localhost:3055
```

**注意事项**:
- 保持此终端窗口运行
- 如果端口 3055 被占用，请修改 `config/server-config.json` 中的 `websocket.port`

### Windows WSL 用户特别说明

如果您在 Windows WSL 环境下运行，需要修改 `src/socket.ts`:

```typescript
// 取消注释以下行
hostname: "0.0.0.0",
```

然后重新构建:
```bash
bun run build
bun socket
```

---

## 五、配置 MCP 服务器（可选 - 仅 AI 辅助时需要）

### 什么时候需要配置 MCP？

**简单回答：只有在使用 Claude Code / Cursor 用自然语言操作 Figma 时才需要配置 MCP。**

#### 场景对比

**场景 A: 直接运行脚本（不需要 MCP）**
```bash
# 启动 WebSocket
bun socket

# 在另一个终端直接运行脚本
node scripts/run_weekly_poster.js --channel test
```
✅ **无需配置 MCP**
✅ 适合：批量生成海报、定期自动化任务
✅ 脚本直接通过 WebSocket 与 Figma 插件通信

**场景 B: 使用 AI 辅助设计（需要 MCP）**
```bash
# 在 Claude Code 中用自然语言
"帮我在 Figma 中创建一个卡片，标题是XXX"
"把这个节点的颜色改成红色"
"导出当前选中的节点为 PNG"
```
❌ **需要配置 MCP**
✅ 适合：探索性设计、原型验证、需要 AI 辅助决策
✅ Claude Code 通过 MCP 工具调用 Figma 插件

### MCP 配置步骤（仅场景 B 需要）

如果你确定需要使用 Claude Code / Cursor 进行 AI 辅助设计，请继续以下配置：

### 方法 A: 使用 setup 脚本（推荐）

```bash
bun setup
```

此脚本会自动：
1. 构建项目（`bun run build`）
2. 在当前项目根目录创建 `mcp-config.json`（包含项目绝对路径）

### 方法 B: 手动配置

1. 复制示例配置文件:
```bash
cp mcp-config.example.json mcp-config.json
```

2. 编辑 `mcp-config.json`，将 `<PROJECT_ROOT>` 替换为项目绝对路径:
```json
{
  "mcpServers": {
    "talk-to-figma": {
      "command": "node",
      "args": ["/Users/你的用户名/Projects/cursor-talk-to-figma-mcp/dist/server.js"]
    }
  }
}
```

3. 将此配置添加到您的 AI 编辑器配置中:
   - **Claude Code**: `~/.claude/mcp.json`
   - **Cursor**: `~/.cursor/mcp.json`

**完整示例（Claude Code）**:
```json
{
  "mcpServers": {
    "talk-to-figma": {
      "command": "node",
      "args": ["/Users/你的用户名/Projects/cursor-talk-to-figma-mcp/dist/server.js"]
    }
  }
}
```

### 验证 MCP 配置

在 Claude Code 或 Cursor 中：
1. 重启编辑器
2. 打开任意项目
3. 在聊天中输入 `/mcp` 或查看可用工具
4. 应该能看到 `talk-to-figma` 相关的 57 个工具

### MCP 对脚本开发的帮助

虽然运行脚本不需要 MCP，但在**开发调试阶段**，MCP + Claude Code 可以显著提升效率。

#### 开发时的典型工作流

**场景：开发新脚本时需要探索 Figma 文件结构**

**第 1 步：快速验证节点名称**
```plaintext
User: "帮我查看当前选中节点的子节点列表，列出节点名称和类型"
Claude: [调用 get_selection → get_node_info]
返回: slot:IMAGE_GRID (Frame), titleText (Text), slot:CARDS_STACK (Frame)...
```

**第 2 步：验证 API 调用参数**
```plaintext
User: "帮我测试 resize_poster_to_fit 命令，锚点是 ContentAndPlate，底部留 200px"
Claude: [调用 resize_poster_to_fit]
返回: 成功/失败 + 错误信息
```

**第 3 步：生成脚本框架代码**
```plaintext
User: "基于我的 Figma 文件结构，生成一个卡片填充脚本"
Claude: [分析节点结构 → 生成代码框架]
返回: 可直接运行的脚本模板
```

#### MCP vs 直接运行脚本

| 对比项 | 直接运行脚本 | 使用 MCP + AI |
|--------|------------|--------------|
| **执行速度** | ✅ 快（无中间层） | ⚠️ 慢（需 AI 推理） |
| **适用场景** | 生产环境、批量任务 | 开发调试、探索验证 |
| **灵活性** | ⚠️ 需修改代码重新运行 | ✅ 自然语言交互 |
| **错误排查** | ⚠️ 需手动添加日志 | ✅ AI 辅助分析根因 |
| **学习成本** | ⚠️ 需熟悉 API 文档 | ✅ 边问边学 |

#### 推荐工作流

1. **开发阶段**：配置 MCP，用 Claude Code 快速验证 API + 探索文件结构
2. **调试阶段**：用 MCP 定位节点、测试参数、分析错误
3. **生产阶段**：直接运行脚本，不依赖 MCP（无需 AI，速度更快）

**示例：开发新脚本的完整流程**
```plaintext
1. 在 Claude Code 中：
   "帮我查看 ProductCard 组件的所有子节点结构"

2. 确认节点名称后：
   "生成一个脚本，填充 productName、price、description"

3. 获得脚本框架后：
   直接运行 `node scripts/my_product_script.js`

4. 如果出错：
   "为什么 fillImage 报错 'nodeId undefined'？"
   Claude 会分析代码并指出 prepare_card_root 返回值解析问题
```

---

## 六、运行示例脚本

### 准备工作

1. **启动 WebSocket 服务器**（如果还未启动）:
```bash
bun socket
```

2. **打开 Figma Desktop** 并运行插件:
   - 右键 > **Plugins** > **Cursor Talk To Figma MCP Plugin**
   - 在插件 UI 中输入频道名称（例如 `test-channel`）并点击 **Join**

3. **打开新终端窗口**（保持 WebSocket 服务器运行）

### 示例 1: 运行文章短图生成器

```bash
node scripts/run_article_images.js --channel test-channel
```

**功能**: 根据 `config/server-config.json` 中配置的内容文件，自动生成多语言文章配图（shortCard 组件）。

**预期输出**:
```bash
✅ 连接 WebSocket: ws://localhost:3055
✅ 加入频道: test-channel
🔍 查找 shortCard 组件...
📝 处理内容项 1/5: 标题示例
✅ 创建组件实例
✅ 填充图片 (URL)
✅ 填充标题
✅ 填充来源
✅ 海报高度调整完成
...
🎉 全部完成! 共生成 5 张海报
```

### 示例 2: 运行周报海报生成器

```bash
node scripts/run_weekly_poster.js --channel test-channel
```

**功能**: 自动生成周报三海报（图文卡 + 纯文本卡），包括标题、日期、来源、正文、图片。

**预期输出**:
```bash
✅ 连接 WebSocket: ws://localhost:3055
✅ 加入频道: test-channel
📁 内容文件: docx2json/250915-单向上行_zh-CN.json
🚀 推断数据集: 250915_upward_zh-cn
🖼️ 静态服务器: http://localhost:3056/assets/250915_upward_zh-cn
🔍 定位锚点: slot:CONTENT, slot:CARDS_STACK
🎨 处理海报 1/3: 周报一
✅ 更新标题与日期
✅ 创建 8 个卡片
✅ 填充内容
✅ 调整海报高度
...
🎉 全部完成!
```

### 常见问题

**Q1: WebSocket 连接失败？**
- 确认 `bun socket` 正在运行
- 检查端口 3055 是否被占用（`lsof -i :3055`）
- 确认插件已成功加入频道

**Q2: 找不到组件？**
- 确认 Figma 文件中存在对应的组件（例如 `shortCard`）
- 检查组件名称是否匹配 `config/server-config.json` 中的配置

**Q3: 图片填充失败？**
- 检查静态服务器是否运行（`curl http://localhost:3056/assets/...`）
- 如果 URL 不可达，脚本会自动降级到 Base64 模式（查看日志）

---

## 七、目录结构说明

安装完成后，项目目录结构如下：

```
cursor-talk-to-figma-mcp/
├── scripts/                     # 生产级脚本
│   ├── run_article_images.js    # 文章短图生成器
│   ├── run_weekly_poster.js     # 周报海报生成器
│   ├── figma-ipc.js            # 共享通信层（可复用）
│   └── setup.sh                # MCP 安装脚本
│
├── src/
│   ├── talk_to_figma_mcp/      # MCP 服务器（TypeScript）
│   ├── cursor_mcp_plugin/      # Figma 插件（JavaScript）
│   ├── socket.ts               # WebSocket 中继服务器
│   ├── config-resolver.js      # 内容路径解析
│   └── static-server.js        # HTTP 静态文件服务器
│
├── config/
│   └── server-config.json      # 核心配置文件
│
├── docs/
│   ├── INSTALLATION.md         # 本文档
│   ├── DEVELOPMENT.md          # 开发指南
│   ├── PITFALLS.md            # 避坑指南
│   ├── architecture-flow.md    # 架构流程图
│   └── OPTIMIZATION_SUMMARY.md # 优化记录
│
├── dist/                       # 构建输出（git ignored）
│   └── server.js              # MCP 服务器编译后代码
│
├── mcp-config.json            # 本地 MCP 配置（git ignored）
└── mcp-config.example.json    # MCP 配置示例
```

---

## 八、下一步

### 对于使用者
- ✅ 阅读 [⚠️ docs/PITFALLS.md](PITFALLS.md)（了解常见问题与解决方案）
- ✅ 查看 `config/server-config.json`（理解配置文件结构）
- ✅ 尝试修改配置并重新运行脚本

### 对于开发者
- ✅ 阅读 [🛠️ docs/DEVELOPMENT.md](DEVELOPMENT.md)（学习如何开发自定义脚本）
- ✅ 查看 [📐 docs/architecture-flow.md](architecture-flow.md)（理解完整架构）
- ✅ 研究 `scripts/figma-ipc.js`（复用共享函数）

---

## 九、获取帮助

如果遇到问题：

1. **检查本文档的「常见问题」章节**
2. **查看 [docs/PITFALLS.md](PITFALLS.md)**（常见错误总结）
3. **查看 Git commit 历史**（可能已有类似问题的修复）
4. **提交 Issue**: [GitHub Issues](https://github.com/logicrw/cursor-talk-to-figma-mcp/issues)

---

---

**文档版本**: v1.0
**维护者**: logicrw
**项目状态**: 稳定运行中
