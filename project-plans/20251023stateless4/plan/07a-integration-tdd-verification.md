# Phase 07a: Integration TDD Verification

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P07a`

## Prerequisites
- Required: `.completed/P07.md` exists documenting failing tests.
- Verification: `test -f project-plans/20251023stateless4/.completed/P07.md`
- Expected files from previous phase: Newly authored failing stateless tests.

## Implementation Tasks

### Files to Modify
- `project-plans/20251023stateless4/analysis/verification/provider-cache-elimination.md`
  - Record failing scenarios and coverage map.
- `project-plans/20251023stateless4/analysis/verification/logging-wrapper-adjustments.md`
  - Capture wrapper-related failures.
- `project-plans/20251023stateless4/analysis/verification/provider-runtime-handling.md`
  - Document CLI runtime isolation/profile failure expectations tied to pseudocode lines 10-16.

### Activities
- Ensure each failing test references pseudocode line ranges in description or comments.
- Capture baseline metrics (failure messages, stack traces) for integration into verification logs.
- Highlight Anthropic and OpenAI Responses failures triggered by alternating call-scoped `config`/user-memory data (pseudocode line 13 in `analysis/pseudocode/provider-runtime-handling.md`, @plan:PLAN-20251023-STATELESS-HARDENING.P07, @requirement:REQ-SP4-003).
- Capture CLI runtime isolation/profile application failures demonstrating why integration work is required.

### Required Code Markers
- Verification updates mention `@plan:PLAN-20251023-STATELESS-HARDENING.P07` and requirements per test using `@requirement:REQ-SP4-00X`.

## Verification Commands

### Automated Checks
```bash
pnpm test --filter "stateless" --runInBand && exit 1
pnpm test --filter "runtime isolation" --runInBand && exit 1
```

### Manual Verification Checklist
- [ ] All targeted suites (providers, logging wrapper, CLI runtime/profile tests) remain red.
- [ ] Anthropic/OpenAI Responses tests clearly document call-scoped `config`/user-memory assertions and their failure output.
- [ ] Failure logs stored for future comparison.
- [ ] No partial implementations introduced.

## Success Criteria
- Verified failing baseline for provider stateless work.

## Failure Recovery
1. If tests pass prematurely, remove accidental implementation changes.
2. Strengthen assertions to reflect intended behaviour.

## Phase Completion Marker
- Create `.completed/P07a.md` with timestamp, failing test output, and reviewer notes per PLAN-TEMPLATE guidelines.
