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

---

## Phase 5: End-to-End Workflow Design

### 💡 **Expert Recommendations** (Received 2025-08-30)

**Core Philosophy**: "先自发现 → 再确认 → 后执行" - Minimize manual configuration through intelligent template discovery.

#### **A) 文档与产物架构**
- **Single Active Document**: Continue using `FIGMA_INTEGRATION_NOTES.md` (no tasks/designs directories needed)
- **Two Config Files** (auto-generated):
  - `config/node_name_map.json` - 节点名称映射 (generated by scanning Figma template)  
  - `run_state.json` - 轻量级断点状态 ("写完固定文本=1，完成到第几个group的索引")

#### **B) 模板自发现算法** (Template Auto-Discovery)
**前提**: User selects target poster Frame in Figma

**Discovery Rules**:
1. **BackgroundFrame**: 直接取当前选中的Frame作为背景根
2. **ContentGroup**: 在BackgroundFrame的子孙里寻找Group/Frame，满足：
   - 子节点里同时存在图片占位(有IMAGE填充或name含`image`)和文本
   - 画布靠上(top y较小)，尺寸覆盖主要内容
   - 候选>1时，选子项最多的那个
3. **doc_title**: 根Frame的非内容区文本，name/文本含"日报/晨报"等
4. **date**: 根Frame的文字层，文本像月份/日期(如`AUG`、`24`)

**Output**: 候选列表 + 最终提案 (节点name、类型、子节点数、(x,y,w,h)) → 用户确认 → 写入mapping文件

#### **C) 内容区角色识别** (Content Role Classification)
对ContentGroup的所有子孙节点进行启发式分类：
- **image**: fills含IMAGE，或name含`image`  
- **source**: Text，name含`Source/来源`，或文本以"来源:"开头
- **title**: Text，name含"2行标题"，或位于某图正上方、距离较近，且行数≤2
- **paragraph**: 剩余文本(如多段正文)

**排序**: 按视觉顺序(`absoluteBoundingBox`的y→x排序)，不依赖图层顺序

**关联**: 每张image的上方最近title→标题；下方最近source→来源

#### **D) 基于Group Metadata的渲染规则**
**输入处理**: content.json的blocks(仅paragraph和figure两类)
**分组逻辑**:
1. 按`group_id`分组，按`group_seq`排序
2. 每个figure→占一个image，占位不足则`append_card_to_container`
3. 组首→写title；组尾→写credit
4. 正文段落→依视觉顺序写入(若只有一个正文位就拼接，空行分隔)

#### **E) 端到端执行步骤**
1. **连接**: `join_channel` + 确认工具可用性
2. **自发现**: 模板结构扫描 → 输出候选 → 用户确认 → 写入`node_name_map.json`
3. **固定文本**: `doc_title`、日期 → `set_multiple_text_contents`一次写入 → `run_state.did_write_fixed_text=true`
4. **图片与分组**:
   - 确保ContentGroup内有足够卡片，不足则append
   - 填充图片、写组首标题、组尾来源
   - 完成组 → `run_state.last_processed_group_index=当前索引`
5. **正文**: 依次写入paragraph
6. **文本防截断**: 对所有Text节点执行`set_text_auto_resize('HEIGHT')`
7. **背景拉长**: 取ContentGroup高度 → `resize_node(BackgroundFrame, height=内容高+120)`
8. **导出预览**(可选): `export_node_as_image(BackgroundFrame)`
9. **回显统计**: 图/段落数量、占位情况、背景最终高度

#### **F) 错误恢复机制** (Lightweight State Management)
**run_state.json只存两项**:
- `did_write_fixed_text`: boolean
- `last_processed_group_index`: number  

**幂等执行**: 重跑时跳过已完成部分，重复写入不影响结果

#### **G) Smoke Test建议**
在完整端到端前先验证：
1. 对一个image占位 → `set_image_fill`成功(FILL/FIT各一次)
2. 对一个长文本节点 → `set_text_auto_resize('HEIGHT')`，确认不缩字
3. 对ContentGroup → `append_card_to_container`，确认新增卡片正常排版

三步全过 → 再跑完整流程

### 🎯 **Phase 5 Technical Plan**

#### **Objectives**
1. **Smart Template Discovery**: 自动识别Figma模板关键节点，最小化手动配置
2. **Group-based Content Processing**: 基于content.json的group metadata实现智能图文块处理  
3. **Robust Pipeline**: 从文本替换到背景调整的完整自动化流程
4. **Error Recovery**: 轻量级状态管理，支持断点续传

#### **Assumptions & Constraints**
- User已在Figma中选中目标海报Frame
- content.json格式符合docx2json输出规范
- 所有MCP工具已验证可用
- 模板具有相对规范的节点命名和结构

#### **Options & Trade-offs**
- **自发现 vs 手动配置**: 自发现提高易用性但增加复杂度，采用启发式规则平衡准确性与通用性
- **批量 vs 逐一操作**: 优先使用批量工具(set_multiple_text_contents)提升性能
- **状态粒度**: 选择最小必要状态(固定文本+group索引)，避免过度复杂化

#### **Solution Architecture**

**1. Configuration Management**
```
config/
├── node_name_map.json    # Auto-generated node mapping
└── run_state.json        # Execution checkpoint state
```

**2. Template Discovery Algorithm**
- Scan current Figma selection and descendants
- Apply heuristic rules for node classification  
- Generate candidate proposals for user confirmation
- Store validated mapping for execution phase

**3. Content Processing Pipeline**
- Parse content.json into groups by group_id
- Map content elements to template nodes
- Execute batch operations with progress tracking
- Handle dynamic card creation for overflow content

**4. Error Recovery System**  
- Checkpoint after major operations
- Enable restart from last successful state
- Maintain idempotent operation design

#### **Acceptance Criteria**
- [ ] Template auto-discovery successfully identifies 90%+ of key nodes  
- [ ] Group-based processing correctly handles all test content.json scenarios
- [ ] Error recovery allows restart from any checkpoint state
- [ ] Complete pipeline processes test data in <60 seconds
- [ ] Output poster visually matches expected layout and content

#### **Test Plan**
- [ ] **Unit Tests**: Template discovery algorithm with various node structures
- [ ] **Integration Tests**: End-to-end pipeline with docx2json test data
- [ ] **Error Recovery Tests**: Simulate interruptions at each checkpoint
- [ ] **Performance Tests**: Measure processing time for different content scales
- [ ] **Smoke Tests**: Core MCP tools functionality validation

#### **Risks & Mitigations**
- **Risk**: Template structure varies significantly across projects
  **Mitigation**: Fallback to manual node specification if auto-discovery fails
- **Risk**: Large content sets exceed Figma performance limits  
  **Mitigation**: Implement chunked processing and progress feedback
- **Risk**: Image assets missing or corrupted
  **Mitigation**: Validate assets before processing and provide clear error messages

---

## 🚨 PHASE 5 EMERGENCY FIX - Current Status

**Date**: 2025-08-30  
**Status**: 90% complete, emergency fix needed for 3 abnormal image nodes

### **Critical Issue**
- **Problem**: 3 abnormal image nodes showing incorrectly due to 1x1 test images
- **Root Cause**: Previous testing used 1x1 placeholder images, causing display anomalies
- **Solution**: Use URL mode from static server to get real image data

### **System Status**
- ✅ **WebSocket Service**: Running normally (Port 3055)
- ✅ **Static File Server**: Running normally (Port 3056, serving image1-14.png)
- ✅ **Figma Plugin**: Connected to channel `jqpnfv6y`, API working
- ✅ **URL Auto-Detection**: Implemented, supports URLs in imageBase64 parameter
- 🔄 **Image Node Fixes**: 3 nodes need immediate repair

### **Abnormal Nodes Requiring Fix**
1. **Node 6:6441** (image 7311) → `http://localhost:3056/assets/image1.png`
2. **Node 6:6443** (image 7313) → `http://localhost:3056/assets/image5.png`  
3. **Node 6:6378** (image 7302) → `http://localhost:3056/assets/image10.png`

### **Technical Implementation**
- **Tool**: `mcp__talk-to-figma__set_image_fill`
- **Method**: URL parameter in imageBase64 field (URL detection already working)
- **Config**: `config/node_name_map.json` contains complete node mapping
- **Data Mapping**: Static server provides image1-14.png assets

### **Immediate Action Plan**
1. **Connect** to Figma plugin channel `jqpnfv6y`
2. **Fix Node 6:6441** using `http://localhost:3056/assets/image1.png`
3. **Fix Node 6:6443** using `http://localhost:3056/assets/image5.png`
4. **Fix Node 6:6378** using `http://localhost:3056/assets/image10.png`
5. **Verify** all fixes working properly in Figma

### **Phase 5 Development History**
1. ✅ **Phase 1**: System connectivity verification  
2. ✅ **Phase 2**: Template auto-discovery algorithm
3. ✅ **Phase 3**: Core MCP tools implementation
4. ✅ **Phase 4**: End-to-end workflow automation  
5. 🔄 **Phase 5**: Fix optimization (emergency fix needed)

### **Expert Recommendations Applied**
- ✅ Emergency救火方案: URL图片传递系统
- ✅ 根治方案: Complete MCP setup and Figma plugin fixes  
- 🔄 Final fix: 3 abnormal image nodes repair

### **Next Steps**
Ready for immediate emergency fix execution.