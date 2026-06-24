Verdict: FAIL

# Deepthinker Review — Issue #1594 implementation-plan artifacts

The plan is substantially improved and is directionally faithful to `overview.md`: it chooses `@vybestack/llxprt-code-agents`, keeps #1594 non-breaking for current low-level top-level exports, uses `createIsolatedRuntimeContext`, requires a shared runtime id and shared bus seam, recognizes that `AgenticLoop` caches its constructor client and therefore requires `rebuildLoop()`, documents safe-denial confirmation semantics, includes the MCP discovery decision, and maps the 21 `GeminiEventType` variants with an exactly-one-`done` invariant.

However, it still fails as an executable coordinator/subagent plan because several phase files are internally inconsistent with `PLAN-TEMPLATE.md` or with adjacent phases. These are not merely cosmetic: a coordinator/verifier following them literally can fail valid work, break current consumers before #1595, or leave required typed surface area under-specified.

## BLOCKING issues

### B1 — Several `Requirements Implemented (Expanded)` sections do not satisfy `PLAN-TEMPLATE.md`

**Location:**
- `project-plans/issue1594/plan/03-config-schema.md:28-34`
- `project-plans/issue1594/plan/04-event-schema.md:28-34`
- `project-plans/issue1594/plan/15-impl-createagent-core.md:27-29`

**Problem:**
`PLAN-TEMPLATE.md` requires each requirement/scenario in `Requirements Implemented (Expanded)` to include `Full Text`, `Behavior`, and `Why This Matters`. Three phase files introduce an additional `### REQ...` heading without the required trio:

- P03 has `### REQ-017 (config-relevant projection types only)` with prose only.
- P04 has `### REQ-003 (event projection types)` with prose only.
- P15 has `### REQ-003: typed AgentEvent stream wired into chat()/stream()` with only `Full Text`, no `Behavior` or `Why This Matters`.

**Why it matters:**
This violates the governing plan template and weakens subagent execution. These are phases that define public types and core bootstrap/stream behavior; missing behavior/why expansions make it easier for a worker to implement structure-only surfaces or for a verifier to check markers instead of semantics.

**Concrete fix:**
For each listed heading, either merge it into the preceding requirement expansion or add the full required structure:

- `**Full Text**`: complete requirement text, not a reference.
- `**Behavior**`: GIVEN/WHEN/THEN bullets.
- `**Why This Matters**`: concrete user/API value.

Then add a simple review check to the plan or final evaluation that counts `### REQ` headings versus `Full Text`/`Behavior`/`Why This Matters` occurrences for worker phase files.

### B2 — P06/P06a contradict the non-breaking export strategy and can break current CLI/a2a consumers before P07

**Location:**
- `project-plans/issue1594/plan/06-stubs.md:45-46`, `:70-75`
- `project-plans/issue1594/plan/06a-stubs-verification.md:29-30`
- `project-plans/issue1594/plan/07-export-strategy.md:18-24`, `:40-53`
- Authoritative design: `overview.md` §3.1/§6 and specification decision that #1594 adds public Agent API from `@vybestack/llxprt-code-agents` while #1595 owns CLI migration/final trimming.

**Problem:**
P07 correctly says #1594 must be non-breaking: add `./internals.js`, add the public Agent API, and keep existing low-level top-level exports until #1595 migrates CLI/a2a and trims. But P06/P06a require the `packages/agents/src/api/index.ts` barrel to be “curated” and verify that the “curated barrel [is] limited to public symbols (no AgentClient/CoreToolScheduler leaking — those come via subpath in P07)”. At P06, `./internals.js` does not exist yet, and the existing package top-level still needs to serve current consumers.

**Why it matters:**
A worker or verifier can interpret P06/P06a as requiring removal/non-exposure of low-level symbols before the internals subpath exists. That is exactly the breaking change P07 and the authoritative design prohibit. Current CLI/a2a consumers still import low-level symbols from the agents top-level until #1595.

**Concrete fix:**
Rewrite P06/P06a to say:

- `packages/agents/src/api/index.ts` is the curated **new API sub-barrel** only.
- `packages/agents/src/index.ts` remains unchanged or only additively re-exports the new API until P07.
- No verification in P06/P06a should require `AgentClient`/`CoreToolScheduler` to disappear from the package top-level.
- P07 remains the additive export phase: `./internals.js` is added and existing top-level low-level exports are kept until #1595.

### B3 — P03 does not verify the complete `AgentConfig` typed field set promised by the authoritative design

**Location:**
- `overview.md` §4.2 lists additional typed fields: `folderTrust`, `embeddingModel`, `debugMode`, `continueOnFailedApiCall`, `allowedTools`, `coreTools`, `toolDiscoveryCommand`, `toolCallCommand`, `mcpServerCommand`, `allowedMcpServers`, `blockedMcpServers`, `mcpEnabled`, `extensionsEnabled`, `compressionThreshold`, `projectHooks`, `disabledHooks`, and others.
- `project-plans/issue1594/specification.md:292-300` requires every consumer-relevant field to be classified to typed field, sub-surface, or documented settings entry.
- `project-plans/issue1594/plan/03-config-schema.md:76-79` verifies only a subset of fields.
- `analysis/pseudocode/config-adapter.md` steps 60-72 references several omitted fields, creating a mismatch with P03 verification.

**Problem:**
P03’s verification loop omits several fields that `overview.md` explicitly requires the planner to classify and that the pseudocode says are covered by the typed classification table. The phase says the “typed first-class config fields enumerated in specification.md §4.2” are defined, but the actual verification is not comprehensive and does not force an explicit typed/sub-surface/settings classification for every field from the authoritative design.

**Why it matters:**
REQ-002 is a core design deliverable. If CLI-needed fields are accidentally omitted from `AgentConfig`, #1595 either deep-imports internals again or pushes fields into the unstable `settings` hatch without design justification. This is exactly what `overview.md` forbids.

**Concrete fix:**
Add a concrete `ConfigParameters → AgentConfig typed | Agent sub-surface | app-service | settings` classification table to P03 (or an explicit artifact created by P03) and make P03/P03a verify every field from `overview.md` §4.2 and the current `ConfigParameters` type. The verification loop must include the omitted fields or verify their documented non-typed classification with rationale. In particular, cover `folderTrust`, `embeddingModel`, `debugMode`, `continueOnFailedApiCall`, `allowedTools`, `coreTools`, `toolDiscoveryCommand`, `toolCallCommand`, `mcpServerCommand`, `allowedMcpServers`, `blockedMcpServers`, `mcpEnabled`, `extensionsEnabled`, `compressionThreshold`, `projectHooks`, and `disabledHooks`.

### B4 — P15’s shared `MessageBus` seam is a production change to `providers`, but no dedicated test/contract phase isolates the package-boundary impact

**Location:**
- `analysis/pseudocode/createAgent.md` “PINNED bus-ownership model” section and steps 33-58.
- `project-plans/issue1594/plan/15-impl-createagent-core.md:35-37`, `:52-58`, `:92-100`.

**Problem:**
The plan correctly identifies that `createIsolatedRuntimeContext` currently creates a private bus and that #1594 needs a seam (`messageBus?: MessageBus`) so OAuth/config initialize/tool/hook channels share one bus. But this is a cross-package production change in `packages/providers/src/runtime/runtimeContextFactory.ts` introduced inside the large P15 bootstrap implementation. P15’s verification mostly greps for `messageBus`; it does not require a focused providers-runtime unit/contract test proving both paths:

1. existing callers without `messageBus` still get the old private-bus behavior, and
2. `createAgent` callers with `messageBus` get the exact provided instance bound to the context-created OAuthManager.

**Why it matters:**
This seam is central to REQ-001/REQ-006/REQ-008/REQ-015. If it is wrong, OAuth prompts/status, tool confirmations, and hook events split across buses. Because it changes `providers`, a broad P15 grep is not a strong enough executable contract and may miss regressions for existing runtime-context users.

**Concrete fix:**
Add to P15 (or split a small preceding phase) explicit tests in the providers package for `createIsolatedRuntimeContext`:

- no `messageBus` option preserves current behavior and type compatibility;
- provided `messageBus` is used as the session bus for OAuthManager/runtime context;
- `handle.activate()` still registers the same config/settings/providerManager under the runtime id.

P15/P15a should then run those targeted tests, not only grep for `messageBus`.

## NON-BLOCKING issues / improvements

1. **P15 runtimeId verifier is acceptable but still grep-based.** `plan/15-impl-createagent-core.md:70-74` now checks a 12-line window after `createAgentRuntimeState`, which is robust enough for ordinary multiline calls. Prefer an AST-based check or a targeted unit test that asserts the runtime state id equals the shared runtime-context id, but this is no longer blocking.
2. **P14 uses pseudocode step labels correctly.** `plan/14-impl-adapters.md:57-68` cites numbered pseudocode step labels (`steps 10-24`, `210-245`) rather than physical file line ranges. This satisfies the requested discipline; keep verifier language consistently saying “step labels”.
3. **Verification commands use `--testNamePattern`, not `--grep`.** The current generated phase files use Vitest-compatible `--testNamePattern` for test filtering. Old review artifacts and `issue-update.md` contain stale text, but the generated plan phases are acceptable.
4. **P27 is much improved.** It now forbids unsupported/deferred `Result` placeholders for required T23/T24 commands and requires behavior-real backing or explicit CLI-local classification. Keep this wording; do not weaken it during execution.
5. **Stats import path is now correct.** P20/P20a explicitly require `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js` plus `HistoryService`, and forbid direct `@vybestack/llxprt-code-telemetry` under `packages/agents/src/api`.

## Coverage assessment summary — T1-T25

| T-row | Planned RED | Planned GREEN | Assessment |
|---|---:|---:|---|
| T1 | P11 | P15 | Covered |
| T2/T2b | P11/P10 | P17 | Covered |
| T3/T3b/T3c | P11 | P17 | Covered |
| T4/T4b/T4c/T4d/T4e/T4f | P12 | P16/P19 | Covered, including same-HistoryService assertions |
| T5 | P12 | P16 | Covered |
| T6/T6b/T7 | P11 | P20 | Covered |
| T8/T8b | P11 | P20 | Covered, with legal stats source |
| T9 | P11 | P15 | Covered |
| T10 | P11 | P21 | Covered |
| T11 | P11 | P17 | Covered, safe-denial semantics specified |
| T12/T12b | P12 | P22/P25 | Covered |
| T13 | P13 | P15/P24 | Covered, teardown table-driven |
| T14/T14b | P12/P11 | P17/P20 | Covered |
| T15/T15b/T15c | P12 | P22/P23/P17/P20 | Covered |
| T16 | P10 | P14/P15 | Covered, 21 variants represented |
| T17 | P09 | Boundary guard after exports/imports | Covered |
| T18/T18b/T18c | P12 | P18 | Covered |
| T18d | P12 | P19 | Covered |
| T18e | P12 | P23 | Covered |
| T19 | P13 | P23/P24 | Covered, scheduler factory ownership specified |
| T20 | P12 | P22 | Covered, MCP discovery semantics specified |
| T21 | P11 | P17 | Covered |
| T22 | P11/P12 | P26 | Covered |
| T23/T24 | P09 | P27 | Covered, now requires behavior-real app-service backing |
| T25 | P11 | P15/P25 | Covered |

Harness coverage is nominally complete. The coverage table is acceptable once the blocking phase-executability issues above are fixed.

## Coverage assessment summary — REQ-001..REQ-021

| REQ | Phase coverage | Assessment |
|---|---|---|
| REQ-001 | P05/P06/P11/P15/P26 | Covered; shared context/runtimeId/activate/rebuildLoop specified. Needs stronger bus-seam contract test (B4). |
| REQ-002 | P03/P14/P23 | Covered in intent, but incomplete typed-field verification/classification is blocking (B3). |
| REQ-003 | P04/P10/P14/P15/P26 | Covered; 21 variants and exactly-one-done represented. P04/P15 requirement expansion defect is blocking (B1). |
| REQ-004 | P16 | Covered, including real runtime mutators and rebuildLoop. |
| REQ-005 | P16 | Covered, including same HistoryService and stripThoughts. |
| REQ-006 | P03/P05/P13/P15/P17/P23/P24 | Covered, including correlationId/toolCallId and scheduler factory ownership. |
| REQ-007 | P17 | Covered. |
| REQ-008 | P18 | Covered, precedence/buckets/OAuth/key storage. |
| REQ-009 | P19 | Covered. |
| REQ-010 | P20 | Covered. |
| REQ-011 | P20 | Covered. |
| REQ-012 | P21 | Covered. |
| REQ-013 | P05/P12/P22 | Covered, including `TurnOptions.mcpDiscovery` and `AgentError.code:'mcp_discovery_failed'`. |
| REQ-014 | P22 | Covered. |
| REQ-015 | P23 | Covered. |
| REQ-016 | P15/P24 | Covered. |
| REQ-017 | P03/P04/P05/P25 | Covered in intent, but P03/P04 requirement expansion defects are blocking (B1). |
| REQ-018 | P07 | Covered; P06/P06a contradict sequencing and must be fixed (B2). |
| REQ-019 | P08/P09/P13/P29 | Covered. |
| REQ-020 | P28 | Covered. |
| REQ-021 | P09/P26/P27 | Covered; P27 now forbids deferred placeholders. |

## Explicit yes/no assessment

- **Design fidelity to `overview.md`: YES, with blocking execution inconsistencies.** The main architectural choices match the authoritative design: Agent API in `@vybestack/llxprt-code-agents`, full control plane, shared runtime context, non-breaking #1594 export strategy, safe-denial public confirmation behavior, 21-event mapping, and #1595 owns CLI migration/core trim.
- **Full harness/REQ coverage: YES nominally, but NOT executable until blockers are fixed.** All T rows and REQs are mapped, but B1/B2/B3/B4 prevent a clean PASS.
- **TDD soundness: YES in structure.** Stubs precede RED harness phases; implementation phases follow. Tests are described as behavioral with real Agent/FakeProvider/CoreToolScheduler/MessageBus and no reverse tests/mock theater. Quality gates are early and final evaluation consumes them.
- **Pseudocode discipline: YES.** Pseudocode is contract-first, numbered, and implementation phases cite step labels rather than nonexistent physical line ranges. No orphan pseudocode found.
- **Integration: YES.** CLI/a2a consumers and no-deep-import boundary are real acceptance concerns, not isolated unit work. P27 makes app-service backing behavior-real.
- **Coordination executability: NO.** Phase numbering is contiguous and P01 correctly requires executed `.completed/P00a.md`, but B1/B2/B3/B4 are concrete coordinator/subagent execution defects.
- **Open-question decisions: YES.** Entry package, control-plane scope, safe-denial semantics, idle timeout terminality, core trim sequencing, stats source, MCP discovery gate, app-service boundary, and a2a raw-loop stance are decided.
- **Correctness-risk handling: NO until blockers are fixed.** The plan identifies the right risks (event mapping/done synthesis; stopped vs blocked; client rebinding/rebuildLoop; shared provider/config/OAuth/message bus; confirmation correlationId; dispose ownership; MCP discovery; scheduler factory), but B2/B3/B4 can still lead to breaking exports, incomplete config API, or split bus behavior during execution.
