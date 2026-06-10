# Phase 05: Consumer Integration Updates

## Phase ID

`PLAN-20260608-ISSUE1587.P05`

## Requirements Implemented

- REQ-INT-001: Update direct MCP consumers to import from the new package where appropriate.

## Implementation Tasks

- Update CLI MCP command/list/diagnostics imports to `@vybestack/llxprt-code-mcp` when they directly use MCP-specific API.
- Add MCP package dependency to CLI if direct imports are used.
- Update A2A direct MCP type/status imports to MCP package if appropriate and add dependency.
- Keep provider package unchanged unless typecheck requires changes; providers should not be a dependency of MCP.

## Verification

- `npm run typecheck --workspace @vybestack/llxprt-code`
- `npm run typecheck --workspace @vybestack/llxprt-code-a2a-server`
- Relevant tests pass.
