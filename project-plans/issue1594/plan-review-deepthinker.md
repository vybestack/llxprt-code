# Deep Plan Review — Issue #1594 Core Public API

Verdict: **FAIL**

The plan captures much of the design intent, but it is not sound or executable as written. The most serious blockers are: non-contiguous phase numbering despite the coordinator’s no-skips rule, inconsistent subagent assignments, binding pseudocode that does not match real code, unresolved preflight blockers pushed into implementation, and non-enforceable mutation/property gates.

## BLOCKING issues

### B1 — Phase numbering violates the mandatory coordinator protocol

**Location:** `project-plans/issue1594/plan/00-overview.md:85`, `:139-141`; `project-plans/issue1594/execution-tracker.md:21-66`; `dev-docs/COORDINATING.md:9-15`

**What is wrong:** The plan claims “NO gaps” but skips every even worker number after P03: P03/P03a → P05/P05a → P07/P07a, etc. It then says the “intervening gaps” are reserved (`plan/00-overview.md:139-141`). That directly conflicts with `COORDINATING.md`, which requires exact sequential execution and “NEVER SKIP PHASE NUMBERS.”

**Why it matters:** A coordinator following the project rules will stop after P03a looking for P04, or will skip phases in violation of the protocol.

**Concrete fix:** Renumber all phases contiguously and update prerequisites, trackers, completion markers, grep commands, and cross-references. Do not describe the current numbering as “NO gaps.”

### B2 — Subagent assignments are internally inconsistent

**Location:** `execution-tracker.md:13-17`, `execution-tracker.md:21`; `plan/00a-preflight-verification.md:12`; `plan/00-overview.md:87-93`

**What is wrong:** The tracker assigns P00a to `typescriptexpert`, but the P00a phase file and overview assign it to `typescriptreviewer`.

**Why it matters:** The tracker is the coordinator’s dispatch source; the wrong role can execute the preflight gate.

**Concrete fix:** Make P00a consistently `typescriptreviewer` everywhere, or explicitly redefine it as a worker phase everywhere.

### B3 — Event adapter pseudocode references a non-existent `AgenticLoopEvent.value`

**Location:** `analysis/pseudocode/event-adapter.md:54`; real code `packages/agents/src/core/agenticLoop/types.ts:37-42`

**What is wrong:** The pseudocode says `mapStreamEvent(ev.value, state)`. Real `AgenticLoopEvent` uses `{ kind: 'stream'; event: ServerGeminiStreamEvent }`; there is no `value` field. Other loop variants use `toolCalls`, `callId`, `chunk`, and `completed`.

**Why it matters:** This is the top correctness-risk adapter. Following the pseudocode literally will not compile or will map undefined.

**Concrete fix:** Change the stream row to `mapStreamEvent(ev.event, state)` and audit all other loop-kind projections against the real type fields.

### B4 — `createAgentRuntimeState` is called with an invalid argument shape

**Location:** `analysis/pseudocode/createAgent.md:87`; `specification.md:256-261`; real code `packages/core/src/runtime/AgentRuntimeState.ts:203-219`

**What is wrong:** The plan calls `createAgentRuntimeState({ provider, model })`, but the real function requires a valid `runtimeId` and throws if it is missing.

**Why it matters:** The P21 bootstrap algorithm would fail at runtime.

**Concrete fix:** Use the real config-derived factory if appropriate, or include all required runtime-state fields. Update REQ-001, pseudocode, P21, and tests.

### B5 — Preflight blocker B1 is deferred into implementation

**Location:** `plan/00a-preflight-verification.md:62`, `:102-118`; `plan/23-impl-switch-context.md:14-27`; `analysis/pseudocode/switch-rebind.md:60`, `:74`, `:83`

**What is wrong:** P00a says the rebuild hook/runtime-context selection is not pinned and must be resolved before switch implementation. P23 makes resolving it part of the implementation phase, and the pseudocode still uses placeholder `config.refreshAfterSwitch()`.

**Why it matters:** PLAN.md requires assumptions and call paths to be verified before implementation. The switch/rebind path is the headline context-preservation guarantee; it cannot remain a mid-implementation design task.

**Concrete fix:** Add a dedicated pre-implementation contract phase, or resolve B1 in P02 pseudocode finalization. Name the exact callable method/path and runtime-context selection model before P23 begins.

### B6 — Provider-manager/Config settings-context wiring remains under-specified

**Location:** `overview.md:273-278`; `plan/00a-preflight-verification.md:86-100`; `analysis/pseudocode/createAgent.md:34-37`, `:66`, `:78`; real code `packages/providers/src/composition/headlessFactory.ts:53-64`

**What is wrong:** The overview requires manager/Config to be wired from the same settings/runtime context. P00a correctly notes `createHeadlessProviderManager` builds a manager from its own `SettingsService`, but the bootstrap pseudocode still creates the manager before Config and never specifies how the Config and manager share settings/runtime context.

**Why it matters:** Auth/profile/settings precedence can diverge if Config and ProviderManager are not using the same settings source.

**Concrete fix:** Pin the bootstrap composition: either construct both from a shared runtime context/settings service, or explicitly adopt/transfer the headless factory settings into Config. Add an identity/behavior test for shared settings.

### B7 — No-handler confirmation behavior conflicts with the actual high-level loop

**Location:** `specification.md:107-110`; `analysis/pseudocode/tool-confirmation-merge.md:80-83`; `plan/25-impl-tools-approval-loop.md:18-23`; real code `packages/agents/src/core/agenticLoop/AgenticLoop.ts:27-32`, `:232-245`; `packages/agents/src/scheduler/confirmation-coordinator.ts:320-325`

**What is wrong:** The spec/pseudocode decide “throw” when no handler and confirmation is required. The scheduler coordinator throws in one path, but the real `AgenticLoop` says no-handler ASK_USER in non-interactive mode becomes a safe tool error, and approval-handler rejection is converted to denial. Since the Agent delegates to `AgenticLoop`, the plan is internally inconsistent about which behavior is public.

**Why it matters:** This changes T3/T11/T21 behavior and headless safety semantics.

**Concrete fix:** Re-run preflight on both layers, decide whether high-level Agent preserves `AgenticLoop` safe-denial behavior or intentionally changes it, and update REQ-006, pseudocode, tests, and docs consistently.

### B8 — Mutation testing ≥80% is not actually executable

**Location:** `plan/47-final-plan-quality-eval.md:36-37`, `:70-75`; `plan/00a-preflight-verification.md:27`; `packages/agents/package.json:45-50`

**What is wrong:** The final eval requires mutation ≥80%, but no implementation verification phase runs Stryker or checks a mutation report. `@stryker-mutator/core` is not present in `packages/agents/package.json`; P00a only says to assert it later.

**Why it matters:** PLAN.md requires mutation enforcement, not a final checkbox. The current plan can reach P47 with no mutation data.

**Concrete fix:** Add a concrete mutation-test setup/verification phase or commands in each relevant implementation verifier. If dependency is missing, add an explicit dependency/setup phase. P47 must consume an actual report and fail if score <80%.

### B9 — Property-based testing ≥30% is under-specified and not enforceable

**Location:** `plan/13-harness-core-behavior.md:57-75`; `plan/13a-harness-core-behavior-verification.md:21-30`; `plan/15-harness-cli-parity.md:57`, `:76`; `plan/47-final-plan-quality-eval.md:36`

**What is wrong:** P13 requires ≥30% property tests “across this layer,” but verification only counts occurrences and does not compute a percentage. P15 says “where natural,” which weakens the global ≥30% requirement. P47 checks a box but has no command.

**Why it matters:** The plan cannot prove the PLAN.md property-based gate.

**Concrete fix:** Define numerator/denominator (e.g., test cases tagged with plan markers), add a script that computes the percentage across the full harness, and make each harness verifier or P47 run it with a hard failure below 30%.

### B10 — Harness coverage has orphan/incorrect REQ mappings

**Location:** `plan/13-harness-core-behavior.md:38`; `plan/17-harness-resource-leak.md:25`; `specification.md:459-495`; `execution-tracker.md:77-119`

**What is wrong:** P13 lists `T22 | REQ-?`, and P17 lists `REQ-?` for scheduler factory/T19. The formal spec maps T22 to REQ-001/REQ-003 at `specification.md:494`, while the tracker maps T22 to P41/REQ-021. T19 is REQ-006 in the spec (`specification.md:490`) and tracker, not unknown.

**Why it matters:** Requirement traceability is not complete and verifiers cannot enforce requirement tags reliably.

**Concrete fix:** Replace all `REQ-?` with the formal IDs, and reconcile T22: either update the spec mapping to REQ-021 or expand P13/P41 so T22’s REQ-001/003 and REQ-021 aspects are both covered.

### B11 — Public docs path/name contradicts the design

**Location:** `overview.md:1055`; `specification.md:496-497`; `plan/45-docs-core-api.md:1-27`

**What is wrong:** The design acceptance criterion says “new `docs/core-api.md`,” but the package entry is `@vybestack/llxprt-code-agents`. The plan names the doc “core-api,” which may preserve the old “core API” wording the design explicitly rejected for the package entry.

**Why it matters:** This is not as severe as code-path blockers, but it can perpetuate consumer confusion between `-core` and `-agents`.

**Concrete fix:** Either rename to `docs/agent-api.md` or ensure the first section explicitly states the API is exported from `@vybestack/llxprt-code-agents`, not core.

## NON-BLOCKING issues / improvements

### N1 — P00a dependency statement about telemetry is incomplete

**Location:** `plan/00a-preflight-verification.md:44`; real `packages/agents/package.json:30-43`

P00a says the canonical stats source is the telemetry package, but `agents/package.json` does not list `@vybestack/llxprt-code-telemetry` directly. Current code imports telemetry via a core subpath. The implementation phase should pin the legal public import path and add a dependency if a direct telemetry import is intended.

### N2 — P03 type phase is too large for one worker

**Location:** `plan/03-public-types-schemas.md:25-39`

P03 creates the full `Agent` surface, all sub-surfaces, all events, all projection schemas, stats, result, options, and callbacks. It is possible but high-risk for one subagent. Consider splitting into config/schema, event/schema, and control-plane interface phases.

### N3 — P27 auth/keys/profiles is too broad for one worker

**Location:** `plan/27-impl-auth-keys-profiles.md:13-35`

This bundles OAuth, buckets, secure store, runtime auth mutation, keyfile/raw/key-name precedence, profile save semantics, durable profile CRUD, standard profile apply, and load-balancer apply. That is likely too much for one isolated subagent. Split auth keys from profile CRUD/apply.

### N4 — Some verifier grep commands can pass with “MISSING” output

**Location:** multiple phase files, e.g. `plan/11-harness-event-characterization.md:74-77`, `plan/13a-harness-core-behavior-verification.md:17-19`

Several commands echo missing items but do not exit non-zero. The semantic checklist can catch this, but automation would not. Prefer shell loops that set `missing=1` and `exit $missing`.

### N5 — The plan overuses permanent `@plan` comments in production code

**Location:** all implementation phases

The template asks for markers, so this is not a plan violation, but it conflicts with the general project preference for sparse comments. If accepted, keep markers minimal and avoid explanatory comments beyond marker blocks.

## Coverage assessment

### T-row coverage status

| T-row | Planned RED phase | Planned GREEN phase | REQ status | Review status |
|---|---:|---:|---|---|
| T1 | P13 | P21 | REQ-001/003 | Covered |
| T2 | P13 | P25 | REQ-006/007 | Covered |
| T2b | P13/P11 | P25 | REQ-003/006 | Covered |
| T3 | P13 | P25 | REQ-006/007 | Covered, but confirmation behavior conflict B7 |
| T3b | P13 | P25 | REQ-006 | Covered |
| T3c | P13 | P25 | REQ-006 | Covered |
| T4 | P15 | P23 | REQ-004 | Covered |
| T4b | P15 | P23/P27 | REQ-009 | Covered |
| T4c | P15 | P23 | REQ-004/005 | Covered |
| T4d | P15 | P23 | REQ-005 | Covered; depends on unresolved B5/B6 |
| T4e | P15 | P23 | REQ-005/009 | Covered; depends on unresolved B5/B6 |
| T4f | P15 | P23 | REQ-005 | Covered |
| T5 | P15 (also tracker says P13) | P23 | REQ-004 | Covered but tracker/spec phase inconsistency |
| T6 | P13 | P29 | REQ-010 | Covered |
| T6b | P13 | P29 | REQ-010 | Covered |
| T7 | P13 | P29 | REQ-010 | Covered |
| T8 | P13 | P29 | REQ-011 | Covered |
| T8b | P13 | P29 | REQ-010 stats | Covered |
| T9 | P13 | P21 | REQ-003 | Covered |
| T10 | P13 | P31 | REQ-012 | Covered |
| T11 | P13 | P25 | REQ-006 | Covered, but B7 affects expected behavior |
| T12 | P15/P13 | P33/P39 | REQ-017 | Covered but phase allocation inconsistent |
| T12b | P15 | P33 | REQ-013 | Covered |
| T13 | P17 | P21/P37 | REQ-016 | Covered |
| T14 | P13/P15 | P25 | REQ-007 | Covered |
| T14b | P13 | P29 | REQ-010 | Covered |
| T15 | P15 | P33 | REQ-014 | Covered |
| T15b | P15 | P35 | REQ-015 | Covered |
| T15c | P15 | P35 | REQ-007/010 in spec, REQ-015 in plan | Covered but REQ mapping inconsistent |
| T16 | P11 | P19/P21 | REQ-003 | Covered, but event pseudocode bug B3 |
| T17 | P09 | boundary guard | REQ-019 | Covered |
| T18 | P15 | P27 | REQ-008 | Covered |
| T18b | P15 | P27 | REQ-008 | Covered |
| T18c | P15 | P27 | REQ-008 | Covered |
| T18d | P15 | P27 | REQ-009 | Covered |
| T18e | P15 | P35 | REQ-002/021 | Covered |
| T19 | P17 | P35 | REQ-006 | Covered but P17 says REQ-? (B10) |
| T20 | P15 | P33 | REQ-013 | Covered |
| T21 | P13 | P25 | REQ-007 | Covered |
| T22 | P13/P15 | P41 | REQ-001/003 in spec, REQ-021 in tracker | Covered but REQ mapping inconsistent (B10) |
| T23 | P09 | P43 | REQ-021 | Covered |
| T24 | P09 | P43 | REQ-021 | Covered |
| T25 | P13 | P21/P39 | REQ-001/017 | Covered |

### REQ coverage status

| REQ | Planned phases | Status |
|---|---|---|
| REQ-001 | P05, P21, P41/T22 | Covered, but runtime-state call invalid (B4) |
| REQ-002 | P03, P19, P35 | Covered |
| REQ-003 | P03, P11, P19, P21 | Covered, but event pseudocode bug (B3) |
| REQ-004 | P23 | Covered, but switch hook unresolved (B5) |
| REQ-005 | P23 | Covered, but depends on B5/B6 |
| REQ-006 | P25, P35 | Covered, but no-handler semantics conflict (B7) |
| REQ-007 | P25 | Covered |
| REQ-008 | P27 | Covered |
| REQ-009 | P27 | Covered |
| REQ-010 | P29 | Covered |
| REQ-011 | P29 | Covered |
| REQ-012 | P31 | Covered |
| REQ-013 | P33 | Covered |
| REQ-014 | P33 | Covered |
| REQ-015 | P35 | Covered |
| REQ-016 | P37 | Covered |
| REQ-017 | P03, P39 | Covered |
| REQ-018 | P07 | Covered |
| REQ-019 | P09/P17 | Covered |
| REQ-020 | P45 | Covered |
| REQ-021 | P41, P43 | Covered, but T22 mapping inconsistent |

## Explicit yes/no assessment

- **Design fidelity:** **No.** Broadly faithful, but provider/Config wiring, no-handler confirmation behavior, and switch rebuild context are not faithful/executable enough.
- **Full harness/REQ coverage:** **No.** Most rows are allocated, but `REQ-?` or inconsistent mappings remain for T19/T22/T15c.
- **TDD soundness:** **No.** Test-first ordering exists, but mutation/property gates are not actually enforced.
- **Pseudocode discipline:** **No.** Pseudocode is present and mostly referenced, but event-adapter and createAgent pseudocode contain real-code mismatches; switch pseudocode keeps a placeholder hook.
- **Integration (not isolated):** **Yes, with caveats.** The plan names CLI and a2a and deep imports, and the harness is integration-oriented. However, app-service subpaths and runtime context details are still under-specified.
- **Coordination executability:** **No.** Phase numbering and tracker inconsistencies block execution.
- **Open-question decisions correct:** **No.** Several decisions are recorded, but no-handler confirmation and stats-source dependency/import path need correction.
- **Correctness-risk handling:** **No.** The plan recognizes the right risks, but B3/B5/B6/B7 mean the highest-risk paths are not pinned correctly.

## Summary

The plan should not be executed until the blockers are fixed. The biggest must-fix items are the coordinator-incompatible phase numbering, the erroneous event adapter and runtime-state pseudocode, the unresolved switch/rebind preflight blocker, the provider-manager/Config settings-context ambiguity, and the contradiction around no-handler confirmation behavior. The coverage matrix is close, but traceability has holes (`REQ-?`) and the mutation/property quality gates need real commands and dependencies, not final checkboxes.
