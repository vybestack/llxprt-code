# REIMPLEMENT Plan: Extensions MCP Refactor

**Upstream SHA:** `da4fa5ad75ccea4d8e320b1c0d552614e654f806`  
**Subject:** Extensions MCP refactor (#12413)

## Overview

Major refactor of the extensions/MCP system (878 additions, 479 deletions). Restructures how extensions and MCP servers are loaded and managed.

## Files Changed (Upstream)

**A2A Server:**
- `packages/a2a-server/src/agent/task.ts` (minor)
- `packages/a2a-server/src/config/config.ts` (-24 lines)

**CLI Config:**
- `packages/cli/src/config/config.test.ts` (+39 modified)
- `packages/cli/src/config/config.ts` (-108 lines significantly reduced)
- `packages/cli/src/config/extension-manager.ts` (+57 modified)
- `packages/cli/src/config/extension.test.ts` (+30 modified)

**CLI UI:**
- `packages/cli/src/gemini.test.tsx` (+2)
- `packages/cli/src/services/McpPromptLoader.test.ts` (+6 modified)
- `packages/cli/src/services/McpPromptLoader.ts` (+5 modified)
- `packages/cli/src/ui/AppContainer.test.tsx` (+1)
- `packages/cli/src/ui/commands/mcpCommand.test.ts` (+5)
- `packages/cli/src/ui/commands/mcpCommand.ts` (+29 modified)
- `packages/cli/src/ui/components/Composer.test.tsx` (+5)
- `packages/cli/src/ui/components/Composer.tsx` (+6 modified)
- `packages/cli/src/ui/components/ConfigInitDisplay.tsx` (+10 modified)
- `packages/cli/src/utils/events.ts` (+12 modified)

**Core:**
- `packages/core/src/config/config.ts` (+64 modified)
- `packages/core/src/telemetry/loggers.test.ts` (+15 modified)
- `packages/core/src/telemetry/types.ts` (+3 modified)
- `packages/core/src/tools/mcp-client-manager.test.ts` (+217 lines significantly expanded)
- `packages/core/src/tools/mcp-client-manager.ts` (+195 lines significantly expanded)
- `packages/core/src/tools/mcp-client.test.ts` (+65)
- `packages/core/src/tools/mcp-client.ts` (+5)
- `packages/core/src/tools/tool-registry.test.ts` (-31)
- `packages/core/src/tools/tool-registry.ts` (-64 lines significantly reduced)
- `packages/core/src/utils/extensionLoader.test.ts` (+108 - new)
- `packages/core/src/utils/extensionLoader.ts` (+201 lines significantly expanded)

## LLxprt Considerations

1. **A2A Server Private** - LLxprt keeps A2A server private, adapt changes carefully
2. **Extension Manager** - LLxprt has extensions, verify compatibility
3. **MCP Client Manager** - Major changes, needs careful review
4. **Tool Registry** - 64 lines removed, ensure LLxprt's tool batching preserved
5. **Telemetry Types** - Skip ClearcutLogger parts

## High-Risk Areas

- `mcp-client-manager.ts` - Core MCP functionality
- `tool-registry.ts` - LLxprt has custom tool handling
- `config.ts` - Both CLI and core

## Implementation Steps

1. Review mcp-client-manager changes in detail
2. Cherry-pick with careful conflict resolution
3. Preserve LLxprt's tool batching in tool-registry
4. Keep A2A server private (don't expose new functionality)
5. Skip any telemetry additions
6. Full test suite

## Verification

```bash
npm run lint && npm run typecheck
npm run test
npm run build
# Test MCP server loading
node scripts/start.js --profile-load synthetic --prompt "test mcp"
```

## Decision

- [ ] Careful cherry-pick with significant manual review
- [ ] Preserve LLxprt tool batching
- [ ] Keep A2A private

---

*Plan to be executed during Batch 20*
