# MCP Status Hook Refactor — Requirements (EARS Format)

**Upstream Commit:** cebe386d797b210c2329284cb858b31788c68f23
**Format:** EARS (Easy Approach to Requirements Syntax)
**Patterns Used:** Ubiquitous (U), Event-driven (E), State-driven (S), Optional (O), Complex (C)

---

## Requirement Key

| ID Pattern | Area |
|------------|------|
| REQ-EVT-* | Core event system |
| REQ-MGR-* | MCP Client Manager |
| REQ-HOOK-* | useMcpStatus hook |
| REQ-QUEUE-* | Message queue |
| REQ-GATE-* | Submission gating |
| REQ-UI-* | Status display / user feedback |
| REQ-TEST-* | Testing requirements |
| REQ-CFG-* | CLI config |

---

## A. Core Event System

### REQ-EVT-001 — McpClientUpdate Event Type (Ubiquitous)

The `CoreEvent` enum **shall** include a `McpClientUpdate` member with a unique string value.

**Acceptance Criteria:**
1. `CoreEvent.McpClientUpdate` is defined in `packages/core/src/utils/events.ts`
2. The enum member maps to a string value
3. The enum member is importable from `@vybestack/llxprt-code-core`
4. No other enum member or constant in the codebase uses the same string value

---

### REQ-EVT-002 — Typed Payload Interface (Ubiquitous)

The `McpClientUpdate` event **shall** use a named, typed payload interface following LLxprt conventions.

**Acceptance Criteria:**
1. An interface `McpClientUpdatePayload` is exported from `packages/core/src/utils/events.ts`
2. The interface contains a `clients` property typed as `ReadonlyMap<string, McpClient>`
3. All emit sites pass a value conforming to this interface
4. All listen sites receive a value typed as this interface
5. The interface is importable from `@vybestack/llxprt-code-core`

---

### REQ-EVT-003 — Single Source of Truth for Event Name (Ubiquitous)

The string value of the `McpClientUpdate` event **shall** appear exactly once in the codebase — as the enum definition.

**Acceptance Criteria:**
1. `grep -rn "mcp-client-update" packages/core/src packages/cli/src integration-tests/` returns results only from the `CoreEvent` enum definition line (matching single-quoted, double-quoted, and template-literal forms)
2. All emit, listen, and test sites use `CoreEvent.McpClientUpdate`, never a raw string literal
3. TypeScript compilation succeeds with strict mode
4. The `AppEvent.McpClientUpdate` enum member in `packages/cli/src/utils/events.ts` is removed or documented as deprecated

---

### REQ-EVT-004 — CoreEventEmitter Type Overloads (Ubiquitous)

The `CoreEventEmitter` class **shall** include typed `on`, `off`, and `emit` overloads for the `McpClientUpdate` event.

**Acceptance Criteria:**
1. `coreEvents.on(CoreEvent.McpClientUpdate, handler)` compiles with `handler: (payload: McpClientUpdatePayload) => void`
2. `coreEvents.off(CoreEvent.McpClientUpdate, handler)` compiles with the same handler type
3. `coreEvents.emit(CoreEvent.McpClientUpdate, payload)` compiles with `payload: McpClientUpdatePayload`
4. Passing an incorrectly typed payload causes a TypeScript compile error

---

### REQ-EVT-005 — Extension and Non-MCP Event Compatibility (Ubiquitous)

Extension lifecycle events and all other non-MCP events on `coreEvents` and `appEvents` **shall** continue to function correctly after the MCP event migration.

**Acceptance Criteria:**
1. Extension lifecycle events (`extensionsStarting`, `extensionsStopping`) continue to be emitted on the injected `eventEmitter` (which is `appEvents` in CLI context) via `ExtensionLoader`
2. CLI-specific `appEvents` (`OpenDebugConsole`, `OauthDisplayMessage`, `Flicker`, `McpServersDiscoveryStart`, `McpServerConnected`, `McpServerError`, `LogError`) continue to function without changes
3. All existing `coreEvents` subscribers (`UserFeedback`, `MemoryChanged`, `ModelChanged`, `ConsoleLog`, `Output`, `ExternalEditorClosed`, `SettingsChanged`) are unaffected
4. `Config.getExtensionEvents()` continues to return the injected `eventEmitter` for extension event consumption
5. Existing tests for extension loading/unloading pass without modification

---

## B. MCP Client Manager

### REQ-MGR-001 — Emit on Discovery State Transition to COMPLETED (Event-driven)

**When** the `McpClientManager` discovery state transitions to `COMPLETED`, the system **shall** emit `CoreEvent.McpClientUpdate` on `coreEvents` with the current client map.

**Acceptance Criteria:**
1. Every code path that sets `discoveryState = MCPDiscoveryState.COMPLETED` immediately emits `CoreEvent.McpClientUpdate`
2. The emit uses `coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })`
3. A test verifies that the COMPLETED transition produces an event

---

### REQ-MGR-002 — Emit on Discovery State Transition to IN_PROGRESS (Event-driven)

**When** the `McpClientManager` discovery state transitions to `IN_PROGRESS`, the system **shall** emit `CoreEvent.McpClientUpdate` on `coreEvents`.

**Acceptance Criteria:**
1. The first call to `maybeDiscoverMcpServer` that transitions from `NOT_STARTED` to `IN_PROGRESS` emits `CoreEvent.McpClientUpdate`
2. A test verifies the IN_PROGRESS transition produces an event

---

### REQ-MGR-003 — Emit on Client Map Change (Event-driven)

**When** the `McpClientManager` client map changes (client added, removed, or status updated), the system **shall** emit `CoreEvent.McpClientUpdate` on `coreEvents`.

**Acceptance Criteria:**
1. All existing emit sites that fire on client map changes use `coreEvents.emit(CoreEvent.McpClientUpdate, ...)`
2. No emit sites use the injected `this.eventEmitter` for MCP client update events
3. Existing tests for client add/remove/error scenarios continue to pass

---

### REQ-MGR-004 — Emit on Zero-Server Fast Path (Event-driven)

**When** `startConfiguredMcpServers` is called and zero MCP servers are configured, the system **shall** transition to `COMPLETED` and emit `CoreEvent.McpClientUpdate`.

**Acceptance Criteria:**
1. Calling `startConfiguredMcpServers()` with an empty server configuration emits exactly one `CoreEvent.McpClientUpdate` event
2. After the call, `getDiscoveryState()` returns `MCPDiscoveryState.COMPLETED`
3. A dedicated test verifies this fast path

---

### REQ-MGR-005 — Server Count Accessibility (Ubiquitous)

The `McpClientManager` **shall** provide a way to determine the count of configured/discovered MCP servers.

**Acceptance Criteria:**
1. The count of servers is determinable either via a `getMcpServerCount()` method, or via the `clients` map size in the `McpClientUpdatePayload`
2. The count reflects the current state (in-progress servers that haven't connected yet are still counted)
3. The value is accessible from the `useMcpStatus` hook

---

### REQ-MGR-006 — Emit via coreEvents, Not Injected EventEmitter (Ubiquitous)

The `McpClientManager` **shall** emit `CoreEvent.McpClientUpdate` on the `coreEvents` singleton, not on the injected `eventEmitter` parameter.

**Acceptance Criteria:**
1. All `this.eventEmitter?.emit('mcp-client-update', ...)` calls are replaced with `coreEvents.emit(CoreEvent.McpClientUpdate, ...)`
2. The injected `eventEmitter` is not used for MCP client update events
3. The injected `eventEmitter` may still be used for other event types (extension events) if applicable
4. TypeScript compilation succeeds

---

## C. useMcpStatus Hook

### REQ-HOOK-001 — Initial State from Current Manager (Ubiquitous)

The `useMcpStatus` hook **shall** initialize its state from the current `McpClientManager` state, not from defaults.

**Acceptance Criteria:**
1. If `McpClientManager` is already at `COMPLETED` when the hook mounts, `discoveryState` initializes as `COMPLETED`
2. If no `McpClientManager` exists, `discoveryState` initializes as `NOT_STARTED`
3. No event emission is required for the hook to reflect the correct initial state
4. A test verifies correct initialization when the manager is pre-COMPLETED

---

### REQ-HOOK-002 — Reactive State Updates (Event-driven)

**When** a `CoreEvent.McpClientUpdate` event is emitted, the `useMcpStatus` hook **shall** update its `discoveryState` and `mcpServerCount` from the current manager state.

**Acceptance Criteria:**
1. Emitting `CoreEvent.McpClientUpdate` causes `discoveryState` to reflect `manager.getDiscoveryState()`
2. Emitting `CoreEvent.McpClientUpdate` causes `mcpServerCount` to reflect the current server count
3. A test verifies state updates in response to events

---

### REQ-HOOK-003 — isMcpReady Derivation (State-driven)

**While** `discoveryState` is `COMPLETED`, `isMcpReady` **shall** be `true`.

**While** `discoveryState` is `NOT_STARTED` and `mcpServerCount` is 0, `isMcpReady` **shall** be `true`.

**While** `discoveryState` is `IN_PROGRESS`, `isMcpReady` **shall** be `false`.

**While** `discoveryState` is `NOT_STARTED` and `mcpServerCount` is greater than 0, `isMcpReady` **shall** be `false`.

**Acceptance Criteria:**
1. A test covers each of the four state combinations above
2. `isMcpReady` is a derived boolean, not independently set
3. `isMcpReady` updates reactively when `discoveryState` or `mcpServerCount` changes

---

### REQ-HOOK-004 — Listener Cleanup on Unmount (Ubiquitous)

The `useMcpStatus` hook **shall** remove its `coreEvents` listener when the component unmounts.

**Acceptance Criteria:**
1. The `useEffect` returns a cleanup function that calls `coreEvents.off(CoreEvent.McpClientUpdate, handler)`
2. After unmount, emitting `CoreEvent.McpClientUpdate` does not trigger state updates
3. A test verifies no listener leak (listener count returns to zero after unmount)

---

### REQ-HOOK-005 — Hook Return Shape (Ubiquitous)

The `useMcpStatus` hook **shall** return an object with `discoveryState`, `mcpServerCount`, and `isMcpReady` properties.

**Acceptance Criteria:**
1. `discoveryState` is typed as `MCPDiscoveryState`
2. `mcpServerCount` is typed as `number`
3. `isMcpReady` is typed as `boolean`
4. TypeScript compilation verifies the return type

---

## D. Message Queue

### REQ-QUEUE-001 — Queue Creation (Ubiquitous)

A `useMessageQueue` hook **shall** provide a message queue that holds user prompts submitted while submission gates are closed.

**Acceptance Criteria:**
1. The hook is a new file at `packages/cli/src/ui/hooks/useMessageQueue.ts`
2. The hook exports a `useMessageQueue` function
3. The hook returns `{ messageQueue: string[], addMessage: (message: string) => void }`
4. TypeScript compilation succeeds

---

### REQ-QUEUE-002 — Gate Parameters (Ubiquitous)

The `useMessageQueue` hook **shall** accept gate parameters: `isConfigInitialized`, `streamingState`, `submitQuery`, and `isMcpReady`.

**Acceptance Criteria:**
1. The hook accepts an options object with all four parameters
2. TypeScript enforces all four are required
3. The hook does not flush the queue unless ALL gates are open

---

### REQ-QUEUE-003 — Auto-Flush When Gates Open (Complex)

**When** all of the following are true: `isConfigInitialized` is `true`, `streamingState` is `Idle`, `isMcpReady` is `true`, and `messageQueue` has one or more items — the hook **shall** dequeue the first message and call `submitQuery` with it.

**Acceptance Criteria:**
1. Only the first message in the queue is submitted per flush cycle
2. `submitQuery` is called with the exact message string (no modification, no joining)
3. The submitted message is removed from the queue
4. Remaining messages stay in the queue until the next flush cycle
5. A test verifies three queued messages drain across three separate `submitQuery` calls

---

### REQ-QUEUE-004 — No Flush While Streaming (State-driven)

**While** `streamingState` is not `Idle`, the message queue **shall not** flush, even if `isMcpReady` is `true` and the queue is non-empty.

**Acceptance Criteria:**
1. A test verifies the queue remains intact when `streamingState === StreamingState.Responding`
2. The queue flushes only after `streamingState` transitions back to `Idle`

---

### REQ-QUEUE-005 — No Flush While MCP Not Ready (State-driven)

**While** `isMcpReady` is `false`, the message queue **shall not** flush, even if `streamingState` is `Idle` and the queue is non-empty.

**Acceptance Criteria:**
1. A test verifies the queue remains intact when `isMcpReady === false`
2. The queue flushes only after `isMcpReady` transitions to `true`

---

### REQ-QUEUE-006 — FIFO Ordering (Ubiquitous)

Queued prompts **shall** be submitted in FIFO (first-in, first-out) order. The queue **shall not** support reordering, priority insertion, or out-of-order submission.

**Acceptance Criteria:**
1. The first prompt added to the queue is the first prompt submitted to `submitQuery`
2. Three prompts queued in order A, B, C are submitted in order A, B, C across three flush cycles
3. No public API exists on the queue to reorder, swap, or skip entries
4. A test verifies ordering is preserved across multiple flush cycles

---

## E. Submission Gating

### REQ-GATE-001 — Slash Command Immediate Execution (Ubiquitous)

Slash commands **shall** execute immediately via `submitQuery`, regardless of MCP discovery state.

**Acceptance Criteria:**
1. Submitting `/help` while `discoveryState === IN_PROGRESS` calls `submitQuery` immediately
2. Submitting `/clear` while `discoveryState === NOT_STARTED` with servers configured calls `submitQuery` immediately
3. Slash commands are never added to the message queue
4. A test verifies slash commands bypass the queue

---

### REQ-GATE-002 — Prompt Queuing When MCP Not Ready (Complex)

**When** a user submits a non-slash-command prompt **and** `isMcpReady` is `false`, the system **shall** add the prompt to the message queue instead of calling `submitQuery`.

**Acceptance Criteria:**
1. The prompt is added to the message queue
2. `submitQuery` is NOT called
3. The prompt is preserved exactly as submitted (no trimming beyond what already occurs)
4. A test verifies queuing behavior

---

### REQ-GATE-003 — Prompt Direct Submission When MCP Ready (Complex)

**When** a user submits a non-slash-command prompt **and** `isMcpReady` is `true` **and** `streamingState` is `Idle`, the system **shall** call `submitQuery` directly without queuing.

**Acceptance Criteria:**
1. `submitQuery` is called with the prompt
2. The message queue is not used
3. This is the normal-path behavior when no MCP servers are configured or all servers are ready

---

### REQ-GATE-004 — Input History Tracking Preserved (Ubiquitous)

The message queue and gating logic **shall** preserve input history tracking — every submitted prompt (whether queued or direct) **shall** be added to the input history store for up-arrow recall.

**Acceptance Criteria:**
1. `inputHistoryStore.addInput(trimmedValue)` is called for every prompt, regardless of queue/direct path
2. A user who submits a prompt during MCP init can recall it with up-arrow even before it executes

---

### REQ-GATE-005 — Non-Idle Prompt Submission Behavior (Complex)

**When** a user submits a non-slash-command prompt **and** `isMcpReady` is `true` **and** `streamingState` is not `Idle` (i.e., streaming is active), the system **shall** queue the prompt for deferred submission rather than rejecting it.

**Acceptance Criteria:**
1. The prompt is added to the message queue (same queue as MCP-gated prompts)
2. `submitQuery` is NOT called immediately
3. The prompt is auto-submitted when `streamingState` returns to `Idle` and all other gates remain open
4. A test verifies prompts submitted during active streaming are queued, not dropped

---

## F. User Feedback

### REQ-UI-001 — First-Queue Info Message (Event-driven)

**When** the first non-slash-command prompt is queued while MCP is not ready, the system **shall** emit a user feedback message indicating that MCP servers are initializing and prompts will be queued.

The info message counter **shall** reset on each new MCP discovery cycle (i.e., when `discoveryState` transitions from `COMPLETED` or `NOT_STARTED` back to `IN_PROGRESS`). This means the message displays once per discovery cycle, not once per application session.

**Acceptance Criteria:**
1. An info-severity message is displayed to the user
2. The message indicates that MCP servers are initializing
3. The message indicates that slash commands are still available
4. The message indicates that prompts will be queued (not dropped)
5. The message is only shown once per discovery cycle (on first queue entry during that cycle), not on every subsequent queued prompt
6. If a re-discovery occurs (e.g., MCP server config changes mid-session), the message can appear again for the first queued prompt during the new discovery cycle
7. A test verifies the message emission and the per-cycle reset behavior

---

### REQ-UI-002 — No Message on Zero-Server Startup (State-driven)

**While** zero MCP servers are configured, the system **shall not** display any MCP initialization message.

**Acceptance Criteria:**
1. Starting the app with no MCP servers shows no MCP-related info/warning messages
2. `isMcpReady` is `true` from first render
3. Prompts submit immediately without queuing

---

## G. CLI Config Event Emitter

### REQ-CFG-001 — MCP Event Propagation via coreEvents (Ubiquitous)

The system **shall** ensure that `CoreEvent.McpClientUpdate` events emitted by `McpClientManager` are receivable by `useMcpStatus` via the `coreEvents` singleton.

**Acceptance Criteria:**
1. MCP client update events emitted by `McpClientManager` are receivable by `useMcpStatus` via `coreEvents`
2. The solution is documented (either `appEvents` replaced with `coreEvents`, or `McpClientManager` bypasses the injected emitter for MCP events)
3. Non-MCP events (extension lifecycle, flicker, OAuth) continue to function correctly
4. The `appEvents` `McpClientUpdate` type/enum is either removed or documented as deprecated

---

## H. Testing

### REQ-TEST-001 — useMcpStatus Unit Tests (Ubiquitous)

The `useMcpStatus` hook **shall** have unit tests covering all state combinations and transitions.

**Acceptance Criteria:**
1. Test: initialization with no servers → `isMcpReady === true`
2. Test: initialization with servers, NOT_STARTED → `isMcpReady === false`
3. Test: IN_PROGRESS → `isMcpReady === false`
4. Test: event emission → state updates correctly
5. Test: COMPLETED → `isMcpReady === true`
6. Test: cleanup on unmount removes listener
7. All tests follow LLxprt's existing test patterns (Vitest, render utilities, no mock theater)

---

### REQ-TEST-002 — useMessageQueue Unit Tests (Ubiquitous)

The `useMessageQueue` hook **shall** have unit tests covering queue, flush, and gate behavior.

**Acceptance Criteria:**
1. Test: queue prompt while MCP not ready → queue length increases, `submitQuery` not called
2. Test: flush when all gates open → first item dequeued, `submitQuery` called once
3. Test: three items queued → drain across three separate calls (FIFO order verified)
4. Test: no flush while streaming
5. Test: no flush while MCP not ready
6. Test: no-server startup → queue never used, `submitQuery` fires directly

---

### REQ-TEST-003 — McpClientManager Emit Tests (Ubiquitous)

The `McpClientManager` **shall** have tests verifying `CoreEvent.McpClientUpdate` emission.

**Acceptance Criteria:**
1. Test: COMPLETED transition emits event
2. Test: zero-server fast path emits event with COMPLETED state
3. Test: IN_PROGRESS transition emits event
4. Test: client addition emits event
5. Test: client removal emits event

---

### REQ-TEST-004 — Integration: AppContainer MCP Gating (Ubiquitous)

The `AppContainer` **shall** have integration-style tests verifying the end-to-end submission gating flow.

**Acceptance Criteria:**
1. Test: prompt submitted during IN_PROGRESS → queued, info message shown, `submitQuery` not called
2. Test: `CoreEvent.McpClientUpdate` with COMPLETED → queued prompt auto-submitted
3. Test: slash command during IN_PROGRESS → `submitQuery` called immediately
4. Test: two prompts queued → first submits on COMPLETED, second waits for idle
5. All tests use behavioral assertions (observable outcomes), not implementation details

---

### REQ-TEST-005 — String Literal Enforcement (Ubiquitous)

After all implementation is complete, a verification step **shall** confirm no raw `mcp-client-update` string literals exist outside the enum definition.

**Acceptance Criteria:**
1. `grep -rn "mcp-client-update" packages/core/src packages/cli/src integration-tests/` (matching all quoting styles: single-quoted `'mcp-client-update'`, double-quoted `"mcp-client-update"`, and backtick-template `` `mcp-client-update` ``) returns results only from the `CoreEvent` enum definition
2. This check is documented in the verification steps and can be run as a post-implementation gate

---

### REQ-TEST-006 — Full Verification Suite (Ubiquitous)

All changes **shall** pass the full LLxprt verification suite.

**Acceptance Criteria:**
1. `npm run test` passes
2. `npm run lint` passes
3. `npm run typecheck` passes
4. `npm run format` produces no changes
5. `npm run build` succeeds
6. `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` completes successfully (smoke test)

---

## Requirements Traceability Matrix

| Requirement | Depends On | Package | New/Modify |
|-------------|-----------|---------|------------|
| REQ-EVT-001 | — | core | Modify |
| REQ-EVT-002 | REQ-EVT-001 | core | Modify |
| REQ-EVT-003 | REQ-EVT-001 | core + cli | Verify |
| REQ-EVT-004 | REQ-EVT-001, REQ-EVT-002 | core | Modify |
| REQ-EVT-005 | REQ-EVT-001 | core + cli | Verify |
| REQ-MGR-001 | REQ-EVT-001, REQ-EVT-002 | core | Modify |
| REQ-MGR-002 | REQ-EVT-001, REQ-EVT-002 | core | Modify |
| REQ-MGR-003 | REQ-EVT-001, REQ-EVT-002 | core | Modify |
| REQ-MGR-004 | REQ-MGR-001 | core | Modify |
| REQ-MGR-005 | — | core | Modify |
| REQ-MGR-006 | REQ-EVT-001 | core | Modify |
| REQ-HOOK-001 | REQ-MGR-005 | cli | Create |
| REQ-HOOK-002 | REQ-EVT-001, REQ-MGR-003 | cli | Create |
| REQ-HOOK-003 | REQ-HOOK-001, REQ-HOOK-002 | cli | Create |
| REQ-HOOK-004 | REQ-HOOK-002 | cli | Create |
| REQ-HOOK-005 | REQ-HOOK-003 | cli | Create |
| REQ-QUEUE-001 | — | cli | Create |
| REQ-QUEUE-002 | REQ-HOOK-005 | cli | Create |
| REQ-QUEUE-003 | REQ-QUEUE-002 | cli | Create |
| REQ-QUEUE-004 | REQ-QUEUE-002 | cli | Create |
| REQ-QUEUE-005 | REQ-QUEUE-002 | cli | Create |
| REQ-QUEUE-006 | REQ-QUEUE-001 | cli | Create |
| REQ-GATE-001 | REQ-QUEUE-001 | cli | Modify |
| REQ-GATE-002 | REQ-HOOK-003, REQ-QUEUE-001 | cli | Modify |
| REQ-GATE-003 | REQ-HOOK-003 | cli | Modify |
| REQ-GATE-004 | REQ-GATE-001, REQ-GATE-002 | cli | Modify |
| REQ-GATE-005 | REQ-QUEUE-001, REQ-HOOK-003 | cli | Modify |
| REQ-UI-001 | REQ-GATE-002 | cli | Modify |
| REQ-UI-002 | REQ-HOOK-003 | cli | Verify |
| REQ-CFG-001 | REQ-MGR-006 | cli | Modify |
| REQ-TEST-001 | REQ-HOOK-* | cli | Create |
| REQ-TEST-002 | REQ-QUEUE-* | cli | Create |
| REQ-TEST-003 | REQ-MGR-* | core | Modify |
| REQ-TEST-004 | REQ-GATE-* | cli | Create |
| REQ-TEST-005 | REQ-EVT-003 | all | Verify |
| REQ-TEST-006 | all | all | Verify |
