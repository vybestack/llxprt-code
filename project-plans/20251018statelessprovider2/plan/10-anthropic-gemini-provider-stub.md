# Phase 10: Anthropic/Gemini Provider Stub

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P10`

## Prerequisites

- Required: Phase 09a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P09a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Stateless OpenAI implementations

## Implementation Tasks

### Files to Create

- `project-plans/20251018statelessprovider2/analysis/pseudocode/anthropic-gemini-stateless.md`
  - Document stateless behavior for Anthropic and Gemini providers, including OAuth specifics and streaming behavior
  - Tag with `@plan:PLAN-20251018-STATELESSPROVIDER2.P10` & `@requirement:REQ-SP2-001`

- `packages/core/src/providers/anthropic/__tests__/anthropic.stateless.stub.test.ts`
- `packages/core/src/providers/gemini/__tests__/gemini.stateless.stub.test.ts`
  - Placeholder suites with minimal assertions and plan markers

### Files to Modify

- `packages/core/src/providers/anthropic/AnthropicProvider.ts`
- `packages/core/src/providers/gemini/GeminiProvider.ts`
  - Insert TODO comments referencing pseudocode

### Required Code Markers

```typescript
/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P10
 * @requirement REQ-SP2-001
 */
```

## Verification Commands

### Automated Checks

```bash
grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P10" project-plans/20251018statelessprovider2/analysis/pseudocode/anthropic-gemini-stateless.md
npm test -- --run anthropic.stateless.stub
npm test -- --run gemini.stateless.stub
```

### Manual Verification Checklist

- [ ] Pseudocode document created with numbered steps
- [ ] Stub suites run successfully
- [ ] TODO markers present in providers

## Success Criteria

- Placeholders ready for TDD

## Failure Recovery

1. Remove created files
2. Recreate per instructions

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P10.md`

```markdown
Phase: P10
Completed: YYYY-MM-DD HH:MM
Files Created:
- project-plans/20251018statelessprovider2/analysis/pseudocode/anthropic-gemini-stateless.md
- packages/core/src/providers/anthropic/__tests__/anthropic.stateless.stub.test.ts
- packages/core/src/providers/gemini/__tests__/gemini.stateless.stub.test.ts
Files Modified:
- packages/core/src/providers/anthropic/AnthropicProvider.ts
- packages/core/src/providers/gemini/GeminiProvider.ts
Verification:
- <paste command outputs>
```
