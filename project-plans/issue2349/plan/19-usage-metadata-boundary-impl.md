# Phase 19: Usage-metadata boundary + telemetry — IMPL

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P19`

## Prerequisites
- Required: Phase 18 completed (OQ-2v evidence recorded).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P18" packages/agents/src` AND read `project-plans/issue2349/.completed/P18.md` for the recorded runtime key-set EVIDENCE (documentation only — it does NOT select a branch; OQ-2u is committed to option (C) unconditionally).
- Expected files from previous phase: `packages/agents/src/api/__tests__/usageMetadata.characterization.spec.ts` (records observed `done.finished.usageMetadata` key set).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/usage-metadata-boundary.md` — follow line numbers EXACTLY.

## Committed implementation (NO branch — option (C) unconditional, Critical 1 round 7)
This phase implements **option (C) UNCONDITIONALLY** (domain-model.md OQ-2u). There is NO option-B path: option (B) (retyping the public declared type to neutral) is REJECTED for #2349 because it is a public breaking change that would break the CLI/public-event consumers (`packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts:406` reads `event.usage.promptTokenCount`; `packages/cli/src/zed-integration/zedIntegration.ts:614-615` read `usage.candidatesTokenCount`/`usage.totalTokenCount`) with no owning migration phase in this plan.
- **(C):** write the `usageStatsToPublicUsageMetadata` neutral→Gemini mapper at the `eventAdapter.ts` `Finished`/`UsageMetadata` cases; the declared public `UsageMetadataValue`/`FinishedValue.usageMetadata` type is UNCHANGED (Gemini-named), so no CLI/public consumer breaks. Internal loop is neutral `UsageStats` end-to-end.
- Read `.completed/P18.md` for the recorded runtime key-set EVIDENCE (it documents WHY the mapper is needed; it does NOT select a branch).
- OQ-3t is COMMITTED neutral — `turnLogging.ts` is NEVER allow-listed and takes NO Gemini-key exception.

## Requirements Implemented (Expanded)

### REQ-007.2: Public usage-metadata boundary (§7A, OQ-2u committed to option (C) unconditionally)
**Full Text**: Option (C) is applied UNCONDITIONALLY (Critical 1 round 7): the currently-absent `UsageStats`→Gemini-named mapper `usageStatsToPublicUsageMetadata` is written at `eventAdapter.ts`'s `Finished`/`UsageMetadata` cases so the declared public type (Gemini-named, UNCHANGED) is honored while the internal loop stays neutral. Option (B) (retyping the public type to neutral) is NOT implemented — it is a public breaking change rejected for #2349.
**Behavior**:
- GIVEN: an agent turn emitting usage that reaches the API boundary through `eventAdapter.ts`'s `Finished`/`UsageMetadata` cases.
- WHEN: the option-(C) mapper `usageStatsToPublicUsageMetadata(neutralUsageStats)` runs at that boundary edge.
- THEN: internal state is neutral `UsageStats` end-to-end; the public `done.finished.usageMetadata` (and the `usage` event) is Gemini-named per its UNCHANGED declared type (so `agentEventDispatcher.ts:406` / `zedIntegration.ts:614-615` keep working); and no internal loop file carries Gemini usage keys (permitted ONLY in `api/event-types.ts`/`event-schema.ts` + the mapper).
**Why This Matters**: honors the published Gemini-named public wire (no CLI breakage) while making the internal loop neutral — bounding this issue's blast radius (RISK-1 conservative).

### REQ-007.3: Core-owned event scope limitation documented + CI-checked with CONCRETE evidence (Critical 3 round 8)
**Full Text**: The agents gate cannot enforce the core-owned `ServerUsageMetadataEvent` (`packages/core/src/core/turn.ts:221-228`). Under option (C) this event is a DOCUMENTED core-owned Gemini-named public-wire type that is PRODUCTION-DEAD (zero production emitters/constructors; only the test helper `eventHarness.ts:108` constructs it; `eventAdapter.ts:268` / `a2a-server/task-support.ts:136,166` are consumers). A compensating core test (`serverUsageMetadataEvent.shape.test.ts`, CREATED by P19) asserts the CONCRETE decided target: (a) no PRODUCTION code emits/constructs a `ServerUsageMetadataEvent` (grep/AST — only test helpers may), AND (b) the LIVE usage path `ServerFinishedEvent.value.usageMetadata` is the neutral `UsageStats` type (`turn.ts:241-245`). It does NOT claim the dead event is "fed by neutral production emitters" (there are none). Tied to the OQ-2u/REQ-007.3 decision.
**Behavior**:
- GIVEN: the core-owned public event `ServerUsageMetadataEvent` (production-dead) and the live `ServerFinishedEvent.value.usageMetadata` path.
- WHEN: CI runs the core test.
- THEN: it asserts (a) zero production emitters/constructors of `ServerUsageMetadataEvent` (only test helpers may construct it) and (b) `ServerFinishedEvent.value.usageMetadata` is neutral `UsageStats` — failing if a production emitter appears OR if the live `Finished` usage is retyped Gemini-shaped.
**Why This Matters**: closes the gate-scope hole (Major 3) with concrete executable evidence (production-dead + live-path-neutral), not a vague shape snapshot that could pass vacuously.

### REQ-008.1: Telemetry neutral (OQ-3t committed)
**Full Text**: `turnLogging.logApiRequest` accepts `IContent[]` and extracts request text neutrally; `logApiResponse` accepts neutral `UsageStats`. NO Gemini-named telemetry keys remain; `turnLogging.ts` is NOT allow-listed.
**Behavior**:
- GIVEN: a request/response logged for telemetry
- WHEN: logged
- THEN: text is extracted from `IContent[]` and usage is logged from neutral `UsageStats` — no `GenerateContentResponseUsageMetadata`, no `toGeminiContents`.
**Why This Matters**: removes G4/G5/G7 telemetry conversions and the last internal Gemini usage-key sink.

### REQ-010.1 (telemetry conversions): delete toGeminiContents G4/G5/G7
**Full Text**: The telemetry-boundary `ContentConverters.toGeminiContents(...)` conversions G4 (`streamRequestHelpers.ts:281`), G5 (`TurnProcessor.ts:457`), G7 (`DirectMessageProcessor.ts:178`) are deleted; telemetry logs neutral `IContent[]`. (G1/G2 die in P21 with the `getHistory` return-type flip — Major 3; G6 in P08; the only surviving `toGeminiContents` call is the G3 hook adapter IFF OQ-1a keeps the hook wire Gemini-shaped AND it is a central-allow-list entry.)
**Behavior**:
- GIVEN: telemetry logging
- WHEN: it runs
- THEN: no `toGeminiContents` call precedes it.
**Why This Matters**: eliminates 3 of the 7 `toGeminiContents` offenders — the structural converter flow #2424 used.

### REQ-010.2 (barrel imports): no GeminiContent* imports in the telemetry files
**Full Text**: No imports of `GeminiContent`/`GeminiContentPart`/`GeminiFunctionCall` (barrel or direct) remain in `turnLogging.ts`/`streamRequestHelpers.ts`/`TurnProcessor.ts`/`DirectMessageProcessor.ts` after the G4/G5/G7 deletions.
**Behavior**:
- GIVEN: the migrated telemetry files
- WHEN: searched
- THEN: zero `GeminiContent*` imports remain.
**Why This Matters**: closes the barrel-import bypass alongside the call-expression deletion.

### REQ-007.4 / OQ-14: reasoning tokens — INTERNAL preservation (mandatory) + PUBLIC exposure OUT OF SCOPE (Critical 1 round 8)
**Full Text**: OQ-14 is SPLIT into an INTERNAL decision and a PUBLIC decision (consistent with the option-(C)-unconditional choice — see domain-model OQ-14 and pseudocode lines 25-26):
- **INTERNAL (mandatory):** BOTH the direct and streaming neutral paths preserve `UsageStats.reasoningTokens` INTERNALLY (on `ModelOutput.usage` / `ModelStreamChunk.usage` / `IContent.metadata.usage`). Streaming already maps `thoughtsTokenCount → UsageStats.reasoningTokens` (`streamChunkWrapper.ts:57-59`, pinned by P06/P07); the direct path also populates it when retyped to `ModelOutput` (pinned by P12/P13, §2B.2). This is the real OQ-14 requirement and it MUST stay (acceptance §9.1-8).
- **PUBLIC (out of scope for #2349):** the declared public `UsageMetadataValue`/`FinishedValue.usageMetadata` type stays UNCHANGED (option (C)) — it declares ONLY `promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`/`cachedContentTokenCount` (`api/event-types.ts:32-37`), with NO `reasoningTokens` and NO `thoughtsTokenCount`. The mapper `usageStatsToPublicUsageMetadata` maps ONLY those 4 keys and does NOT emit reasoning/thought tokens to the public wire. Adding a public reasoning-token field would be a public API change with CLI blast radius (exactly what option-(C)-unconditional avoids).
**Behavior**:
- GIVEN: a provider that supplied thoughts (so `UsageStats.reasoningTokens` is populated internally).
- WHEN: usage flows through the neutral internal loop and reaches the option-(C) boundary mapper.
- THEN: `UsageStats.reasoningTokens` is PRESERVED internally on `ModelOutput.usage`/`ModelStreamChunk.usage` (INTERNAL decision); AND the public `done.finished.usageMetadata`/`usage` event carries ONLY the 4 declared Gemini-named keys — NO `reasoningTokens`/`thoughtsTokenCount` on the public wire (PUBLIC decision; declared type UNCHANGED).
**Why This Matters**: preserves reasoning-token fidelity INTERNALLY across the neutralization without a public API change — one coherent target (internal reasoningTokens preserved; public wire unchanged).

## Implementation Tasks (MODIFY)

### `packages/agents/src/api/eventAdapter.ts` (option (C) — committed unconditionally)
- Implement `usageStatsToPublicUsageMetadata` (pseudocode lines 20-26) and wire it into the `Finished`/`UsageMetadata` cases (lines 27-31). Internal state stays neutral `UsageStats`; the declared public `UsageMetadataValue`/`FinishedValue.usageMetadata` type (`api/event-types.ts:32-41`, `event-schema.ts:30-39`) is UNCHANGED. Gemini keys appear ONLY here (the mapper) + `event-types.ts`/`event-schema.ts`. Record these three modules in the central allow-list (P31 artifact).
- The mapper maps EXACTLY the 4 declared public keys — `promptTokenCount`←`promptTokens`, `candidatesTokenCount`←`completionTokens`, `totalTokenCount`←`totalTokens`, `cachedContentTokenCount`←`cachedTokens`. It MUST NOT emit `reasoningTokens` OR `thoughtsTokenCount` to the public wire (OQ-14 PUBLIC out of scope): `UsageMetadataValue` (`event-types.ts:32-37`) declares neither field, so emitting them would either fail to compile against the UNCHANGED type or require an out-of-scope public API change. `u.reasoningTokens` is preserved INTERNALLY on `UsageStats` only (OQ-14 INTERNAL).
- Do NOT retype the public declared type to neutral (that is option (B), rejected for #2349 — it would break `agentEventDispatcher.ts:406` / `zedIntegration.ts:614-615`).

### `packages/core/src/core/turn.ts` core-owned event check (M3 — REQ-007.3 enforcement) — CONCRETE target (Critical 3 round 8)
- **P19 CREATES this test file** (Additional Risk 3 from round 5): `packages/core/src/core/__tests__/serverUsageMetadataEvent.shape.test.ts` (`@requirement:REQ-007.3`). It asserts the CONCRETE decided target under option (C) — NOT a vague "agreed shape" snapshot and NOT a claim that the event is "fed by neutral production emitters" (there are NONE — see below). Wire it into the normal `npm run test` (already CI-run).
- **VERIFIED FACT this check encodes (do NOT restate as a live feed):** `ServerUsageMetadataEvent` (`packages/core/src/core/turn.ts:221-228`) is a DOCUMENTED core-owned Gemini-named public-wire type that is PRODUCTION-DEAD — it has ZERO production emitters/constructors. Verified: the ONLY construction site is the TEST helper `packages/agents/src/api/__tests__/helpers/eventHarness.ts:108`; `packages/agents/src/api/eventAdapter.ts:268` and `packages/a2a-server/src/agent/task-support.ts:136,166` are CONSUMERS (they switch on / forward `AgentEventType.UsageMetadata`, they do not construct a `ServerUsageMetadataEvent`); `turn.ts:222` is the type definition. There is therefore NO "internal usage feeding it" to trace — a shape-snapshot alone would be vacuous.
- **The test asserts the two concrete, executable facts:**
  - **(a) PRODUCTION-DEAD (grep-based, HARD):** no PRODUCTION file in `packages/agents/src` or `packages/core/src` constructs/emits a `ServerUsageMetadataEvent` (i.e. no production `{ type: AgentEventType.UsageMetadata, value: ... }` literal). Only test helpers (`__tests__`/`*-test-helpers*`/`*.test.*`/`*.spec.*`) may construct it. Implement as a grep/AST assertion inside the test (fail if any production match is found), e.g. search `type: AgentEventType.UsageMetadata` occurrences and assert every hit is either the type definition (`turn.ts`), a `case`/switch consumer, or a test-helper file — never a production emitter.
  - **(b) LIVE-PATH NEUTRAL (type-level, HARD):** `ServerFinishedEvent.value.usageMetadata` is the neutral `UsageStats` type (`turn.ts:241-245`) — the ACTUAL live usage path. Assert via a `test-d`/type-level check (or an `expectTypeOf<ServerFinishedEvent['value']['usageMetadata']>()` equivalence to `UsageStats | undefined`) so a future retype of the live `Finished` usage to a Gemini-shaped type fails the check.
- This compensates for the agents-scoped gate being unable to reach core (domain-model OQ-8), with concrete evidence (production-dead + live-path-neutral) rather than a shape snapshot.

### `packages/agents/src/core/turnLogging.ts` (OQ-3t committed neutral)
- `logApiRequest` accepts `IContent[]`; neutral text extraction (lines 40-42); delete `toGeminiContents` G4/G5/G7 telemetry conversions (finish any residual from P08/P13).
- `logApiResponse` accepts neutral `UsageStats`. NO Gemini-key exception; `turnLogging.ts` is NOT allow-listed.
- Drop `GenerateContentResponseUsageMetadata`/`Content`/`GenerateContentConfig` imports.

### Required Code Markers
EVERY touched function MUST carry the marker block with the SPECIFIC `@pseudocode` line range (from `usage-metadata-boundary.md`), not only the prose bullets:
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P19
 * @requirement:REQ-007.2
 * @pseudocode lines 20-26   // usageStatsToPublicUsageMetadata mapper (per-function range)
 */
```
- `usageStatsToPublicUsageMetadata` (option-(C) mapper — committed unconditionally) → `@pseudocode lines 20-26`; `@requirement:REQ-007.2`.
- `eventAdapter` `Finished`/`UsageMetadata` case wiring → `@pseudocode lines 27-31`; `@requirement:REQ-007.2`.
- `turnLogging.logApiRequest` neutral text extraction + `logApiResponse` neutral usage → `@pseudocode lines 40-42`; `@requirement:REQ-008.1`, `@requirement:REQ-010.1` (G4/G5/G7 deletion), `@requirement:REQ-010.2`.
- `serverUsageMetadataEvent.shape.test.ts` (core public-event check) → `@requirement:REQ-007.3` (test-only; annotate with the OQ-2u decision rule reference — no pseudocode function).
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P19`, `@requirement:REQ-007.2/REQ-007.3/REQ-007.4/REQ-008.1/REQ-008.2/REQ-010.1/REQ-010.2`, plus the per-function `@pseudocode lines X-Y` above.

### M3 evidence-paste requirement (Additional Risk 3 — do NOT overstate acceptance §9.1-2b)
The P19 completion marker MUST PASTE the actual PASS output of the core-owned `ServerUsageMetadataEvent` check (the real `npm test -- packages/core/src/core/__tests__/serverUsageMetadataEvent.shape.test.ts` run output) AND the PASS output of the two CONCRETE sub-assertions (Critical 3 round 8): (a) the production-dead grep (`type: AgentEventType.UsageMetadata` — zero production emitters, only test helpers/type-def/case-consumers) and (b) the live-path-neutral type-level assertion (`ServerFinishedEvent.value.usageMetadata` === `UsageStats | undefined`). A prose claim that it ran, or a vacuous "shape snapshot" without the production-dead + live-path-neutral evidence, is INVALID. P33 re-checks that this concrete evidence exists before accepting §9.1-2b (see P33 §9.1-2b).

## Verification Commands
```bash
npm test -- packages/agents/src/api/__tests__/usageMetadata.characterization.spec.ts   # green; declared type now matches emitted value
npm test -- packages/core/src/core/__tests__/serverUsageMetadataEvent.shape.test.ts    # green (REQ-007.3 core public-event check — CONCRETE: production-dead + live-path-neutral)
# ---- CRITICAL 3: ServerUsageMetadataEvent CONCRETE target HARD-ASSERTED (production-dead + live-path-neutral) ----
# (a) PRODUCTION-DEAD: no production file constructs/emits a ServerUsageMetadataEvent literal. Only test helpers may.
if grep -rnE "type:\s*AgentEventType\.UsageMetadata" packages/agents/src packages/core/src --include=*.ts | grep -vE "__tests__|\.test\.|\.spec\.|test-helpers" | grep -vE "packages/core/src/core/turn\.ts" | grep -vE "case\s+AgentEventType\.UsageMetadata"; then echo "FAIL(Critical 3): a PRODUCTION emitter/constructor of ServerUsageMetadataEvent exists (only test helpers + the type def + case-consumers are allowed)"; exit 1; fi
# (b) LIVE-PATH NEUTRAL: the type-level assertion lives in serverUsageMetadataEvent.shape.test.ts (expectTypeOf ServerFinishedEvent.value.usageMetadata === UsageStats | undefined); covered by the npm test run above.
# ---- CRITICAL 1: public wire carries NO reasoning/thought tokens (OQ-14 PUBLIC out of scope) ----
if grep -rnE "reasoningTokens|thoughtsTokenCount" packages/agents/src/api/event-types.ts packages/agents/src/api/event-schema.ts; then echo "FAIL(Critical 1): public UsageMetadataValue/schema must NOT declare reasoningTokens/thoughtsTokenCount (option (C) — public type UNCHANGED, OQ-14 PUBLIC out of scope)"; exit 1; fi
if grep -nE "reasoningTokens|thoughtsTokenCount" packages/agents/src/api/eventAdapter.ts | grep -i "usageStatsToPublicUsageMetadata" ; then echo "FAIL(Critical 1): the option-(C) mapper must NOT emit reasoning/thought tokens to the public wire"; exit 1; fi
# ---- MAJOR 2: comment expectations HARD-ASSERTED (fail the phase on violation) ----
if grep -qrn "@google/genai" packages/agents/src/core/turnLogging.ts; then echo "FAIL: @google/genai still imported in turnLogging.ts"; exit 1; fi
# OQ-3t committed neutral: NO Gemini usage keys anywhere in the agents core loop, INCLUDING turnLogging.ts:
if grep -qrnE "promptTokenCount|candidatesTokenCount|totalTokenCount" packages/agents/src/core --include=*.ts | grep -v test; then echo "FAIL: Gemini usage key present in agents core loop (OQ-3t committed neutral)"; exit 1; fi
# ---- MAJOR 4: API usage-key boundary is AST-CONTEXT enforced (NOT a filename/substring line-grep) ----
# The ONLY api-boundary site permitted to contain Gemini usage keys is the usageStatsToPublicUsageMetadata FUNCTION BODY
# (plus the declared type in event-types.ts/event-schema.ts). Prove it via the P02/P31 AST-context allow-list gate,
# the SAME mechanism used for G3/hookWireAdapter — a bare filename/substring exclusion is INSUFFICIENT (a new
# Gemini-usage-key object literal elsewhere in eventAdapter.ts, or near a same-named comment, could evade a line-grep).
npx tsx scripts/agents-neutral-gate.ts --check-usage-key-boundary --allowlist dev-docs/agents-neutral-gate-allowlist.md   # exit 0 ONLY if every Gemini usage-key node resolves (by AST enclosing-function/scope) to the usageStatsToPublicUsageMetadata function body OR the declared type in event-types.ts/event-schema.ts; exit 1 (FAIL) on any usage-key node in api/ outside that exact AST context (e.g. a literal in eventAdapter.ts outside the mapper).
# (This check is fixtured in P02/P31: a positive fixture with a Gemini-usage-key literal added to eventAdapter.ts OUTSIDE the mapper MUST fail the gate; the mapper body itself MUST pass.)
if grep -rn "toGeminiContents" packages/agents/src/core/turnLogging.ts packages/agents/src/core/streamRequestHelpers.ts packages/agents/src/core/TurnProcessor.ts packages/agents/src/core/DirectMessageProcessor.ts | grep -qv test; then echo "FAIL: residual toGeminiContents (G4/G5/G7) in a telemetry file"; exit 1; fi
if grep -rnE "GeminiContent(Part)?\b|GeminiFunctionCall\b" packages/agents/src/core/turnLogging.ts packages/agents/src/core/streamRequestHelpers.ts packages/agents/src/core/TurnProcessor.ts packages/agents/src/core/DirectMessageProcessor.ts | grep -qv test; then echo "FAIL: GeminiContent* barrel/direct import remains in a telemetry file (REQ-010.2)"; exit 1; fi
# ---- MAJOR 4 + MAJOR 2: P19-OWNED structural-hit IDENTITY closure, HARD-ASSERTED (site-specific + net-count) ----
# This slice OWNS: G4 streamRequestHelpers.ts:281 toGeminiContents; G5 TurnProcessor.ts:457 toGeminiContents;
#   G7 DirectMessageProcessor.ts:178 toGeminiContents; turnLogging.ts:85-104 Gemini-named usage spread (:101-102).
#   (streamResponseHelpers usage-key reads are P07-owned — do NOT double-claim.)
npx tsx scripts/agents-neutral-gate.ts --count --by-file > /tmp/p19_byfile.txt
while read -r id; do
  if grep -qF "$id" /tmp/p19_byfile.txt; then echo "FAIL(Major 4): P19-owned structural hit still present: $id"; exit 1; fi
done < <(grep -F 'owner=P19' dev-docs/agents-neutral-gate-baseline.md | sed -E 's/ *owner=P19.*//; s/^[-* ]*//')
prev=$(grep -oE 'count=[0-9]+' dev-docs/agents-neutral-gate-baseline.md | tail -1 | cut -d= -f2)
cur=$(npx tsx scripts/agents-neutral-gate.ts --count)
test -n "$prev" || { echo "FAIL: no prior baseline count recorded"; exit 1; }
test "$cur" -lt "$prev" || { echo "FAIL(Major 2): net --count $cur not strictly lower than prior $prev"; exit 1; }
echo "PASS: P19 net --count $cur < prior $prev; owned hits (G4/G5/G7 + turnLogging usage) closed"
npm run typecheck && npm run build   # green cross-package (build-green checkpoint P19)
```

## Success Criteria
- Internal loop neutral usage end-to-end; Gemini usage keys confined to the `api/` boundary modules (never `turnLogging.ts`); G4/G5/G7 deleted; `UsageStats.reasoningTokens` PRESERVED INTERNALLY (public wire UNCHANGED — NO `reasoningTokens`/`thoughtsTokenCount` on the public usage metadata, OQ-14 PUBLIC out of scope); core public-event shape check green.
- **Site-specific closure (Major 4):** every P19-OWNED baseline structural-hit ID (G4/G5/G7 `toGeminiContents` + the `turnLogging.ts` Gemini-named usage spread) is ABSENT in `--by-file` output, in ADDITION to the net `--count` strictly decreasing; those IDs are removed from the baseline listing.

## Failure Recovery
If this phase fails (characterization red, a Gemini usage key leaks into the core loop, or the core shape check red):
1. `git checkout -- packages/agents/src/api/eventAdapter.ts packages/agents/src/core/turnLogging.ts` (+ the core turn.ts test if added).
2. Re-apply option (C) exactly (the `usageStatsToPublicUsageMetadata` mapper; declared public type UNCHANGED — do NOT reintroduce an option-B retype); confirm `turnLogging.ts` took NO Gemini exception (OQ-3t committed neutral).
3. Cannot proceed until both usage tests are green and no core-loop Gemini usage key remains.

## Phase Completion Marker
`project-plans/issue2349/.completed/P19.md`.
