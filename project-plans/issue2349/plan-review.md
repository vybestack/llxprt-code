# Review of PLAN-20260707-AGENTNEUTRAL for Issue #2349

## Verdict: REJECT

The plan is unusually thorough and is clearly aimed at avoiding the rejected #2424 source-swap failure mode. It correctly inventories the existing synthetic `GenerateContentResponse` round-trip, the two side-channels, the `toGeminiContents` structural converter sites, the cross-package `clientContract.ts` blast radius, and the need for a structural/AST gate. However, it still has blocking inconsistencies that a mechanical coordinator could execute into a bad migration: the usage-metadata phase contradicts its own “declared public type unchanged” decision by requiring a `reasoningTokens` public field that does not exist; the core usage-metadata check is described as enforcing an internal feed for a production-dead event; the final “remaining retypes” characterization phase claims to pin the chatSession facade but never creates or runs a chatSession facade test; several verification phases are malformed against the plan template; and the gate’s staged `--count` metric intentionally excludes several acceptance-critical checks until P31, creating a window where slices can pass the shrink-ratchet while still leaving non-counted structural bypasses. These are not cosmetic issues; they affect acceptance criterion 2b, behavioral coverage, method-doc compliance, and fraud resistance.

---

## Critical findings

### Critical 1 — P19 requires a public `reasoningTokens` field while also requiring the public usage type to remain unchanged

**Assessment area:** TDD correctness; fidelity to overview + §7A structural avoidance; executability & correctness; requirements coverage.

**Location in plan:** `project-plans/issue2349/plan/19-usage-metadata-boundary-impl.md:21-27`, `:61-67`, `:71-73`.

**Problem:** P19 commits to §7A option (C): keep the declared public `UsageMetadataValue` / `FinishedValue.usageMetadata` shape Gemini-named and unchanged, then add a boundary mapper. But the same phase adds an OQ-14 requirement that the public usage metadata includes `reasoningTokens`. That is contradictory and non-executable as written: `reasoningTokens` is a neutral/internal `UsageStats` field name, not present in the current public Gemini-named API type. A coordinator following P19 literally must either (a) change the declared public type, violating the phase’s own “UNCHANGED” / “no option-B” mandate, or (b) leave `reasoningTokens` absent and fail P19’s success condition.

**Evidence:**
- P19 says the public usage metadata stays Gemini-named and unchanged: `project-plans/issue2349/plan/19-usage-metadata-boundary-impl.md:21-27` says option (C) writes `usageStatsToPublicUsageMetadata`, keeps the public type unchanged, and emits Gemini-named public usage keys.
- P19 repeats this in tasks: `project-plans/issue2349/plan/19-usage-metadata-boundary-impl.md:71-73` says the declared public `UsageMetadataValue` / `FinishedValue.usageMetadata` type is unchanged and option B is rejected.
- The same phase requires `reasoningTokens` on public usage metadata: `project-plans/issue2349/plan/19-usage-metadata-boundary-impl.md:61-67` says “The public usage event exposes reasoning tokens (`reasoningTokens`)” and “THEN: `reasoningTokens` is present on the public usage metadata.”
- The actual public type has no `reasoningTokens`: `packages/agents/src/api/event-types.ts:32-37` defines `UsageMetadataValue` with only `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, and `cachedContentTokenCount`; `FinishedValue.usageMetadata` uses that type at `packages/agents/src/api/event-types.ts:39-41`.
- The live CLI consumers cited by the plan read the existing Gemini-named fields, not `reasoningTokens`: `packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts:406-407` reads `event.usage.promptTokenCount`; `packages/cli/src/zed-integration/zedIntegration.ts:614-615` reads `usage.candidatesTokenCount` / `usage.totalTokenCount`.
- The overview explicitly says OQ-14 still requires deciding whether public usage exposes reasoning tokens under legacy or neutral naming: `project-plans/issue2349/overview.md:856` says the direct path must populate internal `UsageStats.reasoningTokens` and decide whether the public usage event exposes reasoning tokens under a legacy or neutral name.

**Required fix:** Split OQ-14 into internal and public decisions. At minimum:
1. Require direct and streaming neutral paths to preserve `UsageStats.reasoningTokens` internally (`ModelOutput.usage` / `ModelStreamChunk.usage`) without requiring a new public field.
2. If the public wire must expose reasoning tokens in this issue, explicitly extend `UsageMetadataValue` / `event-schema.ts` with a Gemini-compatible field name and add owning CLI/API migration/tests; otherwise state public reasoning-token exposure is out of scope for #2349 and verify only internal preservation.
3. Update P19, P18/P19 tests, specification REQ-007/OQ-14 text, and acceptance mapping so there is one coherent target.

---

### Critical 2 — P26 claims chatSession facade behavioral coverage but does not create or run any chatSession characterization test

**Assessment area:** TDD correctness; requirements & acceptance coverage; scope & risk.

**Location in plan:** `project-plans/issue2349/plan/26-remaining-retypes-tdd.md:13-25`, `:29-46`, `:50-59`.

**Problem:** P26 is the characterization phase that must protect the final “remaining group” retype before P27 reaches zero production `@google/genai` imports. It explicitly includes the chatSession facade in the covered scope and success criteria, but the files to create/confirm and verification command omit any chatSession facade test. That means a coordinator can proceed to P27 with compression, agenticLoop, API session-control, and TodoContinuation pinned, while the chatSession facade migration is not directly characterized in this phase despite the plan claiming it is.

**Evidence:**
- P26 scope includes the chatSession facade: `project-plans/issue2349/plan/26-remaining-retypes-tdd.md:13` says it covers `chatSession.ts`; `:20-25` includes “chatSession facade stream” in GIVEN/THEN.
- P26’s assertion list includes chatSession: `project-plans/issue2349/plan/26-remaining-retypes-tdd.md:39` says “chatSession facade: `sendMessageStream(AgentMessageInput)` emits the same `ServerAgentStreamEvent` sequence.”
- But the actual files to create/confirm are only four files: compression, agenticLoop, apiSessionControl, and todoContinuation (`project-plans/issue2349/plan/26-remaining-retypes-tdd.md:29-33`). No chatSession facade test file is listed.
- The verification command runs only those same four test areas (`project-plans/issue2349/plan/26-remaining-retypes-tdd.md:50-57`), and the property ratio is computed over those four files only.
- The success criteria nevertheless claim “chatSession behavior pinned”: `project-plans/issue2349/plan/26-remaining-retypes-tdd.md:59`.
- The actual tree has chatSession facade methods that will be affected by this migration: `packages/agents/src/core/chatSession.ts:502-503` returns `Content[]` from `getHistory`, and `packages/agents/src/core/client.ts:403-421` currently returns Google-shaped history through `ContentConverters.toGeminiContents`.

**Required fix:** Add an explicit chatSession facade characterization test file to P26 (or move the facade out of P26’s claimed scope and into an already-existing phase with evidence). The test must run in P26 verification and be included in the aggregate property-ratio calculation. It should assert observable `sendMessageStream` event ordering and history behavior through the public facade, not `Content[]` / `{role,parts}` internals.

---

### Critical 3 — P19’s “core-owned event shape check” is underspecified and internally inconsistent with the overview’s production-dead `ServerUsageMetadataEvent` inventory

**Assessment area:** fidelity to overview + #2424 structural avoidance; executability & correctness; requirements coverage.

**Location in plan:** `project-plans/issue2349/plan/19-usage-metadata-boundary-impl.md:29-35`, `:75-76`, `:98-104`.

**Problem:** The plan tries to close the agents-gate scope hole by adding a core test for `ServerUsageMetadataEvent`, but it describes the test as asserting the event “remains in the agreed neutral/decided shape” and that “internal usage feeding it is neutral.” This is not a concrete executable target. The overview states `ServerUsageMetadataEvent` is core-owned and currently Gemini-named, but also production-dead: no production code emits it. Therefore there is no actual “internal usage feeding it” to trace. The plan can pass with a shape snapshot that does not enforce anything relevant, or fail because the event remains Gemini-named under option (C). This weakens acceptance criterion 2b because the compensating core check is the only mechanism the plan offers for the core-owned scope caveat.

**Evidence:**
- P19 says the core test should assert the event remains in an “agreed neutral/decided shape” and internal usage feeding it is neutral: `project-plans/issue2349/plan/19-usage-metadata-boundary-impl.md:75-76`.
- P19’s requirement text similarly says the CI check “fails if internal Google-shaped usage is reintroduced upstream of the boundary”: `project-plans/issue2349/plan/19-usage-metadata-boundary-impl.md:29-35`.
- Actual core type is currently Gemini-named: `packages/core/src/core/turn.ts:221-228` defines `ServerUsageMetadataEvent`; `packages/core/src/core/turn.ts:241-245` separately defines `ServerFinishedEvent.value.usageMetadata?: UsageStats`, which is neutral.
- Overview says `ServerUsageMetadataEvent` has zero production emitters and only a test helper constructs it: `project-plans/issue2349/overview.md:723-732`. That means there is no production “internal usage feeding it” for the proposed test to validate.
- Overview also says this scope limitation must be handled either by a separate core-package check or by tracking the decision in the cross-package migration, and that an agents-only gate cannot enforce it: `project-plans/issue2349/overview.md:790-793`.

**Required fix:** Make REQ-007.3 executable and explicit. Either:
1. State `ServerUsageMetadataEvent` remains a documented Gemini-named public-wire exception, add a focused test that asserts the type/schema/adapter behavior selected by option (C), and do not claim it is fed by neutral production emitters; or
2. Migrate/remove the dead `ServerUsageMetadataEvent` shape in core under a concrete phase with owning tests and CLI/core blast-radius coverage.

In either case, update P19 and P33 so §9.1-2b is not signed off by a vague “shape check” that cannot prove the core-owned exception is bounded.

---

## Major findings

### Major 1 — Multiple NNa verification phases are malformed against the mandatory phase-template section name

**Assessment area:** method-doc compliance.

**Location in plan:** `project-plans/issue2349/plan/07a-streamprocessor-impl-verification.md:14`, `29a-enforcement-gate-stub-verification.md:11`, `30a-enforcement-gate-tdd-verification.md:11`, `31a-enforcement-gate-impl-verification.md:11`.

**Problem:** The plan template requires every phase to include `## Requirements Implemented (Expanded)`. The shared verification template says NNa phases may express gate-level GWT, but still says each NNa file must carry the full phase structure and mentions “Requirements Implemented (Expanded)” / “Requirements Verified” as a verification-phase form. Four NNa files use only `## Requirements Verified (Expanded — full GIVEN/WHEN/THEN, Major 1)` and do not include the required exact section heading. A mechanical coordinator or checker following `PLAN-TEMPLATE.md` will mark these phases malformed.

**Evidence:**
- `PLAN-TEMPLATE.md:23-25` says each phase must follow the phase template; `PLAN-TEMPLATE.md:41-53` names `## Requirements Implemented (Expanded)` and requires full requirement text with GIVEN/WHEN/THEN.
- The shared verification template confirms every NNa file itself carries the full phase structure: `project-plans/issue2349/plan/verification-template.md:1-3`.
- It further says every NNa requirement block must have the three labeled GWT bullets: `project-plans/issue2349/plan/verification-template.md:5-13`.
- Four files use a different heading and omit the exact required heading: `project-plans/issue2349/plan/07a-streamprocessor-impl-verification.md:14`; `project-plans/issue2349/plan/29a-enforcement-gate-stub-verification.md:11`; `project-plans/issue2349/plan/30a-enforcement-gate-tdd-verification.md:11`; `project-plans/issue2349/plan/31a-enforcement-gate-impl-verification.md:11`.

**Required fix:** Add or rename to the exact required heading `## Requirements Implemented (Expanded)` in every NNa file, while retaining the verification wording inside it if desired. Re-run a mechanical heading check over all executable phases.

---

### Major 2 — Several verification phases use generic verification tasks instead of concrete phase-specific command evidence

**Assessment area:** method-doc compliance; TDD correctness; executability.

**Location in plan:** especially `project-plans/issue2349/plan/29a-enforcement-gate-stub-verification.md:31-35`, `30a-enforcement-gate-tdd-verification.md:26-29`, `31a-enforcement-gate-impl-verification.md:31-37`.

**Problem:** Several NNa phases list high-level checklist bullets but not concrete commands that would actually produce the evidence. For example, P29a says “Both gate scripts + allow-list artifact exist and compile; scripts run without crashing” without the `npx tsx ...` commands or fixture invocations; P30a says fixtures cover all vectors but not the actual test command; P31a says “verify by adding a fake inline comment” without a reproducible command. This weakens the fraud-detection and makes the phase harder to execute mechanically.

**Evidence:**
- `PLAN-TEMPLATE.md:83-99` requires verification commands with concrete automated checks.
- P29a verification commands are checklist prose only at `project-plans/issue2349/plan/29a-enforcement-gate-stub-verification.md:31-35`.
- P30a similarly lacks explicit `npm test -- scripts/__tests__/...` and `prop_ratio ...` commands in its Verification Commands section: `project-plans/issue2349/plan/30a-enforcement-gate-tdd-verification.md:26-29`.
- P31a lacks the concrete gate commands that P31 itself lists (`npm test`, `npm run lint:agents-neutral-gate`, `npm run lint:agents-neutral-test-gate`, `npx tsx ... --count`), and instead uses checklist prose: `project-plans/issue2349/plan/31a-enforcement-gate-impl-verification.md:31-37`. The sibling P31 implementation phase does have concrete commands at `project-plans/issue2349/plan/31-enforcement-gate-impl.md:109-122`, proving the verification sibling can be made precise.

**Required fix:** Copy the exact relevant commands into each NNa verification file, including expected exit codes and required pasted output. For P31a, include the fake-inline-comment / bare-file-path allow-list fixture as an actual test or command, not prose.

---

### Major 3 — The P02/P31 staged gate metric lets migration slices pass the shrink-ratchet while acceptance-critical checks are still stubbed

**Assessment area:** fidelity to overview + #2424 structural avoidance; integration-first / no isolated features; executability.

**Location in plan:** `project-plans/issue2349/plan/02-ast-gate-skeleton.md:142-164`, `:209-224`; `project-plans/issue2349/plan/verification-template.md:116-130`; `project-plans/issue2349/plan/31-enforcement-gate-impl.md:49-62`.

**Problem:** The plan’s early AST gate is valuable, but its `--count` metric intentionally excludes `checkD` round-trip symbols, `checkG-barrel` imports, and `checkH` usage-key context until P31. Yet P07-P27 use `--count` as the authoritative shrink-ratchet. This creates a fraud window: a migration slice can reduce counted F1/F3/F5/G-call hits while leaving or introducing uncounted `streamChunkWrapper` / `providerStopReason` symbol usage, `GeminiContent*` barrel imports, or Gemini usage-key contexts, and still pass the net-count ratchet before P31. P31’s later “metric widened” re-baseline documents the change, but it does not protect the earlier slices from falsely passing.

**Evidence:**
- P02 implements F1/F3/F5 structural matchers and `toGeminiContent(s)` call matching for count mode, but stubs `checkD`, `checkG-barrel`, and `checkH`: `project-plans/issue2349/plan/02-ast-gate-skeleton.md:142-164`.
- P02 seeds the baseline and per-site owner list from the early metric: `project-plans/issue2349/plan/02-ast-gate-skeleton.md:209-224`.
- The verification template says from P07 onward the AST `--count` is the authoritative strict-decrease gate: `project-plans/issue2349/plan/verification-template.md:116-130`.
- P31 later admits the metric widens from `{A/B/C/E/F/G-call}` to full `(a)-(h)` and re-baselines: `project-plans/issue2349/plan/31-enforcement-gate-impl.md:49-62`.
- Overview acceptance requires all of these surfaces, including round-trip symbols and usage keys, be caught by the target gate: `project-plans/issue2349/overview.md:816-828`; overview §8 explicitly includes round-trip symbols, structural converter imports/calls, and usage keys (`project-plans/issue2349/overview.md:765-788`).

**Required fix:** Either implement all acceptance-critical checks in count mode before the first migration slice (P07), or add per-slice hard greps/AST checks for the uncounted categories until P31. At minimum, any slice touching files that could contain round-trip symbols, `GeminiContent*` imports, or usage keys must fail on those patterns immediately, not only at P31.

---

### Major 4 — P19’s API-boundary grep cannot prove the mapper is the only API usage-key site

**Assessment area:** fidelity to overview + structural avoidance; executability.

**Location in plan:** `project-plans/issue2349/plan/19-usage-metadata-boundary-impl.md:107-113`.

**Problem:** P19 verifies permitted API usage-key hits by grepping for key names and excluding any line containing `event-types.ts`, `event-schema.ts`, or `usageStatsToPublicUsageMetadata`. This is too weak for the boundary P19 is trying to enforce. A new object literal with Gemini usage keys in `eventAdapter.ts` outside the mapper can evade the filter if it appears in or near a helper with the same name, comments, or re-export plumbing. The plan already insists the final gate must be AST-context-aware; P19 should not use a line-grep as the hard gate for the same structural exception.

**Evidence:**
- P19 uses textual grep exclusions: `project-plans/issue2349/plan/19-usage-metadata-boundary-impl.md:107-113`.
- The overview explicitly warns usage-key detection must be context-aware and confined to designated boundary modules: `project-plans/issue2349/overview.md:783-788`.
- The plan elsewhere recognizes file-level or line-level exemptions are unsafe, especially for G3 and `hookWireAdapter`: `project-plans/issue2349/plan/31-enforcement-gate-impl.md:56-60` and `:83-87`.

**Required fix:** In P19, require a local AST-context check or a P02/P31 gate fixture proving only the specific mapper function may contain Gemini usage keys. Do not hard-pass P19 on broad grep exclusions by filename/substr.

---

### Major 5 — P28’s behavioral coverage preservation uses filename/keyword counts, not semantic coverage of the rewritten tests

**Assessment area:** TDD correctness; requirements & acceptance coverage.

**Location in plan:** `project-plans/issue2349/plan/00a-preflight-verification.md:159-182`; `project-plans/issue2349/plan/28-test-migration.md:86-113`.

**Problem:** P28 improves over pure import deletion by comparing behavior-area counts to a P0.5 baseline, but the metric is still a keyword/file-count proxy. A rewritten test can retain a filename or a keyword like `stopReason` while only asserting structure or setup plumbing, and the count will pass. The shared verification template’s semantic review helps, but P28’s hard “coverage preserved” gate is not semantic enough for a migration of 54 raw-importer tests plus no-import structural fixtures.

**Evidence:**
- P0.5 captures baseline counts using keyword greps such as `issue2329|directRefusal|stopReason|finishReason`: `project-plans/issue2349/plan/00a-preflight-verification.md:159-182`.
- P28 compares post-migration counts using the same keyword/file-count probes: `project-plans/issue2349/plan/28-test-migration.md:86-113`.
- RULES.md requires behavior, not implementation detail or mock interactions: `dev-docs/RULES.md:94-108`, `dev-docs/RULES.md:399-408`.
- Overview acceptance requires agent-loop tests assert observable outputs, not internal structures: `project-plans/issue2349/overview.md:827-828`.

**Required fix:** Add a semantic per-file disposition audit to P28’s hard gate: for each RB file, record the old behavior(s), the new observable assertions, and why deleting/breaking the real implementation would fail the rewritten test. The keyword-count baseline can remain as a smoke check, but it must not be the primary proof of behavior coverage preservation.

---

## Minor findings

### Minor 1 — P0.5 success criteria says “All 14 Verification Gate checkboxes” despite listing 15 gates

**Assessment area:** method-doc compliance; executability.

**Location in plan:** `project-plans/issue2349/plan/00a-preflight-verification.md:205-220`, `:224-230`, `:232-238`.

**Problem:** P0.5 lists 15 verification gates but the success criteria and failure recovery still say “all 14” / “re-check all 14.” This is small, but it is exactly the kind of mechanical mismatch that causes a coordinator to miss a new gate.

**Evidence:**
- Fifteen checklist items are listed: `project-plans/issue2349/plan/00a-preflight-verification.md:205-220`.
- Success criteria says “All 14 Verification Gate checkboxes checked”: `project-plans/issue2349/plan/00a-preflight-verification.md:224-230`.
- Failure recovery says “re-check all 14 gates”: `project-plans/issue2349/plan/00a-preflight-verification.md:232-238`.

**Required fix:** Change both references to “15.”

---

### Minor 2 — P03 allows `NotYetImplemented` stubs even though later RED tests are expected to fail by value mismatch

**Assessment area:** TDD correctness.

**Location in plan:** `project-plans/issue2349/plan/03-neutral-gap-types-stub.md:7`, `:85-93`; `project-plans/issue2349/plan/04-neutral-gap-types-tdd.md:95-113`.

**Problem:** P03 permits stubs to throw `new Error('NotYetImplemented')`, while P04 says the tests must fail naturally against empty stub returns with value mismatches, not “not a function.” The plan bans assertions on `NotYetImplemented`, which is good, but if P03 implementers choose throwing stubs, P04 RED failures will be dominated by thrown errors rather than behavioral value mismatches. That is not fatal, but it weakens the plan’s own RED-quality expectation.

**Evidence:**
- P03 permits throwing `NotYetImplemented`: `project-plans/issue2349/plan/03-neutral-gap-types-stub.md:7`, `:85-86`.
- P04 expects tests to fail naturally against empty stubs/value mismatches: `project-plans/issue2349/plan/04-neutral-gap-types-tdd.md:95-113`.
- PLAN.md allows stubs to throw but also forbids tests expecting those throws: `dev-docs/PLAN.md:667-672`, `dev-docs/PLAN.md:731-771`.

**Required fix:** For this plan’s neutral-gap stubs, require non-throwing empty correctly-typed returns unless a return cannot compile otherwise. Keep the reverse-test ban.

---

### Minor 3 — `00-overview.md` is not an executable phase but is named like one and fails the phase-template headings

**Assessment area:** method-doc compliance.

**Location in plan:** `project-plans/issue2349/plan/00-overview.md:1-6`.

**Problem:** The file `00-overview.md` is a plan overview, not a phase, but its numeric prefix makes simple phase-template checks include it. It lacks all phase headings. This is not a problem if the coordinator treats it as overview-only, but the plan should say explicitly that `00-overview.md` is non-executable and excluded from phase-template compliance checks.

**Evidence:**
- `00-overview.md` is titled “Plan Overview” and contains plan metadata at `project-plans/issue2349/plan/00-overview.md:1-6`, not phase sections.
- `PLAN-TEMPLATE.md:23-25` says each phase must follow the phase template.

**Required fix:** Add a one-line “non-executable overview; not a phase” note at the top, and ensure the execution tracker uses `0.5` as the first executable phase.

---

## Additional risks / open questions

1. **P21 is a very large atomic cross-package flip.** The plan correctly explains why a dual-typed staging shim would recreate #2424 (`project-plans/issue2349/plan/21-clientcontract-impl.md:159-160`), but the phase touches `clientContract.ts`, agents client/session/manager, 23 CLI files, 5 core files, and extra `getHistory` callers (`project-plans/issue2349/plan/21-clientcontract-impl.md:100-157`). This is executable only if P21’s completion marker includes the regenerated consumer list and full build output. Any drift must stop the phase, not be deferred.

2. **`ModelGenerationRequest` sufficiency is correctly preflighted but remains a hard dependency.** Actual `ModelGenerationRequest` has `contents`, `tools`, `settings`, `model`, `abortSignal`, and `modelParams` (`packages/core/src/llm-types/modelRequest.ts:68-87`), while current agents call sites pass `params.config?.abortSignal` and tool/config data (`packages/agents/src/core/StreamProcessor.ts:230-240`, `:398-459`). P0.5 task 11 is therefore load-bearing. If any Gemini config field lacks a neutral home, the plan must update P03-P05 before tests are written.

3. **Actual source confirms the core premises are real.** `provider.generateChatCompletion` returns `AsyncIterableIterator<IContent>` (`packages/core/src/runtime/contracts/RuntimeProvider.ts:77-84`); agents currently fabricates a synthetic response (`packages/agents/src/core/MessageConverter.ts:518-543`); `streamChunkWrapper.ts` still converts response→chunk and chunk→parts (`packages/agents/src/core/streamChunkWrapper.ts:105-167`); `providerStopReason.ts` and `hookToolRestrictions.ts` still contain side-channel mechanisms (`packages/agents/src/core/providerStopReason.ts:24-52`, `packages/agents/src/core/hookToolRestrictions.ts:16-35`); and `clientContract.ts` still exposes Google-shaped payload types (`packages/core/src/core/clientContract.ts:100-124`, `:127-197`). The plan is targeting the right architectural fault; the review findings above are about making the plan mechanically safe.

4. **The test migration allow-list is correctly bounded in prose, but enforcement must be exact.** P28 names five CHAR files and requires local structural fixtures only (`project-plans/issue2349/plan/28-test-migration.md:72-82`). P31’s test gate must enforce this exact list; no wildcard or directory-level allow-list should be accepted.

5. **No lint/complexity loosening is correctly stated.** The plan repeatedly requires no `eslint-disable`, no TS suppressions, no severity downgrades, and `npm run lint:eslint-guard` (e.g. `project-plans/issue2349/specification.md:211-215`, `project-plans/issue2349/plan/verification-template.md:70`). Keep this unchanged.
