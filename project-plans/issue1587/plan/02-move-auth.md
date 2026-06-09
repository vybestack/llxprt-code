# Phase 02: Move MCP Auth Code and Tests

## Phase ID

`PLAN-20260608-ISSUE1587.P02`

## Requirements Implemented

- REQ-MOVE-001: Move all MCP OAuth/token storage files and tests into `packages/mcp/src/auth`.

## Implementation Tasks

- Move `packages/core/src/mcp/**` to `packages/mcp/src/auth/**`.
- Preserve tests alongside source files.
- Rewrite imports for moved files.
- Ensure imports from core are leaf utilities only and do not create runtime cycles.
- Add auth barrel exports as needed.

## Verification

- Run MCP auth-related tests in the new package.
