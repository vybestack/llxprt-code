# Phase 04a: Neutral gap types TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P04a`

## Prerequisites
- Required: Phase 04 completed.

Follow `plan/verification-template.md`. TDD-phase specifics:

## Requirements Implemented (Expanded)

### Verifies the P04 RED behavioral tests (REQ-001.1..001.5) exist, are behavioral, and fail naturally (verification GWT — Major 1)
**Full Text**: Confirms the RED behavioral tests for REQ-001.1 (AgentMessageInput→IContent conversion), REQ-001.2 (lossless legacy→IContent incl. thoughtSignature; unsupported→`{ok:false}`), REQ-001.3 (`sendParamsToRequest` yields a `ModelGenerationRequest` with no Google-shaped keys), REQ-001.4 (afcHistory round-trip), REQ-001.5 (`toModelStreamChunk` preserves responseId + providerMetadata — the OQ-16 gap) exist and FAIL NATURALLY against the P03 stub, with ≥30% property-based.
**Behavior (verification gate):**
- GIVEN: P04's test files (`agentMessageInput.test.ts`, `modelEnvelope.afc-providerMetadata.test.ts`) and the P03 non-behavioral stubs.
- WHEN: the verifier runs the phase test suite plus the mock-theater/reverse-testing/property-ratio detectors from `verification-template.md`.
- THEN: every REQ-001.x has ≥1 behavioral test that FAILS with a value mismatch (NOT "is not a function", NOT `toThrow('NotYetImplemented')`); the aggregate property ratio is ≥30%; zero mock-theater/reverse-testing hits — otherwise the phase FAILS with the specific finding.
**Why This Matters**: proves the TDD phase established genuine RED behavioral coverage before P05 implements against it.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] Tests assert REAL behavior (input→output deep-equal), NOT mock calls / structure-only.
- [ ] NO reverse testing (`toThrow('NotYetImplemented')`, `not.toThrow()`).
- [ ] ≥30% property-based (paste counts).
- [ ] Tests FAIL naturally against the stub (run and paste head of output — expect value mismatches, not "not a function").
- [ ] BR-5 covered: thoughtSignature-preserving test present; ES-2 covered: unsupported-input returns `{ok:false}`.
- [ ] REQ-001.5 covered: providerMetadata-preservation test present (this is the OQ-16 gap).
- [ ] Full requirement text copied into test headers.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm each test would CATCH a broken implementation (reason through 3). Verdict PASS only if tests are behavioral and fail naturally.

## Phase Completion Marker
`project-plans/issue2349/.completed/P04a.md`.
