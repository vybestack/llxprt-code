# Phase 11: Anthropic/Gemini Provider Tests

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P11`

## Prerequisites

- Required: Phase 10a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P10a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Pseudocode document `anthropic-gemini-stateless.md`
  - Stub suites for Anthropic/Gemini

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/anthropic/__tests__/anthropic.stateless.stub.test.ts`
  - Rename to `anthropic.stateless.test.ts`
  - Implement tests for per-call settings, auth handling, and client reuse keyed by runtime
  - Reference pseudocode line numbers in each test case

- `packages/core/src/providers/gemini/__tests__/gemini.stateless.stub.test.ts`
  - Rename to `gemini.stateless.test.ts`
  - Add tests covering streaming sessions, tool availability, and session isolation

- Update pseudocode document if numbering adjusted

### Required Code Markers

```typescript
it('isolates anthropic session state @plan:PLAN-20251018-STATELESSPROVIDER2.P11 @requirement:REQ-SP2-001 @pseudocode anthropic-gemini-stateless.md lines X-Y', async () => {
  // ...
});
```

## Verification Commands

### Automated Checks

```bash
grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P11" packages/core/src/providers/anthropic/__tests__/anthropic.stateless.test.ts packages/core/src/providers/gemini/__tests__/gemini.stateless.test.ts

# EXPECTED TO FAIL
npm test -- --run anthropic.stateless
npm test -- --run gemini.stateless
```

### Manual Verification Checklist

- [ ] Tests fail due to current stateful behavior
- [ ] Each test cites pseudocode lines
- [ ] No implementation changes yet

## Success Criteria

- Suites fail highlighting leakage in Anthropic/Gemini providers

## Failure Recovery

1. Revert renamed files
2. Recreate failing tests per instructions

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P11.md`

```markdown
Phase: P11
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/anthropic/__tests__/anthropic.stateless.test.ts
- packages/core/src/providers/gemini/__tests__/gemini.stateless.test.ts
- project-plans/20251018statelessprovider2/analysis/pseudocode/anthropic-gemini-stateless.md
Verification:
- <paste failing command outputs>
```
