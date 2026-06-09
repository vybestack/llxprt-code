# Phase 03: Move MCP Client Code and Tests

## Phase ID

`PLAN-20260608-ISSUE1587.P03`

## Requirements Implemented

- REQ-MOVE-002: Move MCP client, manager, and tool bridge into `packages/mcp/src/client`.
- REQ-NOCYCLE-001: Avoid circular package dependency.

## Implementation Tasks

- Move `packages/core/src/tools/mcp-client.ts` and `.test.ts` to `packages/mcp/src/client`.
- Move `packages/core/src/tools/mcp-client-manager.ts` and `.test.ts` to `packages/mcp/src/client`.
- Move `packages/core/src/tools/mcp-tool.ts` and `.test.ts` to `packages/mcp/src/client`.
- Introduce narrow host interfaces if needed for config/tool registry structural typing.
- Rewrite relative imports and test imports.
- Keep MCP package free of CLI/providers imports.

## Verification

- Run MCP client-related tests in the new package.
