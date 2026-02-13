# Phase 22a: Enriched Prompts & Todo-Aware Summarization — TDD Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P22a`

## Purpose

Verify that all tests for enriched prompts and todo-aware summarization are properly written, compile, and cover the requirements. Prompt content tests should pass (sections were added in P21). Todo integration tests may fail naturally pending P23 implementation.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers for P22
grep -rn "@plan.*HIGHDENSITY.P22" packages/core/src/core/__tests__/compression-prompts.test.ts packages/core/src/core/compression/__tests__/compression-todos.test.ts | wc -l
# Expected: ≥ 2

# 3. Requirement markers
grep -rn "@requirement.*REQ-HD-010" packages/core/src/core/__tests__/compression-prompts.test.ts | wc -l
# Expected: ≥ 1
grep -rn "@requirement.*REQ-HD-011" packages/core/src/core/compression/__tests__/compression-todos.test.ts | wc -l
# Expected: ≥ 1

# 4. No deferred work in test files
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/core/__tests__/compression-prompts.test.ts packages/core/src/core/compression/__tests__/compression-todos.test.ts
# Expected: No matches
```

## Behavioral Verification

### Prompt Content Tests

The verifier MUST read `packages/core/src/core/__tests__/compression-prompts.test.ts` and confirm:

- [ ] Test verifies `getCompressionPrompt()` output contains `<task_context>`
- [ ] Test verifies output contains `<user_directives>`
- [ ] Test verifies output contains `<errors_encountered>`
- [ ] Test verifies output contains `<code_references>`
- [ ] Test verifies all new sections are inside `<state_snapshot>` (between open and close tags)
- [ ] Test verifies existing 5 sections are still present
- [ ] Tests use real `getCompressionPrompt()` function (no mocks of the prompt)

### Todo-Aware Summarization Tests

The verifier MUST read `packages/core/src/core/compression/__tests__/compression-todos.test.ts` and confirm:

- [ ] Test for MiddleOutStrategy with activeTodos present — verifies todo content in LLM request
- [ ] Test for MiddleOutStrategy with activeTodos undefined — verifies no todo content
- [ ] Test for MiddleOutStrategy with activeTodos empty — verifies no todo content
- [ ] Test for OneShotStrategy with activeTodos present
- [ ] Test for OneShotStrategy with activeTodos undefined
- [ ] Test for HighDensityStrategy with activeTodos — verifies no effect on result
- [ ] Test for TopDownTruncationStrategy with activeTodos — verifies no effect
- [ ] Test for MiddleOutStrategy with transcriptPath present
- [ ] Test for MiddleOutStrategy with transcriptPath undefined
- [ ] Test for OneShotStrategy with transcriptPath present
- [ ] Test for todo text formatting (status + content per todo)
- [ ] Tests follow behavioral pattern — test the BEHAVIOR, not internal implementation details
- [ ] Tests do NOT mock the strategy internals — they test through the public compress() method

### Test Quality Verification

- [ ] Tests use real assertions (expect/assert), not just console.log
- [ ] Tests would genuinely fail if the tested behavior was removed
- [ ] Tests cover positive cases (feature works) and negative cases (feature absent)
- [ ] Tests don't depend on implementation order within strategies

### Prompt Content Tests Should Pass Now

```bash
# Prompt content tests — should PASS (sections added in P21)
npm run test -- --run packages/core/src/core/__tests__/compression-prompts.test.ts 2>&1 | tail -15
# Expected: All pass
```

### Todo Tests — Expected State

```bash
# Todo integration tests — state depends on strategy implementations
npm run test -- --run packages/core/src/core/compression/__tests__/compression-todos.test.ts 2>&1 | tail -15
# Expected: Tests that depend on P23 changes fail naturally.
#           Tests for non-LLM strategies (HighDensity, TopDownTruncation) may pass
#           since they don't use activeTodos.
```

### Regression Verification

```bash
# All existing tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: Only new P22 tests may fail (pending P23), all pre-P22 tests pass

# Lint
npm run lint
# Expected: 0 errors

# Typecheck
npm run typecheck
# Expected: 0 errors
```

## Success Criteria

- Test files compile
- Prompt content tests cover all 4 new sections and pass
- Todo integration tests cover MiddleOut, OneShot, HighDensity, TopDownTruncation
- Transcript path tests cover presence and absence
- Tests follow behavioral testing patterns
- Plan and requirement markers present
- All pre-P22 tests pass

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P22 to fix
3. Re-run P22a
