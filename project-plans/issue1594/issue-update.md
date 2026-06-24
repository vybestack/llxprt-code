## Design update — overall design & boundaries (post #2033/#2034)

This refreshes the design now that the two foundational refactors this issue was waiting on have **merged to `main`**. The full design lives in `project-plans/issue1594/overview.md`; this comment summarizes the shape and the boundaries.

### What changed since this issue was filed

The two hard prerequisites are now shipped engine primitives, so `createAgent` is a **composition of existing primitives**, not new orchestration and not a relocation:

1. **Provider-by-name works headlessly — #2033 / PR #2039.** Provider + profile composition moved out of `packages/cli` into `@vybestack/llxprt-code-providers`. `createHeadlessProviderManager({ provider, model, apiKey, baseUrl })` builds a fully wired `ProviderManager` from a bare `SettingsService`, imports nothing from the CLI, and a behavioral test routes a real completion through a concrete `OpenAIProvider`. The runtime switch pipeline (`switchActiveProvider`, `setActiveModel`, `applyProfileWithGuards`, …) now lives in `packages/providers/src/runtime/` — it no longer needs extraction.

2. **The multi-turn tool loop is an engine primitive — #2034 / PR #2050.** The send to stream to policy to approve to execute to feed-back to continue loop is now `AgenticLoop` in `@vybestack/llxprt-code-agents`. It owns tool scheduling, the confirmation bus, function-response continuation, cancellation/teardown, and prompt-id correlation. The CLI is now a single consumer of it; its old hand-rolled continuation logic is gone.

### Where the API lives (boundary ruling)

`createAgent` must compose three things: a `ProviderManager` (providers), a `Config` (core), and an `AgentClient` + `AgenticLoop` (agents). Only **one** package depends on all three — **`packages/agents`** — so that is where `createAgent` lives and the public entry is **`@vybestack/llxprt-code-agents`**.

The issue text originally wrote `import { createAgent } from '@vybestack/llxprt-code-core'`. That exact specifier requires `core` to import `agents` — a dependency cycle — and is rejected. Recommended ruling (one-line maintainer OK requested): publish the Agent API from `@vybestack/llxprt-code-agents` (matches where the runtime already lives and how `cli`/`a2a-server` already import) and amend the wording to "the public Agent API" rather than "core". An optional thin facade package (`@vybestack/llxprt-code`) re-exporting from agents can be added later if a single batteries-included specifier is wanted; it is not required here.

### The composition `createAgent` performs

    createAgent(AgentConfig)                          [packages/agents]
      - createHeadlessProviderManager(...)            [providers] -> ProviderManager (+ sets it on Config)
      - new Config(configParams)                      [core]      -> configParams from AgentConfig
      - await config.initialize({ messageBus })       [core]      -> tools, MCP, extensions, scheduler
      - await config.refreshAuth(authType)            [core]      -> auth as data
      - createAgentRuntimeState({ provider, model })  [core]      -> runtime state
      - AgentClient (config-owned via factory)        [agents]    -> single-turn primitive
      - new AgenticLoop({ agentClient, config, bus }) [agents]    -> multi-turn loop
            -> Agent facade wraps the loop + control-plane methods

### Boundaries the API enforces

1. **Clients depend only on `@vybestack/llxprt-code-agents`** to run the agent. No client reaches into `core`/`providers`/`tools` internals to run a turn, switch a provider, approve a tool, or compress history. (This is #1595's acceptance gate.)
2. **`core` stays UI- and client-agnostic** and remains the home of shared types/contracts (`Config`, `AgentClientContract`, the event types in `core/turn.ts`, runtime contracts). Its 664-line barrel is trimmed to those.
3. **`providers` owns provider/profile/auth composition**; `agents` consumes it via `createHeadlessProviderManager` and the `registerAgentRuntimeFactories` inversion seam (no `providers -> agents` cycle).
4. **The Agent facade is the only public orchestration surface.** It delegates to `AgenticLoop` (turns/tools), `ProviderManager` (provider/model), and `Config` (settings/history/compression), and does **not** re-expose those objects raw — so internals can change without breaking clients.
5. **Power users** who genuinely need an internal get it from a **documented sub-path** (`@vybestack/llxprt-code-providers/composition.js`, `…/runtime.js`, `…/auth.js`, `…-core/runtime/...`), never from the default agent entry.

### Scope of #1594 (what is actually built here)

The remaining work is real but bounded:

1. The `AgentConfig -> ConfigParameters` translation + the bootstrap composition above.
2. A **stable, typed, complete public event stream** mapped from `AgenticLoopEvent` / `ServerGeminiStreamEvent` — this is the top correctness risk (every internal `GeminiEventType` variant is either projected to a public event or explicitly collapsed).
3. The **control-plane methods** that let #1595 drive provider/model/param switching, tool/MCP management, approval response, history/session + compression, and side-channel generation **without deep imports**.

### Sizing decision

The API is designed as a **full control plane** (option B), not a minimal send-and-stream façade. A review of the actual CLI wiring shows the CLI does live provider/model switching, tool confirmation UI, OAuth, history restore/checkpoint, compression, side-channel generation, todo continuation, and a much richer event stream. A minimal façade would force #1595 to bypass the API and import internals anyway, defeating the purpose. A plain script still gets the simple path for free (just `createAgent` + `stream`).

### Test-first spine

The plan builds a **CLI-touchpoint test harness** first: behavioral integration tests that exercise the public API through the same touchpoints the CLI will use (against the real `FakeProvider`, no mock theater). These are written before `createAgent`/`Agent` exist, fail naturally, and become the executable definition of "the API is sufficient for the CLI." If a touchpoint can't be expressed through the public surface, the design — not the test — is wrong.

### Open items needing a maintainer decision

- Confirm the entry-package wording ruling (`@vybestack/llxprt-code-agents`, amend issue/#1595 text).
- Confirm the full control plane (provider/model/tool/auth/profile/session) is in-scope for #1594 so #1595 is a pure UI rewrite.
- Confirm which sub-surfaces (`agent.mcp`, `agent.ide`, `agent.session`, `agent.hooks`, `agent.profiles`, `agent.auth.*`) are public methods vs. documented power-user subpaths.
- Confirm `core/index.ts` trim sequencing (recommended: trim as the tail step of #1595, after consumers migrate — not a back-compat shim).

Full detail, the typed `Agent`/`AgentConfig`/`AgentEvent` surface, the event-mapping table, and the harness rows are in `project-plans/issue1594/overview.md`.
