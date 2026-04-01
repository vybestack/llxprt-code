# Playbook: MCP Status Hook Refactor (cebe386)

**Commit:** cebe386d797b210c2329284cb858b31788c68f23
**Risk Level:** HIGH
**Scope:** 10 upstream files - significant refactor to MCP initialization flow

---

## Executive Summary

This commit introduces a new `useMcpStatus` hook and refactors MCP status handling:
1. **New Hook:** `useMcpStatus.ts` - React hook for MCP server initialization status
2. **Event System Change:** Switches from `appEvents` to `coreEvents` for MCP status
3. **UI Flow Change:** MCP status handling moved from `useGeminiStream` to `AppContainer`
4. **Message Queue Integration:** MCP readiness now gates message submission

This is a **behavioral change** affecting how the app waits for MCP servers before accepting user input.

---

## Upstream Change Summary

### New File: `useMcpStatus.ts`

Creates a new React hook that:
- Tracks MCP discovery state (`NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`)
- Tracks MCP server count
- Computes `isMcpReady` state
- Subscribes to `CoreEvent.McpClientUpdate` events

### Event System Changes

**BEFORE:**
```typescript
import { appEvents } from '../utils/events.js';
eventEmitter: appEvents as EventEmitter<ExtensionEvents>,
```

**AFTER:**
```typescript
import { coreEvents } from '@google/gemini-cli-core';
eventEmitter: coreEvents as EventEmitter<ExtensionEvents>,
```

### Files Modified (10 total)

| File | Changes |
|------|---------|
| `packages/cli/src/config/config.ts` | Use `coreEvents` instead of `appEvents` |
| `packages/cli/src/ui/AppContainer.tsx` | Add `useMcpStatus`, update submit logic |
| `packages/cli/src/ui/hooks/useGeminiStream.ts` | Remove MCP status logic |
| `packages/cli/src/ui/hooks/useMcpStatus.ts` | **NEW FILE** - MCP status hook |
| `packages/cli/src/ui/hooks/useMessageQueue.ts` | Add `isMcpReady` parameter |
| `packages/core/src/tools/mcp-client-manager.ts` | Emit `McpClientUpdate` events |
| `packages/core/src/utils/events.ts` | Add `McpClientUpdate` event type |

---

## LLxprt Current State Analysis

### LLxprt Event System

Based on `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/utils/events.ts`:

```typescript
export enum CoreEvent {
  UserFeedback = 'user-feedback',
  MemoryChanged = 'memory-changed',
  ModelChanged = 'model-changed',
  ConsoleLog = 'console-log',
  Output = 'output',
  ExternalEditorClosed = 'external-editor-closed',
  SettingsChanged = 'settings-changed',
}
```

**LLxprt does NOT have `McpClientUpdate` event yet.**

### LLxprt MCP Status

Based on search results:
- LLxprt has `MCPDiscoveryState` in `packages/cli/src/ui/commands/mcpCommand.ts`
- LLxprt has `getMCPDiscoveryState` function
- LLxprt does NOT have `useMcpStatus.ts`
- LLxprt does NOT have `useMessageQueue.ts`

### Key Differences from Upstream

1. **No `useMessageQueue.ts`:** LLxprt may handle message queuing differently — audit before creating
2. **`appEvents` still present in CLI config:** The earlier claim "already aligned / no appEvents" is INCORRECT. `packages/cli/src/config/config.ts` still imports CLI-local `appEvents`. This must be explicitly resolved — see Phase 7.
3. **Different MCP handling:** Check how LLxprt handles MCP initialization — identify exact submission gate before injecting `isMcpReady`
4. **LLxprt payload convention:** LLxprt uses named payload interfaces for all events; do NOT copy upstream's `Array<Map<string, McpClient> | never>` union-array — use `McpClientUpdatePayload` instead

---

## Detailed Adaptation Plan

### Phase 1: Add McpClientUpdate Event — Single Source of Truth

#### Step 1.1: Update `packages/core/src/utils/events.ts`

**Add new event to `CoreEvent` enum:**

```typescript
export enum CoreEvent {
  UserFeedback = 'user-feedback',
  MemoryChanged = 'memory-changed',
  ModelChanged = 'model-changed',
  ConsoleLog = 'console-log',
  Output = 'output',
  ExternalEditorClosed = 'external-editor-closed',
  McpClientUpdate = 'mcp-client-update',  // ADD THIS
  SettingsChanged = 'settings-changed',
}
```

**Add event type imports (if needed):**

```typescript
import type { McpClient } from '../tools/mcp-client.js';
import type { ExtensionEvents } from './extensionLoader.js';
```

> **WARNING: SINGLE SOURCE OF TRUTH — MANDATORY:** The string `'mcp-client-update'`
> must appear **only once** in the entire codebase — as the value of
> `CoreEvent.McpClientUpdate` in `events.ts`. Every emit, listen, and test MUST
> use the enum constant. Raw string literals are forbidden.
>
> After implementing, enforce with grep:
> ```bash
> grep -rn "'mcp-client-update'" \
>   packages/core/src packages/cli/src integration-tests/
> # Must return ZERO results (only the enum definition is allowed)
> ```
> If any raw string is found, replace it with `CoreEvent.McpClientUpdate`.

**Add first-class typed payload (required — do NOT use upstream's union-array form):**

```typescript
// In events.ts — add alongside McpClient import:
export interface McpClientUpdatePayload {
  readonly clients: ReadonlyMap<string, McpClient>;
}
```

**Update `CoreEvents` interface:**

```typescript
export interface CoreEvents extends ExtensionEvents {
  [CoreEvent.UserFeedback]: [UserFeedbackPayload];
  [CoreEvent.ModelChanged]: [ModelChangedPayload];
  [CoreEvent.ConsoleLog]: [ConsoleLogPayload];
  [CoreEvent.Output]: [OutputPayload];
  [CoreEvent.MemoryChanged]: [MemoryChangedPayload];
  [CoreEvent.ExternalEditorClosed]: never[];
  [CoreEvent.McpClientUpdate]: [McpClientUpdatePayload];  // typed payload, NOT Array<Map | never>
  [CoreEvent.SettingsChanged]: never[];
  // ... other events
}
```

> **Why not `Array<Map<string, McpClient> | never>`?**
> Upstream uses this awkward union-array form as an artifact of their generic event
> infrastructure. `McpClient | never` collapses to `McpClient`, so it's equivalent
> but confusing. LLxprt uses a clean named payload interface for all events —
> follow that convention. The `ReadonlyMap` return prevents accidental mutation of
> the manager's internal client map from event listeners.

**Emit site in `mcp-client-manager.ts` must match:**

```typescript
// Use the payload wrapper, not a raw Map argument:
this.eventEmitter?.emit(CoreEvent.McpClientUpdate, { clients: this.clients });
```

**Listener site in `useMcpStatus.ts` must match:**

```typescript
const onChange = (payload: McpClientUpdatePayload) => {
  const manager = config.getMcpClientManager();
  if (manager) {
    setDiscoveryState(manager.getDiscoveryState());
    setMcpServerCount(payload.clients.size);
  }
};
coreEvents.on(CoreEvent.McpClientUpdate, onChange);
```

### Phase 2: Update MCP Client Manager

#### Step 2.1: Update `packages/core/src/tools/mcp-client-manager.ts`

> **Requirement:** Every path that transitions `discoveryState` to `COMPLETED`
> MUST emit `CoreEvent.McpClientUpdate`. Missing any path causes the UI to hang
> indefinitely waiting for a signal that never comes.

**Read the file first to find every state-transition site:**

```bash
grep -n 'MCPDiscoveryState\|discoveryState\s*=' \
  packages/core/src/tools/mcp-client-manager.ts
```

**Required emit sites — all are mandatory:**

1. **Normal completion** (after all servers discovered):
```typescript
// After all servers have been processed and promise resolves:
this.discoveryState = MCPDiscoveryState.COMPLETED;
// Use enum constant — NOT raw string 'mcp-client-update':
this.eventEmitter?.emit(CoreEvent.McpClientUpdate, { clients: this.clients });
```

2. **Empty-server fast-path** (no servers configured — must complete immediately):
```typescript
// When Object.keys(servers).length === 0:
this.discoveryState = MCPDiscoveryState.COMPLETED;
this.eventEmitter?.emit(CoreEvent.McpClientUpdate, { clients: this.clients });
return;
```
> **This fast-path is critical.** If the app starts with zero MCP servers and the
> `COMPLETED` event is never emitted, `isMcpReady` stays `false` forever and the
> entire message queue gate is locked. Verify this path explicitly.

3. **IN_PROGRESS start** (optional but recommended for UI feedback):
```typescript
// When discovery begins:
this.discoveryState = MCPDiscoveryState.IN_PROGRESS;
this.eventEmitter?.emit(CoreEvent.McpClientUpdate, { clients: this.clients });
```

**Duplicate-listener guard:**

After adding emits, verify no duplicate listener accumulation in tests:
```bash
grep -n 'on(CoreEvent.McpClientUpdate\|on.*mcp-client-update' \
  packages/cli/src/ui/hooks/useMcpStatus.ts \
  packages/cli/src/config/config.ts \
  packages/core/src/tools/mcp-client-manager.ts
```
Each listener must have a corresponding `off` / cleanup in component unmount or
manager teardown. Check `useMcpStatus.ts` returns its cleanup function from
`useEffect`.

### Phase 3: Create useMcpStatus Hook

#### Step 3.1: Create `packages/cli/src/ui/hooks/useMcpStatus.ts`

**Create new file:**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import {
  type Config,
  coreEvents,
  MCPDiscoveryState,
  CoreEvent,
} from '@vybestack/llxprt-code-core';

export function useMcpStatus(config: Config) {
  const [discoveryState, setDiscoveryState] = useState<MCPDiscoveryState>(
    () =>
      config.getMcpClientManager()?.getDiscoveryState() ??
      MCPDiscoveryState.NOT_STARTED,
  );

  const [mcpServerCount, setMcpServerCount] = useState<number>(
    () => config.getMcpClientManager()?.getMcpServerCount() ?? 0,
  );

  useEffect(() => {
    const onChange = () => {
      const manager = config.getMcpClientManager();
      if (manager) {
        setDiscoveryState(manager.getDiscoveryState());
        setMcpServerCount(manager.getMcpServerCount());
      }
    };

    coreEvents.on(CoreEvent.McpClientUpdate, onChange);
    return () => {
      coreEvents.off(CoreEvent.McpClientUpdate, onChange);
    };
  }, [config]);

  // We are ready if discovery has completed, OR if it hasn't even started and there are no servers.
  const isMcpReady =
    discoveryState === MCPDiscoveryState.COMPLETED ||
    (discoveryState === MCPDiscoveryState.NOT_STARTED && mcpServerCount === 0);

  return {
    discoveryState,
    mcpServerCount,
    isMcpReady,
  };
}
```

### Phase 4: Update AppContainer

#### Step 4.1: Update `packages/cli/src/ui/AppContainer.tsx`

**Add import:**

```typescript
import { useMcpStatus } from './hooks/useMcpStatus.js';
import { isSlashCommand } from './utils/commandUtils.js';
```

**Add hook usage:**

```typescript
// Inside AppContainer component:
const { isMcpReady } = useMcpStatus(config);
```

**Update `useMessageQueue` call (if exists) or add MCP readiness check:**

If LLxprt has `useMessageQueue`:
```typescript
const {
  messageQueue,
  addMessage,
} = useMessageQueue({
  isConfigInitialized,
  streamingState,
  submitQuery,
  isMcpReady,  // ADD THIS
});
```

If LLxprt does NOT have `useMessageQueue`, update `handleFinalSubmit`:

```typescript
const handleFinalSubmit = useCallback(
  (submittedValue: string) => {
    const isSlash = isSlashCommand(submittedValue.trim());
    const isIdle = streamingState === StreamingState.Idle;

    if (isSlash || (isIdle && isMcpReady)) {
      void submitQuery(submittedValue);
    } else {
      // Check messageQueue.length === 0 to only notify on the first queued item
      if (isIdle && !isMcpReady && messageQueue.length === 0) {
        coreEvents.emitFeedback(
          'info',
          'Waiting for MCP servers to initialize... Slash commands are still available and prompts will be queued.',
        );
      }
      addMessage(submittedValue);
    }
    addInput(submittedValue); // Track input for up-arrow history
  },
  [
    addMessage,
    addInput,
    submitQuery,
    isMcpReady,
    streamingState,
    messageQueue.length,
  ],
);
```

### Phase 5: Update useGeminiStream

#### Step 5.1: Update `packages/cli/src/ui/hooks/useGeminiStream.ts`

**REMOVE MCP status logic (if present):**

```typescript
// REMOVE THIS ENTIRE BLOCK if it exists:
const discoveryState = config
  .getMcpClientManager()
  ?.getDiscoveryState();
const mcpServerCount =
  config.getMcpClientManager()?.getMcpServerCount() ?? 0;
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

**Remove unused import:**

```typescript
// REMOVE if no longer used:
import { MCPDiscoveryState } from '@vybestack/llxprt-code-core';
```

### Phase 6: Create or Update useMessageQueue

#### Step 6.1: Check if LLxprt has useMessageQueue

```bash
ls -la packages/cli/src/ui/hooks/useMessageQueue*.ts
```

**Before creating `useMessageQueue`, locate the actual submission/queue path in LLxprt:**

```bash
# Find where user input is submitted to the AI loop in AppContainer:
grep -n 'submitQuery\|handleSubmit\|handleFinalSubmit\|onSubmit' \
  packages/cli/src/ui/AppContainer.tsx | head -30

# Find if a queue concept already exists:
grep -rn 'queue\|Queue\|pending\|Pending' \
  packages/cli/src/ui/hooks/ packages/cli/src/ui/AppContainer.tsx | head -30
```

> **Mapping requirement:** Before writing any queue code, identify:
> 1. The exact function in `AppContainer.tsx` that dispatches user input to the AI
> 2. Whether that function already has a pending/queue guard (e.g., checks `streamingState`)
> 3. Where `isConfigInitialized` is set and whether it already gates submission
>
> The `isMcpReady` gate must be injected at the **same decision point** as the
> existing streaming-state guard — not at a separate layer. Injecting it in the
> wrong place (e.g., after the streaming check but before history push, or vice
> versa) creates subtle ordering bugs.

**If `useMessageQueue` does not exist in LLxprt, create it with LLxprt-specific rules:**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { StreamingState } from '../types.js';

export interface UseMessageQueueOptions {
  isConfigInitialized: boolean;
  streamingState: StreamingState;
  submitQuery: (query: string) => void;
  isMcpReady: boolean;
}

export interface UseMessageQueueReturn {
  messageQueue: string[];
  addMessage: (message: string) => void;
}

export function useMessageQueue({
  isConfigInitialized,
  streamingState,
  submitQuery,
  isMcpReady,
}: UseMessageQueueOptions): UseMessageQueueReturn {
  const [messageQueue, setMessageQueue] = useState<string[]>([]);

  const addMessage = useCallback((message: string) => {
    setMessageQueue((prev) => [...prev, message]);
  }, []);

  // Flush the queue when all gates are open: config ready, idle, MCP ready
  useEffect(() => {
    if (
      isConfigInitialized &&
      streamingState === StreamingState.Idle &&
      isMcpReady &&
      messageQueue.length > 0
    ) {
      // Submit messages one at a time (not combined) to preserve individual turns
      const [next, ...rest] = messageQueue;
      setMessageQueue(rest);
      submitQuery(next);
    }
  }, [
    isConfigInitialized,
    streamingState,
    isMcpReady,
    messageQueue,
    submitQuery,
  ]);

  return {
    messageQueue,
    addMessage,
  };
}
```

> **LLxprt queue rules (differ from upstream):**
> - Submit messages **one at a time**, not combined — each queued message is a
>   separate conversational turn. Upstream's `join('\n\n')` collapses them into
>   one turn which loses context boundaries.
> - The flush effect re-runs on each state change; the `[next, ...rest]` pattern
>   ensures the effect settles one message per render cycle without a loop.
> - Slash commands MUST bypass the queue entirely (handled in `handleFinalSubmit`
>   before `addMessage` is ever called).

### Phase 7: Fix `appEvents` in CLI Config — REQUIRED

> **Correction to earlier analysis:** The claim "LLxprt is already aligned / no
> appEvents" is **wrong**. `packages/cli/src/config/config.ts` STILL imports and
> uses the CLI-local `appEvents` emitter. This must be explicitly resolved as part
> of this commit — do not skip it.

#### Step 7.1: Audit `packages/cli/src/config/config.ts`

Grep for `appEvents` in that file:

```bash
grep -n 'appEvents' packages/cli/src/config/config.ts
```

**Expected findings:** One or more import and usage sites. Example:

```typescript
import { appEvents } from '../utils/events.js';
// ...
eventEmitter: appEvents as EventEmitter<ExtensionEvents>,
```

#### Step 7.2: Decide migration strategy (choose one — document decision in PR)

**Option A — Full migration (preferred):**
Replace all `appEvents` usages in `config.ts` with `coreEvents`:

```typescript
// Remove:
import { appEvents } from '../utils/events.js';

// Add (if not already imported):
import { coreEvents } from '@vybestack/llxprt-code-core';

// Replace:
eventEmitter: coreEvents as EventEmitter<ExtensionEvents>,
```

Verify that `McpClientUpdate` events will now propagate correctly through the
single `coreEvents` emitter shared between `mcp-client-manager.ts` and
`useMcpStatus.ts`.

**Option B — Dual emitter (only if Option A breaks other functionality):**
If `appEvents` is used for CLI-only events that must NOT flow through core,
document exactly which events still use `appEvents` and why. Add a comment to
`config.ts` explaining why the dual-emitter pattern is intentional here. Verify
that `McpClientUpdate` (which flows through `coreEvents`) is still received by
`useMcpStatus` correctly despite the dual-emitter setup.

> **Failure condition:** If this step is skipped entirely, MCP update events may
> not propagate to the UI status hook, silently breaking the MCP ready gate.

### Phase 8: Create Tests

> **Test coverage requirement:** Tests must cover the full LLxprt submission flow,
> not just the isolated hook. Unit tests for `useMcpStatus` alone are insufficient
> — add integration-style tests for the `AppContainer`/queue interaction.

#### Step 8.1: Create `packages/cli/src/ui/hooks/useMcpStatus.test.tsx`

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { act } from 'react';
import { render } from '../../test-utils/render.js';
import { useMcpStatus } from './useMcpStatus.js';
import {
  MCPDiscoveryState,
  type Config,
  CoreEvent,
  coreEvents,
} from '@vybestack/llxprt-code-core';

describe('useMcpStatus', () => {
  let mockConfig: Config;
  let mockMcpClientManager: {
    getDiscoveryState: Mock<() => MCPDiscoveryState>;
    getMcpServerCount: Mock<() => number>;
  };

  beforeEach(() => {
    mockMcpClientManager = {
      getDiscoveryState: vi.fn().mockReturnValue(MCPDiscoveryState.NOT_STARTED),
      getMcpServerCount: vi.fn().mockReturnValue(0),
    };

    mockConfig = {
      getMcpClientManager: vi.fn().mockReturnValue(mockMcpClientManager),
    } as unknown as Config;
  });

  const renderMcpStatusHook = (config: Config) => {
    let hookResult: ReturnType<typeof useMcpStatus>;
    function TestComponent({ config }: { config: Config }) {
      hookResult = useMcpStatus(config);
      return null;
    }
    render(<TestComponent config={config} />);
    return {
      result: {
        get current() {
          return hookResult;
        },
      },
    };
  };

  it('should initialize with correct values (no servers)', () => {
    const { result } = renderMcpStatusHook(mockConfig);

    expect(result.current.discoveryState).toBe(MCPDiscoveryState.NOT_STARTED);
    expect(result.current.mcpServerCount).toBe(0);
    expect(result.current.isMcpReady).toBe(true);
  });

  it('should initialize with correct values (with servers, not started)', () => {
    mockMcpClientManager.getMcpServerCount.mockReturnValue(1);
    const { result } = renderMcpStatusHook(mockConfig);

    expect(result.current.isMcpReady).toBe(false);
  });

  it('should not be ready while in progress', () => {
    mockMcpClientManager.getDiscoveryState.mockReturnValue(
      MCPDiscoveryState.IN_PROGRESS,
    );
    mockMcpClientManager.getMcpServerCount.mockReturnValue(1);
    const { result } = renderMcpStatusHook(mockConfig);

    expect(result.current.isMcpReady).toBe(false);
  });

  it('should update state when McpClientUpdate is emitted', () => {
    mockMcpClientManager.getMcpServerCount.mockReturnValue(1);
    mockMcpClientManager.getDiscoveryState.mockReturnValue(
      MCPDiscoveryState.IN_PROGRESS,
    );
    const { result } = renderMcpStatusHook(mockConfig);

    expect(result.current.isMcpReady).toBe(false);

    mockMcpClientManager.getDiscoveryState.mockReturnValue(
      MCPDiscoveryState.COMPLETED,
    );

    act(() => {
      coreEvents.emit(CoreEvent.McpClientUpdate, { clients: new Map() });
    });

    expect(result.current.discoveryState).toBe(MCPDiscoveryState.COMPLETED);
    expect(result.current.isMcpReady).toBe(true);
  });
});
```

#### Step 8.2: Add `packages/cli/src/ui/hooks/useMessageQueue.test.tsx`

Include these scenarios (LLxprt-specific flow):

```typescript
describe('useMessageQueue — LLxprt flow', () => {
  it('queues prompt while MCP init is in progress', async () => {
    // isMcpReady = false, streamingState = Idle
    // addMessage('hello') → queue length 1, submitQuery NOT called
  });

  it('slash command during IN_PROGRESS bypasses queue', async () => {
    // Slash commands are handled before addMessage — this test verifies that
    // handleFinalSubmit in AppContainer calls submitQuery directly for slash cmds,
    // not addMessage. Use AppContainer-level test for this.
  });

  it('flushes queue one message at a time when MCP becomes ready', async () => {
    // Three messages queued → isMcpReady flips true →
    // submitQuery called once per render cycle, queue drains
  });

  it('does not flush queue while streaming even when MCP ready', async () => {
    // streamingState = Streaming, isMcpReady = true →
    // queue stays intact until Idle
  });

  it('no-server startup: isMcpReady=true immediately, no queueing', async () => {
    // mcpServerCount=0, discoveryState=NOT_STARTED →
    // isMcpReady=true → submitQuery fires immediately, queue never used
  });
});
```

#### Step 8.3: Add AppContainer integration test (file: `AppContainer.mcp.test.tsx`)

```typescript
describe('AppContainer MCP init gate', () => {
  it('shows queued-info message on first non-slash prompt while MCP in progress', () => {
    // Render AppContainer with mock config where MCP is IN_PROGRESS, 1 server
    // Simulate user submitting "write me a poem"
    // Assert: coreEvents.emitFeedback called with info about queueing
    // Assert: submitQuery NOT called yet
  });

  it('prompt auto-submits after McpClientUpdate COMPLETED event fires', async () => {
    // Setup same as above, then emit CoreEvent.McpClientUpdate with COMPLETED state
    // Assert: submitQuery called with the queued prompt
  });

  it('slash command /help submits immediately regardless of MCP state', () => {
    // Simulate "/help" submission while MCP IN_PROGRESS
    // Assert: submitQuery called immediately (not queued)
  });

  it('no double-submission: second queued prompt waits for first to finish', async () => {
    // Two prompts queued during MCP init
    // MCP becomes ready, streaming starts for prompt 1
    // Assert: prompt 2 stays queued until streaming returns to Idle
  });
});
```

---

## Files to Read (Full Paths)

```
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/utils/events.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/tools/mcp-client-manager.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/AppContainer.tsx
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/hooks/useGeminiStream.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/config.ts
```

## Files to Create

```
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/hooks/useMcpStatus.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/hooks/useMcpStatus.test.tsx
```

## Files to Modify (Full Paths)

```
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/utils/events.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/tools/mcp-client-manager.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/AppContainer.tsx
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/hooks/useGeminiStream.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/config.ts
```

## Files to Create (if missing)

```
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/hooks/useMessageQueue.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/hooks/useMessageQueue.test.tsx
```

---

## Risk Areas

### Critical Risk
1. **MCP Initialization Race:** If `COMPLETED` transition does not emit `CoreEvent.McpClientUpdate`, the UI hangs forever — especially dangerous on the empty-server fast-path
2. **`appEvents` still in config.ts:** Falsely assumed to be migrated. If `appEvents` still wires up the MCP emitter while `useMcpStatus` listens on `coreEvents`, no events arrive and `isMcpReady` never flips
3. **Message Loss:** Messages queued during MCP init might be silently dropped if queue flush effect has a bug in the one-at-a-time drain pattern
4. **Slash Command Availability:** Slash commands must bypass the queue entirely — if routed through `addMessage`, they will be deferred behind MCP init

### High Risk
1. **Event String Literal Leakage:** Any raw `'mcp-client-update'` string surviving outside the enum definition will compile but silently not match, causing listener deafness
2. **Duplicate Listeners:** `useMcpStatus` or `config.ts` registering listeners on every re-render without cleanup causes event storms
3. **Hook Subscription Lifecycle:** `useEffect` cleanup in `useMcpStatus` must call `coreEvents.off` — missing cleanup leaks listeners across navigation
4. **Upstream Type Mismatch:** If the emit payload uses `Array<Map | never>` (upstream form) but listener expects `McpClientUpdatePayload` (LLxprt form), TypeScript may not catch the mismatch at runtime due to structural compatibility edge cases

### Medium Risk
1. **UI Responsiveness:** Users may see "waiting for MCP" unexpectedly if `isMcpReady` initialization reads a stale `discoveryState`
2. **Error Handling:** MCP discovery errors should transition to `COMPLETED` (or a new `FAILED` state) — app must not remain gated if discovery fails
3. **Dual-emitter ambiguity:** If both `appEvents` and `coreEvents` exist in `config.ts`, it's unclear which carries extension events and which carries MCP events without explicit documentation

---

## Acceptance Criteria

All of the following must be demonstrably true before this playbook is considered done:

1. **No raw `'mcp-client-update'` string literals** outside the enum definition — verified by grep returning zero results.

2. **`McpClientUpdate` uses `McpClientUpdatePayload`** — NOT `Array<Map<string, McpClient> | never>`. Emit and listen sites both use the typed payload wrapper.

3. **`appEvents` in `packages/cli/src/config/config.ts` is explicitly resolved** — either migrated to `coreEvents` or documented as intentional with proof that MCP update events still reach `useMcpStatus`.

4. **Empty-server fast-path emits `COMPLETED` event** — verified by test: when zero MCP servers are configured, `isMcpReady` is `true` on first render with no waiting.

5. **`useMcpStatus` cleanup runs on unmount** — `useEffect` returns a cleanup that calls `coreEvents.off`.

6. **Slash commands are never queued** — `/help` submitted during MCP `IN_PROGRESS` calls `submitQuery` immediately, not `addMessage`.

7. **Queue drains one message per turn** — verified by test showing three queued messages submit across three separate `submitQuery` calls, not merged into one.

8. **All integration tests pass** — `AppContainer.mcp.test.tsx` scenarios from Step 8.3 all green.

## Verification Steps

### Step 1: Enforce string literal ban
```bash
grep -rn "'mcp-client-update'" \
  packages/core/src packages/cli/src integration-tests/
# Must return ZERO results
```

### Step 2: Verify appEvents audit
```bash
grep -n 'appEvents' packages/cli/src/config/config.ts
# Review output — each occurrence needs a disposition comment or migration
```

### Step 3: Type Check
```bash
npm run typecheck
```

### Step 4: Run All Tests (including new integration tests)
```bash
npm run test
```

### Step 5: Test MCP Status Hook with real startup
```bash
# Start LLxprt with no MCP servers — must not hang
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
# isMcpReady must be true immediately, prompt executes without queueing
```

### Step 6: Full Verification Cycle
```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

---

## Rollback Plan

If critical issues arise:
1. Keep MCP status check in `useGeminiStream`
2. Remove `useMcpStatus` hook
3. Revert to blocking prompt submission in stream hook

---

## Notes

- This commit depends on the hooks schema refactor (211d2c5) for `coreEvents` integration
- The `McpClientUpdate` event must be emitted from `mcp-client-manager.ts`
- `appEvents` in CLI config.ts is NOT already migrated — audit and resolve explicitly (see Phase 7)
- The message queue is required for correct behavior — it is NOT optional and cannot be added incrementally after this commit ships
- All emit sites must use `McpClientUpdatePayload` wrapper, never raw `Map` arguments
- Test with zero-server startup to verify the empty-server fast-path emits `COMPLETED` immediately
