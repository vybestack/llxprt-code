# Feature Specification: Core Public Agent API (`createAgent` / `Agent`)

Plan ID: PLAN-20260617-COREAPI
Source design: `project-plans/issue1594/overview.md` (authoritative)
GitHub issue: #1594 "Design and implement core public API"
Depends on (merged to `main`): #2033 / PR #2039 (headless provider composition), #2034 / PR #2050 (AgenticLoop)

---

## Purpose

`packages/core/src/index.ts` is a **664-line barrel** (verified) that dumps internals.
There is no curated public API. To build a working agent today, a consumer must
hand-reproduce a multi-step bootstrap and reach into engine internals to switch
providers/models, approve tools, restore history, compress, and generate side-channel
completions.

This feature ships a **curated, typed, stable public Agent API** —
`createAgent(config) → Agent` plus the `Agent` control plane and the `AgentEvent`
stream — published from `@vybestack/llxprt-code-agents`. It is **not** new
orchestration: it is a **composition over shipped primitives**
(`createIsolatedRuntimeContext`/providers-runtime composition in providers, `new Config(...)` + lifecycle in core,
`AgentClient` + `AgenticLoop` in agents) plus two genuinely new pieces:

1. the `AgentConfig → ConfigParameters` translation + bootstrap composition, and
2. a stable public **event stream** mapped from `AgenticLoopEvent` /
   `ServerGeminiStreamEvent` (the top correctness risk — 21 internal variants),

and a set of **control-plane methods** that wrap shipped runtime machinery so the CLI
rewrite (#1595) can be a thin UI with **no deep imports**.

This is explicitly designed as **option (B): a full control plane**, not a minimal
send-and-stream façade, because the CLI does live provider/model switching, tool
confirmation, OAuth, history restore/checkpoint, compression, side-channel generation,
todo continuation, IDE, and a rich event stream. A minimal façade would force #1595 to
bypass the API and deep-import internals, defeating the purpose. A plain script still
gets the trivial subset for free (`createAgent` + `stream`).

---

## Architectural Decisions

- **Package home — `packages/agents`.** `createAgent` composes a `ProviderManager`
  (providers), a `Config` (core), and `AgentClient` + `AgenticLoop` (agents). Only
  `agents` depends on all three (verified `agents/package.json` lists core, providers,
  auth, settings, tools, policy). `core` depends on none of them, so it cannot host
  `createAgent` without a `core → agents` cycle. **Public entry is
  `@vybestack/llxprt-code-agents`.** (Resolves overview §10.1 and issue wording.)
- **Pattern — Facade over shipped primitives.** `Agent` is a stable facade that
  delegates to `AgenticLoop` (turns/tools), the providers runtime-switch pipeline
  (provider/model/params/profile), and `Config` (settings/history/compression). It
  does **not** re-expose those objects raw, so internals can change without breaking
  clients.
- **Event-driven public stream.** `agent.stream()` maps the `AgenticLoopEvent` union
  (and, where it surfaces, `ServerGeminiStreamEvent`) into a stable `AgentEvent` union
  with an **exactly-one-`done`** invariant and **synthesized `done`** for terminal
  paths that emit no internal `Finished` (max-turns, context-overflow, loop-detected,
  error/BeforeAgent-block).
- **Schema-first (Zod).** `AgentConfig`, `AgentEvent`, and public tool/stats shapes
  are defined as Zod schemas; TypeScript types are derived from them. Strict
  TypeScript: no `any`, no type assertions.
- **Client rebinding (never cache the client).** The live `AgentClient` is replaced by
  `Config.initializeContentGeneratorConfig` on `refreshAuth`/provider switch (verified
  `config.ts`). The Agent **never caches** a client reference; it resolves
  `config.getAgentClient()` on each delegated call and re-attaches per-turn
  subscriptions to the new client.
- **Context preservation across switch is a first-class contract.** Provider/model/
  profile switch — manual or load-balancer failover — **continues the same
  conversation** by reusing the same `HistoryService` instance via the verified
  `extractExistingState → transferHistoryToNewClient` path. Manual switch and LB
  failover are the **same** mechanism. Provider-incompatible artifacts (e.g. another
  provider's thought-signatures) are normalized via the existing `stripThoughts`
  behavior; continuity is **semantic**, not byte-identical.
- **Config-owned, post-auth client only.** `createAgent` injects its own
  `agentClientFactory` (agents owns `AgentClient`), runs the full bootstrap+auth
  sequence, and binds to `config.getAgentClient()` **after** auth — never to the
  transient pre-auth client and never to a second long-lived client.
- **Resource ownership.** `createAgent` owns every resource it creates;
  `Agent.dispose()` tears them all down (driven by a resource-ownership/teardown
  table). Caller-supplied resources are not disposed.
- **Runtime vs app-service boundary (§4.7).** `Agent` is the runtime control plane
  (anything affecting the live conversation/turn). Durable/config concerns (settings
  mutation, MCP server config add/remove, profile CRUD decoupled from the live
  snapshot, session/recording management, extensions, memory-file edits, diagnostics)
  are public **app-service subpaths**, not crammed onto `Agent`. Pure UI is CLI-local.
- **Export strategy (non-breaking in #1594).** The root `@vybestack/llxprt-code-agents`
  entry keeps all current low-level top-level exports during #1594 and adds the new
  interactive `createAgent`/`Agent` surface + handler/types/enums additively. A new
  documented `./internals.js` subpath is added as the future/power-user home for
  low-level exports; final root curation/removal happens only in #1595 after CLI/a2a
  consumers migrate.

### Resolved "planner-decides" items (overview §10 + inline)

| Open item | Decision | Rationale |
|---|---|---|
| Entry wording (§10.1) | `@vybestack/llxprt-code-agents` | Only package depending on all three; matches how cli/a2a already import; `-core` would be a cycle |
| Control-plane scope (§10.3) | **Full control plane in-scope (option B)** | So #1595 is a pure UI rewrite with zero deep imports |
| Sub-surfaces public? (§10.5) | `tools`, `mcp`, `auth`, `ide`, `session`, `hooks`, `profiles` are **public methods on `Agent`** | Each is a verified CLI touchpoint; subpath-only would force deep imports |
| Auth control plane shape (§10.4) | `agent.auth.*` (login/logout/status/buckets/key/keyfile/keyName/mcpLogin) **public** | Covers `/auth`, `/key`, `/keyfile`, LB buckets, MCP OAuth |
| No-handler confirmation (§4.6) | **Match the real `AgenticLoop` (safe denial)** — the high-level `Agent.chat()`/`stream()` delegates to `AgenticLoop`, whose verified behavior is: no `approvalHandler` + ASK_USER in non-interactive mode → return a SAFE TOOL ERROR (denial) to the model, NOT throw; approval-handler rejection → `ToolConfirmationOutcome.Cancel` (denial). The `confirmation-coordinator.setupConfirmationPrompt` throw applies ONLY on the RAW coordinator path (`!isInteractive()` reaching the coordinator directly), which is the documented power-user `internals` path — not the default public surface. (B7) | Behavior-preserving for the public path: `Agent` delegates to `AgenticLoop`, so it MUST match the loop's safe-denial semantics. Documenting a throw on the high-level path would contradict the real loop (verified `AgenticLoop.ts:29-32, :237-247`). |
| Idle-timeout classification (§4.4) | **Terminal** (matches current `turn.ts` behavior: emit then `return`) | Behavior-preserving; any change would need an explicit documented decision + test |
| `AgentExecutionStopped` vs `Blocked` | Stopped → terminal `done: hook-stopped`; Blocked → non-terminal `hook-blocked` | Verified: stopped `return`s, blocked `continue`s |
| `core/index.ts` trim sequencing (§10.7) | **Trim as the tail step of #1595**, after consumers migrate | Current barrel is the real API, not a shim; trimming before migration breaks consumers |
| Stats source authoritative pick | `uiTelemetryService` is canonical for token/usage; `HistoryService` for turn/history counts; mapped into normalized public `SessionStats`. **Legal import path (N1):** `agents` consumes telemetry via the core re-export subpath `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js` (NOT a direct `@vybestack/llxprt-code-telemetry` import — that package is NOT a dependency of `agents/package.json`). If a direct telemetry dependency is ever required, it MUST be added to `agents/package.json` first; the stats impl phase pins the exact import. | Single normalized public shape; consumers never deep-import either; the import path is a real, dependency-legal core subpath |
| Command discovery/loading boundary | (a) **loading stays CLI-local**; every command *action* maps to a public Agent method or app-service subpath | Avoids a public loader API and avoids duplicating loader logic in #1595 |
| Sandbox mode | **agent-instance config** at `createAgent`; `Agent` exposes status only; change = recreate/app-service | Avoids unsafe live mutation of the tool executor |
| a2a tool-loop future | Documented in consumer matrix: **(b) a2a keeps owning its loop**, the raw unmerged stream is a building block (not full parity); adopting the high-level loop is a follow-up, not required here | a2a `Task` owns scheduling/continuation today; flipping it is out of scope for #1594 |

---

## Project Structure

New files land in `packages/agents`. Illustrative layout (final names are a stub-phase
detail, but kept consistent through the plan):

```
packages/agents/src/
  api/                                  # NEW — the public Agent API
    createAgent.ts                      # createAgent() bootstrap composition
    agent.ts                            # Agent facade implementation
    agentConfig.schema.ts              # Zod schema for AgentConfig (+ derived type)
    agentConfig.adapter.ts             # AgentConfig -> ConfigParameters translation
    agentEvent.schema.ts               # Zod schema for AgentEvent union (+ derived type)
    agentEvent.adapter.ts              # AgenticLoopEvent/ServerGeminiStreamEvent -> AgentEvent
    toolShapes.schema.ts               # public AgentToolCall/AgentToolResult/ToolConfirmation/ToolUpdate
    stats.schema.ts                    # public SessionStats normalization
    control/                            # sub-surfaces
      providerControl.ts               # setProvider/setModel/params (wraps providers/runtime)
      profilesControl.ts               # apply + durable store (wraps profileApplication/profileSnapshot)
      toolsControl.ts                  # list/setEnabled/confirmation/updates/editor cbs
      mcpControl.ts                    # runtime MCP status/discovery
      authControl.ts                   # login/logout/status/buckets/keys/keyfile/mcpLogin
      ideControl.ts                    # IDE status/trust/editor open-close
      sessionControl.ts               # resume/checkpoint/recording
      historyControl.ts               # history/system-instruction/directory/compress/stats
      hooksControl.ts                  # hook execution observation + session lifecycle
    discovery.ts                        # static listProviders/listTools (+ instance variants on Agent)
    dispose.ts                          # teardown orchestration (ownership table)
    types.ts                            # handler types (ApprovalHandler, OAuthPromptHandler, EditorCallbacks, etc.)
    index.ts                            # public Agent API sub-barrel, re-exported additively from package root
  api/__tests__/                        # the CLI-touchpoint + characterization harness
    harness/fixtures/                   # FakeProvider JSONL fixtures, fake MCP/hook/IDE
    static-boundary.test.ts            # T17, T23, T24 (layer 1)
    event-characterization.test.ts     # T16 + AgenticLoopEvent mapping (layer 2)
    core-behavior.test.ts              # T1,T5-T11,T14b... (layer 3)
    cli-parity.test.ts                 # T2-T4f,T12b,T15,T18*,T19,T20,T22,T25 (layer 4)
    resource-leak.test.ts              # T13 (layer 5)
docs/
  agent-api.md                           # NEW — public API documentation
packages/agents/package.json            # MODIFY — keep non-breaking root export + add power-user subpath export
```

> **No `ServiceV2`/parallel files; no breaking export trim in #1594.** The new Agent
> API is added to the existing `packages/agents/src/index.ts` root exports while all
> existing low-level root exports remain available. `./internals.js` is added as a
> documented future/power-user subpath that duplicates access during #1594; the final
> root curation/removal is a #1595 tail step after consumers migrate.

---

## Technical Environment

- **Type**: Library (TypeScript) within an npm monorepo (`packages/*`).
- **Runtime**: Node.js (current LTS used by the repo); ESM with `.js` import suffixes.
- **Language**: TypeScript strict mode (no `any`, no type assertions, explicit return
  types).
- **Testing**: Vitest. Property-based tests via `fast-check`. Mutation via Stryker.
- **Validation**: Zod (schema-first; types derived).
- **Key deps (verified present)**: `@vybestack/llxprt-code-core`,
  `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code-policy`,
  `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code-settings`,
  `@vybestack/llxprt-code-auth` (all already in `agents/package.json`).

---

## Integration Points (MANDATORY)

This is **NOT an isolated feature.** Its entire reason to exist is to be consumed by
the CLI (#1595) and a2a-server, replacing their deep imports.

### Existing code that will USE this feature

- **`packages/cli/` (the #1595 consumer — primary acceptance gate).** After #1595, the
  CLI imports **only** `@vybestack/llxprt-code-agents` (+ documented subpaths) to:
  - run turns (`useGeminiStream.*` / `useAgenticLoop.ts` → `agent.stream()`/`chat()`),
  - switch provider/model/params (`config/*`, `/provider`, `/model` →
    `agent.setProvider/setModel/setModelParam`),
  - confirm tools (`useReactToolScheduler`, confirmation UI →
    `agent.tools.onConfirmationRequest`/`respondToConfirmation`),
  - OAuth/keys (`/auth`, `/key`, `/keyfile` → `agent.auth.*`),
  - history restore/checkpoint (`/restore`, `/chat` → `agent.session.*`/`setHistory`),
  - compression (`/compress` → `agent.compress`),
  - side-channel generation (`autoPromptGenerator.ts`, `usePromptCompletion.ts` →
    `agent.generate*`),
  - todo continuation, IDE, hooks, stats (→ `agent.stream`, `agent.ide`, `agent.hooks`,
    `agent.onStats`).
- **`packages/a2a-server/` (`Task` in `task.ts`).** Already bootstraps headlessly and
  consumes the raw `ToolCallConfirmation` stream variant. It continues to own its loop
  (consumer-matrix decision (b)); #1594 provides the **raw unmerged stream** building
  block + the headless `createAgent` path it can adopt incrementally. No regression to
  a2a is permitted.
- **Scripts / 3rd-party.** `createAgent` + `stream` works without the CLI (a2a-server
  already proves the bootstrap runs headlessly).

### Old code / deep imports that get REPLACED (in #1595)

These are the deep-import sites the public API eliminates (the §9 T17/T23 boundary
guard enforces it):

- CLI deep imports of `@vybestack/llxprt-code-providers/runtime` (switch pipeline:
  `switchActiveProvider`, `setActiveModel`, `updateActiveProviderApiKey`,
  `updateActiveProviderBaseUrl`, `applyProfileWithGuards`) → replaced by
  `agent.setProvider/setModel/profiles.apply/auth.*`.
- CLI deep imports of `@vybestack/llxprt-code-providers/auth` /
  `createProviderKeyStorage` → replaced by `agent.auth.keys.*`.
- CLI deep imports of core internals for history/compression/stats
  (`getChat()`/`HistoryService`/`uiTelemetryService`) → replaced by `agent.getHistory`,
  `agent.compress`, `agent.getStats`/`onStats`.
- CLI deep imports of `MessageBus` + hook triggers → replaced by `agent.hooks.*` and
  the merged `agent.stream()`.
- CLI deep imports of `CoreToolScheduler`/confirmation coordinator → replaced by
  `agent.tools.*` and the high-level loop.

> **Note:** #1594 **adds** the API and the harness proving sufficiency. The actual
> CLI migration AND the `core/index.ts` trim are **#1595** (sequencing decision
> above). #1594 does not modify the CLI; it ships the surface + the executable
> contract (harness) that #1595 consumes.

### How users access the feature

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';
const agent = await createAgent({ provider: 'openai', model: 'gpt-4o' });
for await (const ev of agent.stream('hello')) { /* AgentEvent */ }
await agent.dispose();
```

Power users: documented subpath (e.g. `@vybestack/llxprt-code-agents/internals`) plus
the already-established `@vybestack/llxprt-code-providers/{composition,runtime,auth}.js`
and `@vybestack/llxprt-code-core/runtime/...`.

### Migration / sequencing

1. **#1594 (this plan):** add public API + curated/subpath exports in `agents`; add the
   CLI-touchpoint harness (acceptance gate); write `docs/agent-api.md`. Do **not**
   modify the CLI or trim `core/index.ts`.
2. **#1595:** migrate CLI to the public API, then trim `core/index.ts` as the tail
   step. a2a-server adopts `createAgent`/high-level loop opportunistically.

---

## Formal Requirements

Each REQ has a stable ID tagged throughout (`@requirement:REQ-XXX`). Harness rows
T1–T25 are mapped to REQs at the end of this section.

### REQ-001 — `createAgent` bootstrap / composition (shared runtime context)
`createAgent(config: AgentConfig): Promise<Agent>` MUST run the verified composition
**in order**: (1) build `ConfigParameters` from `AgentConfig` and `new Config(...)`
**with an injected `agentClientFactory`**; (2) establish a **shared runtime context**
via `createIsolatedRuntimeContext({ runtimeId, config, settingsService, model,
messageBus })` (providers/runtime.js) — using only executable options from
`IsolatedRuntimeContextOptions` plus the planned `messageBus` seam, and adopting OUR
`Config`/`SettingsService` so the resulting `ProviderManager` and `Config` observe
the **same `SettingsService`** under **one `runtimeId`** (B6); (3) call
`handle.activate()` so the runtime registry resolves THESE instances for the switch
pipeline (B5); (4) apply initial provider/auth/baseUrl through the verified runtime
mutators/profile-auth path after activation and before `refreshAuth` rather than as
unsupported `createIsolatedRuntimeContext` options; (5) `await config.initialize({messageBus})`; (6) `await config.refreshAuth(authType)`;
(7) `createAgentRuntimeState({ runtimeId, provider, model, baseUrl?, modelParams?,
sessionId? })` — `runtimeId` is **REQUIRED** and MUST equal the runtime-context
`runtimeId`; `createAgentRuntimeState` throws `RuntimeStateError(RUNTIME_ID_MISSING)`
without it (verified `AgentRuntimeState.ts`) (B4); (8) bind to
`config.getAgentClient()` (post-auth, never transient); (9) construct
`AgenticLoop({agentClient, config, messageBus, approvalHandler?})`; (10) return the
`Agent` facade. Ordering is a behavioral test target (runtime context active before
`refreshAuth`; `createContentGenerator` throws if a `providerManager` is present
without the content-generator factory).

> **DO NOT use bare `createHeadlessProviderManager` (B6).** Verified
> (`packages/providers/src/composition/headlessFactory.ts`): it builds its OWN
> `new SettingsService()` with a hardcoded `runtimeId: 'headless'` and does not
> expose that context, which would make `Config` and `ProviderManager` diverge.
> `createIsolatedRuntimeContext` (`runtimeContextFactory.ts:449`, re-exported from
> `@vybestack/llxprt-code-providers/runtime.js`) builds a shared
> `SettingsService` + `Config` + `ProviderManager` + `OAuthManager` under one
> `runtimeId` and is the required composition entry.

- GIVEN a valid `AgentConfig`; WHEN `createAgent` resolves; THEN a working `Agent` is
  returned bound to the post-auth `config.getAgentClient()`.
- GIVEN the built agent; WHEN inspecting its runtime wiring; THEN
  `providerManager`'s `SettingsService` is the **same instance** as
  `config.getSettingsService()` (shared-settings identity/behavior — B6 behavioral
  assertion; covered by T25 sub-assertion), and `runtimeState.runtimeId` equals the
  runtime-context `runtimeId` (B4).

### REQ-002 — `AgentConfig → ConfigParameters` translation + full field classification
Provide a deterministic adapter mapping every consumer-relevant `AgentConfig` field to
a `ConfigParameters` field, a sub-surface, or a documented `settings` escape-hatch
entry. The complete `ConfigParameters → (typed field | sub-surface | settings)`
classification table is a design deliverable; any CLI-needed field MUST be typed, not
left in `settings`.
- GIVEN an `AgentConfig` with typed fields; WHEN translated; THEN the resulting
  `ConfigParameters` carries equivalent values and unknown long-tail goes through
  `settings`.

### REQ-003 — Typed `AgentEvent` stream + complete 21-variant mapping + exactly-one-`done`
`agent.stream()` MUST yield a stable `AgentEvent` union mapped from `AgenticLoopEvent`
(and `ServerGeminiStreamEvent` where surfaced), covering **all 21** `GeminiEventType`
members with the exact source payload fields (per §4.4 table), classifying each as
terminal/intermediate per real runtime behavior, and ending every stream with
**exactly one** `done`. The adapter MUST **synthesize** `done` for terminal paths that
emit no `Finished` (max-turns, context-overflow, loop-detected, error/BeforeAgent
block). `AgentExecutionStopped` → terminal `done: hook-stopped`;
`AgentExecutionBlocked` → non-terminal `hook-blocked`. `idle-timeout` is terminal.
Public tool shapes (`AgentToolCall`/`AgentToolResult`) MUST be projected (no raw
internal fields). The `AgenticLoopEvent → AgentEvent` mapping is also a deliverable.
- GIVEN scripted internal events at their real emission sites; WHEN streamed; THEN each
  maps to its documented public projection and the stream terminates with one `done`.

### REQ-004 — Provider/model/param switching (wrapping providers/runtime)
`agent.setProvider/setModel/setModelParam/clearModelParam/getModelParams/getProvider/
getModel/getProviderStatus/getCurrentSequenceModel/getUserTier` MUST wrap the shipped
runtime pipeline (`switchActiveProvider`, `setActiveModel`,
`updateActiveProviderApiKey/BaseUrl`, `setActiveToolFormatOverride`) including
content-generator rebuild and ephemeral preservation. They are not trivial setters.
- GIVEN a live agent; WHEN `setProvider('openai','gpt-x')`; THEN `getProvider()`
  reflects it, the content-generator is rebuilt, and the next turn uses the new
  provider.

### REQ-005 — Context preservation across switch (headline guarantee)
Switching provider/model/profile (manual OR load-balancer failover) MUST continue the
same conversation: chat is NOT reset; the **same `HistoryService` instance** is reused
(`existingHistoryService === newHistoryService`); the next provider call includes prior
messages. Provider-incompatible artifacts (e.g. thought-signatures into Vertex) are
normalized via `stripThoughts`. Manual switch ≡ LB failover (same transfer path).
- GIVEN N messages on provider A; WHEN switching to B and sending a follow-up; THEN the
  follow-up sees the prior N messages and the same `HistoryService` is reused.

### REQ-006 — Tools / scheduler / confirmation (correlationId + dual consumer paths)
`agent.tools.{list,setEnabled,onConfirmationRequest,respondToConfirmation,onToolUpdate,
setEditorCallbacks}` MUST preserve the scheduler/`MessageBus` model. `ToolConfirmation`
carries BOTH `confirmationId`/`correlationId` (what a response keys on) and
`toolCallId` (UI grouping); `respondToConfirmation` keys on the correlation id.
`agent.stream()` MUST merge `AgentClient` events with scheduler updates with documented
ordering (a `tool-call` precedes its `tool-status`/`tool-result`). The raw unmerged
stream is a documented option (serves the a2a path). `ToolUpdate` is a normalized
projection (no raw scheduler union, no CLI UI state).

**No-handler / handler-rejection confirmation behavior (B7 — match `AgenticLoop`).**
The public `chat()`/`stream()` delegate to `AgenticLoop`, so they MUST match its
verified semantics: (a) **no `approvalHandler` + ASK_USER in non-interactive mode →
a SAFE TOOL DENIAL** (the tool is NOT executed; a denied `tool-result` is returned to
the model and the loop proceeds) — it does **NOT** throw (verified
`AgenticLoop.ts:29-32`); (b) **approval-handler rejection →
`ToolConfirmationOutcome.Cancel`** (safe denial, verified `AgenticLoop.ts:237-247`).
The `confirmation-coordinator.setupConfirmationPrompt` throw
(`!isInteractive()`, `confirmation-coordinator.ts:320-325`) applies ONLY to the RAW
coordinator path exposed via the documented power-user `internals` subpath, NOT to the
default `Agent` surface. T3/T11/T21 assert loop safe-denial for the high-level Agent;
the coordinator throw is asserted only on the explicit raw path.
- GIVEN a scripted tool call; WHEN approved via `respondToConfirmation(id, approve)`;
  THEN `tool-status` updates flow, a `tool-result` is produced, history records the
  completed tool, and the function-response continuation runs.
- GIVEN a tool requiring confirmation and **no** `onApproval` handler in
  non-interactive mode; WHEN the turn runs; THEN the tool is NOT executed, a denied
  `tool-result` is returned, and the turn proceeds/ends cleanly (NO throw on the
  public path).

**External scheduler factory contract (T19).** `AgentConfig` includes an optional
`toolSchedulerFactory?: AgentSchedulerFactory`. The caller-owned factory function is
not disposed. Scheduler instances created by the Agent through that factory are
Agent-owned resources: `Agent.dispose()` MUST dispose every created scheduler instance
and remove associated MessageBus/subscription wiring. The factory receives the shared
per-agent dependencies (`config`, `messageBus`, `approvalHandler`/editor callbacks,
and scheduler session metadata) and returns a scheduler implementing the public
`AgentSchedulerHandle` contract (`dispose(): Promise<void>|void` plus the scheduler
methods the existing `AgenticLoop`/Config factory requires). P03/P05 define the public
types; P15 passes the factory through bootstrap; P23/T19 proves routing; P24 proves
created scheduler teardown.

### REQ-007 — High-level tool-loop via `AgenticLoop` wrapping
`agent.chat()`/`stream()` MUST delegate to `AgenticLoop.run(...)` and map
`AgenticLoopEvent` → `AgentEvent`; it MUST NOT re-implement scheduling/continuation.
Facade-level rule: one active `run()` per agent; `chat()` awaits completion; `stream()`
yields until one `done`. `onApproval` wires to the loop's `approvalHandler`; editor
callbacks via `displayCallbacks`. A raw `sendMessageStream` power-user mode is
documented (not default).
- GIVEN a multi-tool turn; WHEN run; THEN completed tools are deferred until the active
  stream settles, a single follow-up continuation is submitted, and there are no
  overlapping turns.

### REQ-008 — Auth control plane (precedence, buckets, MCP OAuth, secure-store + profile-save)
`agent.auth.{login,logout,status,enableOAuth,disableOAuth,listBuckets,switchBucket,
mcpLogin}` and `agent.auth.keys.{list,save,use,delete,setRaw,setKeyFile}` +
`agent.auth.setBaseUrl` MUST wrap the existing auth machinery (secure store, runtime
auth update, ephemeral profile fields) and preserve the **verified** precedence:
`raw --key > --key-name(flag) > auth-key-name(profile) > auth-key(inline) > keyfile >
env`. Saving a profile after `/key` stores a **reference** (`auth-key-name`), not the
raw secret. Interactive OAuth requires `onOAuthPrompt`; with none, it rejects clearly
(never hangs).
- GIVEN key + keyfile + key-name configured; WHEN resolved; THEN the documented
  precedence winner is used and `agent.auth.status()`/`getProviderStatus()` reflect it.

### REQ-009 — Profiles CRUD + apply (standard + load-balancer)
`agent.profiles.{list,get,create,saveCurrent,delete,apply,setDefault,getDefault}` MUST
wrap the runtime apply pipeline (`profileApplication.ts`) and the durable store
(`profileSnapshot.ts`). Applying standard AND load-balancer profiles preserves full
precedence (auth-key-name/keyfile/base-url/model-params/preserved ephemerals) and
context continuity (ties to REQ-005).
- GIVEN a saved profile; WHEN `apply(name)`; THEN provider/model/params/auth match the
  profile and chat is not reset.

### REQ-010 — History / session / recording / checkpointing
`agent.getHistory()` (async), `setHistory({stripThoughts?})`, `addHistory`,
`restoreHistory`, `resetChat`, `updateSystemInstruction`, `addDirectoryContext`, and
`agent.session.{resume(latest|id|prefix),checkpoint create/restore,recording swap}`
MUST map onto `AgentClientContract` and the session/recording machinery without deep
imports.
- GIVEN saved history items; WHEN `setHistory(items)` then `getHistory()`; THEN it
  round-trips and a follow-up turn sees prior context.

### REQ-011 — Compression (explicit + automatic)
`agent.compress(opts?)` MUST trigger explicit compression returning a
`CompressionResult` with reduced token count; automatic compression (history past
threshold mid-turn) MUST surface a `compression` stream event. The two paths are
distinct, not conflated.
- GIVEN an over-threshold history; WHEN a turn runs; THEN a `compression` event is
  emitted; separately, `compress()` reduces token count.

### REQ-012 — Side-channel generate / generateJson / generateEmbedding
`agent.generate(input,opts?)`, `agent.generateJson(contents,schema,opts?)`,
`agent.generateEmbedding(texts)` MUST expose the side-channel paths
(`generateDirectMessage`/`generateContent`/`generateJson`/`generateEmbedding`):
detached/no-tools by default, not mutating chat history unless opted in.
- GIVEN `generate('summarize')`; WHEN called; THEN it returns a string without emitting
  tool-loop events or mutating chat history.

### REQ-013 — MCP control + discovery gating
`agent.mcp.{listServers,status,toolsByServer,auth,discoveryState,refresh}` MUST expose
runtime MCP state. `chat()`/`stream()` MUST honor the MCP discovery gate: default
behavior is to await discovery readiness before sending the prompt; callers may opt
out with `TurnOptions.mcpDiscovery:'skip'`; discovery failure returns/yields
`AgentError{code:'mcp_discovery_failed'}` and exactly one `done{reason:'error'}`.
Runtime/app-service methods remain callable while discovery is pending. Durable MCP
server config add/remove is an app-service subpath, not on `Agent`.
- GIVEN discovery pending; WHEN `stream()` a non-slash prompt with default options; THEN
  the turn awaits readiness and `agent.mcp.status()`/`listTools()` remain callable.
- GIVEN discovery fails; WHEN the default gated turn cannot proceed; THEN a structured
  MCP-discovery error and one terminal `done:error` are produced.

### REQ-014 — IDE integration
`agent.ide.{current,detected,trust,status,editor open/close}` MUST report IDE state and
fire editor open/close callbacks (or be explicitly documented as deferred with sign-off).
- GIVEN an IDE-aware environment; WHEN queried; THEN current/detected IDE + trust are
  reported through the public surface.

### REQ-015 — Hooks / lifecycle
`agent.hooks.{onHookExecution,trigger SessionStart/SessionEnd/clear}` MUST let the UI
observe `HOOK_EXECUTION_REQUEST/RESPONSE` on the `MessageBus` and trigger
session-lifecycle hooks (SessionStart on create, SessionEnd on dispose).
- GIVEN a scripted hook; WHEN it fires; THEN `onHookExecution` observes it; SessionStart
  fires on create and SessionEnd on `dispose()`.

### REQ-016 — Dispose ownership / teardown
`agent.dispose()` MUST tear down every resource `createAgent` created, driven by a
resource-ownership/teardown table (AgentClient, MCP transports, extensions, LSP,
scheduler, ConfirmationCoordinator, bus subscriptions, session locks). Existing dispose
methods are wired; genuinely-missing cleanup (LSP, extensions, hook subs, session
locks) is net-new. No leaked handles/subscriptions.
- GIVEN a fully-built agent; WHEN `dispose()`; THEN each table row is torn down
  (assertable via disposed flags), not a generic no-open-handles check.

### REQ-017 — Discovery helpers (static + instance)
Static `listProviders()`/`listTools()` (best-effort, built-in names; provider list
re-projected from providers' static accessor) AND instance `agent.listProviders()`/
`agent.listTools()` (authoritative: extensions/MCP/skills-aware) MUST be provided.
- GIVEN an initialized agent with MCP/extensions; WHEN `agent.listTools()`; THEN the
  list includes contributed entries, not just built-ins.

### REQ-018 — Non-breaking export strategy + future curated subpaths + core/index trim sequencing
During #1594, the root `@vybestack/llxprt-code-agents` entry MUST remain non-breaking:
it keeps existing low-level top-level exports and additively exports the new public Agent
API. A documented `./internals.js` subpath is added as the future/power-user path for
low-level symbols, while final root curation/removal is sequenced into #1595 after
consumers migrate. Provider/runtime/auth subpaths are formalized as supported.
- GIVEN the root entry; WHEN imported during #1594; THEN both legacy low-level symbols
  and the new public Agent API are present.
- GIVEN `./internals.js`; WHEN imported; THEN low-level symbols are also reachable there
  so #1595 can migrate consumers before final top-level curation.

### REQ-019 — No-deep-import / package-boundary guard
A static check (lint rule or AST scan) MUST assert that the harness (and, as #1595's
gate, the CLI) imports ONLY the public entry + documented subpaths — no `…/dist/…` or
deep `src` internal imports.
- GIVEN the harness sources; WHEN scanned; THEN there are zero deep/internal imports.

### REQ-020 — Docs (`docs/agent-api.md`)
`docs/agent-api.md` MUST document `createAgent`, `AgentConfig`, the full `Agent` control
plane, `AgentEvent` with the mapping table, the consumer matrix, the runtime-vs-app
boundary, and the power-user subpaths. Its **first section MUST state explicitly that
the API is exported from `@vybestack/llxprt-code-agents`** (NOT `-core`) (B11). It MUST
document the no-handler confirmation behavior as **safe denial** (B7), not throw, on
the public path.
- GIVEN `docs/agent-api.md`; WHEN read; THEN the entry package is `@vybestack/llxprt-code-agents`
  and every public surface (createAgent/AgentConfig/Agent/AgentEvent/subpaths) is documented.

### REQ-021 — Runtime-vs-app-service boundary + command→API map
Every CLI slash-command/touchpoint MUST be classified into exactly one of: Agent
runtime method, public app-service subpath, or CLI-local — with a complete
command→(method|subpath|CLI-local) map and no orphans. Durable app-service subpaths
MUST be importable (static/contract test).
- GIVEN the command list; WHEN mapped; THEN every command resolves to a public path or
  documented CLI-local with no gap.

### Harness row → REQ map

| T-row | REQ(s) | Layer |
|---|---|---|
| T1 | REQ-001, REQ-003 | 3 |
| T2 | REQ-006, REQ-007 | 4 |
| T2b | REQ-003, REQ-006 (raw a2a path) | 4 |
| T3 | REQ-006, REQ-007 | 4 |
| T3b | REQ-006 | 3/4 |
| T3c | REQ-006 (editor cbs) | 4 |
| T4 | REQ-004 | 4 |
| T4b | REQ-009 | 4 |
| T4c | REQ-004, REQ-005 (rebinding) | 4 |
| T4d | REQ-005 | 4 |
| T4e | REQ-005, REQ-009 (LB) | 4 |
| T4f | REQ-005 (stripThoughts) | 4 |
| T5 | REQ-004 | 3 |
| T6 | REQ-010 | 3 |
| T6b | REQ-010 (session) | 4 |
| T7 | REQ-010 | 3 |
| T8 | REQ-011 | 3 |
| T8b | REQ-010 (stats) | 3 |
| T9 | REQ-003 (aborted) | 3 |
| T10 | REQ-012 | 3 |
| T11 | REQ-006 (headless approval) | 3 |
| T12 | REQ-017 | 3 |
| T12b | REQ-013 | 4 |
| T13 | REQ-016 | 5 |
| T14 | REQ-007 (todo continuation) | 4 |
| T14b | REQ-010 | 3 |
| T15 | REQ-014 | 4 |
| T15b | REQ-015 | 4 |
| T15c | REQ-007, REQ-010 (save_memory refresh) | 4 |
| T16 | REQ-003 (characterization) | 2 |
| T17 | REQ-019 | 1 |
| T18 | REQ-008 | 4 |
| T18b | REQ-008 | 4 |
| T18c | REQ-008 | 4 |
| T18d | REQ-009 | 4 |
| T18e | REQ-002 (sandbox), REQ-021 | 4 |
| T19 | REQ-006 (scheduler factory) | 4 |
| T20 | REQ-013 | 4 |
| T21 | REQ-007 | 3/4 |
| T22 | REQ-001, REQ-003 (bootstrap+events drained headlessly), REQ-021 (non-interactive output-format/exit-code parity is part of the runtime-vs-app-service/command→API map) | 4 |
| T23 | REQ-021 | 1 |
| T24 | REQ-021 | 1 |
| T25 | REQ-001, REQ-017 | 4 |

---

## Data Schemas (Zod-first)

> These are **design intent** for the stub/TDD phases. Final field set for `AgentConfig`
> is fixed by the REQ-002 classification table (preflight + types phase). Types are
> derived from schemas (`z.infer`).

### AgentConfig (illustrative; full typed set fixed in REQ-002 table)

```typescript
const ProviderAuthSchema = z.object({
  apiKey: z.string().optional(),
  apiKeyFile: z.string().optional(),
  keyName: z.string().optional(),
  baseUrl: z.string().optional(),
  oauth: z.boolean().optional(),
});

const AgentAuthSchema = ProviderAuthSchema.extend({
  perProvider: z.record(ProviderAuthSchema).optional(),
  profile: z.string().optional(),
});

const AgentConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  modelParams: z.record(z.unknown()).optional(),
  auth: AgentAuthSchema.optional(),
  tools: z.array(z.string()).optional(),
  excludeTools: z.array(z.string()).optional(),
  mcpServers: z.record(z.unknown()).optional(),       // McpServerConfig (core type)
  approvalMode: z.nativeEnum(ApprovalMode).optional(), // re-exported enum
  systemPrompt: z.string().optional(),
  workingDir: z.string().optional(),
  sessionId: z.string().optional(),
  includeDirectories: z.array(z.string()).optional(),
  // ... full typed set per REQ-002 classification table (compression, checkpointing,
  // recording, policy, extensions, ide, hooks, sandbox, telemetry, proxy,
  // maxSessionTurns, streamIdleTimeoutMs, etc.)
  settings: z.record(z.unknown()).optional(),         // UNSTABLE escape hatch
  // host callbacks are functions -> represented as z.custom / z.function at schema edge
});
type AgentConfig = z.infer<typeof AgentConfigSchema> & {
  onApproval?: ApprovalHandler;
  onOAuthPrompt?: OAuthPromptHandler;
  editorCallbacks?: EditorCallbacks;
  toolSchedulerFactory?: AgentSchedulerFactory;
};
```

### AgentEvent (the public union — full 21-variant projection)

```typescript
const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), thought: ThoughtSummarySchema }),
  z.object({ type: z.literal('tool-call'), call: AgentToolCallSchema }),
  z.object({ type: z.literal('tool-result'), result: AgentToolResultSchema }),
  z.object({ type: z.literal('tool-confirmation'), confirmation: ToolConfirmationSchema }),
  z.object({ type: z.literal('tool-status'), update: ToolUpdateSchema }),
  z.object({ type: z.literal('usage'), usage: UsageMetadataSchema }),
  z.object({ type: z.literal('model-info'), info: ModelInfoSchema }),
  z.object({ type: z.literal('notice'), message: z.string() }),
  z.object({ type: z.literal('compression'), info: ChatCompressionInfoSchema.nullable() }),
  z.object({ type: z.literal('context-warning'),
            estimatedRequestTokenCount: z.number(), remainingTokenCount: z.number() }),
  z.object({ type: z.literal('retry') }),
  z.object({ type: z.literal('citation'), citation: z.string() }),
  z.object({ type: z.literal('loop-detected') }),
  z.object({ type: z.literal('idle-timeout'), error: StructuredErrorSchema }),
  z.object({ type: z.literal('invalid-stream') }),
  z.object({ type: z.literal('hook-blocked'), info: AgentStopInfoSchema }),
  z.object({ type: z.literal('error'), error: StructuredErrorSchema }),
  z.object({ type: z.literal('done'),
            reason: DoneReasonSchema,
            finished: ServerFinishedValueSchema.optional(),
            stop: AgentStopInfoSchema.optional() }),
]);

const DoneReasonSchema = z.enum([
  'stop', 'aborted', 'max-turns', 'context-overflow',
  'loop-detected', 'error', 'hook-stopped',
]);

const AgentStopInfoSchema = z.object({
  reason: z.string(),
  systemMessage: z.string().optional(),
  contextCleared: z.boolean().optional(),
});

const AgentErrorSchema = z.object({
  code: z.enum(['mcp_discovery_failed', 'provider_error', 'tool_error', 'unknown']),
  message: z.string(),
  cause: z.unknown().optional(),
});
```

### Public tool & stats shapes (projected — no internal leakage)

```typescript
const AgentToolCallSchema = z.object({
  id: z.string(), name: z.string(), args: z.record(z.unknown()),
});
const AgentToolResultSchema = z.object({
  id: z.string(), name: z.string(),
  output: z.string(), isError: z.boolean(),
});
const ToolConfirmationSchema = z.object({
  confirmationId: z.string(),   // correlationId — what respondToConfirmation keys on
  toolCallId: z.string(),       // UI grouping
  name: z.string(),
  details: z.unknown(),         // projected confirmation details
});
const ToolUpdateSchema = z.object({
  id: z.string(), name: z.string(),
  status: z.enum(['validating','scheduled','awaiting-approval','executing','success','error','cancelled']),
  output: z.string().optional(),
  agentId: z.string().optional(),
});
const SessionStatsSchema = z.object({
  promptTokens: z.number(), candidateTokens: z.number(),
  totalTokens: z.number(), cachedTokens: z.number(),
  contextWindowSize: z.number(), contextWindowUsed: z.number(),
  turnCount: z.number(),
});
```

### The 21-variant mapping table (the top correctness deliverable)

| # | GeminiEventType | Source payload (verified) | Public AgentEvent | Terminal? |
|---|---|---|---|---|
| 1 | Content | `value: string` | `text{text}` | no |
| 2 | Thought | `value: ThoughtSummary` | `thinking{thought}` | no |
| 3 | ToolCallRequest | `value: ToolCallRequestInfo` | `tool-call{call}` (projected) | no |
| 4 | ToolCallResponse | `value: ToolCallResponseInfo` | `tool-result{result}` (projected) | no |
| 5 | ToolCallConfirmation | `value:{request,details}` | `tool-confirmation{confirmation}` + callback | no |
| 6 | UserCancelled | (none) | `done{reason:'aborted'}` | **yes** |
| 7 | StreamIdleTimeout | `value:GeminiErrorEventValue` | `idle-timeout{error}` then `done` | **yes** |
| 8 | Error | `value.error` | `error{error}` then `done{reason:'error'}` (synth if BeforeAgent) | terminal-or-intermediate per runtime |
| 9 | ChatCompressed | `value:ChatCompressionInfo\|null` | `compression{info}` | no |
| 10 | UsageMetadata | `value` | `usage{usage}` | no |
| 11 | MaxSessionTurns | — | **synthesized** `done{reason:'max-turns'}` (no Finished) | **yes** |
| 12 | Finished | `value:{reason,usageMetadata?,outcome?}` | `done{reason:'stop',finished}` | **yes** |
| 13 | LoopDetected | (none) | optional `loop-detected` then `done{reason:'loop-detected'}` | **yes** |
| 14 | Citation | `value: string` | `citation{citation}` | no |
| 15 | Retry | (none) | `retry` | no |
| 16 | SystemNotice | `value: string` | `notice{message}` | no |
| 17 | InvalidStream | (none) | `invalid-stream` (terminal-or-continue per runtime) | per runtime |
| 18 | ContextWindowWillOverflow | `value:{estimatedRequestTokenCount,remainingTokenCount}` | `context-warning{...}` then **synth** `done{reason:'context-overflow'}` when terminal | terminal when it stops the turn |
| 19 | ModelInfo | `value:{model}` | `model-info{info}` | no |
| 20 | AgentExecutionStopped | stop payload (incl. contextCleared) | `done{reason:'hook-stopped',stop}` | **yes** |
| 21 | AgentExecutionBlocked | block payload | `hook-blocked{info}` (turn continues) | **no** |

Plus the **`AgenticLoopEvent → AgentEvent`** rows:

| AgenticLoopEvent.kind | Maps to |
|---|---|
| `stream` (ServerGeminiStreamEvent) | per the 21-variant table above |
| `tool_update` (ToolCall[]) | `tool-status` updates (projected) |
| `tool_output` ({callId,chunk}) | `tool-status{output}` increment |
| `tools_complete` (CompletedToolCall[]) | `tool-result` per completed tool |
| `awaiting_approval` (ToolCall[]) | `tool-confirmation` + `onConfirmationRequest` |
| loop `run()` completes | the single synthesized/forwarded `done` |

---

## Example Data

### FakeProvider fixture (JSONL — verified: `new FakeProvider(filePath, cwd)`, one `FakeResponseTurn` per line with `chunks`)

`fixtures/t1-hello.jsonl`:
```jsonl
{"chunks":[{"speaker":"ai","blocks":[{"type":"text","text":"Hello"}]},{"speaker":"ai","blocks":[{"type":"text","text":" world"}]}]}
```

### Expected T1 event sequence (assert values, not "method called")

```
[ {type:'text',text:'Hello'},
  {type:'text',text:' world'},
  {type:'done',reason:'stop', finished:{reason:'STOP'}} ]
```

### T4d context-preservation assertion (values)

```
before = N messages on provider 'anthropic'
after  setProvider('openai','gpt-4o')
assert agent.getProvider() === 'openai'
assert (await agent.getHistory()).length >= N
assert sameHistoryServiceInstance === true   // existing === new
followUp references earlier turn -> next provider call payload contains prior N messages
```

---

## Constraints

- **No mock theater.** Tests use real `Agent` + real `FakeProvider` + real
  `CoreToolScheduler`/`MessageBus`. Mock only infra (HTTP/FS) if unavoidable.
- **No reverse testing.** Tests NEVER assert `NotYetImplemented`/stub behavior.
- **No `any`, no type assertions.** Strict TS; Zod schema-first; types derived.
- **Immutable data.** No mutation of shared structures.
- **No `core → agents` cycle.** `createAgent` lives in `agents`.
- **Behavior-preserving wrappers.** Switch/auth/compression/loop wrap shipped code; do
  not re-implement.
- **No isolated feature.** The harness proves CLI/a2a consumability; #1595 migrates.
- **Pseudocode is binding.** Implementation phases cite pseudocode line numbers;
  deepthinker verifies compliance.

## Performance Requirements

- `createAgent` bootstrap is dominated by `Config.initialize`/`refreshAuth` (existing
  costs); the adapter/facade add no measurable overhead beyond a single object wrap.
- Event mapping is O(1) per event; the merge introduces no unbounded buffering
  (documented back-pressure rule).
- `dispose()` completes deterministically (all awaited; no fire-and-forget).
