<!-- @plan:PLAN-20260621-COREAPIREMED @requirement:REQ-001..REQ-007,REQ-INT-001..REQ-INT-004 -->
# Feature Specification: Core Public Agent API Remediation (enable #1595)

Plan ID: `PLAN-20260621-COREAPIREMED`
Generated: 2026-06-21
Predecessor: `PLAN-20260617-COREAPI` (issue #1594, shipped via PR #2108 — `createAgent`/`Agent`
public surface in `packages/agents`, all 59 phases complete, currently green).
Scope of THIS plan: close the gaps that block issue #1595 ("Refactor CLI to consume core API").

---

## Purpose

The #1594 deliverable shipped a `createAgent(AgentConfig): Promise<Agent>` facade and an
`AgentEvent` stream from `@vybestack/llxprt-code-agents`. An architecture evaluation against
issue #1595's acceptance criteria found the shipped surface is **necessary but not yet
sufficient** to make the CLI a thin UI on top of the public agent API. This plan makes the
public surface **adequate for #1595** without breaking any existing #1594 consumer.

**#1595 (the consumer this plan enables) requires** (verbatim acceptance criteria, from
`gh issue view 1595`):

1. CLI imports only the public core API (no deep imports).
2. The CLI entry point (`gemini.tsx` in the issue text; the actual current entry is
   `packages/cli/src/cli.tsx` plus the Ink root) is under 200 lines.
3. The CLI could theoretically be replaced with a different UI using the same core API.
4. All existing CLI features work.
5. All CLI tests pass.

This remediation plan does **NOT** rewrite the CLI (that is #1595's job). It makes the public
API surface adequate and provides the executable integration seam/contract — proven by a
CLI-parity harness — so that #1595 can route CLI turns through the public `Agent` and stop
deep-importing core/agents internals.

### Why the shipped surface is inadequate (evidence, current post-merge source)

| Gap | Evidence (file:line, verified) | Why it blocks #1595 |
|---|---|---|
| **C1 — No Config-injection seam** | `packages/agents/src/api/createAgent.ts:71` `export async function createAgent(rawConfig: AgentConfig)`; line 128 `const config = new Config(params)` is the sole construction. `AgentConfig` (`config-types.ts:139`) has NO `config` field; no `fromConfig` export (`api/index.ts` exports only `createAgent`). | The CLI already builds a fully-loaded `Config` via `loadCliConfig` (`packages/cli/src/config/config.ts:242`). There is no way to hand that existing `Config` to the agent, so #1595 cannot reuse the CLI's bootstrap; it would have to double-build Config. |
| **C2 — Agent facade omits Config/settings surface** | `packages/agents/src/api/agent.ts:321` `interface Agent` exposes NONE of `getConfig`/`getEphemeralSetting`/`setEphemeralSetting`/`getEphemeralSettings`. Ephemeral settings are defined in `packages/core/src/config/configBase.ts:173/191/265`. ~97 `getEphemeralSetting` + ~41 `setEphemeralSetting` non-test call sites across `packages/cli/src` + `packages/core/src`. | For the CLI to stop deep-importing core, the public `Agent` must expose an adequate, typed settings/config surface. Today every settings read/write forces a deep import of `Config`. |
| **C3 — CLI turn pipeline does not route through `agent.stream()`/`agent.chat()`** | `packages/cli/src` has ZERO `agent.stream(`/`agent.chat(`. Turns are driven by `useAgenticLoop` (`packages/cli/src/ui/hooks/geminiStream/useAgenticLoop.ts:254`) constructing `new AgenticLoop({ agentClient: args.agentClient, config: args.config, messageBus: args.messageBus ?? new MessageBus(), interactiveMode: args.interactiveMode ?? false, approvalHandler: args.approvalHandler, displayCallbacks })` (OBJECT-FORM options; `AgenticLoop` constructor is `constructor(options: AgenticLoopOptions)` at `packages/agents/src/core/agenticLoop/AgenticLoop.ts:182`). `args.agentClient` is an `AgentClientContract` threaded from `config.getAgentClient()` at `useAppInput.ts:331` via `useGeminiStream` → `useGeminiStreamOrchestration`. | #1595 must route CLI turns through the public `Agent` (so the UI is replaceable). The public surface + adapter seam must exist and be proven equivalent to the current `AgenticLoop` drive. |
| **H1 — No client CONTRACT on the curated public boundary** | The concrete `AgentClient` class is exported from `packages/agents/src/internals.ts:38` (`export { AgentClient, PostTurnAction } from './core/client.js'`). The package ROOT (`packages/agents/src/index.ts:26-27`) already re-exports BOTH barrels (`export * from './internals.js'` AND `export * from './api/index.js'`), so the root transitively re-exposes the `AgentClient` CLASS today (it is NOT absent from the root). What is missing is the structural client CONTRACT `AgentClientContract` on the CURATED API barrel `packages/agents/src/api/index.ts` (verified ABSENT there) — that barrel is the boundary #1595 should import from and the one that survives #1595's eventual internals trim. `AgentClientContract` itself is core-owned: `packages/core/src/core/clientContract.ts:67`, imported by agents at `packages/agents/src/core/agenticLoop/types.ts:27`. | #1595 needs a decided public CONTRACT on the curated API barrel so it can type-reference the client surface without deep-importing `./core/client.js`, `./internals.js`, or core internals — and without depending on the low-level class re-export that the #1595 trim will remove from the root. |
| **H2 — Provider runtime is CLI-orchestrated** | `packages/cli/src/config/profileBootstrap.ts:413` `createProviderManager(...)` + `prepareRuntimeForProfile` (`profileBootstrap.ts:380`) assemble the provider/OAuth runtime in the CLI. | Provider runtime must be reachable through the public API so #1595 does not assemble it by hand. |
| **H3 — `getCurrentSequenceModel` is a stub** | `packages/agents/src/api/agentImpl.ts:668-670` literally `getCurrentSequenceModel(): string | null { return null; }`. The real value lives on `AgentClient.getCurrentSequenceModel()` (`AgentClientContract` member, `packages/core/src/core/clientContract.ts:118`). CLI consumers use the pattern `getCurrentSequenceModel() ?? config.getModel()` (e.g. `useGeminiStreamLifecycle.ts`). | A stub returning `null` silently degrades load-balancer sticky-model behavior when the CLI routes through the public agent. Must delegate to the bound client for real. |

**Adequate (do NOT re-plan):** the 19-variant `AgentEvent` union covers all 17 `GeminiEventType`
members and was judged sufficient by the evaluation. This plan builds on it; it does not
redesign the event system.

---

## Architectural Decisions

- **Pattern**: Facade + Adapter. `Agent` is the public facade over shipped primitives
  (`Config`, `AgentClient`, `AgenticLoop`, providers runtime, `MessageBus`). This plan ADDS a
  Config-injection seam (an adapter from an existing `Config` to the agent's internal bootstrap),
  a typed settings projection on the facade, a promoted client contract, and a CLI-parity
  integration harness.
- **Non-breaking additive surface (HARD CONSTRAINT)**: every existing entry point keeps working.
  `createAgent(AgentConfig)` keeps its exact signature and behavior. New capability is added
  ADDITIVELY: a new `fromConfig` entry (NOT an overload that changes `createAgent`'s type), new
  optional facade methods, new promoted exports. Backed by characterization tests pinned in a
  RED harness phase.
- **Config-injection via the providers seam (one NEW providers field required — CRIT-1)**:
  `IsolatedRuntimeContextOptions` ALREADY accepts `config?: Config` (verified
  `runtimeContextFactory.ts:187`) and `messageBus?: MessageBus` (verified `:199`, adopted at
  `:482-484`). It does NOT, however, accept a `providerManager?` — the factory constructs a
  `ProviderManager` UNCONDITIONALLY (verified: `const providerManager = new ProviderManager({...})`
  — anchor by grep `new ProviderManager(`, ~`runtimeContextFactory.ts:502`; line approximate since
  P03/P05 mutate this file — with no `options.providerManager ??` fallback). Therefore the
  "no second `ProviderManager`" invariant (REQ-001.2 / REQ-005.2) is **infeasible** with the
  shipped providers surface. **Decision (Option A, chosen for true single-manager adequacy for
  #1595)**: this plan ADDS one additive, optional field `providerManager?: RuntimeProviderManager`
  to `IsolatedRuntimeContextOptions` and adopts it via `options.providerManager ?? new ProviderManager(...)`,
  mirroring the existing `messageBus?` pattern. This is a small `packages/providers` change with
  its own stub/TDD/impl/verification phases (P03–P05a). `fromConfig` then derives the manager from
  the adopted `Config` via `Config.getProviderManager()` (verified
  `packages/core/src/config/configBaseCore.ts:265`) and passes it in, so NO second manager is
  built. The `SettingsService` is adopted via the already-existing `options.config?.getSettingsService()`
  path; the `MessageBus` is adopted by forwarding a caller-supplied `messageBus` (see next bullet).
  `createAgent` is unchanged — it omits `providerManager`, so the factory still constructs one
  exactly as today (non-breaking).
  - **TYPE DECISION (CRIT-1 — type-safe, zero-assertion).** The new option is typed as the
    CORE STRUCTURAL interface `RuntimeProviderManager`, **NOT** the concrete providers
    `ProviderManager` class. This is REQUIRED for a type-safe adoption path under this plan's
    no-`any`/no-unsafe-assertion rule, because `Config.getProviderManager()` returns
    `RuntimeProviderManager | undefined` (configBaseCore.ts:265) while the concrete class declares
    only `implements IProviderManager` (NOT `implements RuntimeProviderManager`, verified
    `packages/providers/src/ProviderManager.ts:80`). Typing the option as the concrete class would
    force `fromConfig` to write `config.getProviderManager() as ProviderManager` — an unsafe cast.
    Typing it as the structural interface lets `fromConfig` pass `config.getProviderManager()`
    DIRECTLY with ZERO assertion (`RuntimeProviderManager | undefined` → `providerManager?:
    RuntimeProviderManager`, `undefined` ⇒ factory builds one). The default
    `new ProviderManager(...)` structurally satisfies the interface, so the unconditional default
    path is unchanged. To keep the resolved local assignable wherever it flows, P05 also widens the
    factory's INTERNAL manager types (handle field, activate/cleanup closures, prepare/onCleanup
    contexts, and the `RuntimeActivationBindings.registerInfrastructure`/`linkProviderManager`
    params) to `RuntimeProviderManager`; this matches the CLI binding implementations, which are
    ALREADY typed `RuntimeProviderManager` (`registerCliProviderInfrastructure` runtimeLifecycle.ts:91-92,
    `configureProviderRuntimeFactories` providerManagerInstance.ts:173-176). Every member the factory
    invokes on the manager (`setConfig`, `listProviders`, `getProviderByName`, `registerProvider`,
    `setActiveProvider`, `getActiveProvider`, plus the `.runtime` field set via the pre-existing
    `as unknown as {...}` cast) is a `RuntimeProviderManager` member, so NO concrete-only member is
    needed and NO new `any`/`as` is introduced. The no-`any`/no-unsafe-`as`-on-this-path rule is a
    grep-enforced gate in P05/P05a and P09/P09a.
- **Shared MessageBus handoff (CRIT-2 — no Config.getMessageBus())**: `Config` exposes NO
  `getMessageBus()` accessor (verified: `packages/core/src/config/config.ts` only CONSUMES a bus
  via `initialize({ messageBus? })`; there is no getter). The shared bus therefore CANNOT be read
  back off the `Config`. Instead, `FromConfigOptions` carries an optional `messageBus?: MessageBus`
  that the caller (#1595, which already holds the CLI's `MessageBus`) supplies; `fromConfig`
  forwards it into the EXISTING `createIsolatedRuntimeContext({ ..., messageBus })` seam
  (`runtimeContextFactory.ts:199`, adopted at `:482-484`). When omitted, `fromConfig` builds ONE
  bus from `config.getPolicyEngine()` exactly as `createAgent` does — never a second divergent bus.
  The "no second MessageBus" guarantee (REQ-001.2) is thus only as strong as the caller passing the
  shared bus; the spec/tests assert exactly that (adoption of the supplied bus), not a
  read-it-off-Config claim that the source cannot support.
- **Settings surface is a TYPED PROJECTION, not a Config dump**: the facade exposes
  `getEphemeralSetting(key)` / `setEphemeralSetting(key, value)` / `getEphemeralSettings()`
  with a documented key contract, plus a narrow read-only `getConfig()` accessor returning the
  public `Config` type that core already exports. We do NOT invent a parallel settings store;
  we delegate to the bound `Config` (single source of truth, `configBase.ts`).
- **Client contract promotion (CRIT-3 — curated API barrel is the boundary)**: promote client
  TYPE access via a decided public contract. The existing core-owned `AgentClientContract` (a stable
  structural interface, `clientContract.ts:67`, already imported by agents at
  `core/agenticLoop/types.ts:27`) is re-exported TYPE-ONLY from the CURATED API barrel
  `packages/agents/src/api/index.ts` — the barrel #1595 imports from and the one that survives the
  eventual #1595 internals trim. Because the package root (`index.ts:26-27`) already does
  `export * from './api/index.js'`, the contract also becomes reachable from the root transitively,
  WITHOUT adding a separate root edit. The concrete `AgentClient` class remains exported from
  `./internals.js` (power-user subpath); we acknowledge the root ALSO re-exposes that class today via
  `export * from './internals.js'` — that low-level re-export is owned/trimmed by #1595 and is NOT a
  guaranteed-stable part of this plan's promoted surface. This plan's stable promise (REQ-004) is the
  CONTRACT on the curated API barrel, not the class at the root.
- **Provider-runtime reachability**: expose, through the public agents API, a documented way to
  reach the provider/runtime that the agent owns (read-only status + the runtime handle the agent
  already holds), so #1595 does not re-assemble it. We surface accessors on the facade
  (`getProviderManager` is NOT exposed raw; instead the existing DIRECT provider/model methods
  `agent.getProvider()`/`agent.getProviderStatus()`/`agent.getModel()` and the `auth` sub-surface
  already cover control; we add a read-only `getRuntimeId()` + confirm those direct methods are
  adequate) and keep the assembly inside `fromConfig`/`createAgent`.
- **getCurrentSequenceModel real implementation**: delegate to the bound client via the existing
  `resolveClient()` closure the impl already holds, returning
  `client.getCurrentSequenceModel()` (string | null) — matching `AgentClientContract:118`.
- **Schema-first (Zod)** and **strict TypeScript** (NO `any`, NO type assertions, explicit return
  types) per RULES.md — consistent with #1594 house style.
- **Comment discipline (N5)**: production code carries ONLY `@plan`/`@requirement`/`@pseudocode`
  marker blocks; no explanatory prose comments.

---

## Project Structure

> **Reconciliation with the "UPDATE existing files; no parallel/V2 versions" mandate (CRIT-4):**
> `fromConfig.ts` is created as a NEW file, which is permitted here because `fromConfig` is a
> NET-NEW public entrypoint — NOT a `createAgentV2` / parallel reimplementation of `createAgent`.
> The non-negotiable constraint is that there is EXACTLY ONE createAgent-assembly/finalize code
> path: `createAgent.ts` extracts its assembly/finalize sequence (today `finalizeAgent` →
> `assembleFacade`, `createAgent.ts:210`/`:327`) into a SHARED internal, and BOTH `createAgent` and
> `fromConfig` delegate to it. `fromConfig` MUST NOT copy-paste runtime-state build, loop
> construction, facade assembly, or SessionStart (those stay inside the shared `finalizeAgent`/
> `assembleFacade`). P09 enforces this with a no-duplication grep guard.


```
packages/agents/src/api/
  createAgent.ts          # MODIFY: extract/share the bootstrap finalize/assembly helper(s)
                          #   (finalizeAgent/assembleFacade) that fromConfig reuses — does NOT
                          #   itself add fromConfig().
  fromConfig.ts           # CREATE: public fromConfig entry (adopts caller Config).
  config-types.ts         # MODIFY: add FromConfigOptions type (config-injection input),
                          #   including the optional messageBus? field (CRIT-2).
  agent.ts                # MODIFY: add settings/config projection to the Agent interface.
  agentImpl.ts            # MODIFY: implement getEphemeralSetting/setEphemeralSetting/
                          #   getEphemeralSettings/getConfig + real getCurrentSequenceModel.
  agentBootstrap.ts       # MODIFY: factor out adoptExternalConfig path (shared finalize).
  index.ts                # MODIFY (curated API barrel): fromConfig is already exported via
                          #   createAgent.ts re-export; ADD type-only re-export of
                          #   AgentClientContract (CRIT-3). This barrel is #1595's boundary.
  __tests__/
    config-injection.spec.ts       # CREATE: fromConfig adopts external Config (parity).
    settings-surface.spec.ts       # CREATE: ephemeral get/set/getAll + getConfig behavior.
    sequence-model.spec.ts         # CREATE: getCurrentSequenceModel delegates to client.
    client-contract-export.spec.ts # CREATE: AgentClientContract reachable from the curated API
                          #   barrel (api/index.ts) — and transitively from the root via export *.
    cli-turn-parity.spec.ts        # CREATE: agent.stream() parity with useAgenticLoop drive.
    non-breaking-characterization.spec.ts # CREATE: pins existing createAgent behavior.
packages/agents/src/internals.ts   # CONFIRM (no change): keeps the AgentClient class export.
packages/agents/src/index.ts       # CONFIRM (no change): root already re-exports BOTH barrels
                                   #   (export * from './internals.js' + './api/index.js'), so the
                                   #   promoted contract reaches the root transitively. No root edit.
packages/providers/src/runtime/runtimeContextFactory.ts  # MODIFY (CRIT-1, P03-P05): add optional
                                   #   providerManager? to IsolatedRuntimeContextOptions and adopt
                                   #   it (`options.providerManager ?? new ProviderManager(...)`).
docs/agent-api.md                  # MODIFY: document config-injection, settings surface,
                                   #   client contract, provider-runtime reachability, #1595 map.
```

No `V2`/`New`/`Copy` files. Every change UPDATES an existing file or adds a clearly-scoped new
file in the established `api/` layout.

---

## Technical Environment

- **Type**: Library (public API package `@vybestack/llxprt-code-agents`).
- **Runtime**: Node.js 20.x (monorepo workspaces; TypeScript strict; ESM).
- **Dependencies** (all already present; verified in Phase 00a): `zod`, `fast-check`,
  `@stryker-mutator/core` (declared `^9.6.1` in `packages/agents/package.json`, added by #1594's
  quality gate; its absence is a BLOCKING regression, not an expected state), `vitest`.
- **Build/verify**: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run format`,
  `npm run build`; smoke `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`.

---

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature (the consumers — #1595)

These specific files are the integration targets. They are NOT modified by THIS plan (that is
#1595), but this plan's CLI-parity harness proves the seam each will use, and the docs map each:

- `packages/cli/src/config/config.ts` (`loadCliConfig`, line 242) — produces the `Config` that
  `fromConfig({ config })` will adopt (C1 consumer).
- `packages/cli/src/cli.tsx` (line 538 `const config = await loadCliConfig(...)`) — the entry that
  will call `fromConfig(config)` then hand the `Agent` to the UI (#1595 AC2).
- `packages/cli/src/ui/hooks/geminiStream/useAgenticLoop.ts` (line 254) and
  `useGeminiStreamOrchestration.ts` — today construct `new AgenticLoop({ agentClient, config,
  messageBus, interactiveMode, approvalHandler, displayCallbacks })` (object-form options) with
  `args.agentClient` (an `AgentClientContract` sourced from `config.getAgentClient()` at
  `useAppInput.ts:331`); #1595 will replace this with `agent.stream()` (C3 consumer; proven
  by `cli-turn-parity.spec.ts`).
- The ~97 `getEphemeralSetting` / ~41 `setEphemeralSetting` call sites in `packages/cli/src` —
  will read/write through `agent.getEphemeralSetting`/`setEphemeralSetting` (C2 consumer).
- `packages/cli/src/config/profileBootstrap.ts` (`prepareRuntimeForProfile`, line 380;
  `createProviderManager`, line 413) — provider-runtime assembly that `fromConfig` makes reachable
  through the agent (H2 consumer).
- `packages/cli/src/ui/hooks/geminiStream/useGeminiStreamLifecycle.ts` and consumers using
  `getCurrentSequenceModel() ?? config.getModel()` — will get a real value through the public
  agent (H3 consumer).

### Existing Code To Be Replaced / Removed (by #1595, enabled here)

- **Direct `new AgenticLoop({ ... })` construction in the CLI** (`useAgenticLoop.ts:254`,
  object-form options) → replaced by `agent.stream()`/`agent.chat()` routing. THIS plan provides
  the parity contract; it does not delete the CLI code.
- **Deep imports of `@vybestack/llxprt-code-core` config internals for settings** in CLI → replaced
  by `agent.getEphemeralSetting`/`setEphemeralSetting`/`getConfig`.
- **Deep import of `@vybestack/llxprt-code-agents/internals.js` for `AgentClient`** where only the
  contract is needed → replaced by `AgentClientContract` from the curated API barrel
  `@vybestack/llxprt-code-agents` (api/index.ts; also reachable transitively from the root).
- Within THIS plan, the `getCurrentSequenceModel` STUB (`agentImpl.ts:669`) IS removed/replaced by
  a real delegating implementation.

### User Access Points

- API: `createAgent(AgentConfig)` (unchanged) and new `fromConfig({ config, ... })`, both from
  `@vybestack/llxprt-code-agents`.
- API: `agent.getEphemeralSetting(key)`, `agent.setEphemeralSetting(key, value)`,
  `agent.getEphemeralSettings()`, `agent.getConfig()`, `agent.getCurrentSequenceModel()`.
- API: `AgentClientContract` type from the curated API barrel `@vybestack/llxprt-code-agents`
  (api/index.ts; also reachable transitively from the package root via `export *`).
- CLI (downstream, #1595): users reach all of this transitively when #1595 routes the CLI through
  the public agent. No new end-user command is added by THIS plan.

### Migration Requirements

- **No data migration.** This is an additive API surface change.
- **Consumer migration (documented, executed by #1595)**: a command-to-API + import-migration map
  in `docs/agent-api.md` enumerates which CLI deep imports map to which new public surface.
- **Behavior migration**: `getCurrentSequenceModel` changes from always-`null` to the real
  client value. This is a behavior FIX (the stub was wrong); characterization tests assert the
  new correct behavior and confirm no current #1594 consumer relied on the `null`.

---

## Formal Requirements

> Each REQ has full text + GIVEN/WHEN/THEN behavior. Integration requirements are `REQ-INT-00N`.

[REQ-001] Config-injection seam (`fromConfig`)
  **Full Text**: The agents package MUST provide a public `fromConfig` entry that builds a ready
  `Agent` by ADOPTING a caller-supplied, already-constructed `Config` (and the `SettingsService`
  reachable from it, the `ProviderManager` reachable from it, and a caller-supplied shared
  `MessageBus`) instead of constructing a new `Config`. The existing `createAgent(AgentConfig)`
  signature and behavior MUST remain unchanged.
  - GIVEN: a caller (the CLI) has a fully-loaded `Config` from `loadCliConfig` and the shared
    `MessageBus` it already holds
  - WHEN: they call `fromConfig({ config, messageBus?, onApproval?, onOAuthPrompt?,
    editorCallbacks?, toolSchedulerFactory? })`
  - THEN: an `Agent` is returned whose `getConfig()` is the SAME `Config` instance, sharing the
    SAME `SettingsService` (via `config.getSettingsService()`) and the SAME `ProviderManager`
    (via `config.getProviderManager()`, adopted through the providers `providerManager?` seam), and
    using the caller-supplied `MessageBus` when provided — with NO second `Config` constructed.
  [REQ-001.1] `fromConfig` reuses the same finalize path as `createAgent` (runtime state, client
    bind post-auth, loop build, ownership, SessionStart hook).
  [REQ-001.2] `fromConfig` does NOT construct a new `Config` or `SettingsService`; it does NOT
    construct a second `ProviderManager` when the supplied `Config` exposes one (via
    `config.getProviderManager()`, forwarded into the providers `providerManager?` adoption seam);
    and it adopts the caller-supplied `MessageBus` (forwarded into the existing `messageBus?` seam)
    rather than constructing a second bus. When the caller supplies no `messageBus` and/or the
    `Config` exposes no `ProviderManager`, `fromConfig` builds exactly ONE of the missing item for
    that runtime (as `createAgent` does today) — still never a duplicate of one already supplied.
  [REQ-001.3] Ownership: a `Config` supplied to `fromConfig` is NOT disposed by `Agent.dispose()`
    (caller-owned); Agent-created resources (loop, scheduler instances, subscriptions) ARE. A
    caller-supplied `MessageBus`/`ProviderManager` is likewise caller-owned and not force-disposed.

[REQ-002] Agent settings/config projection
  **Full Text**: The public `Agent` interface MUST expose a typed settings/config surface
  adequate for the CLI to stop deep-importing core for settings: `getEphemeralSetting(key:
  string): unknown`, `setEphemeralSetting(key: string, value: unknown): void`,
  `getEphemeralSettings(): Readonly<Record<string, unknown>>`, and a read-only `getConfig():
  Config` accessor returning the core-exported `Config` type.
  - GIVEN: an `Agent`
  - WHEN: a consumer calls `agent.setEphemeralSetting('context-limit', 1000)` then
    `agent.getEphemeralSetting('context-limit')`
  - THEN: the value round-trips through the bound `Config` (single source of truth) with the same
    normalization `Config.setEphemeralSetting`/`getEphemeralSetting` apply.
  [REQ-002.1] `getEphemeralSettings()` returns the full ephemeral map identical to
    `config.getEphemeralSettings()`.
  [REQ-002.2] `getConfig()` returns the exact bound `Config` instance (identity).
  [REQ-002.3] The surface delegates to `Config`; it does NOT maintain a parallel store.

[REQ-003] Real `getCurrentSequenceModel`
  **Full Text**: `Agent.getCurrentSequenceModel()` MUST return the current load-balancer sticky
  sequence model from the bound `AgentClient` (`AgentClientContract.getCurrentSequenceModel()`),
  returning `null` only when the client legitimately has none.
  - GIVEN: an `Agent` whose bound client has a current sequence model `"gpt-4o"`
  - WHEN: `agent.getCurrentSequenceModel()` is called
  - THEN: it returns `"gpt-4o"` (NOT an unconditional `null`)
  [REQ-003.1] When the client returns `null`, the agent returns `null` (no fabrication).
  [REQ-003.2] After a provider/model switch (client rebind), the value reflects the NEW bound
    client.

[REQ-004] Public client contract promotion
  **Full Text**: The agents CURATED API barrel `packages/agents/src/api/index.ts` MUST re-export
  `AgentClientContract` (the structural client contract) TYPE-ONLY so consumers can type-reference
  the client surface from `@vybestack/llxprt-code-agents` without deep-importing `./core/client.js`,
  `./internals.js`, or core internals. The contract is core-owned
  (`@vybestack/llxprt-code-core/core/clientContract.ts:67`) and is re-exported (not redefined). The
  concrete `AgentClient` class remains exported from `./internals.js` (power-user subpath). The
  package ROOT already re-exports both barrels (`index.ts:26-27`), so the promoted contract is also
  reachable from the root transitively; no separate root edit is required, and the plan does NOT
  claim the root's existing low-level `AgentClient` class re-export (via `export * from
  './internals.js'`) as part of this promoted stable surface (#1595 owns trimming that).
  - GIVEN: a consumer importing from `@vybestack/llxprt-code-agents`
  - WHEN: they reference `AgentClientContract`
  - THEN: it resolves (via the curated API barrel, transitively from the root) with the same shape
    as `@vybestack/llxprt-code-core/core/clientContract.ts`.
  [REQ-004.1] `AgentClient` (concrete class) stays exported from `./internals.js` (non-breaking).
  [REQ-004.2] The contract is exported TYPE-ONLY (`export type`), with no runtime value named
    `AgentClientContract` added to the API barrel (erasable, zero runtime cost).

  **H1 Acceptance Interpretation (CRIT-5) — explicit and grounded.** The original H1 wording names
  BOTH `AgentClient` and `AgentClientContract`; this is the decided, justified reading of what H1
  closure requires (so the gap is NOT silently narrowed):
  - (a) The #1595-relevant STABLE need is the TYPE-ONLY `AgentClientContract` on the CURATED API
    barrel (`packages/agents/src/api/index.ts`). Consumers depend on the CONTRACT (the structural
    surface they type-reference), NOT on the concrete implementation class. Promoting the contract
    is therefore the load-bearing deliverable for H1/REQ-004.
  - (b) The concrete `AgentClient` CLASS remains available via `./internals.js`
    (`packages/agents/src/internals.ts:38`) AND is ALREADY reachable through the existing package
    ROOT re-export (`packages/agents/src/index.ts:26` `export * from './internals.js'`). So the
    class is NOT absent today and this plan introduces NO regression for any existing consumer that
    imports the class from the root — non-breaking is preserved.
  - (c) The plan DELIBERATELY does NOT add the concrete `AgentClient` class to the curated API
    barrel. Coupling public/curated consumers to an internal implementation class would undermine
    the purpose of the curated boundary (#1595 will eventually trim the root's low-level
    `./internals.js` re-export; the curated barrel must NOT depend on that trimmable surface). The
    curated boundary stays contract-only by design.
  This interpretation is defensible precisely because the root re-export already exposes the class
  today: H1 closure does NOT need the class re-promoted onto the curated barrel — it needs the
  CONTRACT decided on the curated barrel. The final-evaluation phase (P24) MUST evaluate H1 closure
  against THIS acceptance (contract promoted on curated API + class still reachable via internals/root
  + class intentionally absent from the curated barrel), so the H1 verdict is unambiguous.

[REQ-005] Provider-runtime reachability through the public API
  **Full Text**: The public `Agent` MUST make its provider runtime reachable without the consumer
  re-assembling it: expose `getRuntimeId(): string` and confirm the DIRECT provider/model methods
  (`agent.getProvider()`/`agent.getProviderStatus()`/`agent.getModel()`/`agent.setProvider()`) and
  the `agent.auth.*` sub-surface cover provider/model/auth control. `fromConfig` MUST adopt the
  provider runtime reachable from the supplied `Config` rather than building a new one.
  - GIVEN: an `Agent` built via `fromConfig({ config })` where `config.getProviderManager()`
    returns a manager
  - WHEN: a consumer queries provider/model state and `getRuntimeId()`
  - THEN: the values reflect the adopted runtime; no second `ProviderManager` is constructed
    (the manager from `config.getProviderManager()` is adopted via the providers `providerManager?`
    seam, P03–P05).
  [REQ-005.1] `getRuntimeId()` equals the runtime-context `runtimeId` bound at build time.
  [REQ-005.2] `agent.getProvider()`/`agent.getModel()` reflect the adopted runtime, and the
    `ProviderManager` reachable post-build is the SAME instance returned by
    `config.getProviderManager()` (when the Config exposes one); the factory constructs a manager
    ONLY when none is supplied.
  [REQ-005.3] (CRIT-1 type-safety) The providers adoption seam option is typed as the CORE
    STRUCTURAL interface `RuntimeProviderManager` (NOT the concrete `ProviderManager` class), so
    `fromConfig` passes `config.getProviderManager()` (`RuntimeProviderManager | undefined`,
    configBaseCore.ts:265) into it with ZERO assertion — no `any`, no `as ProviderManager`, no
    `as unknown as ...`. The default `new ProviderManager(...)` structurally satisfies the
    interface. This no-`any`/no-unsafe-`as`-on-the-adoption-path rule is a grep-enforced gate in
    P05/P05a and P09/P09a.

[REQ-006] Non-breaking guarantee (characterization)
  **Full Text**: All existing #1594 public API behavior MUST remain unchanged: `createAgent`
  signature/return, `agent.stream()`/`agent.chat()` semantics, exactly-one-`done`, the existing
  direct provider/model methods (`agent.getProvider()`/`getModel()`/`getProviderStatus()`) and the
  `agent.profiles/tools/mcp/auth/ide/session/hooks` sub-surfaces, and current root + `./internals.js`
  exports.
  - GIVEN: the existing #1594 harness and any current consumer
  - WHEN: this plan's changes are applied
  - THEN: every existing test still passes and the existing public exports are still present.
  [REQ-006.1] No existing export is removed or renamed (additive only).
  [REQ-006.2] `createAgent(AgentConfig)` keeps building its own `Config` (unchanged path).

[REQ-007] Documentation (docs/agent-api.md)
  **Full Text**: `docs/agent-api.md` MUST document the config-injection seam (`fromConfig`), the
  settings/config projection, the promoted `AgentClientContract`, provider-runtime reachability,
  the real `getCurrentSequenceModel`, and a #1595 command-to-API + import-migration map.
  - GIVEN: a #1595 implementer
  - WHEN: they read docs/agent-api.md
  - THEN: they can map each current CLI deep import / settings call / turn drive to the public
    surface this plan provides.

[REQ-INT-001] CLI Config adoption (C1 integration)
  **Full Text**: A CLI-parity integration test MUST prove that an `Agent` built via `fromConfig`
  from a CLI-style pre-built `Config` behaves identically (same `Config`, same settings, same
  client binding) to one the CLI would build today.
  - GIVEN: a `Config` built the way `loadCliConfig` builds it (real, not mocked)
  - WHEN: `fromConfig({ config })` is used to build an `Agent`
  - THEN: `agent.getConfig() === config` and a turn streams correctly.

[REQ-INT-002] CLI turn-drive parity (C3 integration)
  **Full Text**: A CLI-parity integration test MUST prove that driving a turn via `agent.stream()`
  produces the same observable display/tool/finish behavior as the current `useAgenticLoop`
  direct-`AgenticLoop` drive, using a real `FakeProvider` JSONL fixture (no mock theater).
  - GIVEN: a fixed `FakeProvider` script with a tool call + final response
  - WHEN: the same script is driven once via `agent.stream()` and once via a reference
    `AgenticLoop` constructed as the CLI does today
  - THEN: the projected event/tool/finish sequences are equivalent (exactly one terminal `done`).

[REQ-INT-003] Settings call-site adequacy (C2 integration)
  **Full Text**: An integration test MUST demonstrate that the CLI's settings access patterns
  (the `getEphemeralSetting`/`setEphemeralSetting`/`getEphemeralSettings` shapes used across
  `packages/cli/src`) are fully serviceable through the public `Agent` surface (delegating to the
  bound `Config`), with normalization parity for the special keys (`streaming`, `context-limit`).
  - GIVEN: representative CLI settings keys (`streaming`, `context-limit`, a plain key)
  - WHEN: read/written through `agent.*` vs directly through `config.*`
  - THEN: results match (including normalization side effects).

[REQ-INT-004] No-deep-import boundary for the new surface (Path A vs Path B)
  **Full Text**: A static boundary test MUST assert the test-only-vs-production import boundary.
  Path A — the PUBLIC-AGENT path under test (`createAgent`/`fromConfig`/`agent.stream()`/
  `AgentClientContract`) AND the model for the eventual #1595 production CLI — MUST import the
  curated public ROOT `@vybestack/llxprt-code-agents` (plus documented NON-internals subpaths such
  as `/app-service.js`) ONLY: NEVER `./internals.js`, NEVER a deep `/src/` path. Path B — the
  reference drive (the CLI-today `AgenticLoop` comparison) — is TEST-ONLY and MAY import the
  reference `AgenticLoop` from the curated root or the documented `./internals.js` subpath SOLELY to
  build the current baseline; the reference drive is the ONLY permitted `./internals.js` consumer.
  Deep `/src/` paths are forbidden EVERYWHERE.
  - GIVEN: the parity harness sources, partitioned into Path A and Path B
  - WHEN: imports are scanned (AST/lint)
  - THEN: Path A imports only the curated public root + documented non-internals subpaths (no
    `./internals.js`, no deep `/src/`); Path B may additionally use `./internals.js` for the
    reference drive but never a deep `/src/` path.

---

## Data Schemas

```typescript
// Config-injection input (CREATE in config-types.ts).
// Strict: function-typed callback fields are accepted but NOT part of the Zod-validated body.
import { z } from 'zod';

export interface FromConfigOptions {
  readonly config: Config;                 // adopted, caller-owned (NOT disposed)
  readonly messageBus?: MessageBus;        // CRIT-2: caller-supplied SHARED bus (Config has no getter);
                                           //   forwarded into the existing createIsolatedRuntimeContext
                                           //   messageBus? seam. When omitted, fromConfig builds one
                                           //   from config.getPolicyEngine() (single bus, not a second).
  readonly onApproval?: ApprovalHandler;
  readonly onOAuthPrompt?: OAuthPromptHandler;
  readonly editorCallbacks?: EditorCallbacks;
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
  readonly sessionId?: string;             // defaults to config-derived runtimeId
}

// Validatable (non-callback, non-Config) portion only — for symmetry with AgentConfigSchema.
export const FromConfigValidatableSchema = z
  .object({ sessionId: z.string().optional() })
  .strict();
```

The settings surface reuses the existing `Config` shapes; no new schema is introduced for
ephemeral settings (single source of truth is `Config`).

## Example Data

```json
{
  "settingsRoundTrip": { "key": "context-limit", "write": "1000", "expectedRead": 1000 },
  "streamingNormalization": { "key": "streaming", "write": true, "expectedRead": "enabled" },
  "sequenceModel": { "clientReturns": "gpt-4o", "agentReturns": "gpt-4o" },
  "sequenceModelNull": { "clientReturns": null, "agentReturns": null }
}
```

## Constraints

- Strict TypeScript: NO `any`, NO type assertions, explicit return types.
- Additive-only public surface; no removal/rename of existing exports (REQ-006).
- No mock theater; integration tests use real `FakeProvider` JSONL fixtures.
- `fromConfig` MUST NOT construct a second `Config` or `SettingsService`. It MUST NOT construct a
  second `ProviderManager` when the supplied `Config` exposes one (adopt via the providers
  `providerManager?` seam), and MUST adopt a caller-supplied `MessageBus` rather than constructing
  a second one. `Config` has NO `getMessageBus()` accessor — the shared bus is supplied by the
  caller via `FromConfigOptions.messageBus`, never read off `Config`.
- Settings surface MUST delegate to the bound `Config` (no parallel store).
- `getCurrentSequenceModel` MUST delegate to the bound client (no fabrication).
- Mutation score ≥80% on changed implementation files; ≥30% property-based tests in TDD phases.
- Comment discipline N5 (markers only).
- Do NOT modify CLI production source (that is #1595). This plan modifies the agents package + docs
  AND adds one additive optional field (`providerManager?`) to `packages/providers`
  `IsolatedRuntimeContextOptions` (CRIT-1, P03–P05) — the single, scoped providers-layer change.

## Performance Requirements

- `fromConfig` adds no new heavyweight construction beyond adoption wiring (no second Config).
- Settings delegation is O(1) pass-through to `Config`.
