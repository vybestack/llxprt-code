# Independent Plan Review — Issue #1594 Core Public API

Verdict: **FAIL**

The plan is substantially stronger than a minimal façade plan: it recognizes the 21-event mapping risk, includes the CLI-touchpoint harness, covers context preservation, auth/profile precedence, and records several preflight corrections. However, it is **not yet executable as written**. There are blocking internal contradictions, stale phase instructions, incorrect assumptions about real code lifecycles, and several phases that cannot be dispatched safely to one subagent.

## BLOCKING issues

### B1 — AgenticLoop still caches the pre-switch AgentClient, contradicting the plan's rebinding invariant

**Location:**
- `project-plans/issue1594/specification.md:62-66`, `500-507` design invariant: Agent must never cache client and must rebind after switch/auth.
- `project-plans/issue1594/analysis/pseudocode/createAgent.md:151-157` constructs one `AgenticLoop` with `agentClient: client` and claims “by ref; re-resolved on switch”.
- `project-plans/issue1594/plan/15-impl-switch-context.md:50-57`, `82-89` says to “reattachPerTurnSubscriptions(resolveClient())” but does not say to recreate or update the loop.
- Real code: `packages/agents/src/core/agenticLoop/AgenticLoop.ts:162-186` stores `private readonly agentClient`; `AgenticLoop.ts:381-385` calls `this.agentClient.sendMessageStream(...)`.

**What is wrong:**
The plan assumes the loop can re-resolve the current client after provider/model/auth rebinding, but the shipped `AgenticLoop` does not. It captures the `agentClient` constructor argument in a readonly field. After `setProvider`, `setModel`, `profiles.apply`, or `auth.*` causes `Config.initializeContentGeneratorConfig()` / auth refresh to replace the config-owned client, `agent.stream()` will still drive the old client unless the facade reconstructs `AgenticLoop` or `AgenticLoop` is changed to accept a client resolver.

**Why it matters:**
This breaks the headline correctness risks: T4c client rebinding, T4d/T4e context-preserving switch, provider/model switching, auth changes, and any post-switch stream/chat. It also makes the “never cache AgentClient” promise false at the loop boundary.

**Concrete fix:**
Amend the design/plan/pseudocode before execution:
1. Choose one explicit mechanism:
   - preferred: `Agent` owns a `rebuildLoop()` operation after every client-rebinding mutation, disposes/tears down the prior loop/scheduler subscriptions, then constructs a new `AgenticLoop({ agentClient: config.getAgentClient(), ... })`; or
   - modify `AgenticLoop` itself to accept `resolveClient: () => AgentClientContract` and call it per `runTurn`.
2. Update `createAgent.md`, `switch-rebind.md`, P14, P15, P16, P23, and T4c/T13 assertions to cover loop rebinding/teardown explicitly.
3. Add a T4c assertion that after switch the next `AgenticLoop.run` uses the new client, not merely that `Agent.resolveClient()` returns it.

---

### B2 — `createAgent` pseudocode does not await async runtime activation and uses an unavailable/different MessageBus

**Location:**
- `project-plans/issue1594/analysis/pseudocode/createAgent.md:71-84`, `128-132` says `handle.activate()` without `await` and then initializes with `messageBus`.
- Real code: `packages/providers/src/runtime/runtimeContextFactory.ts:309-319` returns an async activation closure; `runtimeContextFactory.ts:472-479` creates a private `sessionMessageBus` for OAuthManager; `runtimeContextFactory.ts:519-528` handle return does **not** expose that bus.
- `packages/core/src/config/config.ts:116-123` requires an explicit `MessageBus` for `Config.initialize`.

**What is wrong:**
`handle.activate()` is async in real code, but the pseudocode and phase instructions do not await it. Also, `createAgent.md:126` invents `handle.config.getMessageBus?()` even though `Config` has no such method, then falls back to constructing a separate `MessageBus`. The isolated runtime context has already constructed an OAuthManager with a different, hidden `sessionMessageBus`. The plan never pins how the same bus is shared among `Config.initialize`, `AgenticLoop`, `OAuthManager`, scheduler, and confirmation flows.

**Why it matters:**
If activation is not awaited, `getCliRuntimeServices()` may resolve the wrong/empty runtime during refresh/switch. If different buses are used, tool confirmation, OAuth prompt/status, and hooks can silently split across channels, defeating REQ-006/008/015.

**Concrete fix:**
1. Change pseudocode to `await handle.activate()` and ensure all downstream phases cite that line.
2. Pin one bus ownership model. Either:
   - change/create an overload for `createIsolatedRuntimeContext` to accept and expose a caller-provided `messageBus`, then use that same instance for OAuthManager, `Config.initialize`, `AgenticLoop`, hooks, and tool control; or
   - avoid relying on the context-created OAuthManager/message bus and construct all bus-bound resources from the same explicit bus.
3. Add preflight and T25/T2/T18c assertions that the bus instance used by `Config.initialize`, `AgenticLoop`, OAuth prompts, and confirmation responses is the same observable channel.

---

### B3 — Export strategy will break current CLI/a2a consumers before #1595, despite the plan saying #1594 does not migrate the CLI

**Location:**
- `project-plans/issue1594/specification.md:221-245` says #1594 does not modify the CLI; CLI migration is #1595.
- `project-plans/issue1594/plan/07-export-strategy.md:37-45` removes low-level top-level exports from `packages/agents/src/index.ts` and moves them to `./internals.js`.
- `project-plans/issue1594/plan/07-export-strategy.md:50-52` says “Do NOT break existing consumers … verify a2a-server/cli still typecheck” but does not list the required consumer edits.
- Real code imports low-level symbols from the top-level package in many places, e.g. `packages/a2a-server/src/agent/task.ts:33` imports `AgentClient`; `packages/cli/src/nonInteractiveCliSupport.ts:18` imports `executeToolCall`; `packages/cli/src/ui/hooks/useReactToolScheduler.ts:26` imports `CoreToolScheduler`; many more matches exist.

**What is wrong:**
P07 makes a breaking export change inside #1594 while simultaneously declaring that CLI migration belongs to #1595. The phase does not include the necessary CLI/a2a import updates to the new internals subpath, and the plan's own verification (`npm run typecheck`) will fail if those imports remain unchanged.

**Why it matters:**
The coordinator cannot execute P07 as written: either it breaks the monorepo, or the worker must perform out-of-scope CLI/a2a migration not specified in the phase. This violates coordination executability and the declared sequencing with #1595.

**Concrete fix:**
Choose one sequencing strategy and encode it explicitly:
1. Non-breaking #1594 strategy: keep existing top-level low-level exports until #1595, add curated API exports and a new `./internals.js` subpath, document the future trim, and make T17 guard only new public harness/API imports. Then #1595 removes low-level top-level exports after consumer migration.
2. Breaking-in-#1594 strategy: add a dedicated phase that updates every CLI/a2a import to `@vybestack/llxprt-code-agents/internals.js`, with files enumerated and tests/typecheck proving no break. This contradicts current “do not modify CLI” wording and needs maintainer sign-off.

---

### B4 — No-handler confirmation behavior is internally contradictory

**Location:**
- `project-plans/issue1594/specification.md:93-100`, `344-355`, `472-478` decides public `Agent.chat()`/`stream()` safe-deny with no handler.
- `project-plans/issue1594/analysis/domain-model.md:180-181`, `231` still says no approval handler + non-permissive approval mode → **throw**.
- `project-plans/issue1594/plan/02-pseudocode.md:52-54` still instructs `tool-confirmation-merge.md` to confirm “no-handler THROW”.
- `project-plans/issue1594/analysis/pseudocode/tool-confirmation-merge.md:86-95`, `101-105` says safe denial for high-level Agent and throw only raw coordinator path.

**What is wrong:**
The authoritative spec and tool pseudocode choose safe denial for the public path, but domain analysis and P02 still preserve the older throw behavior. A worker/verifier reading the phase sequence will receive contradictory instructions.

**Why it matters:**
REQ-006, T3, T11, T21, and docs can be implemented or verified in incompatible ways. This is exactly the sort of contradiction that produces remediation loops and false “PASS” reviews.

**Concrete fix:**
Update `analysis/domain-model.md` business rule R-NOHANDLER and error scenario to match the spec: public Agent path safe-denies; raw coordinator internals path may throw. Update `plan/02-pseudocode.md:52-54` to remove “no-handler THROW” and require the safe-denial/raw-path split.

---

### B5 — Implementation phases cite pseudocode line numbers that do not exist or do not correspond to the described steps

**Location:**
- `project-plans/issue1594/plan/13-impl-adapters.md:33-44` cites config-adapter lines 1-12, 13-20, etc.; actual numbered pseudocode starts at line `10:` in `config-adapter.md:48` and uses logical numbers 10/20/30/40/50/60/80/90/100.
- `project-plans/issue1594/plan/14-impl-createagent-core.md:36-41` cites createAgent lines 1-8, 9-20, etc.; actual pseudocode lines are 10, 20-24, 31, 41-51, 56, 76, 91, 101-107, 111-113, 126-131, 141-149, 161, 170.
- `project-plans/issue1594/plan/15-impl-switch-context.md:50-57` cites switch-rebind lines 1-10, 11-18, etc.; actual pseudocode lines are 10-12, 30, 50-52, 60-62, 80-83, 90-96, 100-106.
- `project-plans/issue1594/plan/16-impl-tools-approval-loop.md:42-50` cites tool-confirmation lines 1-12, 13-28, 60-71, 80-89; actual pseudocode lines are 10-31, 40-45, 60-70, 80-89.

**What is wrong:**
The phases claim to enforce pseudocode line-by-line, but the line references are mostly wrong. This defeats the PLAN.md requirement that implementation phases cite specific pseudocode line numbers and makes verifier compliance subjective.

**Why it matters:**
Subagents cannot reliably implement from or verify against the pseudocode. A deepthinker verifier could pass code that did not follow the intended algorithm because the cited ranges are meaningless.

**Concrete fix:**
Rewrite all implementation phase pseudocode references to cite the actual numbered pseudocode ranges. Also add verifier commands that grep for those exact ranges in marker comments, e.g. `@pseudocode createAgent.md lines 41-56`.

---

### B6 — P15 still contains stale “resolve B1 before coding” instructions that contradict P00a/P02

**Location:**
- `project-plans/issue1594/plan/00a-preflight-verification.md:117-128` says PR1/PR2/PR3 are resolved and pinned.
- `project-plans/issue1594/analysis/pseudocode/switch-rebind.md:18-41` pins exact rebuild behavior: `switchActiveProvider` and `applyProfileSnapshot` rebuild internally; `setActiveModel` does not and requires `config.initializeContentGeneratorConfig()`.
- `project-plans/issue1594/plan/15-impl-switch-context.md:14-28` still says to resolve blocker B1, possibly call `refreshAuth`, and record a pinned name in a comment before implementing.

**What is wrong:**
P15 asks the worker to redo a design decision already resolved in P00a/P02, and even suggests an alternate `refreshAuth` path that contradicts `switch-rebind.md`.

**Why it matters:**
This invites an implementation to diverge from the pinned switch algorithm and can cause unnecessary auth refreshes or double rebuilds. It also violates the requirement that preflight assumptions be settled before implementation.

**Concrete fix:**
Remove the stale Phase Preflight section from P15. Replace it with a hard prerequisite: “Use `switch-rebind.md` lines 30, 90-93, and 100-104 exactly; do not redesign the rebuild path.”

---

### B7 — Provider/model parameter switching is required but has no adequate pseudocode backing

**Location:**
- `project-plans/issue1594/specification.md:315-323` REQ-004 includes `setModelParam`, `clearModelParam`, and `getModelParams`.
- `project-plans/issue1594/plan/15-impl-switch-context.md:50-57` tells the worker to implement `setModelParam/clearModelParam/getModelParams` “EXACTLY per switch-rebind.md”.
- `project-plans/issue1594/analysis/pseudocode/switch-rebind.md:90-127` only defines `setProvider`, `setModel`, and `applyProfile`; it does not define model-param mutation, whether it rebuilds, or how provider call params are verified.

**What is wrong:**
A required control-plane operation lacks the pseudocode discipline the plan requires. It is not clear whether `setActiveModelParam` / `clearActiveModelParam` should trigger a content-generator rebuild, update ephemerals only, or be applied lazily to the next call.

**Why it matters:**
T5 depends on params reaching the provider call. Without a pinned algorithm, subagents may implement trivial in-memory setters that satisfy getters but do not affect runtime calls.

**Concrete fix:**
Add `setModelParam`, `clearModelParam`, and `getModelParams` algorithms to `switch-rebind.md`, citing the real providers/runtime exports (`setActiveModelParam`, `clearActiveModelParam`, `getActiveModelParams`) and specifying rebuild/lazy behavior. Update P15 citations and T5 assertions accordingly.

---

### B8 — App-service subpaths phase is too vague and too large to dispatch safely

**Location:**
- `project-plans/issue1594/plan/26-impl-app-service-subpaths.md:18-24`, `30-35` says to create `packages/agents/src/app-services/` “or providers/core subpaths as appropriate” for settings mutation, MCP add/remove, extensions, skills, memory edits, diagnostics/about, sandbox persistence, completions, and command map.
- `project-plans/issue1594/overview.md:961-999`, `1159-1161`, `1171-1177` requires a concrete runtime-vs-app-service split and command→API map.

**What is wrong:**
P26 is not an executable implementation phase. It spans many unrelated app-service APIs, does not name real files/symbols to wrap, does not specify exports, and leaves package placement undecided. It is effectively a mini-project inside one phase.

**Why it matters:**
This violates COORDINATING.md (“one phase = one subagent”) and PLAN.md integration specificity. A worker cannot implement this reliably without redesigning scope, and a verifier cannot semantically validate it beyond import existence.

**Concrete fix:**
Before execution, split P26 into concrete phases or convert #1594 to only produce the command→API map plus importable stubs with maintainer sign-off. If implemented here, enumerate each subpath with exact backing files/functions and tests, e.g. MCP config service, extensions service, memory service, diagnostics service, completions boundary, each with its own worker+verifier.

---

### B9 — Export of `createAgent` from `@vybestack/llxprt-code-agents` is correct, but P07's “curated entry only” conflicts with current acceptance harness sequencing

**Location:**
- `project-plans/issue1594/plan/07-export-strategy.md:40-45` makes `src/index.ts` curated before harness phases P08-P12.
- `project-plans/issue1594/plan/10-harness-core-behavior.md:46-47`, `53-56` requires real `CoreToolScheduler` / MessageBus in helpers.
- Current package top-level is the only public source of `CoreToolScheduler`, `AgentClient`, etc. until `./internals.js` is created.

**What is wrong:**
The harness may need low-level internals to build real fixtures while simultaneously being used by T17 to prove no deep imports. P07 creates `./internals.js`, but the harness boundary rules do not clearly distinguish “allowed test fixture internals imports” from “consumer public API imports”. If T17 forbids internals for the harness, tests that need real scheduler/client fixtures may either become impossible or use private deep imports.

**Why it matters:**
This can create false boundary failures or force mock theater. The harness should exercise the public API as a consumer, but test helpers may need documented fixture-only internals. The plan does not define that allowance.

**Concrete fix:**
Define T17 precisely: consumer-facing test files may import only the curated entry and documented app-service subpaths; harness helper files may import `./internals.js` only for fixture construction, never to perform the behavior under test. Encode that in `boundary.spec.ts`.

---

### B10 — Mutation/property gates are not fully enforceable in the TDD sequence

**Location:**
- `project-plans/issue1594/plan/28-final-plan-quality-eval.md:69-101` installs Stryker and configures mutation testing only in the final evaluation phase.
- `project-plans/issue1594/plan/28-final-plan-quality-eval.md:103-109` permits a manual mutation spot-check substitute if Stryker is non-viable.
- PLAN.md requires mutation ≥80% and property-based ≥30% as quality gates, not optional retrospective checks.

**What is wrong:**
The hard mutation infrastructure is added only after all implementation phases. If it fails, there is no concrete remediation phase sequence, only “file remediation phases”. The fallback is not equivalent to mutation ≥80%; a manual spot-check of 10 branches is a different and weaker gate. Also, P28 is a reviewer/evaluation phase but mutates package dependencies and writes config, which blurs worker/verifier roles.

**Why it matters:**
A coordinator can reach P28 after substantial implementation and then discover the tooling is not viable. The manual fallback weakens an explicit standard and makes compliance negotiable.

**Concrete fix:**
Move Stryker setup into an early setup worker phase before harness/implementation, with a verifier that runs it against a tiny target to prove viability. If Stryker is non-viable, get maintainer sign-off before execution and update the plan standard; do not silently substitute at final eval. Keep P28 as a pure evaluation phase.

---

### B11 — P14 bootstrap instructions are stale relative to the shared-runtime correction

**Location:**
- `project-plans/issue1594/specification.md:254-281` correctly rejects bare `createHeadlessProviderManager` and requires `createIsolatedRuntimeContext` with shared `runtimeId`.
- `project-plans/issue1594/plan/14-impl-createagent-core.md:18-23`, `36-41`, `50-51` still describes “provider-manager built + set on Config” rather than the corrected shared runtime context and does not mention `createIsolatedRuntimeContext`, `handle.activate`, `runtimeId`, or shared `SettingsService` identity.

**What is wrong:**
The worker phase implementing the most critical bootstrap is not updated to the spec’s corrected composition. It cites outdated steps and wrong pseudocode ranges.

**Why it matters:**
A worker following P14 can accidentally use the rejected `createHeadlessProviderManager` / separate settings path or omit the runtime-context activation/runtimeId invariant, causing provider-manager/config divergence and switch/auth failures.

**Concrete fix:**
Rewrite P14 around `createAgent.md` actual lines 41-56, 76, 91, 101-107, 111-113, and add explicit success criteria for: `await handle.activate()`, shared `SettingsService` identity, `runtimeState.runtimeId`, and no bare `createHeadlessProviderManager` import.

## NON-BLOCKING issues / improvements

1. **Domain model bootstrap text is stale.** `analysis/domain-model.md:90-99` still says `createHeadlessProviderManager`; update to `createIsolatedRuntimeContext` for consistency.
2. **Event pseudocode has confusing idle-timeout text.** `event-adapter.md:232-235` includes “YIELD ensureDone(... 'aborted'? NO...)” then a note to resolve later. The note at `160-164` clarifies, but the pseudocode should be cleaned to a single algorithm: yield idle-timeout, set pending reason, synthesize once at loop end.
3. **P03 typed field verification is incomplete.** `plan/03-config-schema.md:72-75` checks only a subset of overview §4.2 fields and omits several listed fields (`fileFiltering`, `recording`, `extensions`, `ide`, `hooks`, `memory`, `toolOutputLimits`, `coreTools`, etc.). It is only a grep sanity check, but should be expanded.
4. **T-row layer placement is inconsistent.** For example, specification maps T2/T2b to layer 4 (`specification.md:495-496`), while P10 includes them in core behavior (`plan/10-harness-core-behavior.md:23-24`). This is not fatal if tests exist, but the tracker/layering should be reconciled.
5. **P16 raw coordinator throw coverage is asserted in prose but not clearly allocated to a T-row.** If the raw internals path behavior is part of the decision, add an explicit test row or sub-assertion.
6. **Final docs path is `docs/agent-api.md`, while issue wording says core API.** This is probably correct given package decision, but docs should also mention why it is not under `core`.

## Coverage assessment

### Harness T1–T25 allocation status

| T-row | REQ(s) per plan | RED phase | GREEN phase | Status |
|---|---|---:|---:|---|
| T1 | REQ-001/003 | P10 | P14 | Allocated; blocked by P14 bootstrap/loop issues |
| T2 | REQ-006/007 | P10 | P16 | Allocated; layer mismatch but covered |
| T2b | REQ-003/006 | P09/P10 | P16 | Allocated; raw path needs clearer boundary rules |
| T3 | REQ-006/007 | P10 | P16 | Allocated; no-handler contradiction must be fixed |
| T3b | REQ-006 | P10 | P16 | Allocated |
| T3c | REQ-006 | P10/P11 | P16 | Allocated |
| T4 | REQ-004 | P11 | P15 | Allocated; blocked by stale P15 and loop rebinding |
| T4b | REQ-009 | P11 | P15/P18 | Allocated |
| T4c | REQ-004/005 | P11 | P15 | Allocated; blocked by AgenticLoop cached client |
| T4d | REQ-005 | P11 | P15 | Allocated; good identity requirement |
| T4e | REQ-005/009 | P11 | P15/P18 | Allocated |
| T4f | REQ-005 | P11 | P15 | Allocated |
| T5 | REQ-004 | P11 | P15 | Allocated; model-param pseudocode gap |
| T6 | REQ-010 | P10 | P19 | Allocated |
| T6b | REQ-010 | P10/P11 | P19 | Allocated |
| T7 | REQ-010 | P10 | P19 | Allocated |
| T8 | REQ-011 | P10 | P19 | Allocated |
| T8b | REQ-010 | P10 | P19 | Allocated |
| T9 | REQ-003 | P10 | P14 | Allocated |
| T10 | REQ-012 | P10 | P20 | Allocated |
| T11 | REQ-006 | P10 | P16 | Allocated; no-handler semantics contradiction |
| T12 | REQ-017 | P11 | P21/P24 | Allocated |
| T12b | REQ-013 | P11 | P21 | Allocated |
| T13 | REQ-016 | P12 | P14/P23 | Allocated; depends on loop/runtime handle teardown fixes |
| T14 | REQ-007 | P10/P11 | P16 | Allocated |
| T14b | REQ-010 | P10 | P19 | Allocated |
| T15 | REQ-014 | P11 | P21 | Allocated |
| T15b | REQ-015 | P11 | P22 | Allocated |
| T15c | REQ-007/010/015 depending text | P11 | P22 | Allocated but REQ mapping should be reconciled |
| T16 | REQ-003 | P09 | P14 | Allocated; event coverage strong, but adapter pseudocode cleanup needed |
| T17 | REQ-019 | P08 | guard | Allocated; needs fixture-internals allowance clarified |
| T18 | REQ-008 | P11 | P17 | Allocated |
| T18b | REQ-008 | P11 | P17 | Allocated |
| T18c | REQ-008 | P11 | P17 | Allocated; bus sharing must be pinned |
| T18d | REQ-009 | P11 | P18 | Allocated |
| T18e | REQ-002/021 | P11 | P22 | Allocated |
| T19 | REQ-006 | P12 | P22 | Allocated |
| T20 | REQ-013 | P11 | P21 | Allocated |
| T21 | REQ-007 | P10 | P16 | Allocated |
| T22 | REQ-001/003/021 | P10/P11 | P25 | Allocated |
| T23 | REQ-021 | P08 | P26 | Allocated; P26 too vague/large |
| T24 | REQ-021 | P08 | P26 | Allocated; P26 too vague/large |
| T25 | REQ-001/017 | P10 | P14/P24 | Allocated; bootstrap shared-bus/runtime fixes required |

**Summary:** Every T-row T1–T25 is nominally allocated to a phase and REQ. Coverage is not the main problem; executability and internal consistency are.

### REQ → phase status

| REQ | Planned phases | Status |
|---|---|---|
| REQ-001 createAgent bootstrap | P05, P14 | Covered but blocked by stale P14, async activation, bus sharing |
| REQ-002 AgentConfig adapter/classification | P03, P13, P22 | Covered; P03 grep incomplete |
| REQ-003 events/exactly-one done | P04, P09, P13, P14 | Covered; line refs/idle-timeout pseudocode cleanup needed |
| REQ-004 provider/model/params | P15 | Covered but blocked by loop rebinding and missing param pseudocode |
| REQ-005 context preservation | P15 | Covered but blocked by loop rebinding/P15 stale text |
| REQ-006 tools/confirmation/scheduler | P16, P22 | Covered; no-handler contradiction and bus sharing must be fixed |
| REQ-007 high-level AgenticLoop | P16 | Covered; blocked by cached AgenticLoop client after switch |
| REQ-008 auth/keys/OAuth | P17 | Covered; bus sharing and app-service boundaries need pinning |
| REQ-009 profiles | P18 | Covered |
| REQ-010 history/session | P19 | Covered |
| REQ-011 compression | P19 | Covered |
| REQ-012 generate | P20 | Covered |
| REQ-013 MCP/gating | P21 | Covered |
| REQ-014 IDE | P21 | Covered |
| REQ-015 hooks/lifecycle | P22 | Covered; shared MessageBus issue impacts it |
| REQ-016 dispose | P14/P23 | Covered; must include loop recreation/runtime handle/bus teardown |
| REQ-017 discovery/types | P03/P04/P05/P24 | Covered |
| REQ-018 export strategy | P07 | Covered but sequencing breaks current consumers |
| REQ-019 no-deep-import guard | P08/P12 | Covered; T17 scope needs clarification |
| REQ-020 docs | P27 | Covered |
| REQ-021 runtime-vs-app boundary | P25/P26 | Covered nominally; P26 not executable enough |

## Explicit yes/no judgments

- **Design fidelity:** **NO.** The plan covers most design elements nominally, but contradicts the design on rebinding (AgenticLoop cached client), shared runtime/bus composition, no-handler behavior, and export sequencing.
- **Full harness/REQ coverage:** **YES nominally, NO effectively.** Every T-row and REQ is mapped, but several mapped phases are not executable or are internally contradictory.
- **TDD soundness:** **NO.** The test-first structure is good, but mutation infrastructure is deferred to the final evaluation, P26 is too vague for behavioral tests to be meaningful, and contradictory no-handler expectations risk invalid tests.
- **Pseudocode discipline:** **NO.** Pseudocode files mostly have the required sections, but implementation phases cite wrong line ranges; model-param operations lack pseudocode; stale phase instructions conflict with pseudocode.
- **Integration (not isolated):** **PARTIAL.** The spec names CLI/a2a and deep imports, and the harness is integration-oriented. But P07 breaks current consumers without a concrete migration phase, and P26 is not grounded in real symbols.
- **Coordination executability:** **NO.** Numbering is contiguous and roles are named, but P07/P26/P28 cannot be safely dispatched as written, and multiple phases contain stale or contradictory prerequisites.
- **Open-question decisions correct:** **PARTIAL.** Entry package, full control plane, stats source, core trim sequencing, and safe-denial decision are mostly reasonable. But the safe-denial decision is not propagated, and the shared runtime/bus implications are not correctly resolved.
- **Correctness-risk handling:** **NO.** The plan recognizes exactly-one-done, stopped vs blocked, correlationId vs toolCallId, runtimeId, and context preservation, but misses the real AgenticLoop cached-client problem and the runtime-context MessageBus/activation details.

## Required remediation before execution

1. Fix the client rebinding design for `AgenticLoop` and update all affected phases/tests.
2. Fix `createAgent` runtime activation and MessageBus ownership; await activation and use one bus.
3. Resolve export sequencing: non-breaking top-level compatibility until #1595, or explicit consumer migration phase.
4. Propagate safe-denial no-handler behavior consistently across domain model, P02, pseudocode, tests, docs.
5. Correct all pseudocode line references and add missing model-param pseudocode.
6. Rewrite P14/P15 stale bootstrap/switch instructions around the current preflight decisions.
7. Split or concretize P26 app-service subpaths.
8. Move mutation tooling setup earlier or make P28 a pure evaluator with a real hard gate already proven viable.
