# Phase 22: Enriched Prompts & Todo-Aware Summarization — TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P22`

## Prerequisites

- Required: Phase 21 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P21" packages/core/src/core/prompts.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/prompts.ts` (4 new XML sections added)
  - `packages/core/src/prompt-config/defaults/compression.md` (4 new XML sections added)
  - `packages/core/src/core/compression/types.ts` (activeTodos, transcriptPath fields)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-010.1–010.5: Enriched Prompt Sections

**Full Text**: The compression prompt template shall include `<task_context>`, `<user_directives>`, `<errors_encountered>`, and `<code_references>` sections. Both `prompts.ts` and `compression.md` shall be updated.
**Behavior**:
- GIVEN: `getCompressionPrompt()` is called
- WHEN: The return value is inspected
- THEN: It contains all 4 new XML sections inside `<state_snapshot>`
**Why This Matters**: Tests lock down the prompt structure so accidental edits don't regress enrichment.

### REQ-HD-011.2: Todo Population

**Full Text**: When `buildCompressionContext()` assembles the context for compression, it shall populate `activeTodos` from the current todo state if available.
**Behavior**:
- GIVEN: A session with active todo items
- WHEN: `buildCompressionContext()` runs
- THEN: `context.activeTodos` is populated with current todo items
**Why This Matters**: Without population, the field stays undefined and LLM strategies never see todos.

### REQ-HD-011.3: Todo Inclusion in LLM Request

**Full Text**: When an LLM-based strategy has `activeTodos` in its context, it shall append the todo list to the compression request so the LLM can explain the context behind each active todo in the summary.
**Behavior**:
- GIVEN: MiddleOutStrategy.compress() called with `activeTodos` containing items
- WHEN: The compression request is assembled
- THEN: A human message containing formatted todo text is included before the trigger instruction
**Why This Matters**: The LLM needs to see the todos to provide context-aware summaries.

### REQ-HD-011.4: Non-LLM Strategies Unaffected

**Full Text**: Strategies where `requiresLLM` is `false` (including `HighDensityStrategy`) shall ignore the `activeTodos` field.
**Behavior**:
- GIVEN: HighDensityStrategy.compress() called with `activeTodos` containing items
- WHEN: Compression completes
- THEN: The activeTodos field has no effect on the compression result
**Why This Matters**: Non-LLM strategies have nowhere to send todo context — they must not break.

### REQ-HD-012.2: Transcript Pointer in Summary

**Full Text**: Where `transcriptPath` is present, LLM-based strategies shall include a note in the summary referencing the full pre-compression transcript path.
**Behavior**:
- GIVEN: MiddleOutStrategy.compress() called with `transcriptPath` set
- WHEN: The compression request is assembled
- THEN: The transcript path appears in the request content
**Why This Matters**: Gives the compressed summary a pointer back to the uncompressed record.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/__tests__/compression-prompts.test.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P22`
  - MUST include: `@requirement:REQ-HD-010.1, REQ-HD-010.2, REQ-HD-010.3, REQ-HD-010.4, REQ-HD-010.5`
  - Test: `getCompressionPrompt()` output contains `<task_context>` section
  - Test: `getCompressionPrompt()` output contains `<user_directives>` section
  - Test: `getCompressionPrompt()` output contains `<errors_encountered>` section
  - Test: `getCompressionPrompt()` output contains `<code_references>` section
  - Test: All 4 new sections are inside `<state_snapshot>` tags
  - Test: Existing 5 sections are still present (`overall_goal`, `key_knowledge`, `current_progress`, `active_tasks`, `open_questions`)

- `packages/core/src/core/compression/__tests__/compression-todos.test.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P22`
  - MUST include: `@requirement:REQ-HD-011.2, REQ-HD-011.3, REQ-HD-011.4, REQ-HD-012.2`
  - Test: MiddleOutStrategy includes todo text in compression request when `activeTodos` present
  - Test: MiddleOutStrategy omits todo text when `activeTodos` is undefined
  - Test: MiddleOutStrategy omits todo text when `activeTodos` is empty array
  - Test: OneShotStrategy includes todo text in compression request when `activeTodos` present
  - Test: OneShotStrategy omits todo text when `activeTodos` is undefined
  - Test: HighDensityStrategy compression result is unaffected by `activeTodos`
  - Test: TopDownTruncationStrategy compression result is unaffected by `activeTodos`
  - Test: MiddleOutStrategy includes transcript path reference when `transcriptPath` present
  - Test: MiddleOutStrategy omits transcript reference when `transcriptPath` is undefined
  - Test: OneShotStrategy includes transcript path reference when `transcriptPath` present
  - Test: Todo text format includes status and content for each todo
  - Test: Todo text format includes subtasks when present

### Files to Modify

- `packages/core/src/prompt-config/defaults/compression.md`
  - (No code change — test verifies file content matches expected sections)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P22
 * @requirement REQ-HD-010.1, REQ-HD-010.2, REQ-HD-010.3, REQ-HD-010.4
 */
describe('getCompressionPrompt enriched sections', () => { ... });

/**
 * @plan PLAN-20260211-HIGHDENSITY.P22
 * @requirement REQ-HD-011.2, REQ-HD-011.3, REQ-HD-011.4, REQ-HD-012.2
 */
describe('todo-aware summarization', () => { ... });
```

## Verification Commands

### Automated Checks

```bash
# 1. TypeScript compiles (including new test files)
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers for P22
grep -rn "@plan.*HIGHDENSITY.P22" packages/core/src/core/__tests__/compression-prompts.test.ts packages/core/src/core/compression/__tests__/compression-todos.test.ts | wc -l
# Expected: ≥ 2

# 3. Tests exist and are recognized
npm run test -- --run packages/core/src/core/__tests__/compression-prompts.test.ts 2>&1 | grep -c "test\|FAIL\|PASS"
# Expected: ≥ 1

# 4. Tests for todo integration exist
npm run test -- --run packages/core/src/core/compression/__tests__/compression-todos.test.ts 2>&1 | grep -c "test\|FAIL\|PASS"
# Expected: ≥ 1
```

### Semantic Verification Checklist (MANDATORY)

1. **Does the code DO what the requirement says?**
   - [ ] Tests for all 4 new XML sections in getCompressionPrompt() output
   - [ ] Tests for MiddleOutStrategy todo inclusion (with/without todos)
   - [ ] Tests for OneShotStrategy todo inclusion (with/without todos)
   - [ ] Tests for non-LLM strategy indifference to activeTodos
   - [ ] Tests for transcript path inclusion

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests assert specific content (section names, todo formatting)
   - [ ] Tests use real strategy classes or well-targeted behavioral assertions

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing a section from the prompt → prompt content test fails
   - [ ] Removing todo injection from strategy → todo inclusion test fails
   - [ ] Tests verify actual outputs, not just that code ran

## Success Criteria

- Test files created and TypeScript compiles
- Prompt content tests cover all 4 new sections
- Todo-aware tests cover LLM strategies (MiddleOut, OneShot) and non-LLM strategies
- Transcript path tests cover presence and absence
- Tests that depend on P23 implementation fail naturally (not due to compile errors)
- All existing tests pass

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/__tests__/compression-prompts.test.ts`
2. `git checkout -- packages/core/src/core/compression/__tests__/compression-todos.test.ts`
3. Cannot proceed to Phase 23 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P22.md`
Contents:
```markdown
Phase: P22
Completed: [timestamp]
Files Created:
  - packages/core/src/core/__tests__/compression-prompts.test.ts [N tests]
  - packages/core/src/core/compression/__tests__/compression-todos.test.ts [N tests]
Tests Added: [count]
Tests Passing: [count that pass now vs expected to fail until P23]
Verification: [paste verification output]
```
