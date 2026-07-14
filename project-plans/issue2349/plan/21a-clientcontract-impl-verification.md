# Phase 21a: clientContract IMPL — Verification (deepthinker, cross-package)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P21a`

## Prerequisites
- Required: Phase 21 completed.

Follow `plan/verification-template.md`. Cross-package specifics:

## Requirements Implemented (Expanded)
Confirms REQ-009.1 (`Contract*` payload types deleted; `IContent` NOT aliased back to `ContractContent`), REQ-009.2 (surface retyped to `IContent`/`ModelOutput`/`ModelGenerationSettings`/`AgentMessageInput`), and REQ-INT-002 (all 23 CLI + 5 core consumers compile; monorepo `npm run build` green in ONE phase, OQ-4) — with the P20 characterization still green and public event/stream shapes unchanged.

**Line-number freshness FIRST (Minor 2):** BEFORE any check below, compare every line range cited in P21 / this phase (the `clientContract.ts` `Contract*` definitions and the 23 CLI + 5 core consumer sites) against `.completed/P0.5.md`; FAIL immediately if the P0.5 marker is absent or any cited range drifted without a phase-file update.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-009.1 (`Contract*` deleted, not re-aliased)** — **GIVEN:** the P21-flipped `clientContract.ts`; **WHEN:** greps for `Contract*` payload names + any `type ContractContent = IContent` alias; **THEN:** the `Contract*` payload types are DELETED and `IContent` is NOT aliased back to them; FAIL on any surviving `Contract*` payload type or back-alias.
- **REQ-009.2 (surface retyped neutral)** — **GIVEN:** the flipped contract; **WHEN:** the four surface signatures are inspected; **THEN:** `generateDirectMessage`→`Promise<ModelOutput>`, `sendMessageStream` first param `AgentMessageInput`, `getHistory()`→`IContent[]`, `sendMessageStream` params neutral (`AgentMessageInput`/`ModelGenerationSettings`); FAIL on any residual `Contract*`/`ContractPartListUnion`/`ContractSendMessageParameters`.
- **REQ-INT-002 (cross-package build green in ONE phase, OQ-4)** — **GIVEN:** all 23 CLI + 5 core consumers; **WHEN:** `npm run typecheck && npm run build` runs across the monorepo and the checkpointed diff review is performed; **THEN:** every consumer compiles in this single atomic phase with public event/stream shapes unchanged (RISK-1) and P20 characterization green; FAIL on any consumer typecheck failure or a changed public event/stream shape. (Additional Risk 3: P21 stays atomic — NO dual-typed `Contract*` compatibility surface is introduced to split it.)

**C2 (verify explicitly):** the TYPE-SURFACE assertions are proven HERE against the flipped contract — NOT in P20 (which characterized observable behavior only). Confirm the P20 characterization tests STILL pass AND that the neutral surface types now hold:
- `AgentClientContract.generateDirectMessage` returns `Promise<ModelOutput>` (was `Promise<ContractGenerateContentResponse>`).
- `AgentClientContract.sendMessageStream` first param is `AgentMessageInput` (was `ContractPartListUnion`).
- `AgentChatContract.getHistory()`/`AgentClientContract.getHistory()` return `IContent[]` (was `ContractContent[]`).
- `AgentChatContract.sendMessageStream` params are neutral (`AgentMessageInput`/`ModelGenerationSettings`), not `ContractSendMessageParameters`.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] Zero `Contract*` payload-type references in core/cli/agents prod (`grep`).
- [ ] `IContent` NOT aliased back to `ContractContent` (the #2424 trap).
- [ ] **C2 type-surface (RED→green after the flip):** `generateDirectMessage` returns `Promise<ModelOutput>`; `sendMessageStream` takes `AgentMessageInput`; `getHistory` returns `IContent[]`; `AgentChatContract.sendMessageStream` takes neutral params (not `ContractSendMessageParameters`). Trace the types in `packages/core/src/core/clientContract.ts`.
- [ ] All 23 CLI + 5 core consumers compile; monorepo `npm run build` green (paste).
- [ ] P20 characterization tests green (history round-trip CLONE-independence + idle-wait, direct-message observable visible text/usage, stream sequence preserved) — and they still assert OBSERVABLE behavior (they did not need to change to accommodate the neutral types).
- [ ] Public event/stream shapes unchanged; deferred-impl + lint-guard clean.

## Shrink-ratchet (M4)
- [ ] Structural-hit count is STRICTLY LOWER than the prior slice's. Use the AUTHORITATIVE AST counter landed in P02 (Major 4/5): `npx tsx scripts/agents-neutral-gate.ts --count` (AST-context-aware, allow-list-subtracted — NOT broad grep). The broad grep in verification-template §9 is ADVISORY only (slice-scoped) and never the pass/fail gate. Update the integer in `dev-docs/agents-neutral-gate-baseline.md`; paste before/after into the marker.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace a CLI history-export consumer using neutral IContent end-to-end. Confirm build-green checkpoint. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P21a.md`.
