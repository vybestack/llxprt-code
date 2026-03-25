# Domain Analysis: MCP Status Hook Refactor

## Entities

### 1. Core Event System (`CoreEventEmitter` + `CoreEvent` enum)

The typed event bus used for cross-package communication. Singleton instance `coreEvents` exported from `packages/core/src/utils/events.ts`.

- **Current state**: `CoreEvent` enum has 7 members (`UserFeedback`, `MemoryChanged`, `ModelChanged`, `ConsoleLog`, `Output`, `ExternalEditorClosed`, `SettingsChanged`). No `McpClientUpdate` event.
- **Target state**: Add `McpClientUpdate` member with typed `McpClientUpdatePayload` and corresponding `on`/`off`/`emit` overloads on `CoreEventEmitter`.
- **Key feature**: Has a backlog/drain pattern for `UserFeedback` events emitted before listeners attach.

### 2. CLI Event System (`appEvents` + `AppEvent` enum)

CLI-local event emitter defined in `packages/cli/src/utils/events.ts`. Plain `EventEmitter<AppEvents>`.

- **Current state**: `AppEvent.McpClientUpdate = 'mcp-client-update'` already defined, with payload typed as `Array<Map<string, McpClient> | never>`.
- **Target state**: `McpClientUpdate` migrates to `CoreEvent`. `AppEvent.McpClientUpdate` is deprecated or removed. Other CLI events (`OpenDebugConsole`, `OauthDisplayMessage`, `Flicker`, `McpServersDiscoveryStart`, `McpServerConnected`, `McpServerError`, `LogError`) remain on `appEvents`.

### 3. MCP Client Manager (`McpClientManager`)

Core class managing MCP server connections. File: `packages/core/src/tools/mcp-client-manager.ts`.

- **Constructor**: `(toolRegistry, config, eventEmitter?, logger?)` — receives an injected `EventEmitter` (which is `appEvents` from CLI).
- **Internal state**: `discoveryState: MCPDiscoveryState` (NOT_STARTED → IN_PROGRESS → COMPLETED), `clients: Map<string, McpClient>`.
- **Emit sites**: 6 raw string `'mcp-client-update'` emits on `this.eventEmitter` (lines 116, 191, 196, 198, 233, 268).
- **Critical gap**: Line ~240 transitions `discoveryState` to `COMPLETED` but does NOT emit an event — hook would miss the ready signal.
- **Missing method**: `getMcpServerCount()` does not exist. Must be added or derived from payload.
- **Target state**: All MCP update emits use `coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })`. COMPLETED transition emits. Zero-server fast path emits.

### 4. MCP Discovery State (`MCPDiscoveryState` enum)

Defined in `packages/core/src/tools/mcp-client.ts` (lines 91-98). Three states: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`.

- Already exported from core via wildcard re-exports.
- No `FAILED` state — partial failures still result in `COMPLETED`.

### 5. Config Class (`Config`)

Core runtime configuration. File: `packages/core/src/config/config.ts`.

- Exposes `getMcpClientManager(): McpClientManager | undefined` (line 1525).
- Constructed with `eventEmitter` parameter from CLI config (line 1037-1041).
- The `eventEmitter` parameter is `appEvents` from CLI (set at `packages/cli/src/config/config.ts:1508`).

### 6. CLI Config Loader (`packages/cli/src/config/config.ts`)

Constructs `Config` with `eventEmitter: appEvents` (line 1508). This is how `McpClientManager` gets `appEvents` as its event emitter.

- **Key relationship**: Chain is `CLI loadCliConfig()` → `new Config({ eventEmitter: appEvents })` → `new McpClientManager(..., this.eventEmitter)`.
- **Target decision**: Either replace `appEvents` with `coreEvents` here, or have `McpClientManager` bypass the injected emitter for MCP events. The second approach is safer since `eventEmitter` also serves extension events.

### 7. AppContainer (`packages/cli/src/ui/AppContainer.tsx`)

Main UI component orchestrating message submission.

- **`handleFinalSubmit`** (line 1559): Calls `submitQuery(trimmedValue)` directly with no MCP gating.
- **`submitQuery`**: Lives in `useGeminiStream` — currently has NO MCP blocking logic.
- **No `useMessageQueue` hook exists** — prompts go straight through.
- **Slash command detection**: `isSlashCommand` from `packages/cli/src/ui/utils/commandUtils.ts`.
- **`isConfigInitialized`**: Used at line 1391 (hardcoded `true`).
- **`streamingState`**: Available from `useGeminiStream`, typed as `StreamingState`.

### 8. useMcpStatus Hook (NEW)

Does not exist yet. Will be created at `packages/cli/src/ui/hooks/useMcpStatus.ts`.

- Subscribes to `CoreEvent.McpClientUpdate` on `coreEvents`.
- Initializes from `config.getMcpClientManager()?.getDiscoveryState()` (synchronous).
- Returns `{ discoveryState, mcpServerCount, isMcpReady }`.
- `isMcpReady` derivation: `COMPLETED` → true; `NOT_STARTED && serverCount === 0` → true; else → false.

### 9. useMessageQueue Hook (NEW)

Does not exist yet. Will be created at `packages/cli/src/ui/hooks/useMessageQueue.ts`.

- Accepts gate parameters: `isConfigInitialized`, `streamingState`, `submitQuery`, `isMcpReady`.
- Holds a FIFO queue of pending user prompts.
- Flushes one message per render cycle when all gates open.
- Returns `{ messageQueue, addMessage }`.

### 10. StatusDisplay (`packages/cli/src/ui/components/StatusDisplay.tsx`)

Passive component showing MCP server count. NOT modified in this refactor — uses only props, no event subscriptions.

---

## State Transitions

### MCP Discovery Lifecycle

```
NOT_STARTED ──(servers configured, first maybeDiscoverMcpServer call)──▸ IN_PROGRESS
                                                                            │
                                                              (all servers resolved/failed)
                                                                            │
                                                                            ▼
NOT_STARTED ──(zero servers configured)──▸ COMPLETED  ◂──────────── COMPLETED
                                           (fast path)
```

### isMcpReady Derivation

```
discoveryState = NOT_STARTED  ∧  mcpServerCount = 0  →  isMcpReady = true
discoveryState = NOT_STARTED  ∧  mcpServerCount > 0  →  isMcpReady = false
discoveryState = IN_PROGRESS                          →  isMcpReady = false
discoveryState = COMPLETED                            →  isMcpReady = true
```

### Message Submission Flow (Target)

```
User types prompt → handleFinalSubmit fires
  │
  ├─ isSlashCommand? ─── YES ──▸ submitQuery immediately (bypass queue)
  │
  └─ NO
      ├─ isMcpReady && streamingState === Idle? ─── YES ──▸ submitQuery immediately
      │
      └─ NO ──▸ addMessage to queue
               (if first queue entry during this discovery cycle: emit info feedback)
               Queue flushes one-at-a-time when gates open
```

### Message Queue State Machine

```
EMPTY ──(prompt + gate closed)──▸ QUEUED ──(all gates open + idle)──▸ FLUSHING
                                    │                                     │
                                    ▼                                     ▼
                              (more prompts)                    (submit first message,
                              add to queue                      streaming starts →
                                                                gate closes, wait for idle,
                                                                then flush next)
                                                                     │
                                                              (queue empty)
                                                                     │
                                                                     ▼
                                                                   EMPTY
```

---

## Business Rules

1. **BR-01: MCP events on coreEvents, not appEvents** — `McpClientManager` (core) emits on the `coreEvents` singleton. No MCP events flow through the injected `eventEmitter`.

2. **BR-02: Named typed payload** — All MCP update events use `McpClientUpdatePayload { clients: ReadonlyMap<string, McpClient> }`. No raw `Map` arguments.

3. **BR-03: Single source of truth for event name** — The string `'mcp-client-update'` appears exactly once in the codebase: as the `CoreEvent.McpClientUpdate` enum value.

4. **BR-04: COMPLETED transition always emits** — Every code path that sets `discoveryState = COMPLETED` must emit `CoreEvent.McpClientUpdate`. Missing this causes deadlock.

5. **BR-05: Zero-server fast path** — When no MCP servers are configured, `isMcpReady` is `true` immediately. `discoveryState` transitions to `COMPLETED` and emits.

6. **BR-06: Slash commands bypass queue** — Slash commands never enter the message queue. They execute immediately regardless of MCP state.

7. **BR-07: Queue drains one message per turn** — Each queued prompt is a separate conversational turn. No combining.

8. **BR-08: Queue flush requires all gates** — `isConfigInitialized`, `streamingState === Idle`, and `isMcpReady` must all be true.

9. **BR-09: First-queue info message per discovery cycle** — The "MCP servers initializing, prompts queued" message shows once per discovery cycle, not once per queued prompt.

10. **BR-10: Partial failure = COMPLETED** — If some MCP servers fail but discovery finishes, state is `COMPLETED`. Individual failures are reported via `emitFeedback`.

11. **BR-11: Extension events unaffected** — `extensionsStarting`, `extensionsStopping` remain on the injected `eventEmitter` via `ExtensionLoader`. Not migrated.

12. **BR-12: Hook mount after completion** — `useMcpStatus` initializes from current manager state synchronously. No reliance on catching the event.

---

## Edge Cases

1. **Zero MCP servers**: `NOT_STARTED`, `mcpServerCount = 0` → `isMcpReady = true` immediately. No queue, no info message.
2. **Hook mounts after COMPLETED**: Manager is already at COMPLETED. Hook reads state from manager in `useState` initializer → correct from first render.
3. **All servers fail**: Discovery still transitions to COMPLETED. `isMcpReady = true`. Queue flushes normally.
4. **Queue during streaming**: User submits prompt while AI is responding and MCP is ready. Prompt goes to queue (gate closed: streaming not idle). Flushes when streaming completes.
5. **Multiple prompts queued**: Drain one per idle cycle. FIFO order preserved.
6. **Slash command during MCP init**: `/help` while `IN_PROGRESS` → executes immediately. No info message.
7. **Re-discovery cycle**: If MCP config changes mid-session and discovery restarts, the first-queue info message counter resets.
8. **Listener leak**: `useMcpStatus` cleanup must call `coreEvents.off`. React strict mode double-mounts must not leak.
9. **Stale closure in queue flush**: `useEffect` for flush depends on `messageQueue`. After submitting one message, `streamingState` changes → gate closes → no infinite loop.
10. **Duplicate emit/listen mismatch**: If some emit sites still use raw `'mcp-client-update'` while hook listens for `CoreEvent.McpClientUpdate` → silent failure. Must grep-verify after migration.

---

## Error Scenarios

1. **COMPLETED without emit**: Discovery finishes, `discoveryState` set to `COMPLETED`, but no event emitted. Hook stuck at `IN_PROGRESS` → queue never flushes → **deadlock**. Mitigation: audit every COMPLETED assignment.

2. **appEvents/coreEvents mismatch**: Manager emits on `appEvents`, hook listens on `coreEvents` → events never arrive → `isMcpReady` never becomes `true`. Mitigation: migrate all MCP emits to `coreEvents`.

3. **getMcpServerCount missing**: Hook calls a method that doesn't exist → runtime crash. Mitigation: add method to `McpClientManager` or derive from payload.

4. **Queue infinite loop**: Flush effect runs, submits message, state changes trigger effect again, submits next message without waiting for streaming to start. Mitigation: `submitQuery` starts streaming → `streamingState` leaves `Idle` → gate closes.

5. **Input history lost**: If `addInput` is called only on the direct path but not the queue path, queued prompts lose up-arrow recall. Mitigation: `addInput` called in `handleFinalSubmit` before the queue/direct decision.
