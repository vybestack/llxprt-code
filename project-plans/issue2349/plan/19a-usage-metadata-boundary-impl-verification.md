# Phase 19a: Usage-metadata boundary IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P19a`

## Prerequisites
- Required: Phase 19 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
Confirms REQ-007.2 (the previously-absent `usageStatsToPublicUsageMetadata` mapper is written + wired at the boundary so the declared public type matches the emitted value), REQ-007.3 (core-owned `ServerUsageMetadataEvent` scope limitation documented + the core public-event shape check present, M3), REQ-008.1/.2 (telemetry `logApiRequest`/`logApiResponse` neutral; OQ-3t committed NEUTRAL so `turnLogging.ts` is NOT allow-listed), and REQ-010 (`toGeminiContents` G4/G5/G7 deleted) — internal loop neutral, Gemini usage keys confined to boundary modules only.

**Line-number freshness FIRST (Minor 2):** BEFORE any check below, compare every line range cited in P19 / this phase (`eventAdapter.ts` Finished/UsageMetadata cases, `event-types.ts:32-41`, `event-schema.ts:30-39`, `turn.ts:221-228`, `turnLogging.ts:85-104`) against `.completed/P0.5.md`; FAIL immediately if the P0.5 marker is absent or any cited range drifted without a phase-file update.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-007.2 (option (C) mapper wired; public wire unchanged)** — **GIVEN:** the P19-modified `eventAdapter.ts`; **WHEN:** a turn emitting usage is observed at the API boundary and the mapper is traced; **THEN:** internal state is neutral `UsageStats`, `usageStatsToPublicUsageMetadata` maps it to the Gemini-named public `done.finished.usageMetadata`/`usage` event (declared type UNCHANGED, option (C) unconditional), and CLI consumers reading `promptTokenCount`/`candidatesTokenCount`/`totalTokenCount` still see those keys; FAIL if the public wire changed or an internal file carries Gemini usage keys.
- **REQ-007.3 (core-owned event check, M3 — CONCRETE target, Critical 3 round 8)** — **GIVEN:** `serverUsageMetadataEvent.shape.test.ts` (CREATED by P19); **WHEN:** `npm test` runs it and the marker is inspected; **THEN:** the test PASSES asserting the two CONCRETE facts — (a) PRODUCTION-DEAD: zero production emitters/constructors of `ServerUsageMetadataEvent` (only test helpers `eventHarness.ts:108` construct it; `eventAdapter.ts:268`/`a2a-server/task-support.ts:136,166` are consumers; `turn.ts:222` is the type def), AND (b) LIVE-PATH NEUTRAL: `ServerFinishedEvent.value.usageMetadata` is `UsageStats | undefined` (`turn.ts:241-245`) — and both PASS outputs are PASTED in the P19 marker; FAIL if the test is a vacuous shape snapshot, if it claims the dead event is "fed by neutral production emitters", or if the pasted evidence is missing.
- **REQ-008.1/.2 (telemetry neutral, OQ-3t)** — **GIVEN:** `turnLogging.ts`; **WHEN:** greps for `@google/genai`/Gemini usage keys/`toGeminiContents`; **THEN:** `logApiRequest(IContent[])`/`logApiResponse(UsageStats)` are neutral, `turnLogging.ts` is NOT allow-listed, and zero Gemini usage keys remain; FAIL on any residual.
- **REQ-010 (G4/G5/G7 deleted)** — **GIVEN:** the telemetry files; **WHEN:** greps for `toGeminiContents`; **THEN:** G4/G5/G7 are gone; FAIL on any residual telemetry `toGeminiContents`.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] `usageStatsToPublicUsageMetadata` mapper exists and is wired (was verbatim forward); declared public type now matches emitted value.
- [ ] Gemini usage keys appear ONLY in `api/event-types.ts`/`event-schema.ts`/the `usageStatsToPublicUsageMetadata` mapper — NOT in `turnLogging.ts` (OQ-3t committed NEUTRAL) and nowhere in the internal loop.
- [ ] `turnLogging.ts` neutral; `toGeminiContents` G4/G5/G7 gone; no `@google/genai`.
- [ ] OQ-14 INTERNAL: `UsageStats.reasoningTokens` PRESERVED internally (on `ModelOutput.usage`/`ModelStreamChunk.usage`) on BOTH paths (pinned by P06/P07 streaming + P12/P13 direct). OQ-14 PUBLIC: the public `UsageMetadataValue`/`event-schema` declares NO `reasoningTokens`/`thoughtsTokenCount` and the mapper does NOT emit them (declared type UNCHANGED, option (C)); FAIL if the public wire gained a reasoning/thought field or the mapper emits one.
- [ ] REQ-007.3 core-owned `ServerUsageMetadataEvent` check is CONCRETE (Critical 3 round 8): (a) production-dead grep (zero production emitters — only test helpers may construct it) and (b) live-path-neutral type check (`ServerFinishedEvent.value.usageMetadata` === `UsageStats | undefined`) both PASS and are pasted; NOT a vague shape snapshot; agents gate cannot enforce the core event (scope limitation documented).
- [ ] MAJOR 4: the api usage-key boundary is proven by the AST-context allow-list gate (`--check-usage-key-boundary`, same mechanism as G3/hookWireAdapter), NOT a bare filename/substring line-grep; a positive fixture (Gemini usage-key literal in `eventAdapter.ts` OUTSIDE the mapper) FAILS the gate.
- [ ] Deferred-impl + lint-guard clean.

## Shrink-ratchet (M4)
- [ ] Structural-hit count is STRICTLY LOWER than the prior slice's. Use the AUTHORITATIVE AST counter landed in P02 (Major 4/5): `npx tsx scripts/agents-neutral-gate.ts --count` (AST-context-aware, allow-list-subtracted — NOT broad grep). The broad grep in verification-template §9 is ADVISORY only (slice-scoped) and never the pass/fail gate. Update the integer in `dev-docs/agents-neutral-gate-baseline.md`; paste before/after into the marker.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace neutral UsageStats → boundary mapper → public wire. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P19a.md`.
