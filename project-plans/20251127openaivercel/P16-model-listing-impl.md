# Phase 16: Model Listing Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P16`

## Prerequisites

- Required: Phase 15 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts` fails with expected errors
- Expected files from previous phase: `modelListing.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase implements the model listing functionality to make all tests from Phase 15 pass. This is the final implementation phase.

## Requirements Implemented (Expanded)

### REQ-OAV-010: Model Listing

**Implementation**:
- Implement listModels method
- Return static list of common OpenAI models
- Include GPT-4, GPT-3.5, and O1 models
- Include context window information

## Pseudocode Reference

Model listing is a static implementation per specification requirements REQ-OAV-009.
Models list reflects current OpenAI available models with known context window sizes.

## Implementation Code

### File: `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` (updated listModels)

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P16
// @requirement:REQ-OAV-009

async listModels(): Promise<ModelInfo[]> {
  // Return static list of common OpenAI models
  // Sorted alphabetically by name
  return [
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      provider: 'openaivercel',
      contextWindow: 16385,
    },
    {
      id: 'gpt-4',
      name: 'GPT-4',
      provider: 'openaivercel',
      contextWindow: 8192,
    },
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
    {
      id: 'o1-mini',
      name: 'O1 Mini',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
    {
      id: 'o1-preview',
      name: 'O1 Preview',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
  ];
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P16" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run model listing tests
npm run test -- packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts

# Run ALL provider tests to ensure complete functionality
npm run test -- packages/core/src/providers/openai-vercel/
```

### Full Test Suite

```bash
# Run complete test suite for the provider
npm run test -- packages/core/src/providers/openai-vercel/ --reporter=verbose

# Run type checking
npm run typecheck

# Run linting
npm run lint
```

### Semantic Verification Checklist

- [ ] listModels returns array of models
- [ ] All models have id, name, provider, contextWindow
- [ ] Provider field is 'openaivercel'
- [ ] GPT-4o, GPT-4o-mini, GPT-4-turbo included
- [ ] GPT-3.5-turbo included
- [ ] O1-preview and O1-mini included
- [ ] Context windows are correct
- [ ] Models sorted alphabetically by name
- [ ] All P15 tests PASS
- [ ] All provider tests PASS

## Success Criteria

- All model listing tests PASS
- All provider tests PASS
- Provider is fully functional
- Type checking passes
- Linting passes

## Fraud Prevention Checklist (TDD GREEN Phase - FINAL)

Before marking this phase complete, verify:

- [ ] Implementation is MINIMAL to pass tests (no extra features)
- [ ] All P15 tests now PASS (TDD Green)
- [ ] No implementation code was written BEFORE tests
- [ ] Models are sorted alphabetically by name
- [ ] All model IDs use valid OpenAI API format
- [ ] Context windows are accurate
- [ ] Type checking passes
- [ ] Linting passes
- [ ] ALL provider tests pass (complete regression check)

### Anti-Pattern Detection

```bash
# Check for ANY deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/
# Expected: No matches at all

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/providers/openai-vercel/
# Expected: No matches

# Verify ALL tests pass
npm run test -- packages/core/src/providers/openai-vercel/
# Expected: All pass
```

## Final Integration Verification

```bash
# Verify complete provider implementation
echo "=== Final Verification Checklist ==="

# 1. All test files exist
ls packages/core/src/providers/openai-vercel/__tests__/*.test.ts
# Expected: 7-8 test files

# 2. All tests pass
npm run test -- packages/core/src/providers/openai-vercel/
# Expected: All pass

# 3. Type checking passes
npm run typecheck
# Expected: No errors

# 4. Linting passes
npm run lint
# Expected: No errors

# 5. Provider exports are correct
grep "export" packages/core/src/providers/openai-vercel/index.ts
# Expected: OpenAIVercelProvider, error classes, utils exported

# 6. Build succeeds
npm run build
# Expected: No errors

# 7. Plan markers are present in code
grep -r "@plan:PLAN-20251127-OPENAIVERCEL" packages/core/src/providers/openai-vercel/
# Expected: Multiple matches across files

# 8. Requirement markers are present
grep -r "@req:REQ-OAV" packages/core/src/providers/openai-vercel/
# Expected: Multiple matches across files
```

## Failure Recovery

If this phase fails:
1. Review test error messages
2. Check model list structure
3. Verify alphabetical sorting
4. Update implementation to match test expectations

## Related Files

- `packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- `packages/core/src/providers/IProvider.ts` (ModelInfo type)

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When implementation begins
- [ ] IN_PROGRESS → BLOCKED: If unexpected test failures
- [ ] IN_PROGRESS → COMPLETED: When all tests PASS (TDD Green, Final)
- [ ] BLOCKED → IN_PROGRESS: After issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P16.md`
Contents:

```markdown
Phase: P16
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts [diff stats]
Tests Passing: ALL ([total count])
Final Verification:
- All tests: PASS
- Type checking: PASS
- Linting: PASS
- Build: PASS
- Plan markers: Present
- Requirement markers: Present
Fraud Prevention Checklist: [all items checked]
```

---

## Plan Complete

Upon successful completion of Phase 16, the OpenAIVercelProvider is fully implemented with:

1. [OK] Provider registration (REQ-OAV-001)
2. [OK] Standard authentication (REQ-OAV-002)
3. [OK] BaseURL configuration (REQ-OAV-003)
4. [OK] Tool ID normalization (REQ-OAV-006)
5. [OK] Message format conversion (REQ-OAV-005)
6. [OK] Chat completion generation (REQ-OAV-007)
7. [OK] Streaming support (REQ-OAV-008)
8. [OK] Error handling (REQ-OAV-009)
9. [OK] Model listing (REQ-OAV-010)

All requirements have been implemented following strict TDD methodology.
