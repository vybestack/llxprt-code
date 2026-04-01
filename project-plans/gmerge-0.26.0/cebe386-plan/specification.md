# MCP Status Hook Refactor — Technical & Functional Specification

**Upstream Commit:** cebe386d797b210c2329284cb858b31788c68f23
**Risk Level:** HIGH
**Scope:** Cross-package refactor affecting MCP initialization flow, event system, message submission gating, and UI status display

---

## 1. Functional Description

This change introduces a reactive, event-driven mechanism for tracking MCP server initialization status and using that status to gate user message submission. The core behavior:

- A new React hook (`useMcpStatus`) provides real-time MCP discovery state to the UI layer.
- User prompts submitted before MCP discovery completes are queued (not dropped), then auto-submitted when MCP becomes ready.
- Slash commands bypass the queue entirely — they remain available at all times regardless of MCP state.
- The MCP status tracking is moved out of `useGeminiStream` (where it existed as an inline blocking check) into a dedicated, composable hook consumed by `AppContainer`.
- The event propagation path changes from `appEvents` (CLI-local emitter) to `coreEvents` (shared core emitter) for MCP client updates, establishing a single event bus for cross-package communication.

---

## 2. Why This Matters (Problem Statement)

### 2.1 Current Defect: Silent Prompt Dropping

Without this change, when a user submits a prompt while MCP servers are still initializing, the prompt is silently dropped with an informational message. The user must manually re-type and re-submit after initialization completes. This is a poor user experience — the user gets no queuing, no automatic retry, and no clear indication that their prompt will need to be resubmitted.

### 2.2 Architectural Debt: Inline MCP Status Checks

The current MCP readiness check lives inline inside `useGeminiStream`'s `submitQuery` function. This is the wrong abstraction layer:

- `useGeminiStream` is responsible for managing the AI conversation stream — it should not be gating submission based on infrastructure readiness.
- The inline check cannot queue messages; it can only block or drop them.
- Testing the MCP readiness logic requires standing up the entire Gemini streaming pipeline.

### 2.3 Event Bus Fragmentation

LLxprt currently has two event emitters:

- **`coreEvents`** (`packages/core/src/utils/events.ts`): Core-level singleton, used for `UserFeedback`, `MemoryChanged`, `ModelChanged`, `ConsoleLog`, `Output`, `ExternalEditorClosed`, `SettingsChanged`.
- **`appEvents`** (`packages/cli/src/utils/events.ts`): CLI-level emitter, used for `OpenDebugConsole`, `OauthDisplayMessage`, `Flicker`, `McpClientUpdate`, `McpServersDiscoveryStart`, `McpServerConnected`, `McpServerError`, `LogError`.

The `McpClientManager` (in core) currently receives `appEvents` as its `eventEmitter` parameter — passed from the CLI config layer at `packages/cli/src/config/config.ts:1508`. This means a core component is emitting events on a CLI-owned emitter, which is an architectural inversion. The new `useMcpStatus` hook in the CLI needs to listen for MCP events, but the correct source should be `coreEvents` since the events originate in core.

---

## 3. Current LLxprt Architecture

### 3.1 Baseline Evidence

The "current state" claims in this document are derived from the following codebase inspections. These commands should reproduce the same findings when run from the workspace root:

```bash
# No MCP gating in useGeminiStream (zero matches = no MCPDiscoveryState usage)
grep -rn 'MCPDiscoveryState' packages/cli/src/ui/hooks/useGeminiStream.ts
# Result: no matches

# Six emit sites for 'mcp-client-update' in McpClientManager
grep -rn "'mcp-client-update'" packages/core/src/tools/mcp-client-manager.ts
# Result: lines 116, 191, 196, 198, 233, 268

# appEvents passed as eventEmitter in CLI config
grep -n 'eventEmitter:' packages/cli/src/config/config.ts
# Result: line 1508 → eventEmitter: appEvents,

# McpClientManager constructed with injected eventEmitter in core config
grep -n 'McpClientManager(' packages/core/src/config/config.ts
# Result: line 1037 → new McpClientManager(this.toolRegistry, this, this.eventEmitter,)

# No getMcpServerCount method exists
grep -n 'getMcpServerCount' packages/core/src/tools/mcp-client-manager.ts
# Result: no matches

# No useMessageQueue hook exists (only unrelated console message queue ref)
grep -rn 'useMessageQueue' packages/cli/src/ui/hooks/
# Result: no matches

# Extension events emitted on injected eventEmitter (not coreEvents)
grep -n "eventEmitter?.emit('extensions" packages/core/src/utils/extensionLoader.ts
# Result: lines 71, 95, 170, 190 → extensionsStarting and extensionsStopping

# COMPLETED transition does not emit (line ~240 in mcp-client-manager.ts)
grep -A5 'MCPDiscoveryState.COMPLETED' packages/core/src/tools/mcp-client-manager.ts
# Result: line 241 sets discoveryState = COMPLETED inside .then() with no emit call

# handleFinalSubmit calls submitQuery directly (no gating)
grep -A10 'handleFinalSubmit' packages/cli/src/ui/AppContainer.tsx | head -20
# Result: line 1577 → submitQuery(trimmedValue) with no MCP check
```

### 3.2 Event System

**Core events** (`packages/core/src/utils/events.ts`):
- `CoreEventEmitter` class extends Node `EventEmitter` with typed overloads
- Singleton: `export const coreEvents = new CoreEventEmitter()`
- Has backlog/drain pattern for events emitted before listeners attach
- Enum `CoreEvent` defines 7 event types (no `McpClientUpdate` yet)
- Re-exported from `packages/core/src/index.ts` via wildcard (`export * from './utils/events.js'`)

**CLI events** (`packages/cli/src/utils/events.ts`):
- Plain `EventEmitter<AppEvents>` (not a custom class)
- Singleton: `export const appEvents = new EventEmitter<AppEvents>()`
- Enum `AppEvent` includes `McpClientUpdate = 'mcp-client-update'` (already defined)
- Interface `AppEvents` types the payload as `Array<Map<string, McpClient> | never>`

### 3.3 MCP Client Manager

**File:** `packages/core/src/tools/mcp-client-manager.ts`

- Class `McpClientManager` receives an optional `eventEmitter?: EventEmitter` in constructor
- Emits `'mcp-client-update'` as a raw string literal (not an enum constant) on the injected emitter
- Tracks `discoveryState: MCPDiscoveryState` internally (`NOT_STARTED` → `IN_PROGRESS` → `COMPLETED`)
- Exposes `getDiscoveryState(): MCPDiscoveryState`
- Does **not** expose `getMcpServerCount()` — this method does not exist on `McpClientManager`
- Has 6 emit sites for `'mcp-client-update'` (lines 116, 191, 196, 198, 233, 268), plus `coreEvents.emitFeedback` for error feedback
- No `McpClientUpdate` event emission on the `COMPLETED` state transition itself — the emit happens inside `maybeDiscoverMcpServer` per-server, and the COMPLETED transition (line ~240-243) does not emit

### 3.4 Config Construction

**File:** `packages/core/src/config/config.ts` (line 1037-1041):
```
this.mcpClientManager = new McpClientManager(
  this.toolRegistry,
  this,
  this.eventEmitter,   // ← injected EventEmitter from ConfigParameters
);
```

**File:** `packages/cli/src/config/config.ts` (line 1508):
```
eventEmitter: appEvents,   // ← CLI's appEvents is passed into core Config
```

The chain: CLI `loadCliConfig()` → `new Config({ eventEmitter: appEvents })` → `new McpClientManager(..., this.eventEmitter)` → emits on `appEvents`.

### 3.5 MCP Discovery State Type

**File:** `packages/core/src/tools/mcp-client.ts` (lines 91-98):
```typescript
export enum MCPDiscoveryState {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}
```

Exported from core via `export * from './tools/mcp-client.js'` in `index.ts`.

### 3.6 Message Submission Flow

**File:** `packages/cli/src/ui/AppContainer.tsx`

1. User types prompt → `handleFinalSubmit` (line 1559) fires
2. `handleFinalSubmit` calls `submitQuery(trimmedValue)` directly (line 1577) — no MCP readiness check
3. `submitQuery` lives in `useGeminiStream` — currently has **no** MCP blocking logic in LLxprt (confirmed: grep for `MCPDiscoveryState` in `useGeminiStream.ts` returns zero matches)
4. No `useMessageQueue` hook exists in LLxprt

**Critical finding:** LLxprt's `useGeminiStream` does **not** currently have the MCP discovery gate that the upstream plan assumes it does. The playbook's Phase 5 ("remove MCP status logic from useGeminiStream") references code that doesn't exist in the current codebase. This means:
- LLxprt currently has **no** MCP readiness gating at all — prompts flow straight through regardless of discovery state
- The change introduces gating where none existed before (not refactoring existing gating)

### 3.7 Status Display

**File:** `packages/cli/src/ui/components/StatusDisplay.tsx`

- Receives `mcpServers?: Record<string, MCPServerConfig>` as a prop
- Delegates to `ContextSummaryDisplay` which shows MCP server count
- Does **not** display MCP discovery state (not_started / in_progress / completed)
- The StatusDisplay is a passive component — no event subscriptions

### 3.8 No useMessageQueue

LLxprt does not have a `useMessageQueue` hook. The only reference is a comment in `App.test.tsx` (line 1726). There is no message queuing infrastructure — `handleFinalSubmit` calls `submitQuery` synchronously without gating.

---

## 4. Target Architecture

### 4.1 Event Flow (After Change)

```
McpClientManager (core)
  ├─ emits CoreEvent.McpClientUpdate on coreEvents (core singleton)
  │
  ├─ useMcpStatus hook (CLI) listens on coreEvents
  │   └─ provides { discoveryState, mcpServerCount, isMcpReady }
  │
  └─ AppContainer (CLI)
      ├─ consumes useMcpStatus
      ├─ passes isMcpReady to useMessageQueue
      └─ handleFinalSubmit gates on isMcpReady (slash commands bypass)
```

### 4.2 Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `McpClientManager` | Emits `CoreEvent.McpClientUpdate` on every discovery state change via `coreEvents` |
| `CoreEvent` enum | Defines `McpClientUpdate` as the single source of truth for the event name |
| `useMcpStatus` hook | Subscribes to `coreEvents`, derives `isMcpReady` from discovery state and server count |
| `useMessageQueue` hook | Holds pending messages, flushes one-at-a-time when gates open (config ready, idle, MCP ready) |
| `AppContainer` | Orchestrates: routes slash commands directly, queues prompts when MCP not ready, shows info message on first queue |
| `handleFinalSubmit` | Decision point: slash command → `submitQuery` immediately; prompt + MCP not ready → `addMessage`; prompt + MCP ready → `submitQuery` |

### 4.3 State Machine

```
MCP Discovery States:
  NOT_STARTED ──(servers configured)──▸ IN_PROGRESS ──(all resolved)──▸ COMPLETED
       │                                                                    │
       ▼                                                                    ▼
  isMcpReady = true                                              isMcpReady = true
  (when mcpServerCount === 0)                                   (always)

Message Queue States:
  EMPTY ──(prompt + !isMcpReady)──▸ QUEUED ──(isMcpReady + Idle)──▸ FLUSHING ──(queue empty)──▸ EMPTY
                                       │                               │
                                       ▼                               ▼
                                  (more prompts)              (submit one, remain FLUSHING
                                  add to queue                 until queue drains)
```

---

## 5. Cross-Package Impact Map

### 5.1 `packages/core` (foundation layer)

| File | Impact | Description |
|------|--------|-------------|
| `src/utils/events.ts` | **MODIFY** | Add `McpClientUpdate` to `CoreEvent` enum; add typed payload interface; add `on`/`off`/`emit` overloads to `CoreEventEmitter` |
| `src/tools/mcp-client-manager.ts` | **MODIFY** | Switch all `this.eventEmitter?.emit('mcp-client-update', ...)` to `coreEvents.emit(CoreEvent.McpClientUpdate, ...)`. Remove `eventEmitter` constructor parameter dependency for MCP events. Ensure COMPLETED transition emits. |
| `src/config/config.ts` | **AUDIT** | Verify `eventEmitter` parameter still needed for non-MCP events (extensions). No code change needed if `eventEmitter` is still used for extension events. |
| `src/index.ts` | **VERIFY** | Wildcard re-export of `events.ts` already covers new enum member. No change needed. |

### 5.2 `packages/cli` (UI layer)

| File | Impact | Description |
|------|--------|-------------|
| `src/ui/hooks/useMcpStatus.ts` | **CREATE** | New hook: subscribes to `CoreEvent.McpClientUpdate`, derives `isMcpReady` |
| `src/ui/hooks/useMessageQueue.ts` | **CREATE** | New hook: message queue with multi-gate flush (config, streaming, MCP) |
| `src/ui/AppContainer.tsx` | **MODIFY** | Import and consume `useMcpStatus` and `useMessageQueue`; update `handleFinalSubmit` to gate/queue |
| `src/ui/hooks/useGeminiStream.ts` | **VERIFY** | Confirm no MCP blocking logic exists (already verified — none present) |
| `src/config/config.ts` | **MODIFY** | Change `eventEmitter: appEvents` to `eventEmitter: coreEvents` OR remove if no longer needed for MCP |
| `src/utils/events.ts` | **AUDIT** | `AppEvent.McpClientUpdate` and related types may become dead code after migration |

### 5.3 Test Files

| File | Impact |
|------|--------|
| `packages/cli/src/ui/hooks/useMcpStatus.test.tsx` | **CREATE** |
| `packages/cli/src/ui/hooks/useMessageQueue.test.tsx` | **CREATE** |
| `packages/core/src/tools/mcp-client-manager.test.ts` | **MODIFY** — verify emit on `coreEvents` |

---

## 6. Dependency Chain

```
1. CoreEvent.McpClientUpdate enum value  (events.ts)
   └─ typed payload interface            (events.ts)
      └─ CoreEventEmitter overloads      (events.ts)
         ├─ McpClientManager emit sites  (mcp-client-manager.ts)
         │  └─ CLI config eventEmitter audit (cli/config/config.ts)
         └─ useMcpStatus hook            (useMcpStatus.ts)
            └─ useMessageQueue hook      (useMessageQueue.ts)
               └─ AppContainer wiring    (AppContainer.tsx)
                  └─ handleFinalSubmit   (AppContainer.tsx)
```

Each layer depends on the one above it. The event definition must exist before emitters or listeners can use it. The hooks must exist before AppContainer can consume them.

---

## 7. Key Technical Decisions and Constraints

### 7.1 Event Bus: `coreEvents` not `appEvents`

**Decision:** MCP client update events must flow through `coreEvents`, not `appEvents`.

**Rationale:**
- `McpClientManager` lives in core — it should not depend on CLI infrastructure
- `coreEvents` is already imported by `McpClientManager` (for `emitFeedback`)
- `coreEvents` has the backlog/drain pattern, ensuring events emitted before the UI attaches are not lost
- `appEvents` would require the hook to import from CLI utils, creating a circular dependency risk

**Constraint:** The `eventEmitter` parameter passed from CLI to core Config still serves extension events. `ExtensionLoader` (in `packages/core/src/utils/extensionLoader.ts`) emits `extensionsStarting` and `extensionsStopping` events on the injected `eventEmitter`, and `Config.getExtensionEvents()` returns `this.eventEmitter` (line 1900). These events are consumed in the CLI via `appEvents`. The `eventEmitter` parameter cannot be removed — only the MCP update events should migrate to `coreEvents`.

### 7.2 Typed Payload: `McpClientUpdatePayload` not Raw Map

**Decision:** Use a named payload interface, not the upstream `Array<Map<string, McpClient> | never>`.

**Rationale:**
- LLxprt convention: all core events use named payload interfaces (`UserFeedbackPayload`, `MemoryChangedPayload`, etc.)
- `ReadonlyMap` prevents accidental mutation of the manager's internal client map from listeners
- Named interface is self-documenting and enables future extension (e.g., adding `discoveryState` to payload)

### 7.3 Queue Semantics: One Message Per Turn

**Decision:** The message queue flushes one message per render cycle, not all at once.

**Rationale:**
- Each queued prompt represents a separate user intent / conversational turn
- Combining them (upstream's `join('\n\n')`) loses turn boundaries
- One-at-a-time drain ensures each prompt gets its own AI response
- The effect re-triggers naturally as `streamingState` transitions back to `Idle` after each submission

### 7.4 Slash Command Bypass

**Decision:** Slash commands never enter the message queue. They always execute immediately.

**Rationale:**
- Slash commands are UI-layer operations (`/help`, `/clear`, `/mcp`, etc.) — they don't require MCP tools
- Queuing them would break user expectations for immediate feedback
- The decision point is in `handleFinalSubmit`, before `addMessage` is ever called

### 7.5 `isMcpReady` Derivation

**Decision:** `isMcpReady` is `true` when:
- `discoveryState === COMPLETED`, OR
- `discoveryState === NOT_STARTED` AND `mcpServerCount === 0`

**Rationale:** The zero-server case must be immediately ready. If no MCP servers are configured, the app should never wait for discovery.

### 7.6 No `getMcpServerCount` in Current Code

**Constraint:** `McpClientManager` does not currently expose `getMcpServerCount()`. This method must be added, or the hook must derive server count from the `clients` map size (available via the event payload or a new getter). The playbook assumes this method exists — it does not.

### 7.7 Partial MCP Failure Semantics

**Normative statement:** When some MCP servers fail during discovery but discovery itself completes, `discoveryState` transitions to `COMPLETED` regardless of per-server outcomes. `COMPLETED` means the discovery process has finished — it does not imply all servers connected successfully. Individual server failures are reported via `coreEvents.emitFeedback` (error severity) but do not block the queue. Once `discoveryState === COMPLETED`, `isMcpReady` is `true` and queued prompts are released. There is no `FAILED` or `PARTIAL` discovery state.

---

## 8. Race Condition Risks and Mitigation

### 8.1 COMPLETED Transition Without Event Emission

**Risk:** The `discoveryState` transitions to `COMPLETED` inside a `.then()` callback (`packages/core/src/tools/mcp-client-manager.ts`, ~line 240-243) that does NOT emit `McpClientUpdate`. If the hook initializes before this transition, it sees `IN_PROGRESS` but never receives the `COMPLETED` signal → `isMcpReady` stays false forever → the queue never flushes → **deadlock**.

**Mitigation:** Every path that sets `discoveryState = MCPDiscoveryState.COMPLETED` must emit `CoreEvent.McpClientUpdate`. This includes:
1. The normal completion `.then()` after all servers resolve
2. The empty-server fast-path (zero servers configured → immediate COMPLETED)
3. Any error path that terminates discovery

### 8.2 Hook Mounts After Discovery Completes

**Risk:** `useMcpStatus` mounts (registers listener) AFTER `McpClientManager` has already transitioned to `COMPLETED` and emitted the event → the hook misses the event → stuck at `NOT_STARTED` or `IN_PROGRESS`.

**Mitigation:** `useMcpStatus` initializes state from `config.getMcpClientManager()?.getDiscoveryState()` in the `useState` initializer (synchronous, runs before first render). This reads the current state directly, so even if events were missed, the initial state is correct.

### 8.3 `appEvents` Still Wired but `useMcpStatus` Listens on `coreEvents`

**Risk:** If the migration is incomplete — `McpClientManager` still emits on `appEvents` (the injected emitter) while `useMcpStatus` listens on `coreEvents` — no events arrive at the hook.

**Mitigation:** The emit sites in `McpClientManager` must be changed to use `coreEvents.emit(CoreEvent.McpClientUpdate, ...)` directly, bypassing the injected `eventEmitter` for MCP events. Both the emit and listen must use the same singleton.

### 8.4 Duplicate Listener Accumulation

**Risk:** If `useMcpStatus`'s `useEffect` doesn't clean up, or if the component re-mounts without unmounting (React strict mode), listeners accumulate → state updates fire multiple times per event → performance degradation and stale closures.

**Mitigation:** The `useEffect` must return a cleanup function that calls `coreEvents.off(CoreEvent.McpClientUpdate, onChange)`. The handler must be a stable reference captured in the effect closure.

### 8.5 Queue Infinite Loop

**Risk:** The `useMessageQueue` flush effect depends on `messageQueue` in its dependency array. Flushing removes an item (state change), which triggers the effect again. If the exit condition isn't correct, this creates an infinite re-render loop.

**Mitigation:** The flush effect only fires when `messageQueue.length > 0` AND all gates are open. After submitting one message, `streamingState` transitions away from `Idle` (because `submitQuery` starts streaming), which closes the gate and stops the loop. The next flush only happens after streaming returns to `Idle`.

### 8.6 Raw String Literal Mismatch

**Risk:** `McpClientManager` currently emits `'mcp-client-update'` as a raw string. If some emit sites are migrated to `CoreEvent.McpClientUpdate` but others are missed, or if the enum value differs from the raw string, listeners on one won't hear emits from the other.

**Mitigation:** After migration, grep the entire codebase for raw `'mcp-client-update'` strings. The ONLY allowed occurrence is the enum definition itself. All emit and listen sites must use the enum constant.

### 8.7 Stale Initial State in Zero-Server Scenario

**Risk:** When zero MCP servers are configured, `McpClientManager.startConfiguredMcpServers()` returns immediately without transitioning from `NOT_STARTED`. If `useMcpStatus` doesn't handle `NOT_STARTED + 0 servers = ready`, the app hangs.

**Mitigation:** The `isMcpReady` derivation explicitly handles this: `discoveryState === NOT_STARTED && mcpServerCount === 0` → `true`.

---

## 9. Out of Scope

The following are explicitly **not** part of this change:

- **MCP error state handling:** No new `FAILED` discovery state. Servers that fail during discovery still result in `COMPLETED` (with partial results). Error handling for individual servers is unchanged. See §7.7 for normative semantics.
- **StatusDisplay changes:** The `StatusDisplay` / `ContextSummaryDisplay` components are not modified to show discovery state. They continue to show server count as before.
- **Extension event migration:** Only MCP client update events migrate to `coreEvents`. Extension lifecycle events (`extensionsStarting`, `extensionsStopping`) remain on `appEvents` via the injected `eventEmitter`.
- **Prompt queuing for non-MCP reasons:** The message queue is MCP-driven: queuing happens when MCP is not ready. Queue flush is additionally gated by config initialization (`isConfigInitialized`) and streaming idle state (`streamingState === Idle`). These additional flush gates prevent submission when the system cannot accept prompts, but they do not independently cause queuing — only MCP readiness determines whether a prompt is queued vs. submitted directly.
