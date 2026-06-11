# MCP Tool Decision: mcp-tool.ts Classification

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08 (P09 regenerated)

This is the pre-P11 gating artifact for `mcp-tool.ts` classification, as required by `analysis/final-architecture.md` "mcp-tool.ts decision gate" section.

## Actual Import List of mcp-tool.ts

Evidence file: `analysis/mcp-tool-imports.txt`

```
7:import { safeJsonStringify } from '../utils/safeJsonStringify.js';
19:import { type CallableTool, type FunctionCall, type Part } from '@google/genai';
20:import { ToolErrorType } from './tool-error.js';
21:import type { Config } from '../config/config.js';
22:import type { MessageBus } from '../confirmation-bus/message-bus.js';
```

## Per-Import Classification

| Import | IMcpToolService Can Satisfy? | Notes |
| --- | --- | --- |
| `{ safeJsonStringify } from '../utils/safeJsonStringify.js'` | **Yes** | Pure utility, moves to tools/src/utils/ |
| `{ type CallableTool, type FunctionCall, type Part } from '@google/genai'` | **Yes** | External package dependency; `@google/genai` already in packages/tools/package.json |
| `{ ToolErrorType } from './tool-error.js'` | **Yes** | Internal tools import; moves with the tool |
| `type { Config } from '../config/config.js'` | **No — needs IToolRegistryHost** | mcp-tool.ts uses `this.cliConfig?.isTrustedFolder()` via `Config`. This is satisfied by `IToolRegistryHost` (which includes tool discovery configuration). Replacing with `IToolRegistryHost` resolves this dependency. |
| `type { MessageBus } from '../confirmation-bus/message-bus.js'` | **No — needs IToolMessageBus** | mcp-tool.ts uses MessageBus confirmation flow in `DiscoveredMCPToolInvocation`. Replacing with `IToolMessageBus` resolves this dependency. |

## Final Decision: MOVE_AFTER_INTERFACE

mcp-tool.ts can move to `packages/tools` if its constructor accepts:
1. **IToolRegistryHost** (for `isTrustedFolder()` and MCP server config access)
2. **IToolMessageBus** (for MCP tool confirmation flow)

Both interfaces are already defined in `analysis/final-architecture.md` and `analysis/interface-contracts-detailed.md`. The `DiscoveredMCPToolInvocation` class will receive `IToolMessageBus` and `IToolRegistryHost` via constructor injection instead of raw `MessageBus` and `Config`.

The `DiscoveredMCPTool` class will receive an optional `IToolRegistryHost` reference (for trust checking) instead of `Config`. The `Config` type import is replaced by `IToolRegistryHost`.

## Prerequisite

CoreMcpToolServiceAdapter must be created in P11 Group 8 (conditional on this decision being MOVE_AFTER_INTERFACE). CoreToolRegistryHostAdapter must be created in P11 Group 6. CoreMessageBusAdapter must be created in P11 Group 2.

## Alternative (Rejected): STAY_CORE_INFRASTRUCTURE

If mcp-tool.ts had imported `McpClient` as a concrete class, had direct OAuth/auth dependencies, or had `SecureStore`/`McpClientManager` coupling that could not be cleanly inverted, it would need to stay as `STAY_CORE_INFRASTRUCTURE`. However, the actual imports are fully satisfiable by the three interfaces above, so the move is viable.

## Consumer Impact

- `packages/core/src/tools/mcp-client.ts` — STAY_CORE_INFRASTRUCTURE; exports `DiscoveredMCPTool` type used by mcp-tool.ts. The `DiscoveredMCPTool` type (not the class itself) can be replaced with a tools-owned structural type or kept as an import from the retained core module. Since mcp-client.ts stays in core, the type export continues to function.
- `packages/core/src/tools/tool-registry.ts` — MOVE_AFTER_INTERFACE; imports `DiscoveredMCPTool` from mcp-tool.ts. After mcp-tool.ts moves, tool-registry imports it from `@vybestack/llxprt-code-tools`.