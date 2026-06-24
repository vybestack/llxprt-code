# Phase 01a: Domain Analysis Verification

## Phase ID

`PLAN-20260617-COREAPI.P01a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 01 completed
- Verification: `grep -l "@plan:PLAN-20260617-COREAPI.P01" project-plans/issue1594/analysis/domain-model.md`

## Purpose

Verify the domain model is complete, implementation-free, and consistent with
`specification.md`, `overview.md`, and P00a corrections.

## Verification Commands

```bash
missing=0
# Marker present
grep -q "@plan:PLAN-20260617-COREAPI.P01" project-plans/issue1594/analysis/domain-model.md || { echo "MISSING plan marker"; missing=1; }
# REQ coverage
for n in $(seq -w 1 21); do grep -q "REQ-0$n" project-plans/issue1594/analysis/domain-model.md || { echo "MISSING REQ-0$n"; missing=1; }; done
# No code blocks that look like real TS implementation (allow type sketches)
grep -nE "function .*\{|=> \{.*return" project-plans/issue1594/analysis/domain-model.md && { echo "FAIL: impl code present"; missing=1; }
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

Answer ALL in the completion marker:

1. Does the model cover every REQ and every T-row? (list any gap → FAIL)
2. Are invariants testable and consistent with P00a corrections (file-based
   FakeProvider, telemetry stats source, subpath-must-be-created, rebuild-hook
   pinning)? 
3. Is there ANY implementation code? (if yes → FAIL)
4. Are the 6 state transitions internally consistent with the 6 pseudocode files?

### Holistic Functionality Assessment (write in completion marker)

- What does the domain model describe?
- Does it satisfy the requirements (cite sections)?
- What data flow does the bootstrap/rebind/stream describe?
- What could go wrong (gaps)?
- Verdict: PASS/FAIL with explanation.

## Success Criteria

- PASS only if all REQs + T-rows covered, no impl code, invariants testable.

## Failure Recovery

- Return to Phase 01 with specific gap list; re-run until PASS.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P01a.md` (include Holistic Assessment).
