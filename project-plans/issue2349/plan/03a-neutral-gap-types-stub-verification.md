# Phase 03a: Neutral gap types STUB — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P03a`

## Prerequisites
- Required: Phase 03 completed. `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P03" packages/core/src/llm-types`
- Follow `plan/verification-template.md` (shared semantic checklist). This file carries the full
  per-phase template structure below; the shared template is the common body it references, NOT a
  substitute for these sections.

## Requirements Implemented (Expanded)
This verification phase confirms the SURFACE (stub, no behavior yet) of the requirements P03 introduces.

### REQ-001.1: AgentMessageInput neutral DTO (surface verified)
**Full Text**: `AgentMessageInput` neutral DTO replaces `PartListUnion` as the agent/turn user-message + initial-request input, with NO Google `Part`/`role` shape.
**Behavior**:
- GIVEN P03's stub;
- WHEN the verifier type-checks `AgentMessageInput` and inspects its shape;
- THEN the type exists, compiles, and has NO `role`/`parts`/`candidates` members (surface only; conversion is unimplemented).
**Why This Matters**: confirms the primary Google-shaped input vector's neutral replacement exists before behavior lands in P05.

### REQ-001.3: Turn-level neutral request DTO (surface verified)
**Full Text**: Turn-level neutral request DTO reuses/extends `ModelGenerationRequest`; `sendParamsToRequest` stub present; `ModelGenerationRequest`/`ModelGenerationSettings` reachable from the barrel.
**Behavior**:
- GIVEN: P03's stub
- WHEN: inspected
- THEN: `sendParamsToRequest` exists returning a correctly-typed `ModelGenerationRequest` placeholder and the neutral DTO types are barrel-reachable.
**Why This Matters**: confirms the second Google-shaped input vector's neutral replacement is wired before P04/P05.

### REQ-001.4: ModelOutput.afcHistory slot (surface verified)
**Full Text**: `ModelOutput.afcHistory?: IContent[]` first-class neutral AFC slot.
**Behavior**:
- GIVEN: P03's stub
- WHEN: type-checked
- THEN: `ModelOutput.afcHistory?: IContent[]` compiles.
**Why This Matters**: confirms AFC's neutral slot exists before synthetic-response deletion depends on it.

### REQ-001.5: barrel export (surface verified)
**Full Text**: The new gap symbols are exported from the `llm-types` barrel.
**Behavior**:
- GIVEN: P03's stub
- WHEN: the barrel is inspected
- THEN: `AgentMessageInput`/`iContentFromAgentMessageInput`/`iContentFromLegacyInput`/`sendParamsToRequest` are exported.
**Why This Matters**: retype slices can only consume the neutral DTO if it is barrel-reachable.

## Implementation Tasks
This is a verification phase; its "implementation" is executing the semantic verification below and
recording evidence. No production code is written. Perform:
- Read the P03 stub source + barrel; confirm the surface matches pseudocode `neutral-gap-types.md` lines 10-50.
- Run the Verification Commands; record outputs in the completion marker.
- Apply the shared semantic checklist (`verification-template.md`) fraud/lint-guard detectors.

## Verification Commands
```bash
# Surface compiles
npm run typecheck
# Markers present
grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P03" packages/core/src/llm-types | wc -l   # >0
# No reverse testing asserted on NotYetImplemented
if grep -rn "NotYetImplemented" packages/core/src/llm-types/*.test.ts; then echo "FAIL: reverse test asserts NotYetImplemented in llm-types stubs"; exit 1; fi
# AgentMessageInput has NO Google shape
if grep -rnE "role|parts|candidates" packages/core/src/llm-types/agentMessageInput.ts; then echo "FAIL: AgentMessageInput carries a Google-shaped member (role/parts/candidates)"; exit 1; fi
# Barrel exports the new symbols
grep -nE "AgentMessageInput|iContentFromAgentMessageInput|iContentFromLegacyInput|sendParamsToRequest" packages/core/src/llm-types/index.ts
# No suppression / no ServiceV2 parallel file
if grep -rnE "eslint-disable|ts-ignore|ts-expect-error|ts-nocheck" packages/core/src/llm-types/agentMessageInput.ts; then echo "FAIL: suppression directive in agentMessageInput.ts"; exit 1; fi
npm run lint:eslint-guard
```

## Success Criteria
- `AgentMessageInput` + `ModelOutput.afcHistory` compile; barrel exports the new symbols.
- Stubs return correctly-typed empty values; NO test asserts `NotYetImplemented` (no reverse testing).
- `AgentMessageInput` has NO `role`/`parts`/`candidates`; no `@google/genai` import added.
- Existing files MODIFIED in place (no `ServiceV2`/parallel file); no lint-guard violation.
- Line references cited by P03 match the refreshed P0.5 evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding (missing surface, reverse test, Google shape, or lint-guard violation)
to a remediation subagent; re-verify. Do NOT proceed to Phase 04 on FAIL.

## Holistic Assessment
Write the PLAN.md §7 assessment: confirm the gap-type SURFACE matches pseudocode `neutral-gap-types.md`
lines 10-50, and that nothing is implemented yet (stub). Verdict PASS only if the surface is correct and
no reverse tests exist.

## Phase Completion Marker
`project-plans/issue2349/.completed/P03a.md` with the pasted command outputs + the assessment.
