# Phase 5 Claude Code Handoff Prompt

## 🎯 项目背景与当前状态

我需要你接管cursor-talk-to-figma-mcp项目的Phase 5开发。这是一个**DOCX研报到Figma海报完全自动化项目**，已完成前4个阶段，现在需要实现端到端工作流。

### 📋 项目核心架构
**技术栈**: Claude Code ↔ MCP服务 ↔ WebSocket ↔ Figma插件  
**工作目录**: `/Users/chenrongwei/Projects/cursor-talk-to-figma-mcp/`  
**数据源**: `docx2json/content.json` (规范化内容) + `docx2json/assets/media/` (14张测试图片)

### ✅ **已完成的Phase 1-4状态**
1. **docx2json子模块**: DOCX→规范化JSON，每个figure都有group metadata (group_id/group_seq/group_len)
2. **MCP服务器**: 完整的Figma操作工具，包括Phase 5需要的3个核心工具
3. **Figma插件**: 已修复语法兼容性问题，正常运行
4. **WebSocket服务**: 端口3055运行中，插件已连接到channel `4tatjvky`
5. **Claude Code集成**: MCP配置已完成，所有工具可用

### 🛠️ **Phase 5核心工具(已实现，待测试)**
- `mcp__talk-to-figma__set_image_fill` - Base64图片填充
- `mcp__talk-to-figma__set_text_auto_resize` - 文本自动调整  
- `mcp__talk-to-figma__append_card_to_container` - 动态卡片克隆
- 以及完整的Figma操作API

## 🎯 **Phase 5任务：End-to-End Workflow**

### **核心目标**
实现从`content.json`到完成海报的完全自动化流程，基于专家建议采用"**先自发现→再确认→后执行**"的策略。

### **技术规划** (基于专家建议)
1. **模板自发现算法**: 
   - 自动识别BackgroundFrame、ContentGroup、doc_title、date节点
   - 生成`config/node_name_map.json`映射文件
   - 启发式规则+用户确认机制

2. **Group-based内容处理**:
   - 基于content.json的group_id/group_seq/group_len智能分组
   - 图文块按组处理，动态卡片创建
   - 视觉顺序排列，非图层顺序

3. **端到端执行流程** (9步):
   - 连接测试 → 模板发现 → 固定文本 → 图片分组 → 正文填充 → 防截断 → 背景调整 → 导出 → 统计

4. **轻量级状态管理**:
   - `config/run_state.json` 仅存2项断点状态
   - 幂等执行，支持断点续传

### **优先级Smoke Test**
在完整实现前，先验证3个核心MCP工具：
1. `set_image_fill` - 对图片占位填充Base64数据
2. `set_text_auto_resize` - 文本HEIGHT模式防截断  
3. `append_card_to_container` - 动态克隆卡片到容器

## 📖 **必读技术文档**
- `FIGMA_INTEGRATION_NOTES.md` - 完整技术架构、工具接口、实现细节
- `docx2json/content.json` - 测试数据结构样例
- 专家建议已整合到FIGMA_INTEGRATION_NOTES.md的Phase 5章节

## 🤝 **结对编程行为规范**

### **语言与输出规则**
- **叙述、解释、结论一律使用中文**
- **以下内容必须使用英文**以保持结构与可复制性：
  - 模式声明行：`[MODE: RESEARCH|PLAN|EXECUTE]`
  - 代码块与行内代码
  - 结构化小节标题：Steps/Checklist/Notes/Risks/Acceptance Criteria
  - 分支名、提交信息、PR标题

### **三大模式职责**
- **[MODE: RESEARCH]**: 理解问题、审阅代码、识别风险。禁止编写业务代码
- **[MODE: PLAN]**: 形成技术方案与测试计划。必须输出Objectives/Assumptions/Trade-offs/Acceptance Criteria
- **[MODE: EXECUTE]**: 实现与验证。先贴diff确认，后应用变更

### **核心协作原则**
- **首行模式声明**：每条回复第一行必须是`[MODE: XXX]`
- **最小化更改**：遵循最小diff原则，先贴patch供确认
- **Todo管理**：频繁使用TodoWrite工具跟踪任务进度
- **每步完成后自动提醒下一步骤**并提供建议提示词

## 🚀 **当前系统状态**

### **运行中服务**
- WebSocket服务器: `lsof -i :3055` 可见端口占用
- Figma插件: 已连接到channel `4tatjvky`，绿色Connected状态
- MCP服务器: 通过`~/.config/claude-code/mcp.json`配置加载

### **验证系统就绪性**
请先执行以下验证，确认所有组件正常：

```bash
# 1. 检查WebSocket服务状态
lsof -i :3055

# 2. 测试MCP连接到Figma
# (这会触发完整通信链路测试)
```

使用以下MCP工具测试连接：
1. `mcp__talk-to-figma__join_channel` - 连接Figma (channel: 4tatjvky)
2. `mcp__talk-to-figma__get_document_info` - 获取文档信息验证通信

### **Phase 5实现策略**
1. **先Smoke Test** - 验证3个核心工具功能
2. **创建config/目录** - 建立节点映射和状态管理机制  
3. **实现模板自发现** - 扫描Figma模板结构并生成映射
4. **端到端Pipeline** - 完整的9步自动化流程
5. **测试与优化** - 使用真实content.json数据验证

## 📝 **立即行动清单**

**Mode: RESEARCH** (建议第一步)
- [ ] 验证MCP工具连接状态
- [ ] 读取并理解FIGMA_INTEGRATION_NOTES.md的Phase 5设计
- [ ] 分析content.json数据结构和group metadata

**准备切换到EXECUTE模式的提示词**:
```
"现在开始实现Phase 5。请先执行join_channel连接Figma，然后进行3个核心MCP工具的Smoke Test验证。完成后创建config/目录结构并开始模板自发现算法实现。"
```

---
**当前Git状态**: Clean, commit `c2ec3d2` (Phase 5 handoff documentation)  
**工作分支**: main  
**最后更新**: 2025-08-30 (MCP连接配置完成)