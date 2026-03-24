# Playbook: Add mcp_context to BeforeTool and AfterTool Hook Inputs

**Upstream SHA:** `eb3f3cfdb8a`
**Upstream Subject:** feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (#15656)
**Upstream Stats:** ~6 files, moderate insertions

## What Upstream Does

Upstream enriches the `BeforeTool` and `AfterTool` hook events with MCP (Model Context Protocol) context information. When a tool call originates from an MCP server, hooks now receive an `mcp_context` field containing:
- `server_name`: The MCP server name that registered the tool.
- `server_uri`: The MCP server URI/endpoint.

This allows hooks to implement server-specific policies (e.g., "allow all tools from server X but block tools from server Y") and enables better audit logging that distinguishes MCP tools from built-in tools.

## Why REIMPLEMENT in LLxprt

1. LLxprt's hook event model does NOT currently include `mcp_context` — search confirms zero matches for `mcp_context` or `mcpContext` in `packages/core/src/hooks/`.
2. LLxprt's `BeforeToolInput` (line 471 of `types.ts`) has `tool_name` and `tool_input` but no MCP context.
3. LLxprt's `AfterToolInput` (line 491) has `tool_name`, `tool_input`, and `tool_response` but no MCP context.
4. LLxprt's `coreToolHookTriggers.ts` already has `serverName` in `SerializableConfirmationDetails` (line 169) for notification hooks, showing that MCP server identification is available in the tool call flow — but it's not threaded to BeforeTool/AfterTool events.
5. LLxprt's hook system uses a different trigger architecture than upstream. The `triggerBeforeToolHook()` function (line 37 of `coreToolHookTriggers.ts`) passes `toolName` and `toolInput` to `eventHandler.fireBeforeToolEvent()`. The MCP context must be threaded from the tool invocation through to the event handler.
6. The `HookEventHandler.fireBeforeToolEvent()` (line 187 of `hookEventHandler.ts`) constructs the input as `{ tool_name, tool_input }`. The `mcp_context` must be added as an optional field.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/core/src/hooks/types.ts` — `HookInput` (line 91), `BeforeToolInput` (line 471), `AfterToolInput` (line 491)
- [OK] `packages/core/src/hooks/hookEventHandler.ts` — `fireBeforeToolEvent()` (line 187), `fireAfterToolEvent()` (line 201)
- [OK] `packages/core/src/core/coreToolHookTriggers.ts` — `triggerBeforeToolHook()` (line 37), `triggerAfterToolHook()` (line 90), `serverName` in details (line 169)
- [OK] `packages/core/src/hooks/hookSystem.ts` — Wrapper methods (if added by prior batch c64b5ec4a3a)
- [OK] `packages/core/src/hooks/hookValidators.ts` — Validation functions for hook inputs

**Must NOT create:**
- No new files — changes fit in existing files.

## Files to Modify / Create

### 1. Modify: `packages/core/src/hooks/types.ts`

Add `McpContext` interface and include it in `BeforeToolInput` and `AfterToolInput`:

```typescript
/**
 * MCP context information for tool hooks.
 * Present when the tool originates from an MCP server.
 */
export interface McpContext {
  server_name: string;
  server_uri?: string;
}

/**
 * BeforeTool hook input
 */
export interface BeforeToolInput extends HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  mcp_context?: McpContext;  // NEW: present when tool is from MCP server
}

/**
 * AfterTool hook input
 */
export interface AfterToolInput extends HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: Record<string, unknown>;
  mcp_context?: McpContext;  // NEW: present when tool is from MCP server
}
```

The `mcp_context` field is optional — it's only present when the tool originates from an MCP server. Built-in tools won't have it.

### 2. Modify: `packages/core/src/hooks/hookEventHandler.ts`

Update `fireBeforeToolEvent()` and `fireAfterToolEvent()` to accept and pass through `mcp_context`:

```typescript
async fireBeforeToolEvent(
  toolName: string,
  toolInput: Record<string, unknown>,
  mcpContext?: McpContext,
): Promise<DefaultHookOutput | undefined> {
  return this.executeEvent(HookEventName.BeforeTool, {
    tool_name: toolName,
    tool_input: toolInput,
    ...(mcpContext && { mcp_context: mcpContext }),
  });
}

async fireAfterToolEvent(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: Record<string, unknown>,
  mcpContext?: McpContext,
): Promise<DefaultHookOutput | undefined> {
  return this.executeEvent(HookEventName.AfterTool, {
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
    ...(mcpContext && { mcp_context: mcpContext }),
  });
}
```

Import `McpContext` from `./types.js`.

### 3. Modify: `packages/core/src/hooks/hookSystem.ts`

If wrapper methods were added by batch c64b5ec4a3a (the `fireBeforeToolEvent`/`fireAfterToolEvent` wrappers), update their signatures to pass through `mcpContext`:

```typescript
async fireBeforeToolEvent(
  toolName: string,
  toolInput: Record<string, unknown>,
  mcpContext?: McpContext,
): Promise<DefaultHookOutput | undefined> {
  return this.getEventHandler().fireBeforeToolEvent(toolName, toolInput, mcpContext);
}

async fireAfterToolEvent(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: Record<string, unknown>,
  mcpContext?: McpContext,
): Promise<DefaultHookOutput | undefined> {
  return this.getEventHandler().fireAfterToolEvent(toolName, toolInput, toolResponse, mcpContext);
}
```

If wrapper methods don't exist yet (batch c64b5ec4a3a hasn't landed), skip this file.

### 4. Modify: `packages/core/src/core/coreToolHookTriggers.ts`

Update `triggerBeforeToolHook()` and `triggerAfterToolHook()` to accept and pass MCP context:

```typescript
export async function triggerBeforeToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
  mcpContext?: McpContext,
): Promise<BeforeToolHookOutput | undefined> {
  // ... existing guards ...
  const eventHandler = hookSystem.getEventHandler();
  const result = await eventHandler.fireBeforeToolEvent(toolName, toolInput, mcpContext);
  // ...
}
```

The MCP context originates from the tool invocation. In the scheduler/tool-call flow, MCP tools carry server metadata. Check how the scheduler calls `triggerBeforeToolHook()` and thread the `serverName` from the tool invocation:

- In `coreToolScheduler.ts`, when a tool call is being processed, the `ToolCallRequestInfo` or `AnyToolInvocation` may carry MCP server context. Pass it through as `{ server_name: serverName }` when calling `triggerBeforeToolHook()`.

### 5. Modify: `packages/core/src/hooks/hookValidators.ts`

Update `validateBeforeToolInput()` and `validateAfterToolInput()` to handle the optional `mcp_context` field. The validators should not require it (it's optional), but should validate its shape if present:

```typescript
// In validateBeforeToolInput:
if (input.mcp_context !== undefined) {
  if (typeof input.mcp_context !== 'object' || !input.mcp_context.server_name) {
    // Invalid mcp_context shape
  }
}
```

### 6. Add/Update Tests

- **`packages/core/src/hooks/hookEventHandler.test.ts`:** Test that `fireBeforeToolEvent` with `mcpContext` includes it in the hook input, and without `mcpContext` omits it.
- **`packages/core/src/core/coreToolHookTriggers.test.ts`:** Test that MCP context is threaded through when provided.
- **`packages/core/src/hooks/types.test.ts`:** If there are type tests, verify `McpContext` interface.

## Preflight Checks

```bash
# Verify no mcp_context exists yet
grep -rn "mcp_context\|mcpContext\|McpContext" packages/core/src/hooks/
# Expected: no matches

# Verify BeforeToolInput shape
grep -A3 "interface BeforeToolInput" packages/core/src/hooks/types.ts

# Verify AfterToolInput shape
grep -A4 "interface AfterToolInput" packages/core/src/hooks/types.ts

# Verify fireBeforeToolEvent signature
grep -A3 "fireBeforeToolEvent" packages/core/src/hooks/hookEventHandler.ts | head -5

# Verify serverName exists in tool call flow
grep -n "serverName" packages/core/src/core/coreToolHookTriggers.ts
```

## Implementation Steps

1. **Read** `packages/core/src/hooks/types.ts` lines 91-97, 471-494 to understand current input types.
2. **Read** `packages/core/src/hooks/hookEventHandler.ts` lines 187-211 for current fire* signatures.
3. **Read** `packages/core/src/core/coreToolHookTriggers.ts` lines 37-77, 90-140 for current trigger functions.
4. **Read** the scheduler code to understand how MCP server context is available during tool calls — look for `serverName` or MCP metadata on `ToolCallRequestInfo` or `AnyToolInvocation`.
5. **Add** `McpContext` interface to `types.ts`.
6. **Add** `mcp_context?: McpContext` to `BeforeToolInput` and `AfterToolInput`.
7. **Update** `hookEventHandler.ts` fire methods to accept and spread `mcpContext`.
8. **Update** `hookSystem.ts` wrapper methods if they exist.
9. **Update** `coreToolHookTriggers.ts` trigger functions to accept and pass `mcpContext`.
10. **Update** `hookValidators.ts` for optional mcp_context validation.
11. **Thread** MCP context from the scheduler call site through to the trigger functions.
12. **Add tests** and **run verification**.

## Verification

```bash
npm run typecheck
npm run lint
npm run test -- --reporter=verbose packages/core/src/hooks/hookEventHandler
npm run test -- --reporter=verbose packages/core/src/core/coreToolHookTriggers
npm run test -- --reporter=verbose packages/core/src/hooks/
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes / Risks

- **Risk: Scheduler threading.** The hardest part is threading MCP context from the tool invocation through to the hook trigger functions. The `coreToolScheduler.ts` calls `triggerBeforeToolHook()` — find that call site and determine how to extract the MCP server name from the tool invocation. If the invocation is an MCP tool, it likely carries `serverName` on the `ToolCallRequestInfo` or through the `AnyToolInvocation` instance.
- **Risk: Signature compatibility.** Adding an optional parameter to `fireBeforeToolEvent` and `fireAfterToolEvent` is backward-compatible. However, if any code passes arguments positionally (not by name), verify the parameter order doesn't break.
- **Do NOT** make `mcp_context` required — it must be optional since built-in tools don't have MCP context.
- **Do NOT** change other hook event types (BeforeModel, AfterModel, etc.) — only BeforeTool and AfterTool get MCP context.
- **Do NOT** change the serialization format — `mcp_context` should be a plain JSON object that passes through to hook scripts on stdin. The snake_case naming (`mcp_context`, `server_name`) is intentional for consistency with the hook script JSON API.
- **Export** `McpContext` from `packages/core/src/hooks/types.ts` so it can be imported by other modules.
