# Cursor Talk to Figma MCP - Project Context

## Project Overview

This is a Model Context Protocol (MCP) server that enables Cursor AI to communicate with Figma through a local plugin. It provides programmatic access to Figma's design capabilities through natural language commands.

## Architecture

### Core Components

1. **MCP Server** (`src/`)
   - Handles MCP protocol communication
   - Manages WebSocket connections to Figma plugin
   - Provides tool definitions for Figma operations

2. **Figma Plugin** (`plugin/`)
   - Runs inside Figma desktop app
   - Executes design operations
   - Communicates with MCP server via WebSocket

3. **Static Server** (`server/`)
   - Serves plugin UI and resources
   - Handles file uploads for image operations

## Key Files Structure

```
cursor-talk-to-figma-mcp/
├── src/                      # MCP Server source
│   ├── index.ts             # MCP server entry point
│   ├── server/              # Server implementations
│   │   ├── Server.ts        # Base server class
│   │   └── FigmaPluginServer.ts # Figma-specific server
│   ├── client/              # Client implementations
│   │   └── FigmaPluginClient.ts # WebSocket client for plugin
│   └── types.ts             # TypeScript type definitions
│
├── plugin/                   # Figma Plugin source
│   ├── src/
│   │   ├── main.ts          # Plugin main logic
│   │   ├── utils.ts         # Utility functions
│   │   ├── componentHelper.ts # Component operations
│   │   └── annotationHelper.ts # Annotation operations
│   ├── manifest.json        # Figma plugin manifest
│   └── ui.html              # Plugin UI
│
├── server/                   # Static file server
│   └── server.js            # Express server for plugin assets
│
├── config/                   # Configuration files
│   ├── server-config.json   # Server settings
│   ├── node_name_map.json  # Node ID mappings
│   └── corrected_mapping_table.json # Component mappings
│
└── designs/                  # Design documents
    └── *.design.md          # Feature designs and specifications
```

## Available Operations

### Basic Operations
- Get document/selection info
- Create shapes (rectangles, frames, text)
- Modify properties (color, position, size)
- Clone and delete nodes

### Advanced Operations
- Auto-layout management
- Component instance manipulation
- Annotation management
- Image fill operations
- Export to various formats
- Poster/card generation

### Specialized Features
- Short card generation with dynamic content
- Poster resizing and fitting
- Batch text/annotation operations
- Prototyping connections visualization

## Configuration

### MCP Configuration (`mcp-config.json`)
```json
{
  "mcpServers": {
    "talk-to-figma": {
      "command": "npm",
      "args": ["run", "dev"],
      "env": {
        "FIGMA_WS_PORT": "3001",
        "STATIC_SERVER_PORT": "3056"
      }
    }
  }
}
```

### Package Dependencies
- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `ws`: WebSocket communication
- `express`: Static file serving
- `multer`: File upload handling
- `eventsource`: Server-sent events

## Development Workflow

1. **Start MCP Server**: `npm run dev`
2. **Build Plugin**: `npm run build:plugin`
3. **Start Static Server**: `npm run server`
4. **Load Plugin in Figma**: Import from manifest
5. **Connect Cursor**: Configure MCP settings

## Communication Flow

```
Cursor AI → MCP Server → WebSocket → Figma Plugin → Figma API
         ←            ←           ←              ←
```

## Current Status

- Core functionality implemented and tested
- Poster generation features refined
- Component property management enhanced
- Image operations stabilized
- Export capabilities expanded

## Recent Changes

- Unified poster resizing via `resize_poster_to_fit`
- Removed legacy hug implementations
- Enhanced short card frame resizing
- Improved error handling in plugin communication

## Testing

Manual testing through Cursor AI interface with real Figma documents. Test scenarios include:
- Basic shape creation and modification
- Complex auto-layout operations
- Component instance manipulation
- Poster/card generation workflows
- Export and image operations

## Known Limitations

- Requires Figma desktop app (not web)
- Plugin must be manually loaded and connected
- Some operations require specific node types
- WebSocket connection must be maintained

## Future Enhancements

- Batch operation optimization
- Enhanced error recovery
- Additional export formats
- Template library expansion
- Performance monitoring