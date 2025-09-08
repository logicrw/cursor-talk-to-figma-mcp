#!/usr/bin/env node

/**
 * Test script for new MCP tools: get_component_property_references, set_instance_properties
 */

import CardBasedFigmaWorkflowAutomator from './src/workflow_automation_enhanced.js';

// Mock MCP client to test the new tools via actual Figma MCP calls
class TestMcpClient {
  async call(method, params) {
    console.log(`📡 MCP call: ${method}`, JSON.stringify(params, null, 2));
    
    // Since we can't use the new tools yet (server needs restart), 
    // let's simulate expected responses for testing
    switch (method) {
      case 'mcp__talk-to-figma__get_component_property_references':
        // Simulate a successful response with PropertyName#ID format
        return {
          success: true,
          message: `Got component property references from "FigureCard__seedInstance"`,
          nodeId: params.nodeId,
          references: {
            "showTitle#I194:57:showTitle": true,
            "showSource#I194:64:showSource": true,
            "showImg2#I194:61:showImg2": true,
            "showImg3#I194:62:showImg3": true,
            "showImg4#I194:63:showImg4": true
          },
          raw: {
            componentPropertyReferences: {
              visible: "showTitle#I194:57:showTitle"
            },
            componentProperties: {
              "showTitle#I194:57:showTitle": true,
              "showSource#I194:64:showSource": true,
              "showImg2#I194:61:showImg2": true,
              "showImg3#I194:62:showImg3": true,
              "showImg4#I194:63:showImg4": true
            }
          }
        };
      
      case 'mcp__talk-to-figma__set_instance_properties':
        console.log('✅ Mock setInstanceProperties called with:', params);
        return {
          success: true,
          message: `Applied ${Object.keys(params.properties).length} properties to instance`,
          nodeId: params.nodeId,
          applied: params.properties
        };
      
      case 'mcp__talk-to-figma__get_document_info':
        return {
          children: [
            { id: '194:5', name: 'Odaily特供海报', type: 'FRAME' },
            { id: '195:19', name: 'Seeds', type: 'FRAME' }
          ]
        };
      
      case 'mcp__talk-to-figma__get_node_info':
        if (params.nodeId === '195:19') {
          return {
            children: [
              { id: '195:8', name: 'FigureCard__seedInstance', type: 'INSTANCE' },
              { id: '195:5', name: 'BodyCard__seedInstance', type: 'INSTANCE' }
            ]
          };
        }
        if (params.nodeId === '194:5') {
          return {
            children: [
              { 
                id: '194:48', 
                name: 'ContentContainer', 
                type: 'FRAME',
                children: [
                  { id: '194:51', name: 'Cards', type: 'FRAME' }
                ]
              }
            ]
          };
        }
        if (params.nodeId === '194:48') {
          return {
            children: [
              { id: '194:51', name: 'Cards', type: 'FRAME' }
            ]
          };
        }
        return { children: [] };
      
      default:
        return { success: true };
    }
  }
}

async function testNewMcpTools() {
  console.log('🚀 Testing new MCP tools implementation...\n');
  
  try {
    const automator = new CardBasedFigmaWorkflowAutomator();
    const mockClient = new TestMcpClient();
    
    // Mock channel manager
    automator.channelManager = { currentChannel: 'test-channel' };
    
    // Initialize with mock client
    await automator.initialize(mockClient, 'test-channel', null, true);
    
    console.log('\n📋 Boolean Property IDs discovered:');
    console.log(JSON.stringify(automator.boolPropIds, null, 2));
    
    // Test visibility control with the new API
    const mockInstanceId = 'test-instance-12345';
    console.log(`\n🎯 Testing visibility control for instance: ${mockInstanceId}`);
    
    // Test different scenarios
    console.log('\n--- Test Case 1: title=true, source=false, images=2 ---');
    await automator.applyVisibilityControl(mockInstanceId, {
      hasTitle: true,
      hasSource: false,
      imageCount: 2
    });
    
    console.log('\n--- Test Case 2: title=false, source=true, images=4 ---');
    await automator.applyVisibilityControl(mockInstanceId, {
      hasTitle: false,
      hasSource: true,
      imageCount: 4
    });
    
    console.log('\n--- Test Case 3: title=true, source=true, images=1 ---');
    await automator.applyVisibilityControl(mockInstanceId, {
      hasTitle: true,
      hasSource: true,
      imageCount: 1
    });
    
    console.log('\n✅ All test cases completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run the test
testNewMcpTools();