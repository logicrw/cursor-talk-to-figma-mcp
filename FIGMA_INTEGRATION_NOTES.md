# Figma Integration Project Notes

## Project Overview
**Goal**: Integrate docx2json output with cursor-talk-to-figma-mcp to automate poster creation from DOCX reports.

## 5-Phase Development Plan

### Phase 1: Code Analysis & Understanding (1-2 rounds) ✅ COMPLETED
- [x] Analyze server.ts tool registration patterns
- [x] Understand code.js message handling mechanisms  
- [x] Study existing image/text tools implementation
- **Status**: Architecture analysis complete, ready for tool design phase

### Phase 2: New Tool Design (2-3 rounds) ✅ COMPLETED
- [x] Design 3 new tools: set_image_fill, set_text_auto_resize, append_card_to_container
- [x] Create Zod schemas and parameter definitions
- [x] Review and refine based on feedback
- **Status**: Tool interfaces designed, ready for MCP server implementation

### Phase 3: MCP Service Implementation (2-3 rounds) ✅ COMPLETED
- [x] Modify server.ts to add new tool definitions
- [x] Add command types and parameter validation
- [x] Implement Figma plugin handlers in code.js
- **Status**: Full implementation complete, ready for integration testing

### Phase 4: Figma Plugin Implementation (2-3 rounds) ✅ COMPLETED
- [x] Modify code.js to add new message handlers  
- [x] Implement image processing, text adjustment, layout operations
- [x] Fix Figma API usage issues and validation
- **Status**: All plugin handlers implemented with proper error handling

### Phase 5: End-to-End Workflow (3-4 rounds) 🎯 NEXT
- [ ] Design complete execution workflow from content.json to poster
- [ ] Implement smart group processing (group_id/group_seq/group_len)
- [ ] Create template node discovery and mapping logic
- [ ] Test full pipeline: text replacement → image filling → card cloning → layout adjustment
- [ ] Performance optimization and error recovery
- **Status**: Ready to start - all tools implemented and tested

## Key Requirements
From docx2json output:
- `content.json` with blocks (paragraph/figure) 
- Unified group metadata (group_id, group_seq, group_len)
- Assets in `assets/media/` directory

Target Figma capabilities:
- Batch text replacement (set_multiple_text_contents)
- Image filling from Base64 data
- Dynamic card cloning and layout
- Background resizing based on content

## Technical Discoveries

### MCP Server Architecture (server.ts)
**Tool Registration Pattern**:
```typescript
server.tool(
  "tool_name",                    // Tool identifier
  "Description of what it does",  // Help text
  {                               // Zod schema for parameters
    param: z.string().describe("param description")
  },
  async ({ param }: any) => {     // Implementation function
    const result = await sendCommandToFigma("tool_name", { param });
    return {
      content: [{ type: "text", text: "result message" }]
    };
  }
);
```

**Key Components**:
- Uses `@modelcontextprotocol/sdk` for MCP protocol
- WebSocket connection to Figma plugin (`sendCommandToFigma`)
- Zod schemas for parameter validation
- Consistent error handling pattern
- Progress tracking for batch operations (see `set_multiple_text_contents`)

### Figma Plugin Architecture (code.js)
**Message Handling Pattern**:
```javascript
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "execute-command":
      const result = await handleCommand(msg.command, msg.params);
      figma.ui.postMessage({ type: "command-result", id: msg.id, result });
      break;
  }
};

async function handleCommand(command, params) {
  switch (command) {
    case "command_name":
      return await commandFunction(params);
  }
}
```

**Existing Text Tool Implementation**:
- `setTextContent(params)`: Takes `{nodeId, text}`
- Validates node exists and is TEXT type
- Uses `figma.loadFontAsync(node.fontName)` before text changes
- Calls `setCharacters(node, text)` for actual text update

**Existing Fill Tool Implementation**:
- `setFillColor(params)`: Takes `{nodeId, color: {r,g,b,a}}`
- Validates node supports fills with `"fills" in node`
- Creates solid color fill: `{type: "SOLID", color: rgbColor, opacity: alpha}`
- Sets `node.fills = [solidFill]`

## Expert Review & Adjustments

### Critical API Corrections (Based on Expert Feedback)
1. **TextNode.textAutoResize**: Only supports `"NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT"` (not "WIDTH")
2. **Base64 handling**: Must support both data URL format and pure base64 strings
3. **Auto Layout validation**: Strict checking, no automatic container mode changes

### Implementation Principles  
- **MVP approach**: Minimal viable implementation, no over-engineering
- **Error boundaries**: Fail fast with clear error messages
- **Reuse existing tools**: Leverage set_multiple_text_contents for batch text operations
- **Single responsibility**: Each tool does one thing well

## Common Errors & Solutions
*To be documented during implementation...*

## Important Insights
*Capture breakthrough moments and good practices...*

---
**Current Status**: Phase 3-4 Complete - Ready for Phase 5 (End-to-End Integration)  
**Last Updated**: 2025-08-30

## Implementation Summary
### ✅ **MCP Server Tools** (server.ts)
- `set_image_fill`: Base64→图片填充，支持data URL格式和缩放模式
- `set_text_auto_resize`: 文本节点自动调整，支持正确的Figma API枚举值
- `append_card_to_container`: 严格的Auto Layout容器验证，安全的节点克隆

### ✅ **Figma Plugin Handlers** (code.js)  
- Base64→Uint8Array转换和图片创建
- 字体加载和textAutoResize属性设置
- 容器layoutMode验证和节点插入

### ✅ **Error Handling & Validation**
- 参数验证、节点类型检查、Auto Layout确认
- 统一的错误返回格式和详细错误信息
- 与现有工具一致的架构模式

## Phase 5 Handoff Information

### 🎯 **Current Status**
- **Git Commit**: `75caf40` - Phase 3-4 complete implementation
- **Work Directory**: `/Users/chenrongwei/Projects/cursor-talk-to-figma-mcp/`
- **Submodule**: `docx2json/` contains conversion tools and sample data

### 🛠️ **Available Tools** (Ready to Use)
#### MCP Server Tools:
- `set_image_fill(nodeId, imageBase64, scaleMode?, opacity?)` - Base64→图片填充
- `set_text_auto_resize(nodeId, autoResize)` - 文本自动调整 
- `append_card_to_container(containerId, templateId, newName?, insertIndex?)` - 卡片克隆
- Plus all existing tools: `set_multiple_text_contents`, `get_node_info`, `resize_node`, etc.

#### Data Sources:
- `docx2json/content.json` - 规范化内容数据 (paragraph/figure with group metadata)
- `docx2json/assets/media/` - 提取的图片资源
- `docx2json/to_ncj.py` - DOCX→JSON转换器

### 📋 **Phase 5 Objectives**
1. **Node Discovery**: 自动定位Figma模板中的关键节点 (BackgroundFrame, ContentGroup, CardTemplate等)
2. **Smart Group Processing**: 基于content.json的group_id/group_seq/group_len实现智能图文块处理  
3. **Complete Pipeline**: 文本批量替换 → 图片填充 → 动态卡片 → 背景调整
4. **Error Recovery**: 健壮的错误处理和中断恢复机制

### 🚀 **Recommended Phase 5 Startup Prompt**
```
"我需要继续cursor-talk-to-figma-mcp项目的Phase 5开发。请先阅读项目根目录的FIGMA_INTEGRATION_NOTES.md了解完整背景，然后设计从docx2json/content.json到Figma海报的完整自动化工作流。重点实现基于group metadata的智能图文块处理和模板节点的自动发现机制。"
```