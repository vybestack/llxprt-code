# Task: Resolve packages/core/src/tools/mcp-client.ts Conflict

## Objective

Resolve the merge conflict in MCP client to support provider compatibility while preserving MCP improvements from main.

## File

`packages/core/src/tools/mcp-client.ts`

## Context

- **multi-provider branch**: Adapted MCP client for multi-provider support
- **main branch**: Added MCP client enhancements and new features

## Resolution Strategy

1. Keep multi-provider MCP adaptations
2. Include MCP improvements from main
3. Ensure compatibility with all providers
4. Merge connection handling improvements

## Key Items to Preserve

### From multi-provider:

- Provider-agnostic MCP tool interface
- Tool response formatting for providers
- MCP tool discovery adaptations

### From main:

- Connection stability improvements
- New MCP features
- Better error recovery
- Performance optimizations

## Expected Structure

- MCP tools work with any provider
- Improved connection handling
- Proper tool discovery
- Robust error handling

## Commands to Execute

```bash
# After resolution:
git add packages/core/src/tools/mcp-client.ts
```

## Validation

1. MCP connections stable
2. Tools work with all providers
3. Discovery functions properly
4. No connection drops
