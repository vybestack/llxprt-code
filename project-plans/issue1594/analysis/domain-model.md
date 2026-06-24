<!-- @plan:PLAN-20260617-COREAPI.P01 @requirement:REQ-001..REQ-021 -->
# Domain Model: Core Public Agent API

Plan ID: PLAN-20260617-COREAPI
Source: `project-plans/issue1594/overview.md`, `specification.md`
Scope: analysis only — NO implementation code.

---

## 1. Entities

### 1.1 `Agent` (aggregate root — the public facade)
The single public orchestration surface. Owns no engine logic; it **delegates** to:
- `AgenticLoop` — multi-turn tool loop (turns/tools/continuation).
- providers runtime-switch pipeline — provider/model/params/profile.
- `Config` — settings/history/compression/auth/dispose.
- `MessageBus` — tool confirmation + hook events.
- `CoreToolScheduler` / `ConfirmationCoordinator` — tool scheduling + approval.

**Invariant:** `Agent` never caches a live `AgentClient`. It resolves
`config.getAgentClient()` whenever building a loop. Because `AgenticLoop` itself
caches its constructor client, every switch/auth/profile rebind must call the Agent
facade's `rebuildLoop()` to dispose the old loop/subscriptions and construct a new
`AgenticLoop` bound to the current `config.getAgentClient()`.

**Sub-surfaces (composition, not inheritance):** `profiles`, `tools`, `mcp`, `auth`,
`ide`, `session`, `hooks`. Each is a thin controller over shipped machinery.

### 1.2 `AgentConfig` (value object — declarative input)
Immutable description of the desired agent: provider/model/params, auth (with
per-provider overrides + profile reference), tools/MCP, approval mode, working dir,
session id, the typed first-class fields (the REQ-002 classification), an UNSTABLE
`settings` escape hatch, and host callbacks (`onApproval`, `onOAuthPrompt`,
`editorCallbacks`). `AbortSignal`/`promptId` are **per-call** (`TurnOptions`), never on
`AgentConfig`.

### 1.3 `ConfigParameters` (existing core value object — translation target)
The adapter target. Each `AgentConfig` field is classified to exactly one of:
typed `ConfigParameters` field | a sub-surface concern | a documented `settings` entry.

### 1.4 `AgentEvent` (discriminated union — public stream element)
Stable projection of internal events. 19 public variant types projecting the 21
`GeminiEventType` members (two terminal variants — MaxSessionTurns,
ContextWindowWillOverflow terminal — fold into `done`/`context-warning`+`done`), plus
`tool-status` (scheduler origin, not a stream event). Terminator is always exactly one
`done`.

### 1.5 `DoneReason` (enum) & `AgentStopInfo` (value object)
`DoneReason` set includes stop, aborted, max-turns, context-overflow, loop-detected,
error, hook-stopped. `AgentStopInfo` has reason, optional systemMessage, optional
contextCleared — preserves hook stop/block payloads.

### 1.6 Public tool shapes
`AgentToolCall{id,name,args}`, `AgentToolResult{id,name,output,isError}`,
`ToolConfirmation{confirmationId,toolCallId,name,details}`,
`ToolUpdate{id,name,status,output?,agentId?}`. **Projections** — no internal fields
(`prompt_id`, `hookRestrictedAllowedTools`, raw `responseParts`, `errorType`,
`traceId`) leak.

### 1.7 `SessionStats` (normalized value object)
`{promptTokens,candidateTokens,totalTokens,cachedTokens,contextWindowSize,
contextWindowUsed,turnCount}`. Canonical sources: `uiTelemetryService` (token/usage),
`HistoryService` (turn/history). Consumers never deep-import either.


---

## 2. Relationships

```
AgentConfig --(adapter)--> ConfigParameters --(new Config)--> Config
createIsolatedRuntimeContext --(shared runtimeId/settings/messageBus)--> { Config, SettingsService, ProviderManager, OAuthManager }
Config --(initialize/refreshAuth/factory)--> AgentClient (config-owned, post-auth)
AgenticLoop --(holds)--> { AgentClient(cached constructor arg), Config, MessageBus, approvalHandler }
Agent --(delegates)--> AgenticLoop | providers/runtime | Config | MessageBus | scheduler
Agent --(rebuildLoop after client rebind)--> new AgenticLoop(config.getAgentClient())
Agent.stream() == merge( AgenticLoop.run() -> AgentEvent , scheduler callbacks -> tool-status )
HistoryService --(reused by reference across switch)--> new AgentClient   [REQ-005 invariant]
```

**Ownership graph (drives dispose, REQ-016):**
`createAgent` creates → owns → tears down: Config, ProviderManager/OAuth infra,
config-owned AgentClient, AgenticLoop + its scheduler, ConfirmationCoordinator,
MessageBus subscriptions, MCP transports, extensions, LSP, session/recording locks.
Caller-supplied callback/factory functions → NOT disposed. Scheduler instances created by the Agent through an injected `toolSchedulerFactory` are Agent-owned products and ARE disposed.
### 1.8 Engine collaborators (existing, referenced — not redefined)
`ProviderManager`, `OAuthManager`, `Config`, `AgentClient` (`AgentClientContract`),
`AgenticLoop` (+`AgenticLoopEvent`), `HistoryService`, `CoreToolScheduler`,
`ConfirmationCoordinator`, `MessageBus`, `PolicyEngine`, `FakeProvider`.

---

## 3. State Transitions

Each transition below lists explicit pre-conditions and post-conditions.

### 3.1 Bootstrap (createAgent) — strict ordering — REQ-001

**Pre-conditions:** Valid `AgentConfig` supplied; runtime dependencies (core,
providers, auth, settings, tools, policy) available; `zod` present.

**Transition sequence:**
```
[start]
  -> config-constructed (new Config(params, agentClientFactory injected))
  -> runtime-context-built (createIsolatedRuntimeContext adopts Config under shared runtimeId/settings/messageBus)
  -> runtime-context-active (await handle.activate())
  -> initialized (await config.initialize({messageBus}); transient pre-auth client exists)
  -> authed (await config.refreshAuth(authType); NEW client created, history transferred, prev disposed)
  -> runtime-state-created (createAgentRuntimeState)
  -> client-bound (Agent binds to config.getAgentClient() — POST-auth, never transient)
  -> loop-constructed (new AgenticLoop{...})
  -> [ready]
```

**Post-conditions:**
- Agent is in `[ready]` state; `config.getAgentClient()` returns the post-auth client.
- `providerManager`'s `SettingsService` is the **same instance** as
  `config.getSettingsService()` (shared-settings identity — B6; T25 sub-assertion).
- `runtimeState.runtimeId` equals the runtime-context `runtimeId` (B4; T25).
- Runtime context is activated so `getCliRuntimeServices()` resolves THESE instances.
- SessionStart hook fires (REQ-015; T15b).
- DO NOT use bare `createHeadlessProviderManager` (B6) — it builds its own divergent
  `SettingsService` with hardcoded `runtimeId:'headless'`.

**Rule:** ProviderManager must be set on Config **before** `refreshAuth`
(`createContentGenerator` throws if providerManager present without CG factory).

### 3.2 Client rebinding (on switch/auth) — REQ-004 / REQ-005

**Pre-conditions:** Agent is in `[ready]` state; caller invokes
`setProvider`/`setModel`/`profiles.apply`/`auth.*`.

**Transition:**
```
[ready] --setProvider/setModel/profiles.apply/auth.*-->
  config.initializeContentGeneratorConfig:
    extractExistingState() -> transferHistoryToNewClient() -> new client
    (SAME HistoryService instance reused; thoughts normalized if target provider requires)
    previous client disposed
  Agent calls rebuildLoop(): dispose old loop/subscriptions -> new AgenticLoop(config.getAgentClient())
[ready']  (chat NOT reset; context preserved; next run uses new client)
```

**Post-conditions:**
- Chat is NOT reset; `existingHistoryService === newHistoryService` (REQ-005; T4d).
- Next turn uses the new provider/model/client.
- Provider-incompatible artifacts normalized via `stripThoughts` (T4f).
- Manual switch is equivalent to load-balancer failover (identical transfer path; T4e).
- `AgenticLoop` is reconstructed bound to the new client (R-CLIENT; T4c).

### 3.3 Stream lifecycle — exactly-one-`done` — REQ-003

**Pre-conditions:** Agent is in `[ready]` state; no active `run()` (one-active-run rule).

**Transition:**
```
stream() -> subscribe(loop.run + scheduler) -> yield AgentEvent* -> emit exactly one `done` -> unsubscribe
```

**Post-conditions:**
- Stream ends with **exactly one** `done` event (R-DONE; T1, T16).
- Terminal classification per verified decision table:
  - Emits `Finished` -> `done{stop, finished}`.
  - UserCancelled -> `done{aborted}` (turn-level; T9).
  - StreamIdleTimeout -> `idle-timeout` then `done` (TERMINAL).
  - MaxSessionTurns / ContextWindowWillOverflow(terminal) / LoopDetected / Error(BeforeAgent
    block) -> **no Finished emitted** -> adapter **synthesizes** `done`.
  - AgentExecutionStopped -> `done{hook-stopped, stop}` (TERMINAL).
  - AgentExecutionBlocked -> `hook-blocked` (NON-terminal; turn continues).
  - InvalidStream / Retry / 413 -> intermediate-or-terminal per runtime outcome
    (`continueOnFailedApiCall`); single `done` still synthesized at loop end.
  - Inner tool-call stream ends WITHOUT Finished -> loop continues -> NO public `done` yet
    (done decided at `AgenticLoop.run` boundary).
- All subscriptions unsubscribed after `done`.

### 3.4 Tool-loop sequencing (owned by AgenticLoop; facade rule only) — REQ-007

**Pre-conditions:** Agent in `[ready]`; no active `run()`; discovery gate passed (REQ-013).

**Transition:**
```
run(message) -> stream model -> on tool requests:
  schedule -> awaiting_approval -> approve/deny -> execute -> tool_output* -> tools_complete
  -> record completed/denied tool history -> submit single function-response continuation
  -> continue until terminal -> done
Facade: one active run() per agent; chat() awaits; stream() yields until one done.
```

**Post-conditions:**
- Completed tools are deferred until the active stream settles (T14).
- A single follow-up continuation is submitted (no overlapping turns; T21).
- Completed/denied tools recorded in history.
- Terminal `done` emitted exactly once.

### 3.5 Confirmation flow (correlationId) — REQ-006

**Pre-conditions:** A tool requires confirmation; scheduler reaches `awaiting_approval`.

**Transition:**
```
tool -> awaiting_approval (scheduler) -> ConfirmationCoordinator publishes over MessageBus
  -> Agent emits tool-confirmation{confirmationId(correlationId),toolCallId,name,details}
     AND fires onConfirmationRequest
  -> respondToConfirmation(confirmationId, decision) publishes TOOL_CONFIRMATION_RESPONSE
  -> coordinator routes by correlationId -> callId -> executes/denies
ModifyWithEditor -> new correlationId -> re-confirmation (one logical confirmation, one response; dedup)
```

**Post-conditions:**
- `tool-status` updates flow; `tool-result` produced (T2, T3).
- History records completed/denied tool (T3b).
- Function-response continuation runs (T2, T3).
- Editor modify yields new correlationId; old response ignored (T3c).

### 3.6 Compression — explicit vs automatic — REQ-011

**Pre-conditions (explicit):** Caller invokes `compress(opts?)`.
**Pre-conditions (automatic):** History exceeds threshold mid-turn.

**Transition (explicit):**
```
[ready] --compress()--> reduce history --> return CompressionResult{reducedTokenCount} --> [ready]
```

**Transition (automatic):**
```
[running] --history past threshold--> compress internally --> emit compression event --> [running]
```

**Post-conditions:**
- Explicit `compress()` returns `CompressionResult` with reduced token count (T8).
- Automatic compression emits a `compression` stream event (T8).
- The two paths are distinct, not conflated.

### 3.7 Dispose — REQ-016

**Pre-conditions:** Agent in `[ready]` or `[running]` (abort active run first).

**Transition:**
```
[ready] -> dispose() -> teardown each ownership-table row (awaited) -> [disposed]
```

**Post-conditions:**
- Each ownership-table row torn down (assertable via disposed flags; T13).
- SessionEnd hook fires (REQ-015; T15b).
- Post-dispose method calls reject clearly.
- No leaked handles/subscriptions.
- Caller-supplied resources NOT disposed; Agent-created scheduler instances ARE disposed (T19).

---

## 4. Business Rules (Named Invariants)

Each invariant maps to at least one harness row for testability.

1. **R-CTX (REQ-005):** Switch/auth/profile-apply NEVER resets chat. Same
   `HistoryService` reused by reference. Manual switch is equivalent to LB failover.
   Continuity is semantic (artifacts normalized), not byte-identical.
   - Testable via: T4d, T4e, T4f, T4c.

2. **R-CLIENT (REQ-004):** Never cache `AgentClient`; always resolve
   `config.getAgentClient()`. Bind only post-auth; never the transient pre-auth client;
   never a second long-lived client.
   - Testable via: T4, T5, T4c.

3. **R-DONE (REQ-003):** Exactly one `done` per stream. Synthesize it when no `Finished`
   exists. `done` is decided at the `AgenticLoop.run` boundary, never an inner stream end.
   - Testable via: T1, T8, T9, T16.

4. **R-TERMINAL (REQ-003):** Terminal-vs-intermediate is per the verified decision table
   (idle-timeout terminal; AgentExecutionStopped terminal; AgentExecutionBlocked
   non-terminal; invalid-stream/retry/413 per runtime).
   - Testable via: T1, T9, T16.

5. **R-CORR (REQ-006):** Responses key on `correlationId`/`confirmationId`, never tool
   name. Expose both ids; dedup to one response per logical confirmation; new
   correlationId on editor-modify.
   - Testable via: T2, T3, T3b, T3c, T2b.

6. **R-PROJECT (REQ-003/006):** Public tool/event/stats shapes are projections; no
   internal fields leak; `traceId` dropped by default (opt-in only).
   - Testable via: T16, T8b.

7. **R-NOHANDLER (REQ-006):** Public `Agent.chat()`/`stream()` follows
   `AgenticLoop` safe-denial semantics: no approval handler + ASK_USER in a
   non-interactive path becomes a denied tool-result/error that is fed back to the
   model; it does NOT throw. The raw `ConfirmationCoordinator` internals path may
   still throw if used directly via `./internals.js`; that behavior is covered as a
   power-user subpath, not the public Agent default.
   - Testable via: T3, T11, T21.

8. **R-AUTHPREC (REQ-008):** Auth precedence is exactly
   `raw --key > --key-name(flag) > auth-key-name(profile) > auth-key(inline) > keyfile >
   env`. Profile-save stores a key **reference**, not the raw secret.
   - Testable via: T18, T18b, T18c.

9. **R-OWN (REQ-016):** Dispose tears down only what `createAgent` created; injected
   resources are left alone; everything awaited.
   - Testable via: T13, T19.

10. **R-BOUNDARY (REQ-021):** Runtime concerns go to `Agent` methods; durable/config to
    app-service subpaths; pure UI to CLI-local. No orphan command.
    - Testable via: T22, T23, T24, T8b, T19, T18e.

11. **R-NODEEP (REQ-019):** Consumers import only the public root entry + documented
    subpaths.
    - Testable via: T17.

12. **R-SIDE (REQ-012):** `generate*` is detached by default — no tool loop, no history
    mutation unless explicitly opted in.
    - Testable via: T10.

---

## 5. Edge Cases

### 5.1 Bootstrap / context (REQ-001)
- **Transient pre-auth client** used by mistake — binding rule R-CLIENT prevents it
  (bind post-auth only).
- **`runtimeId` missing** — `createAgentRuntimeState` throws
  `RuntimeStateError(RUNTIME_ID_MISSING)` (B4; T25).
- **Bare `createHeadlessProviderManager`** used by mistake — rejected; builds divergent
  `SettingsService` with hardcoded `runtimeId:'headless'` (B6; T25).
- **Runtime context not activated** — switch pipeline would resolve wrong instances;
  `handle.activate()` must be called (B5).

### 5.2 Provider/model switch (REQ-004 / REQ-005)
- **Switch into Vertex** with foreign thought-signatures — strip via `stripThoughts`;
  turn still coherent (T4f).
- **Model-only switch** (`setActiveModel`) does NOT rebuild internally — facade calls
  `config.initializeContentGeneratorConfig()` explicitly (B5; T4).
- **Load-balancer failover** — same transfer path as manual switch (T4e).

### 5.3 Event stream (REQ-003)
- **Stream ends with no `Finished`** (max-turns/overflow/loop/error) — synthesize `done`
  (R-DONE; T1, T16).
- **Abort mid-stream** — exactly one `done{aborted}`, no further events (T9).
- **Inner stream ends without Finished** — loop continues; no premature `done`.

### 5.4 Tools / confirmation (REQ-006 / REQ-007)
- **Editor modify mid-confirmation** — new correlationId; old response ignored; dedup
  (T3c).
- **Empty FakeProvider fixture / exhausted turns** — provider throws "no more canned
  responses" (verified) — surfaces as `error` then `done{error}` (must not hang).
- **Multiple overlapping `run()`** — rejected by facade one-active-run rule (T21).
- **No approval handler, confirmation required on public Agent path** — safe denied
  tool-result/error via AgenticLoop; does NOT throw (R-NOHANDLER; T3, T11).

### 5.5 Auth (REQ-008)
- **Interactive OAuth without `onOAuthPrompt`** — reject clearly (never hang) (T18c).
- **Key + keyfile + key-name all configured** — documented precedence winner used
  (R-AUTHPREC; T18, T18b).

### 5.6 Compression (REQ-011)
- **Explicit vs automatic** — kept distinct: `compress()` returns `CompressionResult`;
  automatic emits `compression` event (T8).

### 5.7 MCP / discovery (REQ-013)
- **Discovery pending** — gate non-slash prompts (await or documented pending signal),
  keep `agent.mcp.status`/`listTools` callable (T12b, T20).
- **Discovery fails** — structured `AgentError{code:'mcp_discovery_failed'}` and one
  terminal `done{reason:'error'}` (T20).

### 5.8 Dispose (REQ-016)
- **Dispose called twice** — idempotent; second resolves without error (T13).
- **Scheduler created via `toolSchedulerFactory`** — Agent-owned, disposed on teardown
  (T19).

### 5.9 Side-channel generate (REQ-012)
- **`generate()` called** — returns string; no tool-loop events; no history mutation
  (R-SIDE; T10).

---

## 6. Error Scenarios

| Scenario | Expected behavior | Harness row(s) |
|---|---|---|
| Provider manager set but CG factory missing | `createContentGenerator` throws during bootstrap — `createAgent` rejects with clear error (ordering test) | T25 |
| `agentClientFactory` not injected | `requireAgentClientFactory` throws at use — prevented by R: createAgent always injects | T25 |
| Tool error during execution | `tool-result{isError:true}`; denied-tool history recorded; turn continues/ends cleanly | T2, T3 |
| BeforeAgent block (Error path, no Finished) | `error` event then synthesized `done{error}` | T16 |
| Idle timeout | `idle-timeout{error}` then `done` (terminal) | T16 |
| Loop detected | optional `loop-detected` then `done{loop-detected}` | T16 |
| Max session turns reached | synthesized `done{max-turns}` | T16 |
| Context overflow terminal | `context-warning` then synthesized `done{context-overflow}` | T16 |
| Hook stop | `done{hook-stopped, stop}` (carries contextCleared) | T16 |
| No approval handler, confirmation required on public Agent path | safe denied tool-result/error via AgenticLoop; raw coordinator internals path keeps its existing direct-coordinator error behavior (R-NOHANDLER) | T3, T11 |
| Post-dispose method call | rejects clearly | T13 |
| Discovery failure | `AgentError{code:'mcp_discovery_failed'}` and one terminal `done{reason:'error'}` | T20 |
| Abort mid-stream | exactly one `done{aborted}`, no further events | T9 |

---

## 7. Requirement Coverage (REQ-001 through REQ-021)

This section maps every formal requirement to its domain entities, transitions,
invariants, and harness rows.

### REQ-001 — createAgent bootstrap / composition (shared runtime context)
**Entities:** Agent, AgentConfig, Config, ProviderManager, SettingsService, AgenticLoop.
**Transition:** §3.1 Bootstrap.
**Invariant:** R-CLIENT; shared-settings identity (B6); runtimeId required (B4).
**Harness rows:** T25, T1.
**P00a corrections incorporated:** Uses `createIsolatedRuntimeContext` (NOT bare
`createHeadlessProviderManager`); runtime context activated via `handle.activate()`;
`createAgentRuntimeState` requires matching `runtimeId`.

### REQ-002 — AgentConfig to ConfigParameters translation + full field classification
**Entities:** AgentConfig, ConfigParameters.
**Transition:** §3.1 (step 1: config-constructed).
**Harness rows:** T18e, all (adapter underpins every test).
**Detail:** Every consumer-relevant field classified to typed ConfigParameters field |
sub-surface concern | documented settings entry. Sandbox is an agent-instance config
(T18e).

### REQ-003 — Typed AgentEvent stream + complete 21-variant mapping + exactly-one-done
**Entities:** AgentEvent, DoneReason, AgentStopInfo.
**Transition:** §3.3 Stream lifecycle.
**Invariants:** R-DONE, R-TERMINAL, R-PROJECT.
**Harness rows:** T16, T1, T8, T9.

### REQ-004 — Provider/model/param switching (wrapping providers/runtime)
**Entities:** Agent (providerControl sub-surface), ProviderManager.
**Transition:** §3.2 Client rebinding.
**Invariant:** R-CLIENT.
**Harness rows:** T4, T5, T4c.
**P00a correction:** Model-only `setActiveModel` does NOT rebuild internally; facade
calls `config.initializeContentGeneratorConfig()` explicitly.

### REQ-005 — Context preservation across switch (headline guarantee)
**Entities:** HistoryService, AgentClient.
**Transition:** §3.2 Client rebinding.
**Invariant:** R-CTX.
**Harness rows:** T4d, T4e, T4f, T4c.

### REQ-006 — Tools / scheduler / confirmation (correlationId + dual consumer paths)
**Entities:** AgentToolCall, AgentToolResult, ToolConfirmation, ToolUpdate,
CoreToolScheduler, ConfirmationCoordinator.
**Transitions:** §3.4 Tool-loop sequencing, §3.5 Confirmation flow.
**Invariants:** R-CORR, R-NOHANDLER, R-PROJECT.
**Harness rows:** T2, T2b, T3, T3b, T3c, T19.
**P00a correction:** FakeProvider is file-based JSONL; T19 external scheduler factory
contract: caller-owned factory not disposed; created schedulers ARE Agent-owned and
disposed.

### REQ-007 — High-level tool-loop via AgenticLoop wrapping
**Entities:** AgenticLoop, Agent.
**Transition:** §3.4 Tool-loop sequencing.
**Invariant:** One active run() per agent (facade rule).
**Harness rows:** T2, T14, T21.

### REQ-008 — Auth control plane (precedence, buckets, MCP OAuth, secure-store + profile-save)
**Entities:** Agent (authControl sub-surface), OAuthManager, secure store.
**Transition:** §3.2 (auth.* triggers rebind).
**Invariant:** R-AUTHPREC.
**Harness rows:** T18, T18b, T18c.

### REQ-009 — Profiles CRUD + apply (standard + load-balancer)
**Entities:** Agent (profilesControl sub-surface), profile snapshot/store.
**Transition:** §3.2 (profiles.apply triggers rebind).
**Invariant:** R-CTX (context continuity tied to REQ-005).
**Harness rows:** T4b, T18d.

### REQ-010 — History / session / recording / checkpointing
**Entities:** HistoryService, Agent (sessionControl/historyControl sub-surfaces).
**Transitions:** §3.2 (history transfer on switch), session resume/checkpoint/recording.
**Harness rows:** T6, T6b, T7, T14b, T8b.

### REQ-011 — Compression (explicit + automatic)
**Entities:** Agent (historyControl sub-surface), CompressionResult.
**Transition:** §3.6 Compression.
**Harness rows:** T8.

### REQ-012 — Side-channel generate / generateJson / generateEmbedding
**Entities:** Agent (generate methods).
**Invariant:** R-SIDE.
**Harness rows:** T10.
**Detail:** Detached/no-tools by default; not mutating chat history unless opted in.

### REQ-013 — MCP control + discovery gating
**Entities:** Agent (mcpControl sub-surface).
**Transitions:** §3.4 (discovery gate before run), edge cases §5.7.
**Harness rows:** T12b, T20.
**Detail:** Default awaits discovery readiness; `TurnOptions.mcpDiscovery:'skip'` opts
out. Durable MCP server config add/remove is an app-service subpath, not on Agent.

### REQ-014 — IDE integration
**Entities:** Agent (ideControl sub-surface).
**Harness rows:** T15.
**Detail:** `agent.ide.{current,detected,trust,status,editor open/close}` reports IDE
state and fires editor open/close callbacks.

### REQ-015 — Hooks / lifecycle
**Entities:** Agent (hooksControl sub-surface), MessageBus.
**Transitions:** SessionStart fires on create (§3.1 post-condition); SessionEnd on
dispose (§3.7 post-condition).
**Harness rows:** T15b, T15c.
**Detail:** `agent.hooks.{onHookExecution,trigger SessionStart/SessionEnd/clear}`.
T15c covers save_memory refresh.

### REQ-016 — Dispose ownership / teardown
**Entities:** Agent (dispose orchestration), ownership table.
**Transition:** §3.7 Dispose.
**Invariant:** R-OWN.
**Harness rows:** T13.

### REQ-017 — Discovery helpers (static + instance)
**Entities:** Agent (discovery methods), static listProviders/listTools.
**Harness rows:** T12, T25.
**Detail:** Static = best-effort built-in names; instance = authoritative
(extensions/MCP/skills-aware).

### REQ-018 — Non-breaking export strategy + future curated subpaths
**Entities:** package exports (`agents/package.json`).
**Invariant:** R-NODEEP (related).
**Harness rows:** T23.
**P00a correction:** The power-user subpath (`./internals.js`) does NOT exist yet in
`agents/package.json` — it must be CREATED by this feature (SET1, export phase P07).
It duplicates AgentClient/AgentExecutor/CoreToolScheduler/AgenticLoop/subagent symbols
while keeping current top-level exports until #1595 trims.

### REQ-019 — No-deep-import / package-boundary guard
**Invariant:** R-NODEEP.
**Harness rows:** T17.
**Detail:** Static check (lint rule or AST scan) asserts harness imports ONLY public
entry + documented subpaths.

### REQ-020 — Docs (docs/agent-api.md)
**Harness rows:** (doc phase — no harness row; documentation deliverable).
**Detail:** First section MUST state the API is exported from
`@vybestack/llxprt-code-agents` (NOT `-core`). Documents no-handler confirmation as
safe denial (B7), not throw.

### REQ-021 — Runtime-vs-app-service boundary + command-to-API map
**Invariant:** R-BOUNDARY.
**Harness rows:** T22, T23, T24, T8b, T19, T18e.
**Detail:** Every CLI slash-command/touchpoint classified into exactly one of: Agent
runtime method, public app-service subpath, or CLI-local. No orphan command. Non-
interactive output-format/exit-code parity is part of this boundary (T22).

---

## 8. P00a Preflight Corrections (Incorporated)

The following corrections from Phase 00a (preflight verification) are incorporated
into this domain model:

1. **File-based FakeProvider (not in-memory scripting):** Every harness fixture
   supplies JSONL files (`new FakeProvider(filePath, cwd?)`, one `FakeResponseTurn`
   per line). Variants not reachable by provider scripting (scheduler/loop-detector/
   runtime emitted) are driven by direct emission/injection at the real emission site.

2. **Telemetry stats source:** The canonical source for token/usage stats is
   `uiTelemetryService` via the LEGAL core re-export subpath
   `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js` (NOT a direct
   `@vybestack/llxprt-code-telemetry` import, which is NOT in `agents/package.json`).
   `SessionStats` projection reads from `uiTelemetryService` (tokens/usage) +
   `HistoryService` (turns). Entity §1.7 reflects this.

3. **Power-user subpath must be CREATED:** The `./internals.js` subpath does NOT exist
   yet in `agents/package.json`. REQ-018 requires creating it (SET1, export phase P07)
   while keeping current top-level exports until #1595 performs the final trim.

4. **Runtime-context switch wiring:** `createAgent` establishes ONE shared runtime
   context via `createIsolatedRuntimeContext({ runtimeId, settingsService, config,
   model, messageBus })`, then `handle.activate()` so `getCliRuntimeServices()`
   resolves THESE instances. DO NOT use bare `createHeadlessProviderManager` (B6).
   Shared-settings identity is asserted in T25.

5. **Rebuild hook:** The post-switch rebuild method is
   `config.initializeContentGeneratorConfig()` (`config.ts:329`):
   `extractExistingState()` to `transferHistoryToNewClient()` to
   `storeHistoryServiceForReuse` (SAME HistoryService by reference) to new client to
   dispose previous. `switchActiveProvider`/`applyProfileSnapshot` rebuild internally;
   model-only `setActiveModel` does NOT — facade calls
   `initializeContentGeneratorConfig()` explicitly.

6. **No-handler confirmation behavior (B7):** The public `Agent.chat()`/`stream()`
   delegates to `AgenticLoop` whose verified behavior is safe denial (not throw):
   no approval handler + ASK_USER in non-interactive mode returns a SAFE TOOL ERROR;
   approval-handler rejection becomes `ToolConfirmationOutcome.Cancel` (denial). The
   raw coordinator throw applies ONLY via the documented `./internals.js` subpath.

7. **Stryker NOT present:** `@stryker-mutator/core` is absent repo-wide; it must be
   added as a devDependency in the quality-gate setup phase (SET3, P08).

8. **Providers subpaths already exist** (`./composition.js`, `./runtime.js`,
   `./auth.js`); REQ-018 only formalizes them as supported.

---

## 9. Harness Row Cross-Reference (T1 through T25)

Every harness row maps to at least one REQ, entity, and behavior documented above.

| T-row | REQ(s) | Behavior documented in | Layer |
|---|---|---|---|
| T1 | REQ-001, REQ-003 | §3.1 Bootstrap, §3.3 Stream lifecycle, §7 REQ-001/REQ-003 | 3 |
| T2 | REQ-006, REQ-007 | §3.4 Tool-loop, §3.5 Confirmation, §7 REQ-006/REQ-007 | 4 |
| T2b | REQ-003, REQ-006 (raw a2a path) | §5.4 Edge cases, §7 REQ-006 | 4 |
| T3 | REQ-006, REQ-007 | §3.5 Confirmation flow, §7 REQ-006/REQ-007 | 4 |
| T3b | REQ-006 | §3.5 Confirmation post-conditions, §7 REQ-006 | 3/4 |
| T3c | REQ-006 (editor cbs) | §3.5 Confirmation (editor modify), §5.4, §7 REQ-006 | 4 |
| T4 | REQ-004 | §3.2 Client rebinding, §7 REQ-004 | 4 |
| T4b | REQ-009 | §7 REQ-009 | 4 |
| T4c | REQ-004, REQ-005 (rebinding) | §3.2 Client rebinding, §7 REQ-004/REQ-005 | 4 |
| T4d | REQ-005 | §3.2 Client rebinding post-conditions, §7 REQ-005 | 4 |
| T4e | REQ-005, REQ-009 (LB) | §3.2 (LB failover), §7 REQ-005/REQ-009 | 4 |
| T4f | REQ-005 (stripThoughts) | §5.2, §7 REQ-005 | 4 |
| T5 | REQ-004 | §3.2 Client rebinding, §7 REQ-004 | 3 |
| T6 | REQ-010 | §7 REQ-010 | 3 |
| T6b | REQ-010 (session) | §7 REQ-010 | 4 |
| T7 | REQ-010 | §7 REQ-010 | 3 |
| T8 | REQ-011 | §3.6 Compression, §7 REQ-011 | 3 |
| T8b | REQ-010 (stats) | §1.7 SessionStats, §7 REQ-010/REQ-021 | 3 |
| T9 | REQ-003 (aborted) | §3.3 Stream lifecycle, §7 REQ-003 | 3 |
| T10 | REQ-012 | §5.9, §7 REQ-012 | 3 |
| T11 | REQ-006 (headless approval) | §5.4, §7 REQ-006 | 3 |
| T12 | REQ-017 | §7 REQ-017 | 3 |
| T12b | REQ-013 | §5.7, §7 REQ-013 | 4 |
| T13 | REQ-016 | §3.7 Dispose, §7 REQ-016 | 5 |
| T14 | REQ-007 (todo continuation) | §3.4 Tool-loop post-conditions, §7 REQ-007 | 4 |
| T14b | REQ-010 | §7 REQ-010 | 3 |
| T15 | REQ-014 | §7 REQ-014 | 4 |
| T15b | REQ-015 | §3.1/§3.7 post-conditions (SessionStart/End), §7 REQ-015 | 4 |
| T15c | REQ-007, REQ-010 (save_memory refresh) | §7 REQ-015/REQ-007 | 4 |
| T16 | REQ-003 (characterization) | §3.3 Stream lifecycle, §7 REQ-003 | 2 |
| T17 | REQ-019 | §7 REQ-019 | 1 |
| T18 | REQ-008 | §5.5, §7 REQ-008 | 4 |
| T18b | REQ-008 | §5.5, §7 REQ-008 | 4 |
| T18c | REQ-008 | §5.5, §7 REQ-008 | 4 |
| T18d | REQ-009 | §7 REQ-009 | 4 |
| T18e | REQ-002 (sandbox), REQ-021 | §7 REQ-002/REQ-021 | 4 |
| T19 | REQ-006 (scheduler factory) | §3.7 Dispose post-conditions, §7 REQ-006 | 4 |
| T20 | REQ-013 | §5.7, §6 Error scenarios, §7 REQ-013 | 4 |
| T21 | REQ-007 | §3.4 Tool-loop, §7 REQ-007 | 3/4 |
| T22 | REQ-001, REQ-003, REQ-021 | §3.1 Bootstrap, §7 REQ-021 | 4 |
| T23 | REQ-018, REQ-021 | §7 REQ-018/REQ-021 | 1 |
| T24 | REQ-021 | §7 REQ-021 | 1 |
| T25 | REQ-001, REQ-017 | §3.1 Bootstrap post-conditions, §7 REQ-001/REQ-017 | 4 |

---

## 10. Sub-Surface Responsibility Summary

Each sub-surface of the `Agent` facade has a single responsibility and wraps shipped
machinery without re-implementing it.

| Sub-surface | Responsibility | REQ(s) | Key harness rows |
|---|---|---|---|
| providerControl | setProvider/setModel/setModelParam/getModelParams/getProvider/getModel/getProviderStatus | REQ-004 | T4, T5, T4c |
| profilesControl | list/get/create/saveCurrent/delete/apply/setDefault/getDefault | REQ-009 | T4b, T18d |
| toolsControl | list/setEnabled/onConfirmationRequest/respondToConfirmation/onToolUpdate/setEditorCallbacks | REQ-006 | T2, T3, T3b, T3c, T19 |
| authControl | login/logout/status/enableOAuth/disableOAuth/listBuckets/switchBucket/mcpLogin/keys/setBaseUrl | REQ-008 | T18, T18b, T18c |
| ideControl | current/detected/trust/status/editor open/close | REQ-014 | T15 |
| sessionControl | resume(latest/id/prefix)/checkpoint create/restore/recording swap | REQ-010 | T6b, T14b |
| hooksControl | onHookExecution/trigger SessionStart/SessionEnd/clear | REQ-015 | T15b, T15c |
| mcpControl | listServers/status/toolsByServer/auth/discoveryState/refresh | REQ-013 | T12b, T20 |
| historyControl | getHistory/setHistory/addHistory/restoreHistory/resetChat/updateSystemInstruction/addDirectoryContext/compress/getStats | REQ-010, REQ-011 | T6, T7, T8, T8b |
| generate (direct) | generate/generateJson/generateEmbedding | REQ-012 | T10 |
| discovery (static+instance) | listProviders/listTools | REQ-017 | T12, T25 |
| dispose | teardown all owned resources | REQ-016 | T13 |
