# Phase 0.5: Preflight Verification

## Phase ID

`PLAN-20260617-COREAPI.P00a`

## Purpose

Verify ALL assumptions cited by `overview.md` and `specification.md` BEFORE any
implementation phase. Where a cited fact is WRONG, record the correction here and
the plan adjusts rather than propagating the error.

**LLxprt Code Subagent (re-run/extend during execution): typescriptreviewer**

---

## Dependency Verification

| Dependency | Verification | Status |
|---|---|---|
| #2033 / PR #2039 (headless provider composition) merged | `createHeadlessProviderManager` present at `packages/providers/src/composition/headlessFactory.ts:53` | OK |
| #2034 / PR #2050 (AgenticLoop) merged | `packages/agents/src/core/agenticLoop/AgenticLoop.ts` (608 lines) present + exported from `agents/src/index.ts` | OK |
| `agents` depends on `core`, `providers`, `auth`, `settings`, `tools`, `policy` | `agents/package.json` deps | OK (assert at exec) |
| `core` depends on neither `agents` nor `cli` | `core/package.json` deps | OK (assert at exec) |
| `zod` available (schema-first) | `npm ls zod` | ASSERT AT EXEC |
| `fast-check` available (property tests) | `npm ls fast-check` (already in `agents` devDeps `^4.2.0`) | ASSERT AT EXEC |
| `@stryker-mutator/core` available (mutation ≥80%) | `npm ls @stryker-mutator/core` → **ABSENT repo-wide** | **NOT PRESENT — must be ADDED as `agents` devDep by the quality-gate setup phase P08; do NOT assume present** |

## Type / Interface Verification

| Type / Symbol | Expected (per overview) | Actual (verified) | Match? |
|---|---|---|---|
| `GeminiEventType` | 21 variants | 21 variants at `packages/core/src/core/turn.ts:48` | YES |
| `AgenticLoopEvent` kinds | stream/tool_update/tool_output/tools_complete/awaiting_approval | confirmed `agenticLoop/types.ts:38-42` | YES |
| `AgentClientContract.getHistory` | async `Promise<Content[]>` | confirmed `clientContract.ts:72` | YES |
| `AgentClientContract.generateEmbedding` | `(texts:string[])=>Promise<number[][]>` | confirmed | YES |
| `createHeadlessProviderManager` return | `{ manager, oauthManager }` | confirmed `headlessFactory.ts:53` | YES |
| `FakeProvider` scripting | (overview implies "scripted output") | **FILE-BASED**: `constructor(filePath, cwd?)` reads JSONL; no in-memory scripting API | **CORRECTED** — harness MUST write JSONL fixture files |
| stats source `uiTelemetryService` legal import path | overview §4.3 says "core" | **LEGAL PATH = `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js`** (a real `exports` entry in `packages/core/package.json`); ALREADY imported by `packages/agents/src/core/client.ts:42`. Implementation re-exports through core, NOT a direct `@vybestack/llxprt-code-telemetry` dep (which is NOT in `agents/package.json`). | **CORRECTED (N1)** — pin this exact specifier in the stats impl phase (P20) |
| `core/index.ts` size | 664 lines | confirmed | YES |
| `agents/src/index.ts` | exports AgentClient/CoreToolScheduler/AgenticLoop/AgentExecutor etc. | confirmed (69 lines) | YES |

## Call Path Verification

| Function | Expected location | Actual (verified) | Evidence |
|---|---|---|---|
| `switchActiveProvider` | providers/runtime | YES | `providerSwitch.ts:803` |
| `setActiveModel` | providers/runtime | YES | `providerMutations.ts:406` |
| `updateActiveProviderApiKey` | providers/runtime | YES | `providerMutations.ts:257` |
| `updateActiveProviderBaseUrl` | providers/runtime | YES | `providerMutations.ts:317` |
| `setActiveToolFormatOverride` | providers/runtime | YES | `providerMutations.ts:379` |
| `applyProfileWithGuards` (INTERNAL) | providers/runtime | YES (internal) | `profileApplication.ts:767` — NOT the public entry |
| `applyProfileSnapshot` (PUBLIC profile-apply entry) | providers/runtime | YES | `runtimeSettings.ts:127` — re-exported public wrapper of `applyProfileWithGuards`; facade calls THIS (B5) |
| `setActiveModelParam` | providers/runtime | YES | `runtimeAccessors.ts:517` |
| static `listProviders()` | providers/runtime | YES | `runtimeAccessors.ts:535` |
| `createIsolatedRuntimeContext` (shared ctx) | providers/runtime | YES | `runtimeContextFactory.ts:449` — re-exported via `runtime.js`; adopts external `Config`, builds shared SettingsService+ProviderManager+OAuthManager under one `runtimeId` (B6) |
| `createAgentRuntimeState({runtimeId,...})` | core/runtime | YES | `AgentRuntimeState.ts:203` — `runtimeId` REQUIRED; throws `RuntimeStateError(RUNTIME_ID_MISSING)` without it (B4) |
| `registerAgentRuntimeFactories` (inversion seam) | providers | YES | `providers/src/runtime/runtimeSettings.ts`, `runtimeContextFactory.ts` |
| `CoreToolScheduler.dispose()` | agents | YES (calls coordinator.dispose) | `coreToolScheduler.ts:201` |
| `ConfirmationCoordinator.dispose()` | agents | YES | `confirmation-coordinator.ts:170` |
| `Config.dispose()` | core | YES (partial: `agentClient.dispose()` + mcp) | `config.ts:882` |
| `Config.extractExistingState` / `transferHistoryToNewClient` | core | YES | `config.ts:254` / `:295` |
| `refreshAuth` | **`configBase.ts:36`** (NOT config.ts) | YES | downstream state logic only in config.ts |
| post-switch rebuild method | core/config | **RESOLVED (B5):** `config.initializeContentGeneratorConfig()` (`config.ts:329`) is the real rebuild — `extractExistingState()`→`transferHistoryToNewClient()`→`storeHistoryServiceForReuse` (SAME HistoryService by ref)→new client→dispose prev. The prior placeholder switch-refresh helper **DOES NOT EXIST** and was removed from the pseudocode. `switchActiveProvider`/`applyProfileSnapshot` rebuild internally; **model-only** `setActiveModel` does NOT → facade calls `initializeContentGeneratorConfig()` explicitly. | PINNED in `switch-rebind.md` (P02); no longer deferred to impl |

## CRITICAL CORRECTIONS (adjust plan accordingly)

1. **FakeProvider is file-based JSONL, not an in-memory scripting object.** Every
   harness fixture supplies one or more `*.jsonl` files (one `FakeResponseTurn` per
   line: `{chunks:[{speaker:'ai',blocks:[{type:'text',text:...}]}]}`). Harness phases
   create a `fixtures/` dir; tests pass `new FakeProvider(fixturePath, cwd)`.
   Variants not reachable by provider scripting (scheduler/loop-detector/runtime
   emitted) are driven by direct emission/injection at the real emission site.
2. **Stats canonical source is `uiTelemetryService` via the LEGAL core re-export
   `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js`** (N1), not a direct
   telemetry-package import (`@vybestack/llxprt-code-telemetry` is NOT a dependency of
   `agents/package.json`). This exact specifier is already used by
   `packages/agents/src/core/client.ts:42`. `SessionStats` projection reads from
   `uiTelemetryService` (tokens/usage) + `HistoryService` (turns). The Agent
   re-projects; consumers never deep-import either. P20 pins this specifier.
3. **Power-user subpath does NOT exist yet in `agents/package.json`** (exports only
   `.`). #1594 must CREATE the subpath export (recommended `./internals.js`) and
   duplicate AgentClient/AgentExecutor/CoreToolScheduler/AgenticLoop/subagent symbols
   there while keeping current top-level low-level exports for CLI/a2a compatibility
   until #1595 performs the final curated-entry trim. This is real integration work
   (an export phase), not mere formalization.
4. **Providers subpaths already exist** (`./composition.js`, `./runtime.js`,
   `./auth.js`, etc. in `providers/package.json`) — #1594 only DOCUMENTS them as
   supported, no change needed there.
5. **`switchActiveProvider`/mutators operate on the runtime context**
   (`getCliRuntimeServices()`), not a passed `Config`. **RESOLVED (B5/B6):**
   `createAgent` establishes ONE shared runtime context via
`createIsolatedRuntimeContext({ runtimeId, settingsService, config: ourConfig,
model, messageBus })` (adopting OUR `Config` and using only executable options),
then `handle.activate()` so
   `getCliRuntimeServices()` resolves THESE instances. This guarantees `Config` and
   `ProviderManager` share the **same `SettingsService`** under one `runtimeId`
   (resolving the precedence-divergence risk). `handle.cleanup()` is wired into
   `Agent.dispose()`. The runtime-context selection model is therefore **per-agent,
   activated**, and is PINNED in `createAgent.md`/`switch-rebind.md` (P02) — NOT
   deferred to the impl phase.
6. **DO NOT use bare `createHeadlessProviderManager` (B6).** It builds its OWN
   `new SettingsService()` with hardcoded `runtimeId:'headless'` and does not expose
   it, which would make `Config` and `ProviderManager` observe divergent settings.
   `createIsolatedRuntimeContext` is the shared-context entry; a behavioral
   shared-settings identity assertion is added (T25 sub-assertion, B6).

## Test Infrastructure Verification

| Component | Test infra present? | Notes |
|---|---|---|
| `FakeProvider` | YES (file-based) | exported from `providers/src/index.ts`; needs JSONL fixtures |
| `MessageBus` real instance | YES | used in agents tests already |
| `CoreToolScheduler` real | YES | `coreToolScheduler.ts` + tests |
| `ConfirmationCoordinator` real | YES | `confirmation-coordinator.test.ts` |
| vitest `*.spec.ts` patterns | YES | repo convention |

## Preflight-Resolved Items (RESOLVED here / in P02 — no longer deferred to impl)

- **PR1 — switch/rebind rebuild + runtime-context (was the review's B5):** RESOLVED.
  Rebuild method = `config.initializeContentGeneratorConfig()` (`config.ts:329`);
  runtime-context model = per-agent `createIsolatedRuntimeContext(...)` +
  `handle.activate()`. Pinned in `createAgent.md` + `switch-rebind.md` (P02). The
  bogus switch-refresh placeholder is removed. Switch impl (P16) consumes the
  pinned path; it does NOT design it.
- **PR2 — shared ProviderManager/Config settings context (was the review's B6):**
  RESOLVED. One `SettingsService` shared via `createIsolatedRuntimeContext`; behavioral
  shared-settings identity assertion added (T25 sub-assertion). Bare
  `createHeadlessProviderManager` is rejected.
- **PR3 — `createAgentRuntimeState` requires `runtimeId` (was the review's B4):**
  RESOLVED. Pinned call shape `createAgentRuntimeState({runtimeId,provider,model,...})`
  in `createAgent.md` + spec REQ-001.

## Setup Items Owned by Later Phases (named, with exact mechanism)

- **SET1 (export phase P07):** create the power-user subpath specifier
  (`./internals.js` recommended) and add it to `agents/package.json`; keep current
  top-level low-level exports until #1595 migrates consumers and trims the entry.
- **SET2 (harness phases P10–P13):** all event-characterization + behavior fixtures
  are JSONL files; the harness phase creates the `fixtures/` directory and helper.
- **SET3 (Stryker — quality-gate, the review's B8):** `@stryker-mutator/core` is
  **NOT present anywhere in the monorepo** (verified `npm ls @stryker-mutator/core`
  yields nothing). It is therefore NOT a final-eval-only item — it must be **added as
  a devDependency to `packages/agents/package.json`** and configured (`stryker.conf`)
  in the dedicated quality-gate setup phase P08. The final eval (P29) consumes the
  produced mutation report and reruns the hard gate.

## Verification Gate

- [x] Dependencies present: `zod` + `fast-check` (`^4.2.0`, in `agents` devDeps)
      asserted at exec; **`@stryker-mutator/core` ABSENT → added by the quality-gate
      phase (SET3), not assumed present**
- [x] Types match (with corrections recorded)
- [x] Call paths PINNED (PR1/PR2/PR3 resolved here / in P02)
- [x] Test infra ready (file-based FakeProvider understood)

IF SET1/SET2/SET3 are not addressed in their owning phases, STOP and update the plan.

## Success Criteria

- Preflight facts are verified against the current codebase or explicitly corrected.
- Blocking assumptions are pinned before P01 starts.
- The executor creates `project-plans/issue1594/.completed/P00a.md` with verification output.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P00a.md`

Contents:

```markdown
Phase: P00a
Completed: YYYY-MM-DD HH:MM
Files Created: none
Files Modified: none
Verification: paste dependency/type/call-path/test-infra verification outputs
Verdict: PASS
```

