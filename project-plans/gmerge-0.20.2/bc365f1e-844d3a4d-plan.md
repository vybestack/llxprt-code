# Reimplement Plan: MCP Server Instructions

**Upstream SHAs:** `bc365f1eaa39c0414b4d70e600d733eb0867aec6` + `844d3a4dfa207fbfe3c083ecb12f0c090ddfa524`
**Batch:** 9

## What upstream does

1. bc365f1e: Adds `useInstructions` config option per MCP server, `getInstructions()` on MCP client, `getMcpInstructions()` on MCP client manager, and injection into system prompt via memory discovery
2. 844d3a4d: Removes the `useInstructions` gate — always include MCP server instructions

## LLxprt approach

Implement getMcpInstructions flow and always-include behavior from the start (skip the intermediate config gate since 844d3a4d removes it).

## Files to modify

1. `packages/core/src/tools/mcp-client.ts` — add `getInstructions()` method
2. `packages/core/src/tools/mcp-client-manager.ts` — add `getMcpInstructions()` aggregator
3. `packages/core/src/utils/memoryDiscovery.ts` — inject MCP instructions into memory context
4. `packages/core/src/config/config.ts` — wire MCP client manager access
5. Tests for instruction retrieval and aggregation

## Key design

- Each MCP client exposes `getInstructions()` from server capabilities
- Manager aggregates across all connected servers
- Instructions injected into system prompt during memory discovery
- Always included (no useInstructions toggle needed)

## Verification

- Unit tests for getInstructions and getMcpInstructions
- Verify instructions appear in system prompt when MCP servers provide them
