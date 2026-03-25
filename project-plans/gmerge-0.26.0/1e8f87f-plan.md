# REIMPLEMENT Playbook: 1e8f87f — Add support for running commands before MCP servers loading

## Upstream Change Summary

Upstream added `MCPDiscoveryState` enum and support for running slash commands while MCP servers are still loading:

1. **New enum `MCPDiscoveryState`**: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED` in `mcp-client.ts`
2. **`McpClientManager` enhancements**: 
   - `getDiscoveryState()` method tracking discovery progress
   - `getMcpServerCount()` method returning client count
   - State transitions during `startConfiguredMcpServers()`
3. **Config change**: `startConfiguredMcpServers()` is no longer awaited (fire-and-forget) to allow CLI to start even if MCP servers are slow
4. **`useGeminiStream`**: Blocks non-slash queries when MCP discovery is in progress and servers exist, shows "Waiting for MCP servers to initialize..." message
5. **`slashCommandProcessor`**: 
   - Listens for MCP status changes to reload slash commands
   - Better error message when unknown command might be from MCP server still loading
6. **Exports**: `addMCPStatusChangeListener`, `removeMCPStatusChangeListener`, `MCPDiscoveryState` added to core exports

## LLxprt Current State

**File**: `packages/cli/src/ui/hooks/slashCommandProcessor.ts`
- LLxprt does NOT have MCP status listener registration
- Has `shellConfirmationRequest` state (LLxprt-specific, preserve)
- Uses `@vybestack/llxprt-code-core` imports

**File**: `packages/cli/src/ui/hooks/useGeminiStream.ts`
- Has deduplication logic for tool calls (LLxprt-specific)
- Does NOT have MCP discovery state check before submitting queries

**File**: `packages/core/src/config/config.ts`
- Need to verify if `startConfiguredMcpServers()` is awaited or not

**File**: `packages/core/src/tools/mcp-client-manager.ts`
- Need to verify if `MCPDiscoveryState` exists

## Adaptation Plan

### File-by-File Changes

#### 1. `packages/core/src/tools/mcp-client.ts` — **authoritative location for `MCPDiscoveryState`**

`mcp-client.ts` already contains MCP status change listeners (`addMCPStatusChangeListener`, `removeMCPStatusChangeListener`, `notifyMCPStatusChange`). **Source the enum and listeners from there**, NOT from `utils/events.ts`.

> **Pre-work**: Read `packages/core/src/tools/mcp-client.ts` to confirm what already exists before adding anything.

Add the enum with **lowercase string literals** matching LLxprt's existing convention:
```typescript
export enum MCPDiscoveryState {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}
```

> **Do NOT use upstream's uppercase values** (`'NOT_STARTED'`, `'IN_PROGRESS'`, `'COMPLETED'`). LLxprt uses lowercase throughout its existing state enums — preserve that convention.

**Reconciliation**: LLxprt may already have discovery state tracked in both `mcp-client.ts` (global) and `mcp-client-manager.ts` (manager-level). Before adding new state tracking, read both files and **choose one authoritative source**:
- If `mcp-client.ts` already has a global state, use it — do not duplicate in `mcp-client-manager.ts`
- If `mcp-client-manager.ts` has it, reference from there and expose via `mcp-client.ts` getters only
- **Do not introduce a third location** for discovery state

#### 2. `packages/core/src/tools/mcp-client-manager.ts`

1. Add private property: `private discoveryState: MCPDiscoveryState = MCPDiscoveryState.NOT_STARTED;`
2. Add method:
   ```typescript
   getDiscoveryState(): MCPDiscoveryState {
     return this.discoveryState;
   }
   ```
3. Add method:
   ```typescript
   getMcpServerCount(): number {
     return this.clients.size;
   }
   ```
4. Update `startConfiguredMcpServers()` to set state transitions:
   ```typescript
   async startConfiguredMcpServers(): Promise<void> {
     this.discoveryState = MCPDiscoveryState.IN_PROGRESS;
     try {
       // ... existing code
     } finally {
       this.discoveryState = MCPDiscoveryState.COMPLETED;
     }
   }
   ```

#### 3. `packages/core/src/config/config.ts`

> **Decision required before implementing**: Read `Config.initialize()` in this file and determine the current await behavior.

**Choose one of the following and document the rationale in a code comment**:

**Option A — Adopt upstream fire-and-forget** (allows CLI to start while MCP loads):
```typescript
// We do not await this promise so that the CLI can start up even if
// MCP servers are slow to connect. Discovery state is tracked via
// MCPDiscoveryState; useGeminiStream blocks non-slash queries until COMPLETED.
Promise.all([
  this.mcpClientManager.startConfiguredMcpServers(),
  this.getExtensionLoader().start(this),
]).catch((error) => {
  debugLogger.error('Error initializing MCP clients:', error);
});
```
> Safety note for Option A: Any code path that runs after `initialize()` returns must not assume MCP tools are available. The `useGeminiStream` guard (step 6) is what makes this safe.

**Option B — Keep existing `await`** (simpler, avoids race conditions):
```typescript
await this.mcpClientManager.startConfiguredMcpServers();
```
> If keeping await, `MCPDiscoveryState` is still useful for the slash command "still loading" message, but the `useGeminiStream` blocking guard is unnecessary and should be omitted.

**Pick one. Do not leave both in.** Prefer Option A if the goal is matching upstream behavior; prefer Option B if you want the minimal-risk change.

#### 4. MCP status listeners — **do NOT use `packages/core/src/utils/events.ts`**

> **Pre-work**: Read `packages/core/src/tools/mcp-client.ts`. MCP status listeners (`addMCPStatusChangeListener`, `removeMCPStatusChangeListener`, `notifyMCPStatusChange`) already exist there. Use those existing functions — do not create a parallel implementation in `utils/events.ts`.

If for some reason they do not exist, add them to `mcp-client.ts` (not `utils/events.ts`):
```typescript
const mcpStatusListeners = new Set<() => void>();

export function addMCPStatusChangeListener(listener: () => void): void {
  mcpStatusListeners.add(listener);
}

export function removeMCPStatusChangeListener(listener: () => void): void {
  mcpStatusListeners.delete(listener);
}

export function notifyMCPStatusChange(): void {
  for (const listener of mcpStatusListeners) {
    listener();
  }
}
```

#### 5. `packages/cli/src/ui/hooks/slashCommandProcessor.ts`

1. Add imports (sourced from `mcp-client.ts` via core exports):
   ```typescript
   import {
     addMCPStatusChangeListener,
     removeMCPStatusChangeListener,
     MCPDiscoveryState,
   } from '@vybestack/llxprt-code-core';
   ```

2. In the first `useEffect`, add MCP status listener:
   ```typescript
   // Listen for MCP server status changes
   addMCPStatusChangeListener(listener);
   ```

3. In cleanup, remove listener:
   ```typescript
   removeMCPStatusChangeListener(listener);
   ```

4. Update the "Unknown command" error handling:
   ```typescript
   const isMcpLoading =
     config?.getMcpClientManager()?.getDiscoveryState() ===
     MCPDiscoveryState.IN_PROGRESS;
   const errorMessage = isMcpLoading
     ? `Unknown command: ${trimmed}. Command might have been from an MCP server but MCP servers are not done loading.`
     : `Unknown command: ${trimmed}`;
   ```

#### 6. `packages/cli/src/ui/hooks/useGeminiStream.ts`

1. Add import: `MCPDiscoveryState` from `@vybestack/llxprt-code-core`

2. In `submitQuery` (after the spanMetadata.input assignment), add MCP loading check:
   ```typescript
   const discoveryState = config.getMcpClientManager()?.getDiscoveryState();
   const mcpServerCount = config.getMcpClientManager()?.getMcpServerCount() ?? 0;
   if (
     !options?.isContinuation &&
     typeof query === 'string' &&
     !isSlashCommand(query.trim()) &&
     mcpServerCount > 0 &&
     discoveryState !== MCPDiscoveryState.COMPLETED
   ) {
     coreEvents.emitFeedback(
       'info',
       'Waiting for MCP servers to initialize... Slash commands are still available.',
     );
     return;
   }
   ```

#### 7. Core exports (`packages/core/src/index.ts`)

Export the new symbols — **all from `mcp-client.ts`**, not from `utils/events.ts`:
```typescript
export {
  MCPDiscoveryState,
  addMCPStatusChangeListener,
  removeMCPStatusChangeListener,
} from './tools/mcp-client.js';
```

## Files to Read

- `packages/core/src/tools/mcp-client.ts` (or relevant MCP files)
- `packages/core/src/tools/mcp-client-manager.ts`
- `packages/core/src/config/config.ts`
- `packages/cli/src/ui/hooks/slashCommandProcessor.ts`
- `packages/cli/src/ui/hooks/useGeminiStream.ts`
- `packages/core/src/utils/events.ts`

## Files to Modify

- `packages/core/src/tools/mcp-client.ts` (add enum + listeners if not already present)
- `packages/core/src/tools/mcp-client-manager.ts`
- `packages/core/src/config/config.ts`
- `packages/cli/src/ui/hooks/slashCommandProcessor.ts`
- `packages/cli/src/ui/hooks/useGeminiStream.ts`
- `packages/core/src/index.ts` (exports)

> **Do NOT modify** `packages/core/src/utils/events.ts` for MCP listeners — those belong in `mcp-client.ts`

## Specific Verification

1. Run tests: `npm run test -- packages/cli/src/ui/hooks/useGeminiStream.test.tsx`
2. Run tests: `npm run test -- packages/core/src/tools/mcp-client-manager.test.ts`
3. Run tests: `npm run test -- packages/core/src/config/config.test.ts`
4. Manual: Start CLI with slow MCP server, verify slash commands work while loading

## Integration & Smoke Tests (Required)

Add or update tests to cover the following behavioral scenarios:

### Slow MCP startup
- Mock `startConfiguredMcpServers()` to delay 500ms before resolving
- Assert that `MCPDiscoveryState` transitions: `not_started` → `in_progress` → `completed`
- Assert `notifyMCPStatusChange()` is called at each transition

### Slash command works during `IN_PROGRESS`
- Set discovery state to `in_progress`, mock 1 MCP server in count
- Submit a slash command (e.g., `/help`) via `useGeminiStream` or `slashCommandProcessor`
- Assert it is processed normally (not blocked)

### Normal prompts resume after `COMPLETED`
- Start with state `in_progress` — verify plain prompt is blocked with "Waiting for MCP servers" message
- Transition to `completed` — verify the same plain prompt is no longer blocked

### No false blocking when server count is zero
- Set discovery state to `in_progress` but MCP server count = 0
- Submit a plain prompt
- Assert it is NOT blocked (the guard must check `mcpServerCount > 0`)
