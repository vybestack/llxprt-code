# Issue 1594 — Core Public API Design

> **Scope:** Design overview for the **public API only** (issue #1594). The
> refactor it sits on top of — god-object decomposition (#1570–1583), package
> extraction (#1584–1593), the **provider/profile composition relocation (#2033,
> PR #2039, merged)**, and the **agentic-loop consolidation (#2034, PR #2050,
> merged)** — is **already done and merged**. This document does **not** re-plan any
> of that. The CLI rewrite is #1595; Bun is #1596. The implementation plan will be
> produced separately via `dev-docs/PLAN-TEMPLATE.md`.
>
> **Status (updated for current `main`):** the two findings that earlier blocked
> this design are now **resolved in code**: (1) provider-by-name is constructible
> headlessly via `createHeadlessProviderManager` in `@vybestack/llxprt-code-providers`
> (#2033), and (2) the multi-turn tool loop is now an engine primitive,
> `AgenticLoop` in `@vybestack/llxprt-code-agents` (#2034). `createAgent` is now a
> **composition over existing, shipped engine primitives** — not new orchestration
> and not a relocation. See §1 and §3 for the grounded current state.

---

## 1. The actual problem (and what is already solved)

`packages/core/src/index.ts` is a **664-line barrel** (verified). There is no API
surface — just a dump of internals. To get a working agent, a consumer must
reproduce a multi-step bootstrap by hand, and must reach into engine internals to
do provider/model switching, tool approval, history, and compression.

**What changed since the first draft of this design (now on `main`):** the two
hard blockers are gone, both replaced by shipped engine primitives.

1. **Provider-by-name now works headlessly (#2033 / PR #2039).** Provider and
   profile composition was relocated out of `packages/cli` into
   `@vybestack/llxprt-code-providers`. There is now a UI-free factory:

   ```ts
   // packages/providers/src/composition/headlessFactory.ts (verified)
   const { manager, oauthManager } =
     createHeadlessProviderManager({ provider: 'openai', model, apiKey, baseUrl });
   ```

   It builds a fully wired `ProviderManager` (alias providers + OAuth infra) from a
   bare `SettingsService`, imports **nothing** from the CLI, and a behavioral test
   (`headless-provider.test.ts`) routes a real completion through a concrete
   `OpenAIProvider`. `createProviderManager` also calls
   `config.setProviderManager(manager)` internally, so the `Config ↔ ProviderManager`
   wiring is now owned by `providers`, not the CLI.

2. **The multi-turn tool loop is now an engine primitive (#2034 / PR #2050).** The
   send→stream→policy→approve→execute→feed-back→continue loop was lifted out of the
   CLI into `@vybestack/llxprt-code-agents`:

   ```ts
   // packages/agents/src/core/agenticLoop/AgenticLoop.ts (verified, ~608 lines)
   const loop = new AgenticLoop({ agentClient, config, messageBus,
                                  approvalHandler?, interactiveMode?, displayCallbacks? });
   for await (const ev of loop.run(message, signal)) { /* AgenticLoopEvent */ }
   ```

   It owns tool scheduling, the confirmation bus, function-response continuation,
   cancellation/teardown, and prompt-id correlation. The CLI is now a **single
   consumer** of it via `useAgenticLoop.ts`; its old hand-rolled continuation
   (`toolCompletionHandler` re-submit logic) is gone.

So the bootstrap already works outside the CLI, and the loop already exists as a
reusable primitive. **`createAgent` is therefore a *composition* of shipped
primitives**, not new orchestration and not a relocation:

> **Note (superseded by the executable plan):** the sketch below is the original
> design-time composition. The executable plan pins the real bootstrap to
> `createIsolatedRuntimeContext({ runtimeId, config, settingsService, model,
> messageBus })` followed by runtime mutators for provider/auth/baseUrl after
> activation. See `specification.md`, `plan/00a-preflight-verification.md`,
> `analysis/pseudocode/createAgent.md`, and `plan/15-impl-createagent-core.md`
> for the authoritative bootstrap sequence.

```text
createAgent(AgentConfig)                         [packages/agents]
  ├─ createHeadlessProviderManager(...)          [providers]  → ProviderManager (+ sets it on Config)
  ├─ new Config(configParams)                    [core]       → configParams from AgentConfig
  ├─ await config.initialize({ messageBus })     [core]       → tools, MCP, extensions, scheduler
  ├─ await config.refreshAuth(authType)          [core]       → auth as data
  ├─ createAgentRuntimeState({ provider, model })[core]       → runtime state
  ├─ AgentClient (config-owned via factory)      [agents]     → single-turn primitive
  └─ new AgenticLoop({ agentClient, config, bus })[agents]    → multi-turn loop
        → Agent facade wraps the loop + control-plane methods (§4)
```

The remaining work in #1594 is real but bounded: **(1)** the `AgentConfig →
ConfigParameters` translation + the bootstrap composition above; **(2)** a stable,
typed public **event stream** mapped from `AgenticLoopEvent` / `ServerGeminiStreamEvent`
(§4.4 — the top correctness risk); and **(3)** the control-plane methods (§4.3) that
let #1595 drive provider/model/tool/history/compression without deep imports.

### Verified facts that constrain the design

- `AgentClient` / `ChatSession` / `AgenticLoop` live in `packages/agents`;
  `agents → core` and now **`agents → providers`** (verified in
  `agents/package.json`). `core` depends on **neither** `agents` nor the CLI.
- `AgenticLoop` is already exported from the `agents` top-level index (verified) —
  `createAgent` can wrap it without new plumbing in `agents`.
- Both runtime consumers (`cli`, `a2a-server`) import `AgentClient` from
  `@vybestack/llxprt-code-agents` and `Config` from `@vybestack/llxprt-code-core`.
- The single-turn primitive is `AgentClient.sendMessageStream(...)` →
  `ServerGeminiStreamEvent`; the multi-turn primitive is `AgenticLoop.run(...)` →
  `AgenticLoopEvent` (a flat union wrapping stream + tool-execution events).
- `Config.initialize({ messageBus })` is async; `Config` already carries factory
  hooks (`agentClientFactory`, `toolSchedulerFactory`, `taskToolRegistration`) and
  the concrete agent factories are registered via the providers-side inversion seam
  `registerAgentRuntimeFactories` (so no `providers → agents` cycle).
- The policy/approval primitives are shipped and re-used, not re-invented:
  `PolicyDecision` (`packages/policy`), `ApprovalMode` (`packages/core`),
  `ToolConfirmationOutcome` (`packages/tools`); `AgenticLoop` already takes an
  `approvalHandler` invoked only on `ASK_USER`.

---

## 2. Goals & non-goals

### The sizing decision (read this first)

There are two very different targets, and they imply very different API sizes:

- **(A) A minimal headless factory** — "make an agent, talk to it, get a stream."
  Small interface. Good enough for scripts/servers/prototype UIs.
- **(B) A control plane the CLI can sit on as a *thin* UI** — which is exactly
  what sibling issue **#1595** requires ("CLI imports **only** the public core
  API, no deep imports").

A review of the actual CLI wiring (`cli.tsx`, `useGeminiStream.*`,
`autoPromptGenerator.ts`, `config/*`) shows the CLI does far more than send-and-
stream: **live mid-session provider/model switching**, model params, tool-call
**confirmation UI**, OAuth login/logout/status, slash-command runtime ops,
**history restore/checkpointing**, **compression**, side-channel generation
(detached client / auto-prompt), todo continuation, and a **much richer event
stream**. If the public API is only (A), then #1595 is forced to bypass it and
import internals anyway — defeating the purpose.

**Therefore the API must be (B): a full control plane, not a minimal façade.**
The minimal `chat/stream/dispose` surface in early drafts was too small. The rest
of this doc designs for (B), while keeping (A) as the trivial subset (a script
just calls `createAgent` + `stream`).

**Goals (this issue):**
- `createAgent(config) → Agent` factory wrapping the existing bootstrap.
- An `Agent` **control plane** sufficient for the CLI to be a thin UI (§4.3):
  chat/stream, **provider/model/param switching**, **tool/MCP management**,
  **approval response**, history/session + compression, and side-channel
  generation.
- One declarative `AgentConfig` with typed common fields + an escape hatch.
- A **stable, typed, complete** public event stream (decoupled from
  `ServerGeminiStreamEvent`), covering every internal variant or explicitly
  collapsing it (§4.4).
- Provider-by-name; tools-by-name; discovery helpers.
- Documented; usable from a plain script (a2a-server already proves the bootstrap
  works without the CLI).

**Non-goals (already done or other issues):**
- Decomposing god objects / extracting packages — **done** (#1570–1593).
- **Finishing the `Config` decomposition is OUT OF SCOPE here (but flagged).**
  #1573 cut `config.ts` from 2,738 → ~893 lines, but it is still god-objecty: it
  owns provider-manager wiring, the content-generator config rebuild, the
  history-transfer / client-rebind lifecycle (`extractExistingState` →
  `transferHistoryToNewClient`), tools, MCP, telemetry, and many other concerns.
  #1594 **wraps** this behavior behind the Agent facade; it must NOT grow `Config`
  further, and ideally isolates its dependence to a small surface (`getAgentClient`,
  `getHistoryService`, `refreshAuth`, `getProviderManager`, `initialize`, `dispose`).
  A genuine follow-up to extract the client-lifecycle / provider-binding concern out
  of `Config` (e.g. a `ConversationSession` / `ClientLifecycle` owner) should be
  filed as its own issue under the #1568 umbrella — recommended, not required for
  #1594.
- Relocating provider/profile composition — **done** (#2033/PR #2039); it lives in
  `@vybestack/llxprt-code-providers` and is constructible headlessly.
- Building the multi-turn tool loop — **done** (#2034/PR #2050); it is the
  `AgenticLoop` primitive in `@vybestack/llxprt-code-agents`. #1594 wraps it; it
  does **not** re-implement scheduling/continuation.
- CLI rewrite itself (#1595) and Bun (#1596). 1594 **designs and ships the API
  the CLI will consume**; #1595 does the consuming.

---

## 3. Where `createAgent` lives — and the boundaries

### 3.1 The package that owns `createAgent`

`createAgent` must compose three things: a `ProviderManager` (from `providers`), a
`Config` (from `core`), and an `AgentClient` + `AgenticLoop` (from `agents`). Only
**one** package depends on all three: **`packages/agents`** (verified — its
`package.json` now lists `core`, `providers`, `auth`, `settings`, `tools`,
`policy`). `core` depends on none of them, so it cannot host `createAgent` without a
cycle. **Therefore `createAgent` lives in `packages/agents` and the public entry is
`@vybestack/llxprt-code-agents`.**

This is no longer entangled with a provider-extraction decision (that shipped in
#2033). The only residual wording issue is cosmetic: the issue text says
`import { createAgent } from '@vybestack/llxprt-code-core'`. That exact specifier
would require `core → agents`, a cycle, and is rejected. The recommended ruling
(needs a one-line maintainer OK, recorded in §7):

- **Publish `createAgent`/`Agent` from `@vybestack/llxprt-code-agents`** — matches
  where the runtime already lives and how `cli`/`a2a-server` already import. The
  issue/#1595 wording is amended to "the public Agent API" rather than "core".
- A thin facade package (e.g. `@vybestack/llxprt-code`) re-exporting from `agents`
  remains available later if a single batteries-included specifier is wanted; it is
  **not** required for #1594 and adds a package for no functional gain now.

### 3.2 The layering this API formalizes

```text
            ┌─────────────────────────── clients ───────────────────────────┐
            │   cli (TUI, #1595)      a2a-server      scripts / 3rd-party     │
            └───────────────▲───────────────▲────────────────▲──────────────┘
                            │  imports ONLY  │   the public   │
                            │                │   Agent API    │
        ┌───────────────────┴────────────────┴────────────────┴─────────────┐
        │  @vybestack/llxprt-code-agents   ← createAgent / Agent (this issue)│
        │  AgenticLoop · AgentClient · scheduler · subagents                 │
        └───────▲───────────────────▲────────────────────────▲──────────────┘
                │                    │                        │
   providers ───┘        core ──────┘            tools/auth/settings/policy
   (ProviderManager,     (Config, runtime,       (registries, OAuth, settings,
    OAuth, headless      contracts, event         PolicyEngine, ToolConfirmation)
    composition)         types, history)
```

**Boundary rules the API enforces:**
1. **Clients depend only on `@vybestack/llxprt-code-agents`** for the agent. No
   client reaches into `core`/`providers`/`tools` internals to run a turn, switch a
   provider, approve a tool, or compress history. (#1595's acceptance gate.)
2. **`core` stays UI- and client-agnostic** and remains the home of shared
   **types/contracts** (`Config`, `AgentClientContract`, the event types in
   `core/turn.ts`, runtime contracts). Its barrel is trimmed to those (§6).
3. **`providers` owns provider/profile/auth composition**; `agents` consumes it via
   `createHeadlessProviderManager` and the `registerAgentRuntimeFactories` seam.
4. **The Agent facade is the only public orchestration surface.** It delegates to
   `AgenticLoop` (turns/tools), `ProviderManager` (provider/model), `Config`
   (settings/history/compression) and **does not** re-expose those objects raw —
   so internals can change without breaking clients.
5. **Power users** who genuinely need an internal get it from a **documented
   sub-path** (`@vybestack/llxprt-code-providers`, `…-core/...`), never from the
   default agent entry (§6).

`core/index.ts` is trimmed to shared types/contracts; the high-level API is **not**
added to `core` (§6).

---

## 4. The API

### 4.1 `createAgent`

```ts
export async function createAgent(config: AgentConfig): Promise<Agent>;
```

Async because provider composition, `Config.initialize()`, and auth are async.
Internally it runs the composition shown in §1 over **shipped** primitives:

> **Note (superseded by the executable plan):** the numbered sketch below is the
> original design-time draft. The authoritative bootstrap uses
> `createIsolatedRuntimeContext({ runtimeId, config, settingsService, model,
> messageBus })` and applies provider/auth/baseUrl through runtime mutators after
> `await handle.activate()` and before `refreshAuth`. See `specification.md`,
> `plan/00a-preflight-verification.md`, `analysis/pseudocode/createAgent.md`, and
> `plan/15-impl-createagent-core.md`.

1. `createHeadlessProviderManager({ provider, model, apiKey, baseUrl })` →
   `ProviderManager` (providers; also sets it on `Config` — but see ownership note).
2. Build `ConfigParameters` from `AgentConfig` → `new Config(...)`.
3. `await config.initialize({ messageBus })` — tools, MCP, extensions, scheduler.
4. `await config.refreshAuth(authType)` — auth resolved from `AgentConfig.auth`.
5. `createAgentRuntimeState({ provider, model, ... })` → `AgentClient`
   (config-owned, via the registered `agentClientFactory`).
6. `new AgenticLoop({ agentClient, config, messageBus, approvalHandler?, ... })`.

The two genuinely new pieces are the **`AgentConfig → ConfigParameters` translation**
and the **`Agent` facade** over the loop + control plane. Everything else is calling
existing, tested code. The composition ordering (provider manager must exist and be
set on `Config` before `refreshAuth`, per `headlessFactory` + `contentGenerator`
constraints) is itself a behavioral test target.

> **Note on client ownership (verified).** `Config.initialize()` creates a
> config-owned `AgentClient` via the injected `agentClientFactory`. a2a-server's
> `Task` constructs a *second* `AgentClient` directly. `AgenticLoop` takes an
> `agentClient` in its options. `createAgent` must standardize on **one** owned
> client (prefer the config-owned one, passed into the loop) and document it, so
> disposal (§4.3) and history ownership are unambiguous. The planner resolves reuse
> vs. fresh — but not both.

> **Note on provider-manager ownership (verified).** `createProviderManager` /
> `createHeadlessProviderManager` call `config.setProviderManager(...)`. So the
> provider manager and `Config` are mutually wired during step 1–2; the planner
> pins the exact order (manager built from the same `SettingsService`/runtime
> context the `Config` uses) and asserts it, since `createContentGenerator` throws
> if a `providerManager` is present without the content-generator factory.

### 4.2 `AgentConfig`

Typed common fields (the things every consumer sets) + an explicit unstable
escape hatch for the long tail.

```ts
export interface AgentConfig {
  provider: string;          // 'anthropic' | 'openai' | 'gemini' | alias
  model: string;
  modelParams?: Record<string, unknown>;  // temperature, topP, etc.

  // Auth is provider-scoped with precedence (verified: profileApplication.ts /
  // providerMutations.ts apply auth-key / auth-keyfile / auth-key-name / base-url
  // per provider, and load-balancer profiles carry multi-bucket auth). A single
  // flat block only covers the default provider; the shape must allow per-provider
  // overrides and a profile/load-balancer reference. The planner finalizes the
  // exact shape, but it MUST express: provider, the precedence chain, base-url
  // override, and a profile reference.
  // VERIFIED precedence (authKeyName.test.ts) — it is NOT a simple key>keyfile>name:
  //   raw --key  >  --key-name (CLI flag)  >  auth-key-name (profile field)
  //   >  auth-key (inline profile key)  >  keyfile  >  env.
  // i.e. a *named* key beats an *inline* key, and a raw CLI key beats everything.
  // The planner reproduces the exact tested precedence, not a guessed ordering.
  auth?: {
    apiKey?: string;
    apiKeyFile?: string;
    keyName?: string;        // secure-store reference
    baseUrl?: string;
    oauth?: boolean;         // interactive; requires onOAuthPrompt (see §4.6)
    perProvider?: Record<string, ProviderAuth>;  // provider-scoped overrides
    profile?: string;        // apply a saved (standard or load-balancer) profile at startup
  };

  tools?: string[];          // names resolved against the built-in registry
  excludeTools?: string[];   // ConfigParameters.excludeTools parity
  mcpServers?: Record<string, McpServerConfig>;

  approvalMode?: ApprovalMode;
  systemPrompt?: string;
  workingDir?: string;
  sessionId?: string;

  // Typed first-class fields the CLI/servers need. These MUST be enumerated at
  // design time (not deferred wholesale to `settings`) so #1595 is a pure UI
  // rewrite. The set, derived from ConfigParameters / a2a-server / CLI wiring:
  includeDirectories?: string[];
  fileFiltering?: FileFilteringOptions;
  telemetry?: TelemetrySettings;
  proxy?: string;
  maxSessionTurns?: number;
  compression?: CompressionConfig;
  checkpointing?: CheckpointingConfig;
  recording?: SessionRecordingConfig;  // session record/resume
  policy?: PolicyConfig;               // trust / policy engine
  extensions?: ExtensionConfig;        // extensions/skills/subagents enablement
  ide?: IdeConfig;
  hooks?: HooksConfig;                 // lifecycle / JIT hooks

  // Further ConfigParameters parity the planner must place (typed vs settings).
  // The COMPLETE classification is a design deliverable (see note below); this is
  // an illustrative, non-exhaustive subset verified against configTypes.ts:
  sandbox?: SandboxConfig;
  folderTrust?: boolean;
  interactive?: boolean;
  embeddingModel?: string;
  debugMode?: boolean;
  memory?: MemoryConfig;               // hierarchical memory / context files
  continueOnFailedApiCall?: boolean;
  streamIdleTimeoutMs?: number;
  toolOutputLimits?: ToolOutputLimits;
  allowedTools?: string[];             // (vs coreTools/excludeTools)
  coreTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  allowedMcpServers?: string[];
  blockedMcpServers?: string[];
  mcpEnabled?: boolean;
  extensionsEnabled?: boolean;
  outputFormat?: OutputFormat;         // outputSettings parity
  shell?: ShellConfig;                 // shell / PTY settings
  contextLimit?: number;
  compressionThreshold?: number;
  projectHooks?: HooksConfig;
  disabledHooks?: string[];
  skills?: SkillsConfig;               // skills toggles
  useWriteTodos?: boolean;

  // Escape hatch for the genuine long tail only. Documented as UNSTABLE; not part
  // of the semver surface. Maps onto SettingsService / ConfigParameters. The
  // planner must justify anything left here rather than typed above.
  settings?: Record<string, unknown>;

  // Host callbacks so the API is headless-capable (§4.6).
  onApproval?: ApprovalHandler;        // auto-answer tool confirmations (headless)
  onOAuthPrompt?: OAuthPromptHandler;  // interactive OAuth
  editorCallbacks?: EditorCallbacks;   // diff / open-in-editor for tools
}
```

> **Design-level requirement (not a planner TODO):** the exact typed-field set is
> finalized as part of #1594 by walking `ConfigParameters`, the a2a-server
> bootstrap, and the CLI's config wiring and assigning each consumer-relevant
> field to either a typed field above, a sub-surface (§4.3), or an explicit
> documented `settings` entry. "Leave it to the planner" is not acceptable for
> fields the CLI demonstrably needs.

> `AbortSignal`/`promptId` are **per-call**, not on `AgentConfig` (a long-lived
> agent makes many cancellable calls). They move to the call options in §4.3.

### 4.3 `Agent` — the control plane

This is the surface #1595 consumes. It must be big enough that the CLI never has
to import internals. Grouped by concern:

```ts
export interface Agent {
  // ── Conversation ──
  // AgentResult is the buffered outcome of a full turn — the contract the
  // NON-INTERACTIVE CLI sits on. It MUST carry enough to drive runNonInteractive:
  //   { text: string; toolCalls: AgentToolCall[]; finishReason: DoneReason;
  //     error?: AgentError; usage?: SessionStats } — so #1595 can map
  //   --output-format (text|json), stdout/stderr separation, and process exit code
  //   without deep imports. (chat() = stream() drained into AgentResult.)
  chat(input: string | AgentInput, opts?: TurnOptions): Promise<AgentResult>;
  stream(input: string | AgentInput, opts?: TurnOptions): AsyncIterable<AgentEvent>;

  // ── Provider / model control (NOT deferred — CLI switches mid-session) ──
  getProvider(): string;
  setProvider(provider: string, model?: string): Promise<void>;
  getProviderStatus(): ProviderStatus;          // auth state, base url, etc.
  getModel(): string;
  setModel(model: string): Promise<void>;
  getCurrentSequenceModel(): string | null;     // model bound to the in-flight sequence
  getModelParams(): Record<string, unknown>;
  setModelParam(key: string, value: unknown): void;
  clearModelParam(key: string): void;
  getUserTier(): UserTierId | undefined;        // for tier-gated UI affordances

  // ── Profiles / load balancers (CLI /profile + load-balancer parity) ──
  readonly profiles: AgentProfileControl;       // list/get/create/saveCurrent/delete/apply/default
                                                 // (standard + load-balancer; durable profile store + live apply)

  // ── Tools / scheduler (sub-surface; see §4.6 for the full shape) ──
  readonly tools: AgentToolControl;   // list/setEnabled/confirmation/updates/editor cbs

  // ── MCP (instance-scoped; discovery can block) ──
  readonly mcp: AgentMcpControl;      // RUNTIME ONLY: listServers/status/toolsByServer/auth/discoveryState/refresh
                                      //   (durable MCP server config add/remove is an app-service subpath, NOT here — see §4.7)

  // ── Auth (instance-scoped; see §4.6) ──
  readonly auth: AgentAuthControl;    // login/logout/status/buckets/mcpLogin

  // ── IDE integration ──
  readonly ide: AgentIdeControl;      // current/detected IDE, trust, status, editor open/close

  // ── History / session / recording / checkpointing ──
  getHistory(): Promise<readonly AgentMessage[]>;       // contract is async (getHistory(): Promise<Content[]>)
  setHistory(history: readonly AgentMessage[], opts?: { stripThoughts?: boolean }): Promise<void>;
  addHistory(message: AgentMessage): Promise<void>;     // direct append (CLI uses addHistory today)
  restoreHistory(items: readonly AgentMessage[]): Promise<void>; // IContent-level restore
  resetChat(): Promise<void>;
  updateSystemInstruction(): Promise<void>;             // re-derive after env/memory/tool change
  addDirectoryContext(): Promise<void>;                 // /directory add → refresh dir context
  compress(opts?: { promptId?: string }): Promise<CompressionResult>;
  getStats(): SessionStats;                              // snapshot: token/usage/context-window
  onStats(cb: (s: SessionStats) => void): Unsubscribe;  // live token-metrics (CLI tracks continuously)
  // SessionStats is a NORMALIZED public shape (prompt/candidate/total/cached token
  // counts, context-window size + used, turn count). Authoritative source is the
  // existing token accounting (uiTelemetryService / HistoryService); the planner
  // names which is canonical and maps it — consumers MUST NOT deep-import either.
  readonly session: AgentSessionControl;                // resume(latest|id|prefix), checkpoint create/restore, recording swap

  // ── Side-channel generation (auto-prompt, summaries, completion; no tool loop) ──
  // Detached / no-history / no-tools by default (mirrors the CLI's detached client
  // + generateDirectMessage/generateContent). GenerateOptions covers explicit
  // model/config/signal overrides and whether history is read/written.
  generate(input: string | AgentInput, opts?: GenerateOptions): Promise<string>;
  generateJson(contents: readonly AgentMessage[], schema: Record<string, unknown>, opts?: GenerateOptions): Promise<Record<string, unknown>>;
  generateEmbedding(texts: readonly string[]): Promise<number[][]>;

  // ── Hooks / lifecycle observation (CLI renders hook execution + fires session hooks) ──
  readonly hooks: AgentHookControl;             // onHookExecution(req/resp), trigger SessionStart/SessionEnd/clear

  // ── Instance-scoped discovery (depends on initialized config/extensions/MCP) ──
  listProviders(): ProviderInfo[];
  listTools(): ToolInfo[];

  // ── Lifecycle ──
  dispose(): Promise<void>;     // tear down MCP, extensions, LSP, schedulers, bus subs, client, config
}

export interface TurnOptions {
  signal?: AbortSignal;
  promptId?: string;
  maxTurns?: number;
}
```

Notes:
- **`setModel`/`setProvider` are NOT deferred, and are NOT trivial setters** — but
  they are now **wrapping shipped code, not relocating it.** The CLI switches
  provider/model mid-session; these wrap the runtime-switch pipeline that **#2033
  already moved into `@vybestack/llxprt-code-providers`** (verified — all in
  `packages/providers/src/runtime/`): `switchActiveProvider` (`providerSwitch.ts`),
  `setActiveModel` / `updateActiveProviderApiKey` / `updateActiveProviderBaseUrl` /
  `setActiveToolFormatOverride` (`providerMutations.ts`), and
  `applyProfileWithGuards` + load-balancer selection (`profileApplication.ts`).
  These cover profile application, auth-key/keyfile/key-name/base-url **precedence**,
  load-balancer profiles, tool-format overrides, content-generator **rebuild**, and
  ephemeral preservation on switch. `agents` already depends on `providers`
  (verified), so the Agent facade can call them directly. Without exposing them
  #1595 deep-imports `providers/runtime` and the "thin UI" goal fails.
- **No extraction prerequisite remains (corrected).** An earlier draft claimed the
  switch pipeline lived in `packages/cli` and had to be extracted first — that was
  true before #2033 and is **no longer the case**. The pipeline is in `providers`,
  reachable from `agents`. The remaining work is purely **wrapping** these functions
  behind stable `Agent` methods (and choosing what is a typed method vs. a sub-path),
  not moving code between packages. This removes what was previously called the
  "single biggest scope risk."
- **Client rebinding on auth/switch (verified, critical):** the live `AgentClient`
  is **not stable** — `Config.initializeContentGeneratorConfig` creates a *new*
  `AgentClient` and disposes the previous one on `refreshAuth`/provider switch
  (verified in `config.ts`). So `Agent` must **not** cache a client reference; it
  delegates to `config.getAgentClient()` (the current one) on every call, and
  `setProvider`/`setModel`/`profiles.apply`/`auth.*` must account for the client
  being swapped underneath. The planner specifies the rebinding rule and that
  per-turn subscriptions (stream/scheduler) re-attach to the new client.
- **Context preservation across switch is a FIRST-CLASS GUARANTEE (verified,
  product-critical).** Switching provider/model — manually
  (`setProvider`/`setModel`/`profiles.apply`) or via automatic load-balancer
  failover — **continues the same conversation**; it does NOT reset chat. The
  mechanism is verified in `config.ts` (`extractExistingState` →
  `transferHistoryToNewClient` → `initializeContentGeneratorConfig`): the
  conversation lives in a provider-independent `HistoryService` that is **handed to
  the new client by reference** (`storeHistoryServiceForReuse` +
  `storeHistoryForLaterUse`), and the code asserts
  `historyServicePreserved === (existingHistoryService === newHistoryService)`. This
  is the core benefit ("anthropic keeps throwing overloaded → apply a gpt profile →
  keep going in the same context") and the exact basis of load-balancer failover.
  The Agent facade therefore MUST: (a) never reset chat on switch; (b) rely on the
  `Config` transfer path rather than re-implementing history copy; (c) treat manual
  switch and LB failover as the SAME mechanism. A switch that drops history is a bug,
  and the harness asserts continuity (T4d/T4e, §9).
- **Switch is not always byte-identical — `stripThoughts` edge case (verified).** The
  transfer normalizes provider-incompatible parts: switching *into* Vertex strips
  thought-signatures (`fromGenaiToVertex` → `Config.stripThoughtSignatures`). So
  "continue the same context" means semantically-equivalent history, with
  provider-incompatible artifacts (e.g. another provider's thinking blocks)
  normalized. The public `setHistory`/`restoreHistory` already carry the
  `stripThoughts` option for this; the switch path applies it automatically. The
  planner specifies the per-provider normalization rule; the harness covers switching
  into a provider that cannot accept the prior provider's thinking blocks (T4f).
- **Config-owned client is conditional (verified).** The config-owned `AgentClient`
  only exists when an `agentClientFactory` is injected via `ConfigParameters` (it is
  optional; `Config.requireAgentClientFactory()` throws at use time if absent —
  verified `configTypes.ts` / `config.ts`). Therefore `createAgent` MUST inject the
  factory itself (it lives in `packages/agents`, which owns `AgentClient`) rather than
  assume `Config` already has one. There is also a **transient pre-auth client**
  created during `initialize()` that is later replaced by the post-`refreshAuth`
  client; the Agent must bind to `config.getAgentClient()` **after** the auth/bootstrap
  sequence completes, never to the transient one.
- **The control plane is grounded in `AgentClientContract`** (verified —
  `packages/core/src/core/clientContract.ts`), not invented. That contract already
  exposes `getHistory(): Promise<Content[]>`, `addHistory`, `setHistory({stripThoughts})`,
  `restoreHistory`, `resetChat`, `resumeChat`, `updateSystemInstruction`,
  `addDirectoryContext`, `setTools`/`clearTools`, `generateDirectMessage`,
  `generateJson`, `generateContent`, `generateEmbedding`, `getUserTier`,
  `getCurrentSequenceModel`. The public Agent maps onto these — so `getHistory` is
  **async**, and the side-channel/history/system-instruction methods above are not
  speculative. The planner produces a contract-method → Agent-method table.
- `generate()` / `generateJson()` / `generateEmbedding()` expose the existing
  side-channel paths: the CLI's detached/auto-prompt client uses
  `generateDirectMessage`/`generateContent` (e.g. `autoPromptGenerator.ts`,
  `usePromptCompletion.ts`), and structured/embedding callers use
  `generateJson`/`generateEmbedding`.
- **Profiles** (`agent.profiles`) wrap both the existing **runtime apply** pipeline
  (`profileApplication.ts`) and the **durable profile store** operations in
  `profileSnapshot.ts` (`saveProfileSnapshot`, `saveLoadBalancerProfile`,
  `loadProfileByName`, `deleteProfileByName`, `listSavedProfiles`,
  `getProfileByName`, `setDefaultProfileName`). This is necessary because `/profile`
  is both a live-runtime command (apply a profile now) and an app-service command
  (create/save/delete/list profiles). The public shape should make that split clear,
  e.g. `agent.profiles.apply(name)` for live application and
  `agent.profiles.saveCurrent(name, opts)` / `create(name, profile)` /
  `delete(name)` for durable changes, all backed by the same profile store. Applying
  standard **and** load-balancer profiles must preserve full precedence
  (auth-key-name/keyfile/base-url/model-params/preserved ephemerals) and context
  continuity (T4d/T4e). Without this, the `/profile` command and load-balancer parity
  force a deep import.
- **Hooks** (`agent.hooks`) lets the UI observe `HOOK_EXECUTION_REQUEST/RESPONSE`
  on the `MessageBus` and trigger session-lifecycle hooks (SessionStart on init,
  SessionEnd on exit, clear). The CLI does this today via `useHookDisplayState`,
  `useSessionInitialization`, `useExitHandling`; without a public surface #1595
  deep-imports the bus and hook triggers.
- **Discovery is instance-scoped** (`agent.listProviders/listTools`): valid
  providers/tools depend on the *initialized* `Config` (extensions, MCP, skills,
  settings, provider manager). A purely global helper (§4.5) is offered as a
  best-effort convenience but is insufficient on its own.
- **`dispose()` ownership is decided (target), and the gap is implementation work.**
  Policy: `createAgent` **owns every resource it creates** and `Agent.dispose()`
  tears all of them down; caller-supplied resources are not disposed. Current state
  (verified, mixed): `CoreToolScheduler.dispose()`, `ConfirmationCoordinator.dispose()`,
  and scheduler-singleton disposal **already exist** and must be wired in;
  `Config.dispose()` is partial (only `agentClient.dispose()` + `mcpClientManager.stop()`);
  `AgentClient.dispose()` only unsubscribes model/runtime listeners; LSP shutdown
  exists in `configBase.ts` but is **not** invoked by dispose; extensions,
  `MessageBus`/hook subscriptions, and recording/session locks have no teardown
  today. The planner produces a **resource-ownership/teardown table** (resource →
  who creates → who tears down → exists today?) wiring the existing dispose methods
  and marking the genuinely-missing cleanup (LSP, extensions, hook subs, session
  locks) as net-new implementation work; the harness (T13) asserts no leaked
  handles/subscriptions.
- **MCP discovery gating:** the CLI blocks non-slash prompts until MCP discovery
  finishes while still allowing slash commands (verified behavior). The Agent must
  reproduce this without deep imports: `agent.mcp` exposes discovery state, and
  `chat()`/`stream()` either await readiness or surface a clear "discovery pending"
  signal. The planner defines whether `chat()` awaits discovery by default and how a
  consumer opts out.
- The sub-surfaces (`tools`, `mcp`, `auth`, `ide`, `session`) keep the top level
  legible. Grouping is a planner detail; **coverage** is the requirement.

### 4.4 Typed event stream — the top correctness risk

`agent.stream()` maps internal `ServerGeminiStreamEvent` → a **stable public**
union so internals can change without breaking consumers. The internal source of
truth is `GeminiEventType` in `packages/core/src/core/turn.ts` (verified — **21
variants**):

```
Content, ToolCallRequest, ToolCallResponse, ToolCallConfirmation, UserCancelled,
StreamIdleTimeout, Error, ChatCompressed, Thought, UsageMetadata, MaxSessionTurns,
Finished, LoopDetected, Citation, Retry, SystemNotice, InvalidStream,
ContextWindowWillOverflow, ModelInfo, AgentExecutionStopped, AgentExecutionBlocked
```

The public union must map **every one** of these. Payload shapes below are
**grounded in the actual `Server*Event` types** in `turn.ts` (verified) — earlier
drafts guessed payloads that don't exist (e.g. `Retry`/`InvalidStream`/`UserCancelled`/
`LoopDetected` carry **no** payload; `Thought` is a `ThoughtSummary`, not a string;
`Citation` is a `string`; `ContextWindowWillOverflow` carries
`{estimatedRequestTokenCount, remainingTokenCount}`; `ChatCompressed` is
`ChatCompressionInfo | null`; `StreamIdleTimeout`/`Error` carry a
`GeminiErrorEventValue`; `Finished` carries `{reason, usageMetadata?, outcome?}`):

```ts
export type AgentEvent =
  | { type: 'text';            text: string }                       // Content.value (string)
  | { type: 'thinking';        thought: ThoughtSummary }            // Thought.value (ThoughtSummary)
  | { type: 'tool-call';       call: AgentToolCall }                // from ToolCallRequest.value — see note (NOT the raw internal type)
  | { type: 'tool-result';     result: AgentToolResult }           // from ToolCallResponse.value — see note (NOT the raw internal type)
  | { type: 'tool-confirmation'; confirmation: ToolConfirmation }   // ToolCallConfirmation.value (IS a stream event — turn.ts) → also drives §4.6
  | { type: 'tool-status';     update: ToolUpdate }                 // scheduler callback, NOT a stream event (§4.6)
  | { type: 'usage';           usage: UsageMetadataValue }          // UsageMetadata.value
  | { type: 'model-info';      info: ModelInfo }                    // ModelInfo.value ({model})
  | { type: 'notice';          message: string }                    // SystemNotice.value (string)
  | { type: 'compression';     info: ChatCompressionInfo | null }   // ChatCompressed.value
  | { type: 'context-warning'; estimatedRequestTokenCount: number; remainingTokenCount: number } // ContextWindowWillOverflow.value
  | { type: 'retry' }                                               // Retry (no payload)
  | { type: 'citation';        citation: string }                   // Citation.value (string)
  | { type: 'loop-detected' }                                       // LoopDetected (no payload)
  | { type: 'idle-timeout';    error: StructuredError }             // StreamIdleTimeout.value.error
  | { type: 'invalid-stream' }                                      // InvalidStream (no payload)
  | { type: 'hook-blocked';    info: AgentStopInfo }                // AgentExecutionBlocked — NON-terminal (turn.ts: yields then `continue`)
  | { type: 'error';           error: StructuredError }             // Error.value.error
  | { type: 'done';            reason: DoneReason; finished?: ServerGeminiFinishedEvent['value']; stop?: AgentStopInfo };

// Exactly ONE `done` terminates a stream. `reason` folds the terminal variants.
// Finished's payload is preserved on `finished`; the hook-stop/blocked payloads
// (reason/systemMessage/contextCleared — verified in turn.ts) are preserved on `stop`.
// IMPORTANT (verified): several terminal paths in MessageStreamOrchestrator return
// WITHOUT emitting Finished — MaxSessionTurns, ContextWindowWillOverflow, LoopDetected,
// and BeforeAgent-blocking Error. So the public adapter must SYNTHESIZE the `done`
// for every terminal path; it cannot rely on a Finished event existing. DoneReason
// therefore covers those paths explicitly:
export type DoneReason =
  | 'stop'             // Finished (normal)
  | 'aborted'          // UserCancelled (turn-level — verified, NOT tool-scoped)
  | 'max-turns'        // MaxSessionTurns (no Finished emitted → synthesized)
  | 'context-overflow' // ContextWindowWillOverflow terminal (no Finished → synthesized)
  | 'loop-detected'    // LoopDetected terminal (no Finished → synthesized)
  | 'error'            // Error terminal / BeforeAgent block (no Finished → synthesized)
  | 'hook-stopped';    // AgentExecutionStopped — terminal (turn.ts: yields then `return`)

export interface AgentStopInfo { reason: string; systemMessage?: string; contextCleared?: boolean }
```

**`AgentExecutionStopped` vs `AgentExecutionBlocked` (verified, do not conflate).**
In `turn.ts`, `AgentExecutionStopped` yields then `return`s — it is **terminal**.
`AgentExecutionBlocked` yields then `continue`s — it is **NOT terminal**; it is a
mid-stream `hook-blocked` event and the turn proceeds. An earlier draft wrongly
folded blocked into `done`. Note (verified): `AgentExecutionStopped` covers **both**
a stop hook *and* an AfterAgent context-cleared case, so the `done: hook-stopped`
reason carries the `AgentStopInfo` (incl. `contextCleared`) to disambiguate — the
planner must not assume it is always a user-facing "stopped by hook."

**`invalid-stream`, `retry`, and 413 are NOT unconditionally terminal; but
`idle-timeout` IS terminal today (verified — corrected).** `MessageStreamTerminalHandler`
only handles **`Error` and `InvalidStream`** (it may retry/continue invalid-stream
or 413 when `continueOnFailedApiCall` is enabled), and `Retry` is inherently
mid-stream. **`StreamIdleTimeout`, by contrast, is emitted and immediately `return`s
in `turn.ts` — it is terminal in current behavior.** The public mapping must
classify each per its real runtime behavior (idle-timeout → terminal unless the new
API *deliberately* changes that, which must be an explicit documented decision +
test; invalid-stream/413 → intermediate-or-terminal on runtime outcome; retry →
intermediate). The single-`done` invariant still holds: exactly one synthesized
`done` is emitted when the stream ends without a `Finished`. The planner produces
the full **terminal-vs-intermediate decision table** (idle-timeout[terminal],
invalid-stream, retry, 413-continuation, user-cancel, BeforeAgent-block,
loop-detected, max-turns, context-overflow, Finished, AgentExecutionStopped,
AgentExecutionBlocked) and the harness asserts each.

Decisions documented (not accidental):
- `ToolCallConfirmation` **is** in the `ServerGeminiStreamEvent` union (verified)
  and a2a-server's `Task` handles it, **but the live interactive confirmation does
  NOT come from `Turn.run`.** Verified: the interactive path is generated by
  `CoreToolScheduler`/`ConfirmationCoordinator` — a tool enters `awaiting_approval`
  status and the coordinator drives it over `MessageBus` (correlationId → callId).
  So the public `tool-confirmation` event is primarily a **synthesized/merged
  scheduler event**, with the raw `ToolCallConfirmation` stream variant mapped only
  if it is actually encountered (the non-interactive/a2a path). Its internal value
  is `{ request, details }` (verified); the `correlationId` lives in `details` and
  **can be replaced after ModifyWithEditor** (verified). The public mapping defines
  a precise `ToolConfirmation` type `{ confirmationId, toolCallId, name, details }`,
  feeds both the `tool-confirmation` event *and* `agent.tools.onConfirmationRequest`
  (§4.6), and documents the **ordering/dedup** rule (one logical confirmation, one
  response) plus the re-confirmation/new-`correlationId` behavior on edit.
- **Stable public tool shapes (do NOT leak internals).** `tool-call`/`tool-result`
  must expose **public** `AgentToolCall`/`AgentToolResult` types, not the raw
  `ToolCallRequestInfo`/`ToolCallResponseInfo` (which carry internal fields like
  `prompt_id`, `hookRestrictedAllowedTools`, raw `responseParts`, `errorType`). The
  public shapes project the consumer-relevant fields (id/name/args; id/name/display
  output/isError) so the event stream stays stable as internals evolve. The mapping
  table names each projected field and what is intentionally dropped.
- **Normal tool-call boundary (no `Finished`).** Verified: `MessageStreamOrchestrator`
  ends a tool-calling stream **without** emitting `Finished`, leaving scheduling +
  continuation to the loop. The `AgenticLoop` primitive (shipped in #2034, §4.6) is
  what schedules the tools, feeds results back, and continues — so the public `done`
  is decided at the **`AgenticLoop` boundary** (the `AgenticLoopEvent` stream ending),
  not by naively observing a single inner `sendMessageStream` end. The Agent's public
  stream maps `AgenticLoopEvent`, so this boundary is already drawn for us; the
  mapping table has an explicit row for the inner tool-call boundary (inner stream
  ends → loop continues → no public `done` yet).
- **`traceId` (lossy choice, documented):** `Content`/`Thought` carry an optional
  `traceId` (verified) that the public mapping drops by default; if a consumer needs
  tracing it is exposed via an opt-in, not on the default event shape.
- `tool-status` is **not** a `ServerGeminiStreamEvent` — it originates from
  `CoreToolScheduler` callbacks. So `agent.stream()` is a **merged stream** of
  `AgentClient` events + scheduler updates; the planner must define ordering,
  subscription, and disposal for the merge (see §4.6). If a consumer wants the raw
  unmerged model stream, that is a separate documented option.
- `UserCancelled` is **turn-level cancellation** (verified — `turn.ts` treats it as
  the turn aborting, not a single tool), so it maps to `done: aborted`, NOT a
  tool-scoped event.
- **Exactly-one-`done` invariant.** `LoopDetected` is emitted internally and then
  the orchestrator returns (verified — `MessageStreamOrchestrator`). Public rule: a
  non-terminal informational `loop-detected` event MAY precede the terminator, but
  the stream still ends with exactly **one** `done` (reason `loop-detected` when the
  loop is what stopped it). The mapping table states, per terminal variant, whether
  it yields an informational event, the `done`, or both — so consumers can rely on a
  single terminator.
- Terminal variants collapse into one `done`; `Finished.value` is preserved on
  `finished` and the hook stop/block payloads on `stop` — nothing lossy.

**Mandatory planner deliverable (preflight):** a table with one row per
`GeminiEventType` member → its public mapping with the **exact source payload
field**, plus any lossy-collapse decision, asserted with characterization tests.
Note: not every variant is reachable purely via `FakeProvider` scripting (some are
emitted by the scheduler, loop detector, or runtime), so the suite combines
provider scripting with direct emission/injection at the real emission site. This
is the single riskiest part of the work; everything else is plumbing.

### 4.5 Discovery helpers

Two levels, because tool/provider availability is config-dependent:

```ts
// Best-effort, pre-agent: built-in/static names only (no extensions/MCP/skills).
export function listProviders(): ProviderInfo[];
export function listTools(): ToolInfo[];
```

These let a consumer pick a plausible `provider`/`tools` value *before* building an
agent. The provider list can now be backed by the **providers** package, which
already ships a static `listProviders()` accessor (verified —
`packages/providers/src/runtime/runtimeAccessors.ts`) plus alias loading; #1594 just
re-projects it into a public `ProviderInfo[]`. **Authoritative discovery is
instance-scoped** — `agent.listProviders()` / `agent.listTools()` (§4.3) — because
the real set depends on the initialized `Config` (extensions, MCP servers, skills,
settings, the active `ProviderManager`). Consumers that need the true list must use
the instance methods.

### 4.6 Tool execution, approval, and headless auth

**Tool execution is scheduler-based, not a simple callback.** Verified: the CLI
collects `ToolCallRequest` stream events and drives them through
`CoreToolScheduler` + `MessageBus`; confirmations are answered by publishing a
`TOOL_CONFIRMATION_RESPONSE` to the bus, and the
`confirmation-coordinator` (`packages/agents/src/scheduler/`) subscribes to it.
Live tool output/status flows back as scheduler updates (surfaced as the
`tool-status` event in §4.4). The public API must preserve this model, not
flatten it into a single `approval-request`/`respondToApproval` pair.

**Correlation semantics (verified).** The `confirmation-coordinator` routes a
`TOOL_CONFIRMATION_RESPONSE` by **`correlationId`**, which it maps to the
scheduler's `callId` — it is *not* a generic tool name. The public confirmation
object must therefore expose **both** the `correlationId`/`confirmationId` (what a
response is keyed on) and the `toolCallId` (what UI groups output under), and
`respondToConfirmation` keys on the correlation id. Conflating the two breaks
multi-call turns.

The API therefore exposes a **tool/scheduler sub-surface** the CLI sits on:

```ts
// On Agent (grouping is a planner detail; coverage is the requirement):
agent.tools.list(): ToolInfo[];
agent.tools.setEnabled(names: string[]): Promise<void>;
agent.tools.onConfirmationRequest(cb: (req: ToolConfirmation) => void): Unsubscribe;
// ToolConfirmation carries BOTH ids: { confirmationId; toolCallId; name; details }
agent.tools.respondToConfirmation(confirmationId: string, decision: ToolDecision): void; // → MessageBus
agent.tools.onToolUpdate(cb: (u: ToolUpdate) => void): Unsubscribe; // live output/status
agent.tools.setEditorCallbacks(cbs: EditorCallbacks): void;          // diff/open-in-editor
```

**`ToolUpdate` is a normalized public shape, not raw scheduler/CLI state.** The
scheduler exposes internal status transitions (validating → scheduled →
awaiting_approval → executing → success/error/cancelled) and the CLI maps these
into its own UI tool state (`toolMapping.ts`), including `agentId` grouping for
subagent tool calls. The public `ToolUpdate` must be a **deliberately normalized
projection** (id, name, public status enum, incremental output, optional
`agentId`) — it must NOT clone CLI UI state and must NOT leak the raw scheduler
internal union. The planner defines the public status enum and the
scheduler-status → public-status map.

**Stream/scheduler merge.** Because `tool-status`/confirmation flow from the
scheduler (not the model stream), `agent.stream()` must internally merge the
`AgentClient` stream with scheduler callbacks. The planner specifies: ordering
guarantees (e.g. a `tool-call` event precedes its `tool-status`/`tool-result`),
how subscriptions are established/torn down per turn, and back-pressure. A
consumer may also opt into the raw unmerged stream.

**Two distinct consumer paths (verified — do not conflate).** There are two real
confirmation flows in the tree and the design must serve both:
1. **Interactive CLI path** — `CoreToolScheduler` puts a tool in `awaiting_approval`
   and `ConfirmationCoordinator` drives it over `MessageBus`
   (`confirmation-coordinator.ts`). This is what `agent.tools.onConfirmationRequest`
   / `respondToConfirmation` serve.
2. **Raw a2a/task path** — `a2a-server`'s `Task` consumes the raw
   `ToolCallConfirmation` *stream* variant directly (`task.ts`) without the
   coordinator.

> **Important — raw-stream projection alone does NOT prove a2a parity.** Verified:
> a2a `Task` owns far more than reading the confirmation event — it creates its own
> scheduler, schedules tools, collects completed tools, updates history, and submits
> the function-response continuation (`task.ts`). So a2a has two valid futures and
> the planner must pick one explicitly: **(a)** a2a adopts the new high-level Agent
> tool loop (preferred — it gets the orchestration for free), or **(b)** a2a stays
> on the raw stream and keeps owning its loop, in which case "raw unmerged stream"
> is only a *building block*, not full parity. The consumer matrix must say which.

The planner includes a **consumer matrix** (CLI interactive / a2a task /
non-interactive CLI / external script) × (which path, which surface, who owns the
tool loop) so the API is proven to cover each, and the harness tests the two
confirmation paths separately (§9).

**High-level tool-loop ownership (critical for #1595) — now a SHIPPED primitive.**
The full tool loop — drive the scheduler to completion, record completed-tool
history, build and submit the function-response continuation, record cancelled/denied
tool history, route approvals, handle cancellation/teardown, and correlate prompt
ids — is exactly what **`AgenticLoop` (#2034 / PR #2050) already does** in
`packages/agents/src/core/agenticLoop/`. The CLI no longer owns it: its old
`toolCompletionHandler` re-submit logic was deleted and it now consumes the loop via
`useAgenticLoop.ts` (verified). **So the Agent's `chat()`/`stream()` delegates to
`AgenticLoop.run(...)` and maps `AgenticLoopEvent` → `AgentEvent`** — it does **not**
re-implement scheduling/continuation.

> **This is a WRAPPER over a shipped loop, not new orchestration (corrected).**
> An earlier draft (written before #2034) called this "the biggest implementation
> chunk … new orchestration." That is no longer true: the orchestration exists as
> `AgenticLoop`. #1594's job here is the **public mapping + facade**: translate the
> loop's `{kind: 'stream'|'tool_update'|'tool_output'|'tools_complete'|'awaiting_approval'}`
> events into the stable `AgentEvent` union (§4.4), wire `onApproval` to the loop's
> `approvalHandler`, and surface display/editor callbacks via the loop's
> `displayCallbacks`. The planner produces the `AgenticLoopEvent → AgentEvent`
> mapping table (alongside the `GeminiEventType` table) and asserts it. A lower-level
> "raw `sendMessageStream`, you own the loop" mode is offered as a documented
> power-user option, not the default.

**Sequencing/concurrency (now owned by `AgenticLoop`, verified).** The deferral of
completed tools until the active stream settles, single-follow-up continuation, and
cancel/teardown-on-`AbortSignal` semantics live **inside `AgenticLoop`** today (it
owns its scheduler via an isolated scheduler-session key — verified in
`AgenticLoop.ts`). The Agent therefore inherits a defined no-overlap contract rather
than inventing one; #1594 specifies only the **facade-level** rule (one active
`run()` per agent; `chat()` awaits completion; `stream()` yields until one `done`)
and the harness asserts ordering across a multi-tool turn by driving the real loop.

**Inner-stream boundary vs outer `done` (verified, handled by the primitive).**
`MessageStreamOrchestrator` ends an inner tool-calling stream **without `Finished`**
(verified); `AgenticLoop` is what continues past it. Because the Agent maps the
**`AgenticLoopEvent`** stream (not the raw inner `sendMessageStream`), the
outer/inner boundary is already drawn by the primitive: the public **`done` is
synthesized when `AgenticLoop.run` completes**, never at an inner stream end. The
planner documents the loop's terminal conditions and maps each to a `DoneReason`;
the mapping/decision tables key off the loop boundary, and the harness asserts no
`done`
at the inner tool-call boundary (it appears in §9).

**`createAgent` client ownership (mandated here, not deferred).** Per the verified
bootstrap (`config.ts`): `Config.initialize` makes a transient pre-auth client, and
`refreshAuth`/`initializeContentGeneratorConfig` then creates a new client,
transfers state, disposes the previous, and assigns it to `Config`. The design
therefore **mandates**: `createAgent` injects its own `agentClientFactory`, runs the
full bootstrap+auth sequence, and the `Agent` thereafter uses **only**
`config.getAgentClient()` — it never constructs a second long-lived client and never
binds to the transient pre-auth one. This is a design decision, not a planner
choice.

**External/subagent scheduler factory.** The interactive CLI today injects an
*external* tool scheduler (`useReactToolScheduler` sets a scheduler factory used by
subagents/interactive flows). For #1595 to avoid deep-importing the scheduler, the
Agent must own scheduler creation by default **and** allow an injected scheduler
factory for interactive/subagent cases. The planner defines the scheduler lifecycle
(per-agent vs per-turn), ownership, and disposal, and how the injected-factory path
is exposed publicly.

- **Headless / simple consumers** instead pass an `onApproval` handler in
  `AgentConfig` (auto-answers confirmations) — equivalent to a2a-server's
  `GEMINI_YOLO_MODE`/`approvalMode`.
- **Current fallback behavior (verified — must be stated, not silently changed):**
  with no handler and a non-permissive `approvalMode`, `ConfirmationCoordinator`
  currently **throws** in non-interactive/confirmation-required mode (it does NOT
  auto-deny). The design must explicitly choose one of: (a) preserve the throw, or
  (b) normalize to a denied `tool-result`. Either is acceptable but it is a behavior
  decision with a dedicated harness test — the API must not accidentally introduce
  silent denial where the code throws today.
- **Editor callbacks** (open-in-editor / diff) are real CLI touchpoints
  (`confirmation-coordinator` takes `EditorCallbacks`) and must be injectable.

**Auth.** Auth-as-data (apiKey / apiKeyFile / keyName / baseUrl, with the CLI's
precedence rules) maps to `refreshAuth(...)`, like a2a-server. But the CLI's auth
surface is much larger and must be addressed explicitly (an `agent.auth.*`
sub-surface or a documented power-user subpath — **planner decision, not a silent
assumption**):

```ts
agent.auth.login(provider: string, opts?: { bucket?: string }): Promise<void>; // interactive OAuth
agent.auth.logout(provider: string, opts?: { bucket?: string; all?: boolean }): Promise<void>;
agent.auth.status(provider?: string): AuthStatus;
agent.auth.enableOAuth(provider: string): Promise<void>;
agent.auth.disableOAuth(provider: string): Promise<void>;
agent.auth.listBuckets(provider?: string): AuthBucket[]; // multi-key buckets / load balancer
agent.auth.switchBucket(provider: string, bucket: string): Promise<void>;
agent.auth.mcpLogin(server: string): Promise<void>;      // MCP-server OAuth

// /key and /keyfile: secure-store + live runtime update + profile-save semantics
agent.auth.keys.list(): Promise<readonly KeyInfo[]>;
agent.auth.keys.save(name: string, apiKey: string, opts?: { provider?: string }): Promise<void>;
agent.auth.keys.use(name: string, opts?: { provider?: string }): Promise<void>;
agent.auth.keys.delete(name: string, opts?: { provider?: string }): Promise<void>;
agent.auth.keys.setRaw(apiKey: string | null, opts?: { provider?: string }): Promise<void>;
agent.auth.keys.setKeyFile(path: string | null, opts?: { provider?: string }): Promise<void>;
agent.auth.setBaseUrl(baseUrl: string | null, opts?: { provider?: string }): Promise<void>;
```

Interactive OAuth needs a human → `onOAuthPrompt`; with an interactive flow and no
handler, the call rejects with a clear error rather than hanging. `/key` and
`/keyfile` are not just in-memory setters: they may write/read the provider secure
store (`createProviderKeyStorage` today), update active runtime auth
(`updateActiveProviderApiKey` / `updateActiveProviderBaseUrl`), and set ephemeral
profile fields (`auth-key-name`, `auth-key`, `auth-keyfile`) so later
`profiles.saveCurrent(...)` stores a **reference** to the named key rather than a raw
secret. The public auth surface must preserve that behavior and the tested
precedence chain; otherwise #1595 still deep-imports `providers/auth.js`.

> **Profile / load-balancer parity.** `setProvider/setModel/setModelParam` (§4.3)
> must cover what `providerMutations.ts`/`profileApplication.ts` do today: profile
> application, auth precedence, load-balancer profiles, tool-format overrides, and
> the content-generator rebuild + history transfer on switch. These are not
> trivial setters; they wrap the existing runtime-switch pipeline.

### 4.7 Agent runtime API vs. app-service boundary (avoid a god-object)

Not every slash command belongs on `Agent`. The planner classifies each CLI
touchpoint into exactly one of:
- **Agent runtime method** — anything that affects the live conversation/turn
  (provider/model/params, tools, approval, history, compression, generation, auth
  for the active run).
- **Public app-service subpath** — settings mutation, profile CRUD when not tied to
  the live agent snapshot, MCP server config add/remove, session browser/recording
  management, extension management, memory-file edits, diagnostics/about, and
  sandbox/profile configuration persistence. These are exposed as stable public
  subpaths (§6), NOT crammed onto `Agent`.
- **CLI-local** — pure UI/UX with no core dependency (stays in #1595's CLI).

The rule: `Agent` is the runtime control plane; durable/config/app concerns are
public services. The deliverable is the command→(method|subpath|CLI-local) map
(§9 slash-command note), so #1595 still has a public path for everything without
turning `Agent` into a CLI-shaped god-object.

**Sandbox mode boundary (startup/runtime split).** `sandbox?: SandboxConfig` is a
first-class `AgentConfig` field because sandboxing affects tool execution from the
first turn (`SandboxConfig` today is `{ command: 'docker' | 'podman' | 'sandbox-exec';
image: string }`). For safety and predictability, sandbox mode is treated as
**agent-instance configuration**: a client chooses it at `createAgent(...)`; changing
it means creating a new Agent (or an explicit future `agent.recreate({ sandbox })`),
not mutating a live tool executor mid-turn. The Agent exposes **status** (e.g.
`sandbox.active`, `sandbox.command`, `sandbox.image`, environment label for about /
diagnostics), while durable sandbox preference/profile editing is an app-service
subpath. This keeps GUI/Luther clients able to opt into sandboxing without importing
CLI `sandboxProfiles` or bootstrap code, and avoids unsafe runtime mutation.

**Command discovery/loading boundary (explicit decision required).** The CLI loads
commands from multiple sources (built-ins, file-based commands, MCP prompt
commands). The planner must decide *and document* whether (a) command
discovery/loading stays CLI-local with every command *action* mapped to a public
Agent method or app-service subpath, or (b) a public command-loading service is
exposed. Default recommendation: (a) — keep loading CLI-local, guarantee a public
path for each action — so #1595 neither deep-imports CLI services nor duplicates
loader logic. Whichever is chosen, it is stated so there is no silent gap.

---

## 5. `AgentDefinition` is a different thing — don't conflate

`packages/agents/src/agents/` has an `AgentDefinition`/`AgentExecutor` for
*non-interactive subagent task runs* (`complete_task` semantics, Zod output,
run-limits). That is **not** the interactive chat `Agent` here. `createAgent`
wraps `AgentClient`/`ChatSession`; keep `AgentExecutor` out of the curated public
API.

> **Export-curation note (verified):** `packages/agents/src/index.ts` *currently*
> exports `AgentDefinition`/`AgentExecutor` (and `AgentClient`, `CoreToolScheduler`,
> etc.) directly. The new curated entry must expose only the interactive
> `createAgent`/`Agent` surface, with the existing low-level exports moved behind a
> documented power-user subpath rather than the headline entry. The planner states
> exactly which symbols stay on the curated entry vs. the subpath.

---

## 6. Export strategy

- **Public API** (`createAgent`, `Agent`, `AgentConfig`, `AgentEvent`,
  `ApprovalMode`, `listProviders/Tools`, handler types) is exported from
  `@vybestack/llxprt-code-agents` (§3).
- **Subpath exports** for power users are **already established** and just need to
  be the documented escape hatch: `@vybestack/llxprt-code-providers/composition.js`,
  `…-providers/runtime.js`, `…-providers/auth.js` (verified in `providers/package.json`
  `exports`), plus the existing `@vybestack/llxprt-code-core/runtime/...` paths. The
  switch pipeline (`switchActiveProvider`, `setActiveModel`, `applyProfileWithGuards`,
  …) is reachable via `…-providers/runtime.js` today, so power users are covered even
  before every wrapper method lands. #1594 just formalizes which of these are
  *supported* public subpaths vs. internal.
- **`core/index.ts` trim:** the umbrella issue forbids backward-compat shims, so we
  don't keep a deprecated barrel. The honest sequencing: **#1594 adds the API;
  #1595 migrates consumers and, as its last step, trims `core/index.ts`.** The
  existing barrel is the *current real API*, not a shim — leaving it untouched
  until its consumers are migrated is not a shim. (Alternatively, maintainers may
  fold the trim + CLI migration into one #1594/#1595 PR.)

---

## 7. Acceptance criteria

From #1594, plus the **#1595-enablement** criterion that the earlier minimal
design failed:

| Criterion | Where |
|---|---|
| **Package/entry wording ruling (small — confirm early)** | §3, §10.1 — entry is `@vybestack/llxprt-code-agents`; amend issue text (no longer an architectural blocker since #2033/#2034 shipped) |
| Clean, documented public API | §4 |
| `createAgent` works end-to-end | §4.1 (mirrors a2a-server bootstrap) |
| Streaming with typed events | §4.4 |
| Usable without the CLI | §4.6 + a2a-server already proves the bootstrap |
| Sub-package imports for power users | §6 |
| API docs written | new `docs/core-api.md` |
| **Sufficient for #1595 (CLI as thin UI, no deep imports)** | §2(B), §4.3 control plane, §4.4 complete events, §4.6 approval/auth |

**Concrete enablement test:** the planner should produce a checklist that maps
each thing the CLI does today (provider/model switch, model params, tool
confirmation, OAuth, history restore/checkpoint, compression, side-channel
generation, todo continuation, IDE) to a public API call. Any item with no public
equivalent is a gap that would force a deep import — and must be either added here
or explicitly deferred with maintainer sign-off.

> Wording note: API entry is `@vybestack/llxprt-code-agents`, not `-core` (§3).

---

## 8. Suggested phasing (sketch for the formal plan)

0. **Preflight:** (a) the complete internal→public **event mapping table** (with
   exact source payload fields) + characterization tests at each variant's real
   emission site; (b) the **CLI-capability → API-method checklist** from §7 plus
   the **slash-command → API map** (§9); (c) the **`AgentClientContract`-method →
   `Agent`-method** table and the **`ConfigParameters` → `AgentConfig`** table, so
   no consumer-relevant field or method is silently dropped.
1. **Public types + stubs:** `AgentConfig`, `Agent` control plane, `AgentEvent`,
   handler types; `createAgent`/`Agent` stubs that compile; formalize subpath
   `exports`.
2. **CLI-touchpoint harness (test-first):** the §9 T-row behavioral integration
   tests (layered per §9), written against the stubs so they fail naturally. This is
   the executable contract for "#1595 can consume this."
3. **`createAgent` + core conversation:** `AgentConfig → ConfigParameters`
   adapter; wrap the existing bootstrap + `sendMessageStream`; event mapping; real
   `dispose()`. Turns T1, T9, T13 green.
4. **Control-plane methods:** provider/model/param switching, tool/MCP management,
   approval response, history/session + compression, side-channel `generate()` —
   each wrapping existing runtime machinery, behavior-preserving. Turns the
   remaining harness touchpoints green.
5. **Docs:** `docs/core-api.md`.

(`core/index.ts` trim + the actual CLI rewrite are #1595.)

---

## 9. CLI-touchpoint test harness (the test-first spine)

The API only succeeds if #1595 can sit on it. So the **first** thing the plan
builds (after the event-mapping characterization tests) is a **CLI-touchpoint
test suite**: a set of behavioral integration tests that exercise the public API
through the *same touchpoints the CLI will use*, against the real `FakeProvider`
(no mock theater). These tests are written before `createAgent`/`Agent` exist, so
they fail naturally, and they become the executable definition of "the API is
sufficient for the CLI."

Each touchpoint below is something the current CLI does by reaching into
internals; the harness asserts it can be done through the public surface instead.

**The harness is layered** (the planner organizes the tests below into these
layers, each with its own fixtures, rather than one flat suite):
1. **Static / boundary** — no-deep-import + package-boundary checks (T17); fast, no runtime.
2. **Event characterization** — every `GeminiEventType` → public projection (T16), driven at real emission sites.
3. **Core Agent behavior** — conversation/tools/history/compression/generation against `FakeProvider` (most T-rows).
4. **CLI-parity integration** — provider/profile switch, MCP, auth, IDE, hooks, todo continuation (need richer fixtures: fake MCP server, fake hook, fake IDE, fake FS).
5. **Resource-leak** — disposal/no-leaked-handles (T13), built on the §4.3 teardown table.

| # | CLI touchpoint (today) | Harness test (through public API) |
|---|---|---|
| T1 | Start a session, send a prompt, render streamed output | `createAgent(...)` then drain `stream()`; assert ordered `text`/`thinking`/`done` events from `FakeProvider` scripted output |
| T2 | Tool call + confirmation + result (scheduler path) | scripted tool call → `tool-call` + `tool-confirmation` events; `agent.tools.onConfirmationRequest` fires; `respondToConfirmation(confirmationId, approve)` (publishes to MessageBus); assert `tool-status` updates, `tool-result`, **history records the completed tool**, and the function-response continuation runs — all via the high-level loop (§4.6) |
| T3 | Deny a tool | as T2 but `respondToConfirmation(confirmationId, deny)`; assert tool **not executed**, a denied `tool-result` (error/denied), denied-tool history recorded, and the turn continues/ends cleanly (distinct from `done: aborted`) |
| T3b | Live tool output/status | long-running scripted tool emits incremental output; assert `tool-status`/`onToolUpdate` deliver partial output before `tool-result` |
| T3c | Editor callback | tool requiring diff/open-in-editor invokes injected `EditorCallbacks`; assert callback received correct payload |
| T4 | Switch provider mid-session (full pipeline) | after a turn, `setProvider('openai','gpt-x')`; assert `getProvider()`, content-generator rebuilt, history transferred, next turn uses new provider |
| T4b | Apply a profile | `agent.profiles.apply(profile)` (standard + load-balancer; incl. auth precedence + tool-format override); assert resulting provider/model/params/auth match the profile |
| T5 | Switch model / set model params | `setModel(...)`, `setModelParam('temperature',0.2)`; assert `getModel()`/`getModelParams()` and that params reach the provider call |
| T6 | History restore (resume session) | `setHistory(savedItems)` then `getHistory()` round-trips; a follow-up turn sees prior context |
| T6b | Session resume by id/prefix/latest + checkpoint | `agent.session.resume(...)` and `checkpoint create/restore`; assert restored history/state |
| T7 | Reset chat | `resetChat()` then `getHistory()` empty; next turn has no prior context |
| T8 | Compression (explicit + automatic) | (a) call `compress()` → `CompressionResult` with reduced token count; (b) separately, drive history past threshold mid-turn → assert a `compression` stream event. Keep the two paths distinct, not conflated |
| T8b | Live token stats | `agent.onStats(...)`; run a turn; assert token/context-window metrics update without reaching into `HistoryService`/`getChat()` |
| T9 | Cancellation | start `stream()` with an `AbortSignal`, abort mid-stream; assert exactly one terminal `done: aborted` (from `UserCancelled`, turn-level) and no further events |
| T10 | Side-channel generation (auto-prompt) | `generate('summarize')` returns a string without emitting tool-loop events or mutating chat history |
| T11 | Headless approval (no UI) | `onApproval` handler auto-answers; a tool turn completes without a manual confirmation round-trip |
| T12 | Instance-scoped discovery | `agent.listProviders()`/`agent.listTools()` include MCP/extension/skill-contributed entries, not just built-ins |
| T12b | MCP discovery + status | configure an MCP server; assert `agent.mcp.listServers()`/`status()`/`toolsByServer()`; assert discovery-blocking behavior honored |
| T13 | Disposal (ownership-table driven) | `dispose()` resolves; assert **each row of the §4.3 resource-ownership/teardown table** is torn down (AgentClient, MCP transports, extensions, LSP, scheduler, ConfirmationCoordinator, bus subscriptions, session locks) via disposed flags — not just a generic no-open-handles check |
| T2b | Raw-stream confirmation (a2a path) | drive a raw `ToolCallConfirmation` *stream* variant (no coordinator) through the **raw unmerged stream** option; assert it surfaces correctly — proving the a2a/task path is served separately from the scheduler path (§4.6 consumer matrix) |
| T4c | Client rebinding on auth/switch | across `setProvider`/`profiles.apply`/`auth.*`, assert the Agent rebinds to the new `config.getAgentClient()` (no stale cached client; per-turn subscriptions re-attach) and that the transient pre-auth client is never used |
| T4d | **Context preservation across switch** (headline benefit) | build N messages on provider A, then `setProvider('openai',…)` **or** `profiles.apply(B)`; send a follow-up referencing earlier turns; assert (1) chat is NOT reset, (2) the next provider call includes the prior N messages, (3) the **same `HistoryService` instance** is reused (`existingHistoryService === newHistoryService`), (4) the answer reflects prior context |
| T4e | Load-balancer failover preserves context | drive an LB profile so an overloaded bucket (A) fails over to bucket B mid-conversation; assert the SAME continuity guarantees as T4d via the SAME transfer path (manual switch ≡ failover) |
| T4f | Switch normalization (`stripThoughts`) | accumulate history with provider-A thinking blocks, switch into a provider that cannot accept them (e.g. Vertex path); assert thought-signatures are stripped per the normalization rule and the turn still continues coherently |
| T14 | Todo continuation | scripted run that triggers todo continuation; assert continuation behavior is preserved purely through `stream()`/`chat()` (no internal import) |
| T15 | IDE integration | `agent.ide.*` reports current/detected IDE + trust; editor open/close callbacks fire (or explicitly documented as deferred) |
| T14b | Direct history / system-instruction / directory context | `addHistory(msg)`, `updateSystemInstruction()`, `addDirectoryContext()` (CLI `/directory`, memory refresh); assert each takes effect on the next turn through the public API |
| T15b | Hooks / lifecycle | `agent.hooks.onHookExecution(...)` observes a scripted hook firing; SessionStart fires on create and SessionEnd on `dispose()`; assert observed through the public surface |
| T15c | save_memory refresh | scripted `save_memory` tool call; assert memory/system-instruction is refreshed for the next turn through the high-level loop (no internal import) |
| T17 | No-deep-import / package boundary | a static check (lint rule or AST scan) asserting the harness (and, as the #1595 gate, the CLI) imports ONLY the public entry + documented subpaths — no `…/dist/…` or deep `src` internal imports. This is the literal "thin UI, no deep imports" guard |
| T18 | Auth: key / keyfile / key-name precedence | configure provider auth via key, keyfile, and key-name; assert the documented precedence wins and `getProviderStatus()`/`agent.auth.status()` reflect it (covers `/key`, `/keyfile`) |
| T18b | `/key` secure-store + profile-save semantics | `agent.auth.keys.save/use/delete/setRaw/setKeyFile` updates the provider key store, active runtime auth, and ephemerals (`auth-key-name` wins, raw key not persisted into saved profile); then `profiles.saveCurrent` stores the key reference, not the secret |
| T18c | OAuth / buckets / MCP auth | `agent.auth.login/logout/status/listBuckets/switchBucket/mcpLogin` works via `onOAuthPrompt`; with no prompt handler, interactive OAuth rejects clearly rather than hanging |
| T18d | Profile CRUD + apply | `agent.profiles.saveCurrent/create/delete/list/get/setDefault/apply`; assert durable store changes, standard + load-balancer profiles apply through the runtime pipeline, and apply preserves context (ties to T4d/T4e) |
| T18e | Sandbox startup + status | `createAgent({ sandbox })` routes tool execution through the sandbox configuration from the first turn; `agent.sandbox/status` (or equivalent diagnostics surface) reports the active sandbox; changing sandbox is classified as recreate/app-service config, not live mutation |
| T19 | External/subagent scheduler factory | inject a scheduler factory; assert subagent/interactive tool calls route through it and are torn down on `dispose()` |
| T20 | MCP discovery gating | with discovery pending, assert `chat()`/`stream()` honor the prompt gate (await readiness or surface the documented pending signal) while the public runtime/app-service methods that back commands (e.g. `agent.mcp.status`, `listTools`) remain callable — the Agent itself does **not** parse slash commands |
| T25 | Provider-by-name bootstrap | per the §1/§3 ruling, assert `createAgent({provider:'anthropic'\|'openai', model})` yields a working agent (real provider composition or documented injection), and Gemini-default works with no provider injection; `listProviders()` returns the available set without a CLI deep import |
| T16 | Event-variant coverage | for each of the 21 `GeminiEventType` members (including `ToolCallConfirmation` → `tool-confirmation` + callback, `AgentExecutionBlocked` → **non-terminal** `hook-blocked` (turn continues), `AgentExecutionStopped` → terminal `done: hook-stopped`, and the synthesized-`done` collapses for max-turns/context-overflow/loop/error), drive it at its real emission site (provider scripting where it originates in the model stream; scheduler/loop-detector/runtime injection for the rest); assert the documented public projection from §4.4 (this is the characterization suite — note not every variant is reachable via `FakeProvider` alone) |
| T21 | Tool-loop sequencing | multi-tool turn: assert completed tools are deferred until the active stream settles, function-response continuation is submitted once, no overlapping turns, and a mid-flight cancel/deny is handled per the documented contract |
| T22 | Non-interactive mode parity | run a single prompt headlessly: assert output-format mapping (text/json), no-confirm/yolo auto-answers tools, clean stdout/stderr separation, and exit/error mapping — the `runNonInteractive` touchpoints — all through the public API |
| T23 | Durable app-service subpaths | static/contract test that durable mutations (`/mcp add|remove`, `/extensions`, `/skills`, `/memory`, settings mutation, diagnostics) resolve to **importable public subpaths** (not the runtime `Agent`), proving the §4.7 runtime-vs-app-service split is real and import-safe |
| T24 | Completions boundary | prompt/command/at-command/MCP-prompt completion data is reachable via a documented public path (or explicitly classified CLI-local in the §4.7 boundary); assert the command→API map has no orphan |

Rules for the harness (per `dev-docs/RULES.md`):
- Real `Agent` + real `FakeProvider` + real `CoreToolScheduler`/`MessageBus` for
  tool tests; mock only infra (HTTP/FS) if unavoidable.
- Assert **behavior and values** (event sequences, history contents, provider in
  use, scheduler state), never "method was called."
- These tests live in `packages/agents` (where `createAgent` lands) and are the
  acceptance gate for the "#1595-enablement" criterion (§7).

**Slash-command dependency note.** Many CLI behaviors are reached via slash
commands — at least `/auth`, `/key`, `/keyfile`, `/provider`, `/model`, `/profile`,
`/compress`, `/mcp` (incl. MCP OAuth), `/restore`, `/chat` (save/resume/clear),
`/tools`, `/directory`, `/memory`, `/skills`, `/ide`, `/stats`, `/about`, and other
diagnostics. Each must resolve to a public Agent call (or a documented public
subpath). The planner produces a full command→API map alongside the §7 capability
checklist; any command with no public path is a gap that forces a deep import.

> This harness is deliberately *not* the full CLI. It is the **contract** the CLI
> depends on. If a touchpoint can't be expressed here, the API is missing
> something and the design — not the test — is wrong.

---

## 10. Open questions for the planner / maintainer

These are genuine **decisions** (most other ambiguities in earlier drafts are now
resolved inline above):

1. **Package/entry wording ruling (§3) — small, cosmetic.** Provider composition
   already ships headlessly in `@vybestack/llxprt-code-providers` (#2033) and
   `agents` already depends on it, so the old coupled architectural decision is
   **resolved**: `createAgent` lives in `@vybestack/llxprt-code-agents`. The only
   open item is **wording**: the issue says `import … from '@vybestack/llxprt-code-core'`,
   which is a cycle and rejected. Confirm the entry is `@vybestack/llxprt-code-agents`
   (recommended) and amend #1594/#1595 text accordingly, or request a thin facade
   package (`@vybestack/llxprt-code`) re-exporting from `agents` (optional, adds a
   package for no functional gain now). Recorded in §7.
2. **Switch-pipeline location — RESOLVED, no extraction needed.** The runtime-switch
   pipeline (`profileApplication.ts`/`providerMutations.ts`/`providerSwitch.ts`/
   `runtimeSettings.ts`) already lives in `packages/providers/src/runtime/` (moved by
   #2033) and is reachable from `agents` (verified). The earlier "must be extracted
   first / its own sub-issue" question is moot. Remaining decision is only **which
   switch operations are typed `Agent` methods vs. a documented `providers/runtime`
   sub-path** — folded into the §4.3/§6 surface decisions, not a predecessor issue.
3. **Control-plane scope (§4.3):** confirm the full provider/model/tool/auth/
   profile/session control plane is in-scope for #1594 (so #1595 is a pure UI
   rewrite). The whole doc assumes yes; if the maintainer wants a smaller #1594,
   that trade-off (and which deep imports #1595 would then need) must be accepted
   explicitly.
4. **Auth control plane shape (§4.6):** confirm `agent.auth.*`
   (login/logout/status/buckets/key/keyfile/key-name/mcpLogin) is public vs. reached
   via a documented subpath. Covers `/auth`, `/key`, `/keyfile`, load-balancer
   bucket selection, MCP OAuth.
5. **Sub-surface scope:** are `agent.mcp`, `agent.ide`, `agent.session`
   (resume/checkpoint/recording), `agent.hooks`, and `agent.profiles` all in-scope
   for #1594, or is any explicitly deferred to a documented power-user subpath?
6. **`AgentConfig` field classification (§4.2):** confirm the full
   `ConfigParameters → typed field | sub-surface | settings` table the planner will
   produce; challenge anything CLI-needed left in the unstable `settings` hatch.
7. **`core/index.ts` trim sequencing:** trim in #1595 (recommended) or as a tail
   step of #1594?
8. **Other consumers / surfaces — in-scope or explicitly excluded?** Each needs a
   yes/no so there is no silent gap: (a) the **non-interactive CLI** path (stdin,
   `--output-format`, no-confirmation, exit/error mapping); (b) **ACP/Zed**
   integration; (c) **async task** reminders/auto-trigger; (d) **completions**
   (prompt, command, at-command file, MCP-prompt). Recommendation: #1594 guarantees
   the runtime primitives these need, but their wiring stays in #1595/their own
   surfaces unless a maintainer pulls one in.
9. **Stats/metrics source:** `getStats`/`onStats` (§4.3) must map to a real source
   — `uiTelemetryService`/`HistoryService` token accounting — without exposing those
   internals. Confirm which is authoritative for the public surface.

Resolved inline (no longer open): event payloads + exactly-one-`done` (§4.4);
ToolCallConfirmation dual projection (§4.4/§4.6); confirmation correlationId
semantics (§4.6); high-level tool-loop ownership + external scheduler factory
(§4.6); disposal ownership (§4.3); MCP discovery gating (§4.3); per-call
signal/promptId (§4.2/§4.3).
