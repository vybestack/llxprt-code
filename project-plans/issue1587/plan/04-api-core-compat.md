# Phase 04: Public API and Core Compatibility

## Phase ID

`PLAN-20260608-ISSUE1587.P04`

## Requirements Implemented

- REQ-API-001: Export clean MCP public API.
- REQ-COMPAT-001: Preserve core public API through re-exports.

## Implementation Tasks

- Export moved auth/client/status/token APIs from `packages/mcp/src/index.ts`.
- Update `packages/core/src/index.ts` to re-export from `@vybestack/llxprt-code-mcp`.
- Update `packages/core/src/config/config.ts` to import `McpClientManager` from MCP package.
- Update core package dependency/configuration.
- Update package exports for direct subpath compatibility if necessary.

## Verification

- `npm run typecheck --workspace @vybestack/llxprt-code-core`
- Core tests that consume MCP types compile and pass.
