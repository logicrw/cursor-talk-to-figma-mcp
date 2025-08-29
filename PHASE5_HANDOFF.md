# Phase 5 交接提示词

## 🎯 完整启动提示词 (复制粘贴到新的Claude Code窗口)

```
我需要继续cursor-talk-to-figma-mcp项目的Phase 5开发。这是一个DOCX研报到Figma海报的完全自动化项目。

## 项目背景
我们已经完成了Phase 1-4的开发：
1. **docx2json子模块**: 将DOCX转换为规范化的content.json，包含paragraph和figure块，每个figure都有统一的group metadata (group_id/group_seq/group_len)
2. **MCP工具实现**: 完成了3个核心工具的MCP服务端和Figma插件端实现
3. **完整技术栈**: 从pandoc解析到Figma API调用的完整链路

## 当前状态  
- **工作目录**: /Users/chenrongwei/Projects/cursor-talk-to-figma-mcp/
- **Git提交**: 75caf40 (Phase 3-4完整实现)
- **文档**: 请立即阅读 FIGMA_INTEGRATION_NOTES.md 了解完整的技术架构和实现细节

## Phase 5任务 (End-to-End Workflow)
需要设计和实现完整的自动化流程：

### 核心功能
1. **智能节点发现**: 自动定位Figma模板中的BackgroundFrame、ContentGroup、CardTemplate等关键节点
2. **Group-based处理**: 基于content.json的group metadata实现智能的图文块处理
3. **完整Pipeline**: 
   - 连接MCP → 定位模板节点
   - 批量文本替换(doc.title/date + 正文段落)  
   - 智能图片填充(按group分组处理)
   - 动态卡片克隆(当图片数超过模板占位时)
   - 背景自适应调整
4. **错误恢复**: 健壮的错误处理和流程中断恢复

### 数据源
- `docx2json/content.json`: 标准化内容数据
- `docx2json/assets/media/`: Base64图片资源  
- 现有3个新MCP工具: set_image_fill, set_text_auto_resize, append_card_to_container

### 预期产出
一个完整的Claude执行脚本，能够读取content.json并完全自动化地生成填满内容的海报，无需人工干预。

请先仔细阅读FIGMA_INTEGRATION_NOTES.md，然后开始Phase 5的设计和实现。
```

## 🔍 关键提醒点

1. **必读文档**: FIGMA_INTEGRATION_NOTES.md包含了所有技术架构、工具接口、实现细节
2. **Group处理逻辑**: content.json中的group_id/group_seq/group_len是核心，要基于此实现智能分组
3. **现有工具**: 不要重复实现，直接使用已完成的MCP工具
4. **测试数据**: docx2json/content.json是真实的测试数据，可直接使用
5. **最小MVP**: 先实现基础流程，再考虑优化和边界情况处理

## 🚀 期望的Phase 5结果
- 完整的端到端自动化流程
- 基于group metadata的智能处理
- 健壮的错误处理
- 性能优化的批量操作
- 完整的测试和验证

---
*此文档为新Claude Code会话的快速上手指南，包含了继续项目开发所需的所有关键信息。*