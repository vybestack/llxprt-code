# Phase 11a: Side-channel retirement IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P11a`

## Prerequisites
- Required: Phase 11 completed.

## Requirements Implemented (Expanded)
This phase verifies **REQ-003.2 (hookToolRestrictions neutralized)** fully, and **REQ-003.1 (providerStopReason retired)** behaviorally — the raw stop reason rides `chunk.rawStopReason`. The WRITER `setProviderStopReason` (`MessageConverter.ts:588`) is removed in P13 (with the fabricator chain), and the READER `getProviderStopReason` (`streamChunkWrapper.ts:112`) + the physical DELETE of `providerStopReason.ts` occur in P25 (co-located with the `streamChunkWrapper.ts` whole-file delete — C2), verified in P25a. Deleting `providerStopReason.ts` at P13 would dangle `streamChunkWrapper.ts:112`'s import, so the file-delete is staged to P25.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-003.2 (hookToolRestrictions neutralized)** — **GIVEN:** the P11-modified `hookToolRestrictions.ts` + the P10 side-channel characterization; **WHEN:** the verifier greps for `WeakMap`/`Symbol(`/`GenerateContentResponse`/`@google/genai` in the file, checks the allow-list, and confirms tool-restriction behavior via P10; **THEN:** the file has ZERO `WeakMap`/`Symbol(`/`GenerateContentResponse`/`@google/genai` and NO allow-list entry, restriction metadata rides `chunk.hookRestrictions` with `ContentBlock[]`/`ToolCallBlock` filtering, and P10 stays green; the bounded before-model helper lives only in `beforeModelBlockingCompat.ts` (its own AST-context allow-list entry). FAIL on any residual WeakMap/Symbol/Google shape in the side-channel module or a missing/mis-scoped allow-list entry.
- **REQ-003.1 (providerStopReason retired behaviorally; file staged to P25)** — **GIVEN:** a provider raw stop reason; **WHEN:** the finish path + the `providerStopReason.ts` reference set are traced; **THEN:** the raw stop reason rides `chunk.rawStopReason`, and `providerStopReason.ts` STILL exists with exactly its WRITER (`MessageConverter.ts:588`, dies P13) + READER (`streamChunkWrapper.ts:112`, dies P25) — NOT deleted here; FAIL if the file was prematurely deleted (dangling import) or the behavior no longer flows via `chunk.rawStopReason`.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P10 characterization tests green (#2329 refusal `Finished.stopReason` + hook-restriction filtering preserved).
- [ ] `hookToolRestrictions.ts` has NO `WeakMap`/`Symbol`; no `@google/genai`; neutral block-based API (`applyHookRestrictionsToChunk`/`filterHookRestrictedBlocks`/`filterAfcByHookRestrictions`).
- [ ] Restriction data rides `chunk.hookRestrictions`; stop reason rides `chunk.rawStopReason` (BR-3/REQ-003.*).
- [ ] Build-order (C2): `providerStopReason.ts` NOT yet deleted; it still has BOTH refs — WRITER `MessageConverter.ts:588` (removed P13) AND READER `streamChunkWrapper.ts:112` (removed P25 with the `streamChunkWrapper.ts` file delete). `grep -rn "providerStopReason" packages/agents/src | grep -v test` ⇒ `MessageConverter.ts:588` + `streamChunkWrapper.ts:112` + the file itself. CONFIRM the file was NOT prematurely deleted here.
- [ ] Monorepo `npm run typecheck && npm run build` green.
- [ ] Pseudocode compliance vs `hooktoolrestrictions-neutral.md`; deferred-impl + lint-guard clean.

## Shrink-ratchet (M4)
- [ ] Structural-hit count is STRICTLY LOWER than the prior slice's. Use the AUTHORITATIVE AST counter landed in P02 (Major 4/5): `npx tsx scripts/agents-neutral-gate.ts --count` (AST-context-aware, allow-list-subtracted — NOT broad grep). The broad grep in verification-template §9 is ADVISORY only (slice-scoped) and never the pass/fail gate. Update the integer in `dev-docs/agents-neutral-gate-baseline.md`; paste before/after into the marker.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace how a restricted tool call is filtered without any WeakMap, using `chunk.hookRestrictions` + `ContentBlock[]`/`ToolCallBlock` filtering. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P11a.md`.
