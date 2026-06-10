# Domain Analysis: Extract packages/mcp

Plan ID: PLAN-20260608-ISSUE1587

## Current Domain Objects

- MCP Client: manages connections to configured MCP servers and exposes prompts/resources/tools.
- MCP Client Manager: orchestrates discovery, status, server restart, and tool registration.
- MCP Tool Bridge: wraps MCP tools as internal LLxprt tools.
- MCP OAuth Provider: handles MCP-specific OAuth discovery, registration, auth, token exchange, and refresh.
- Token Stores: file/keychain/hybrid storage for MCP OAuth credentials.

## Package Boundary

`packages/mcp` owns MCP-specific behavior. `packages/core` remains the host for general config/tool infrastructure and re-exports moved APIs only for compatibility.

## Edge Cases

- Tests importing relative moved paths must be updated.
- Runtime dynamic imports in CLI must resolve from the new package.
- Workspace source aliasing must let Vitest run package tests against TypeScript source.
- Avoid mcp -> core -> mcp runtime cycles. If core imports mcp and mcp imports core, prefer moving any small shared MCP-only type into mcp or importing only leaf core modules that do not import config/mcp.
- Existing consumers may continue to use core re-exports, but direct MCP command consumers should use the new package dependency.

## Existing Files To Move

### Auth

- `packages/core/src/mcp/auth-provider.ts`
- `packages/core/src/mcp/file-token-store.ts`
- `packages/core/src/mcp/file-token-store.test.ts`
- `packages/core/src/mcp/google-auth-provider.ts`
- `packages/core/src/mcp/google-auth-provider.test.ts`
- `packages/core/src/mcp/oauth-provider-utils.ts`
- `packages/core/src/mcp/oauth-provider.ts`
- `packages/core/src/mcp/oauth-provider.test.ts`
- `packages/core/src/mcp/oauth-token-storage.ts`
- `packages/core/src/mcp/oauth-token-storage.test.ts`
- `packages/core/src/mcp/oauth-utils.ts`
- `packages/core/src/mcp/oauth-utils.test.ts`
- `packages/core/src/mcp/sa-impersonation-provider.ts`
- `packages/core/src/mcp/sa-impersonation-provider.test.ts`
- `packages/core/src/mcp/token-store.ts`
- `packages/core/src/mcp/token-store.test.ts`
- `packages/core/src/mcp/token-storage/**`

### Client

- `packages/core/src/tools/mcp-client.ts`
- `packages/core/src/tools/mcp-client.test.ts`
- `packages/core/src/tools/mcp-client-manager.ts`
- `packages/core/src/tools/mcp-client-manager.test.ts`
- `packages/core/src/tools/mcp-tool.ts`
- `packages/core/src/tools/mcp-tool.test.ts`

## Consumer Touchpoints

- `packages/core/src/config/config.ts`
- `packages/core/src/index.ts`
- `packages/core/src/telemetry/types.ts`
- `packages/core/src/telemetry/loggers.test.ts`
- `packages/cli/src/commands/mcp/list.ts`
- `packages/cli/src/ui/commands/mcpCommand.ts`
- `packages/cli/src/ui/commands/mcpCommand.test.ts`
- `packages/cli/src/ui/commands/diagnosticsCommand.ts`
- `packages/cli/src/ui/commands/diagnosticsCommand.spec.ts`
- `packages/cli/src/utils/events.ts`
- `packages/a2a-server/src/agent/task.ts`
- `packages/a2a-server/src/types.ts`

## Verification Commands

- `npm run test --workspace @vybestack/llxprt-code-mcp`
- `npm run test --workspace @vybestack/llxprt-code-core`
- `npm run test --workspace @vybestack/llxprt-code`
- `npm run test --workspace @vybestack/llxprt-code-a2a-server`
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`
