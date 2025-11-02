# Phase 08: OpenAI/Responses Provider Tests

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P08`

## Prerequisites

- Required: Phase 07a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P07a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Pseudocode document `openai-responses-stateless.md`
  - Stub suites

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/openai/__tests__/openai.stateless.stub.test.ts`
  - Rename to `openai.stateless.test.ts`
  - Implement tests covering: client reuse keyed by runtime, base URL isolation, auth isolation, tool formatter resets
  - Reference pseudocode line numbers in each test

- `packages/core/src/providers/openai-responses/__tests__/openaiResponses.stateless.stub.test.ts`
  - Rename to `openaiResponses.stateless.test.ts`
  - Implement tests verifying stateless streaming behavior and compatibility with new call contract

- Update pseudocode document if numbering changed

### Required Code Markers

```typescript
it('creates client per runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P08 @requirement:REQ-SP2-001 @pseudocode openai-responses-stateless.md lines X-Y', async () => {
  // ...
});
```

## Verification Commands

### Automated Checks

```bash
grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P08" packages/core/src/providers/openai/__tests__/openai.stateless.test.ts packages/core/src/providers/openai-responses/__tests__/openaiResponses.stateless.test.ts

# EXPECTED TO FAIL
npm test -- --run openai.stateless
npm test -- --run openaiResponses.stateless
```

### Manual Verification Checklist

- [ ] Tests fail due to current stateful behavior
- [ ] Each test cites pseudocode lines
- [ ] No implementation changes applied yet

## Success Criteria

- Suites fail with clear leakage errors

## Failure Recovery

1. Revert renamed files
2. Recreate failing tests

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P08.md`

```markdown
Phase: P08
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/openai/__tests__/openai.stateless.test.ts
- packages/core/src/providers/openai-responses/__tests__/openaiResponses.stateless.test.ts
- project-plans/20251018statelessprovider2/analysis/pseudocode/openai-responses-stateless.md
Verification:
- <paste failing command outputs>
```
