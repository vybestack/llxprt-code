Verdict: PASS

# Independent Plan Review — Issue #1594 (`PLAN-20260617-COREAPI`)

## BLOCKING issues

None found. The current plan artifacts are complete enough to be executed by a coordinator, are faithful to the required #1594 design constraints, and satisfy the project planning/TDD rules.

## NON-BLOCKING issues / improvements

### NON-BLOCKING-1 — P06 contains a stale expected-file note from an earlier file layout

- **Location:** `project-plans/issue1594/plan/06-stubs.md:11-13`; compare P03/P04/P05 file plans in `plan/03-config-schema.md:51-63`, `plan/04-event-schema.md:49-53`, and `plan/05-control-plane-interface.md:51-58`.
- **Problem:** P06 lists expected files as `packages/agents/src/api/types.ts`, `schemas.ts`, but the preceding phases create/use split files such as `config-types.ts`, `config-schema.ts`, `event-types.ts`, `event-schema.ts`, and `agent.ts`.
- **Why it is non-blocking:** P06's real prerequisite is the P05a completion marker (`plan/06-stubs.md:11-12`), and the implementation tasks correctly create/modify the API files under the newer layout (`plan/06-stubs.md:37-48`). A coordinator can still execute the phase.
- **Concrete improvement:** Replace the stale expected-files line with the actual P03-P05 outputs or remove it entirely.

### NON-BLOCKING-2 — `overview.md` still contains historical bootstrap wording, but the executable plan correctly supersedes it

- **Location:** stale historical wording in `project-plans/issue1594/overview.md:68-77`, `:250-257`; corrected executable plan in `specification.md:258-288`, `plan/00a-preflight-verification.md:90-106`, `analysis/pseudocode/createAgent.md:21-112`, and `plan/15-impl-createagent-core.md:42-72`.
- **Problem:** The authoritative design overview still describes the older `createHeadlessProviderManager({ provider, model, apiKey, baseUrl })` bootstrap sketch in places.
- **Why it is non-blocking:** The user-supplied review constraints, specification, preflight corrections, pseudocode, and P15 implementation instructions all pin the executable path to `createIsolatedRuntimeContext({ runtimeId, config, settingsService, model, messageBus })`, reject bare `createHeadlessProviderManager`, and require provider/auth/baseUrl to be applied via runtime mutators after activation. A coordinator following the plan files will not implement the stale sketch.
- **Concrete improvement:** Add a short “superseded by current plan/spec preflight” note near the stale overview sketch to reduce reader confusion.

### NON-BLOCKING-3 — P15 structural check is text-based rather than AST-based

- **Location:** `project-plans/issue1594/plan/15-impl-createagent-core.md:82-103`.
- **Problem:** The check parses the `createIsolatedRuntimeContext({ ... })` object by brace counting over source text to forbid unsupported `provider:`, `apiKey:`, and `baseUrl:` options.
- **Why it is non-blocking:** This is materially stronger than the earlier brittle line-window check and should catch normal implementations. P15 also has semantic checks for runtime mutator use, `await activate`, runtimeId, shared messageBus, and P12 RED seam tests (`plan/15-impl-createagent-core.md:76-120`).
- **Concrete improvement:** If tooling allows, replace the text parser with an AST-based assertion over the actual call expression.

### NON-BLOCKING-4 — P29 example JSON still uses numeric zero placeholders, though adequately warned

- **Location:** `project-plans/issue1594/plan/29-final-plan-quality-eval.md:122-148`.
- **Problem:** The example JSON shows `mutation_score_pct: 0` and `property_pct: 0`.
- **Why it is non-blocking:** P29 explicitly says the block is an example shape only and the numeric fields must be actual computed values (`plan/29-final-plan-quality-eval.md:124`, `:146-148`).
- **Concrete improvement:** Use string placeholders such as `<actual mutation score>` in prose outside JSON, or add a second warning immediately below the example.

## Coverage assessment for T1-T25

All T rows are allocated to prior RED harness phases and later GREEN implementation phases in a coordinator-executable order. The tracker and phase files agree on the important test-first constraints.

- **T1:** RED P11, GREEN P15. Covers createAgent + stream text/thinking/done (`execution-tracker.md:106`; `plan/11-harness-core-behavior.md:42-68`; `plan/15-impl-createagent-core.md:76-80`).
- **T2 / T2b:** RED P11/P10, GREEN P17. Tool call, confirm/result/history/continuation and raw a2a confirmation path (`execution-tracker.md:107`; `plan/11-harness-core-behavior.md:49-54`; `plan/17-impl-tools-approval-loop.md:78-80`).
- **T3 / T3b / T3c:** RED P11, GREEN P17. Denial, live tool output, editor callback (`execution-tracker.md:108`; `plan/17-impl-tools-approval-loop.md:91-99`).
- **T4 / T4b / T4c / T4d / T4e / T4f:** RED P12, GREEN P16/P19. Provider/profile switching, client rebinding, same HistoryService identity, LB failover, stripThoughts (`execution-tracker.md:109`; `plan/12-harness-cli-parity.md:42-49`; `plan/16-impl-switch-context.md:85-92`).
- **T5:** RED P12, GREEN P16. Model/param mutation reaches provider calls, not just getters (`execution-tracker.md:110`; `plan/12-harness-cli-parity.md:50`; `plan/16-impl-switch-context.md:48`, `:58`, `:90`).
- **T6 / T6b / T7 / T8 / T8b:** RED P11, GREEN P20. History, session, reset, explicit/auto compression, stats (`execution-tracker.md:111`; `plan/20-impl-history-session-compression.md:58-63`, `:84-89`).
- **T9:** RED P11, GREEN P15. Abort mid-stream + exactly one `done` (`execution-tracker.md:112`; `plan/11-harness-core-behavior.md:57`; `plan/15-impl-createagent-core.md:78-80`).
- **T10:** RED P11, GREEN P21. Detached side-channel generation (`execution-tracker.md:113`).
- **T11:** RED P11, GREEN P17. onApproval auto-answer and headless completion (`execution-tracker.md:114`; `plan/17-impl-tools-approval-loop.md:78-80`).
- **T12 / T12b:** RED P12, GREEN P22/P25. Static/instance discovery and MCP status/tools (`execution-tracker.md:115`; `plan/22-impl-mcp-ide.md:75-80`; `plan/25-impl-discovery-helpers.md:54-59`).
- **T13:** RED P13, GREEN P15 initial and P24 full. Per-resource disposal (`execution-tracker.md:116`; `plan/13-harness-resource-leak.md:16-26`, `:62-65`).
- **T14 / T14b:** RED P12/P11, GREEN P17/P20. Todo continuation and history/system/directory context (`execution-tracker.md:117`; `plan/11-harness-core-behavior.md:61-62`; `plan/20-impl-history-session-compression.md:88`).
- **T15 / T15b / T15c:** RED P12, GREEN P22/P23. IDE, lifecycle hooks, save_memory refresh (`execution-tracker.md:118`; `plan/22-impl-mcp-ide.md:75-80`; `plan/23-impl-hooks-scheduler-sandbox.md:87-91`).
- **T16:** RED P10, GREEN P14/P15. All 21 variants, source categories, exactly-one-done (`execution-tracker.md:119`; `plan/10-harness-event-characterization.md:43-66`, `:95-102`; `plan/14-impl-adapters.md:89-103`).
- **T17:** RED P09, GREEN once boundary imports are clean. No deep imports (`execution-tracker.md:120`; `plan/09-harness-static-boundary.md:16-25`, `:43-48`).
- **T18 / T18b / T18c:** RED P12, GREEN P18. Auth precedence, key storage/profile-save, OAuth prompt/no-handler (`execution-tracker.md:121`; `plan/12-harness-cli-parity.md:60-62`).
- **T18d:** RED P12, GREEN P19. Profiles CRUD/apply (`execution-tracker.md:122`; `plan/12-harness-cli-parity.md:63`).
- **T18e:** RED P12, GREEN P23. Sandbox create-time/status/recreate boundary is covered before implementation (`execution-tracker.md:123`; `plan/12-harness-cli-parity.md:64`, `:108-109`; `plan/23-impl-hooks-scheduler-sandbox.md:91`).
- **T19:** RED P13, GREEN P23. Scheduler factory used and created instances disposed (`execution-tracker.md:124`; `plan/13-harness-resource-leak.md:28-37`; `plan/23-impl-hooks-scheduler-sandbox.md:90`).
- **T20:** RED P12, GREEN P22. MCP discovery gate and failure mapping (`execution-tracker.md:125`; `plan/12-harness-cli-parity.md:65`; `plan/22-impl-mcp-ide.md:81-86`).
- **T21:** RED P11, GREEN P17. Multi-tool sequencing (`execution-tracker.md:126`; `plan/11-harness-core-behavior.md:63`; `plan/17-impl-tools-approval-loop.md:97-98`).
- **T22:** RED P11/P12, GREEN P26. Non-interactive AgentResult/output/error mapping (`execution-tracker.md:127`; `plan/11-harness-core-behavior.md:64`).
- **T23 / T24:** RED P09, GREEN P27. Runtime-vs-app-service boundary and command/completion map (`execution-tracker.md:128`; `plan/09-harness-static-boundary.md:27-37`; `plan/27-impl-app-service-subpaths.md:39-84`).
- **T25:** RED P12, GREEN P15/P25. Provider-by-name one-call bootstrap/shared runtime/static discovery is explicitly RED before P15 (`execution-tracker.md:129`; `plan/12-harness-cli-parity.md:66`, `:76-77`; `plan/15-impl-createagent-core.md:76-80`; `plan/25-impl-discovery-helpers.md:54-59`).

## Coverage assessment for REQ-001..REQ-021

- **REQ-001:** Covered by P05/P15/P26, with shared runtime context, runtimeId, post-auth client, and T25/T1 (`execution-tracker.md:80`; `specification.md:258-296`; `plan/15-impl-createagent-core.md:16-25`).
- **REQ-002:** Covered by P03/P14/P23, including field classification and sandbox boundary (`execution-tracker.md:81`; `plan/03-config-schema.md:16-26`; `plan/23-impl-hooks-scheduler-sandbox.md:16-25`).
- **REQ-003:** Covered by P04/P10/P14/P15/P26, including 21 variants and exactly-one-done (`execution-tracker.md:82`; `plan/10-harness-event-characterization.md:16-25`; `analysis/pseudocode/event-adapter.md:210-245`).
- **REQ-004:** Covered by P16 with real providers/runtime mutators and rebuildLoop (`execution-tracker.md:83`; `plan/16-impl-switch-context.md:16-25`, `:42-58`).
- **REQ-005:** Covered by P16 and T4d/T4e/T4f identity/context assertions (`execution-tracker.md:84`; `plan/16-impl-switch-context.md:27-36`, `:87-89`).
- **REQ-006:** Covered by P03/P05/P15/P17/P23/P24, including confirmation IDs, safe denial, scheduler factory, and disposal (`execution-tracker.md:85`; `specification.md:341-381`; `plan/17-impl-tools-approval-loop.md:16-39`).
- **REQ-007:** Covered by P17 using AgenticLoop, not reimplementation (`execution-tracker.md:86`; `plan/17-impl-tools-approval-loop.md:41-54`, `:70-74`).
- **REQ-008:** Covered by P18 with RED harness in P12 (`execution-tracker.md:87`; `plan/12-harness-cli-parity.md:60-62`).
- **REQ-009:** Covered by P19 with RED harness in P12 (`execution-tracker.md:88`; `plan/12-harness-cli-parity.md:43`, `:63`).
- **REQ-010:** Covered by P20 with stats/history/session (`execution-tracker.md:89`; `plan/20-impl-history-session-compression.md:16-30`, `:58-63`).
- **REQ-011:** Covered by P20 explicit/automatic compression separation (`execution-tracker.md:90`; `plan/20-impl-history-session-compression.md:33-47`, `:88`).
- **REQ-012:** Covered by P21; RED T10 in P11 (`execution-tracker.md:91`, `:113`).
- **REQ-013:** Covered by P22 with MCP runtime/gate/failure semantics (`execution-tracker.md:92`; `plan/22-impl-mcp-ide.md:16-35`).
- **REQ-014:** Covered by P22 IDE surface (`execution-tracker.md:93`; `plan/22-impl-mcp-ide.md:37-51`).
- **REQ-015:** Covered by P23 hooks/lifecycle/save_memory refresh (`execution-tracker.md:94`; `plan/23-impl-hooks-scheduler-sandbox.md:16-29`).
- **REQ-016:** Covered by P15 initial and P24 full dispose; RED T13 in P13 (`execution-tracker.md:95`; `plan/13-harness-resource-leak.md:16-26`).
- **REQ-017:** Covered by P03/P04/P05/P25 static and instance discovery (`execution-tracker.md:96`; `plan/25-impl-discovery-helpers.md:16-31`).
- **REQ-018:** Covered by P07 non-breaking root + `./internals.js` (`execution-tracker.md:97`; `plan/07-export-strategy.md:18-33`, `:39-48`).
- **REQ-019:** Covered by P08/P09/P13, including early Stryker/property tooling and no-deep-import boundary (`execution-tracker.md:98`; `plan/08-quality-gate-setup.md:16-25`; `plan/09-harness-static-boundary.md:16-25`).
- **REQ-020:** Covered by P28/P28a docs (`execution-tracker.md:99`; `plan/28-docs-agent-api.md:14-31`).
- **REQ-021:** Covered by P26/P27 and RED boundary harness P09/P12 (`execution-tracker.md:100`; `plan/27-impl-app-service-subpaths.md:16-31`, `:39-84`).

## Explicit assessment

- **Design fidelity:** YES. The plan follows the required #1594 strategy: public API in `@vybestack/llxprt-code-agents`, full control plane, non-breaking additive exports, `./internals.js`, shared runtime context, shared messageBus seam, no-handler safe denial, legal stats path, event mapping, and #1595-sequenced trim.
- **Full harness/REQ coverage:** YES. T1-T25 and REQ-001..REQ-021 are allocated to RED and GREEN phases, with the requested special RED coverage for provider-runtime messageBus, T25 provider-by-name bootstrap, and T18e sandbox boundary before implementation.
- **TDD soundness:** YES. Stubs precede RED harness phases; P12 writes the provider-runtime messageBus contract tests before P15; implementation phases turn existing RED tests green; quality tooling is set up in P08 before harness/implementation and hard-enforced in P29.
- **Pseudocode discipline:** YES. The pseudocode files are numbered and implementation phases cite concrete step ranges. Deepthinker verification is assigned to P14a/P15a/P16a/P17a/P24a and P29 checks no unused pseudocode.
- **Integration not isolated:** YES. Harness layers explicitly use real Agent/FakeProvider/CoreToolScheduler/MessageBus with only external infra fakes, enforce no-deep-import boundaries, cover CLI parity and a2a/raw-stream paths, and add app-service public subpaths.
- **Coordination executability:** YES. Phase IDs match filenames, sequencing is contiguous P00a → P01/P01a through P28/P28a → P29, and each phase has a single named worker/verifier role plus completion markers.
- **Open-question decisions correctness:** YES. Package entry, full control-plane scope, public sub-surfaces, no-handler confirmation, idle-timeout terminality, stats import path, command/app-service boundary, sandbox recreate boundary, a2a future, and core/index trim sequencing are decided and propagated.
- **Correctness-risk handling:** YES. The plan directly handles the high-risk areas: unsupported runtime-context options, provider/auth/baseUrl runtime mutator ordering, shared messageBus seam, AgenticLoop client caching via rebuildLoop, safe denial, stats dependency legality, 21-event mapping, FakeProvider source categories, property/mutation gates, resource teardown, MCP discovery, and app-service boundary.
