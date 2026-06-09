# Feature Specification: Extract packages/mcp

Plan ID: PLAN-20260608-ISSUE1587

## Purpose

Move Model Context Protocol client, tool bridging, OAuth, and token storage code out of `packages/core` into a dedicated `packages/mcp` workspace package while preserving existing public API compatibility.

## Architectural Decisions

- **Pattern**: package extraction with backwards-compatible core re-exports.
- **Public entry point**: `McpClientManager` is the primary public entry point for clients.
- **Package boundary**: `packages/mcp` must not depend on `packages/cli` or `packages/providers`.
- **Current dependency reality**: `packages/auth` and `packages/tools` do not exist in this repository. This extraction therefore creates a dedicated MCP package that still imports minimal core types/utilities where required and exposes narrow interfaces for host config/tool registry boundaries.
- **OAuth separation**: MCP OAuth remains distinct from provider OAuth.

## Integration Points

### Existing Code That Will Use This Feature

- `packages/core/src/config/config.ts` - constructs `McpClientManager`.
- `packages/core/src/index.ts` - re-exports moved MCP API for compatibility.
- `packages/cli/src/commands/mcp/list.ts` - MCP status display.
- `packages/cli/src/ui/commands/mcpCommand.ts` - MCP OAuth and server restart command handling.
- `packages/cli/src/ui/commands/diagnosticsCommand.ts` - MCP token diagnostics.
- `packages/a2a-server/src/agent/task.ts` and `packages/a2a-server/src/types.ts` - MCP server status types/helpers.
- `packages/core/src/telemetry/types.ts` - discovered MCP tool telemetry type.

### Existing Code To Be Replaced

- `packages/core/src/mcp/**` - moved to `packages/mcp/src/auth/**`.
- `packages/core/src/tools/mcp-client.ts` - moved to `packages/mcp/src/client/mcp-client.ts`.
- `packages/core/src/tools/mcp-client-manager.ts` - moved to `packages/mcp/src/client/mcp-client-manager.ts`.
- `packages/core/src/tools/mcp-tool.ts` - moved to `packages/mcp/src/client/mcp-tool.ts`.

### User Access Points

- Existing MCP CLI commands continue to work.
- Existing core imports continue to work through re-exports.
- New package imports are available from `@vybestack/llxprt-code-mcp`.

## Formal Requirements

[REQ-PKG-001] Create `packages/mcp` as a workspace package with build, test, typecheck, and export metadata consistent with the monorepo.

[REQ-MOVE-001] Move all MCP OAuth/token storage files and tests from `packages/core/src/mcp` into `packages/mcp/src/auth`.

[REQ-MOVE-002] Move MCP client, client manager, tool bridge files and tests from `packages/core/src/tools` into `packages/mcp/src/client`.

[REQ-API-001] Export a clean MCP public API from `packages/mcp/src/index.ts` and root `packages/mcp/index.ts`.

[REQ-COMPAT-001] Preserve existing public imports from `@vybestack/llxprt-code-core` via re-exports.

[REQ-INT-001] Update direct MCP consumers to import from the new package where appropriate.

[REQ-NOCYCLE-001] Avoid circular package dependency between `core` and `mcp`.

[REQ-TEST-001] Migrated tests pass in `packages/mcp`; full repo verification passes.

## Constraints

- Do not modify or delete `.llxprt/`.
- Do not depend on `packages/cli` or `packages/providers` from `packages/mcp`.
- Keep MCP OAuth separate from provider OAuth.
- Prefer direct moved-code tests over mock-only tests.
