# Technical Analysis: Property-Based Visibility Control

## Executive Summary

The expert's feedback is **technically accurate**. The current MCP implementation uses "copy overrides" semantics rather than Figma's official `componentPropertyReferences` API, which prevents proper property-based visibility control.

## Current Implementation Analysis

### What We Found ✅
- **Direction is correct**: Moving from `set_node_visible` to component boolean properties
- **Approach is sound**: Using property-based control for Auto-layout space management

### Critical Issues ❌
1. **Wrong API Pattern**: Current `get_instance_overrides` only returns override counts, not `PropertyName#ID` references
2. **Missing ComponentPropertyReferences**: No access to the official Figma API property reference format
3. **Copy-Paste Semantics**: Uses `sourceInstanceId` + `targetNodeIds` instead of direct property setting

## Required MCP Tool Extensions

To implement the expert's B+ approach properly, we need these new MCP functions:

```javascript
// New functions needed in cursor_mcp_plugin/code.js:

async function getComponentPropertyReferences(instanceNodeId) {
  const instance = await figma.getNodeByIdAsync(instanceNodeId);
  const mainComponent = await instance.getMainComponentAsync();
  
  // Return componentPropertyDefinitions in PropertyName#ID format
  const propertyRefs = {};
  for (const [name, definition] of Object.entries(mainComponent.componentPropertyDefinitions || {})) {
    propertyRefs[name] = `${name}#${definition.id}`;
  }
  
  return {
    success: true,
    propertyReferences: propertyRefs,
    componentId: mainComponent.id
  };
}

async function setInstanceProperties(instanceNodeId, properties) {
  const instance = await figma.getNodeByIdAsync(instanceNodeId);
  
  // Use official setProperties API with PropertyName#ID format
  await instance.setProperties(properties);
  
  return {
    success: true,
    instanceId: instanceNodeId,
    appliedProperties: Object.keys(properties)
  };
}
```

## Recommended Implementation Path

### Option A: Extend Current MCP Tool (Recommended)
1. Add `getComponentPropertyReferences` function to return `PropertyName#ID` mappings
2. Add `setInstanceProperties` function for direct property setting
3. Update workflow automation to use the new APIs

### Option B: Workaround with Current Tools
Keep current implementation but acknowledge it may have limitations in some edge cases where the "copy overrides" approach doesn't perfectly match direct property setting.

## Technical Validation

The expert's key points are verified:
- ✅ Figma official docs confirm `PropertyName#uniqueId` format requirement
- ✅ `setProperties()` is the recommended API for instance property control
- ✅ `componentPropertyReferences` provides the correct property reference strings
- ✅ Direct property setting is more reliable than copy-paste semantics

## Recommendation

**Implement Option A** to align with Figma's official API patterns. This requires extending the MCP tool but ensures:
- Proper `PropertyName#ID` format handling
- Direct instance property control
- Compliance with official Figma Plugin API guidelines
- Better reliability across different component configurations

The current implementation works but doesn't follow Figma's recommended practices, which could lead to edge cases and maintenance issues.