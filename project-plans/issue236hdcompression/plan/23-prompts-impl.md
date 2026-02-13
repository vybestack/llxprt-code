# Phase 23: Enriched Prompts & Todo-Aware Summarization — Implementation

## Phase ID

`PLAN-20260211-HIGHDENSITY.P23`

## Prerequisites

- Required: Phase 22 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P22" packages/core/src/core/__tests__/compression-prompts.test.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/__tests__/compression-prompts.test.ts` (prompt content tests)
  - `packages/core/src/core/compression/__tests__/compression-todos.test.ts` (todo integration tests)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-010.1–010.5: Enriched Prompt Sections (already done in P21)

Prompt sections were added in P21. P23 ensures they are final and tested.

### REQ-HD-011.1: CompressionContext Todo Field (already done in P21)

Field added in P21. P23 wires the population and consumption.

### REQ-HD-011.2: Todo Population

**Full Text**: When `buildCompressionContext()` assembles the context for compression, it shall populate `activeTodos` from the current todo state if available.
**Behavior**:
- GIVEN: Active todo items exist in the session
- WHEN: `buildCompressionContext()` runs in geminiChat.ts
- THEN: `context.activeTodos` contains the current todo items
**Why This Matters**: Without wiring, the field stays undefined and LLM strategies never see todos.

### REQ-HD-011.3: Todo Inclusion in LLM Request

**Full Text**: When an LLM-based strategy has `activeTodos` in its context, it shall append the todo list to the compression request.
**Behavior**:
- GIVEN: MiddleOutStrategy.compress() called with `activeTodos` containing 3 items
- WHEN: The compression request array is built
- THEN: A human message with formatted todo text appears between the history and the trigger instruction
**Why This Matters**: The LLM must see the todos to provide context behind each active task.

### REQ-HD-011.4: Non-LLM Strategies Unaffected

**Full Text**: Strategies where `requiresLLM` is `false` shall ignore the `activeTodos` field.
**Behavior**:
- GIVEN: HighDensityStrategy or TopDownTruncationStrategy called with `activeTodos`
- WHEN: Compression completes
- THEN: The result is identical to calling without `activeTodos`
**Why This Matters**: Non-LLM strategies must not break when the new field is present.

### REQ-HD-012.1: CompressionContext Transcript Field (already done in P21)

Field added in P21.

### REQ-HD-012.2: Transcript Pointer in Summary

**Full Text**: Where `transcriptPath` is present, LLM-based strategies shall include a note in the summary referencing the full pre-compression transcript path.
**Behavior**:
- GIVEN: MiddleOutStrategy.compress() called with `transcriptPath` = '/path/to/log.jsonl'
- WHEN: The compression request array is built
- THEN: The transcript path appears in the request content
**Why This Matters**: Provides a breadcrumb back to full uncompressed conversation.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/MiddleOutStrategy.ts`
  - ADD todo context injection: if `context.activeTodos` is non-empty, build formatted text and append as human message before trigger instruction
  - ADD transcript path injection: if `context.transcriptPath` is set, append reference note
  - ADD private `buildTodoContextText(todos)` method
  - ADD marker: `@plan:PLAN-20260211-HIGHDENSITY.P23`
  - ADD marker: `@requirement:REQ-HD-011.3, REQ-HD-012.2`
  - ADD marker: `@pseudocode:prompts-todos.md lines 251-276, 285-299`

- `packages/core/src/core/compression/OneShotStrategy.ts`
  - ADD same todo context injection pattern as MiddleOutStrategy
  - ADD same transcript path injection
  - ADD private `buildTodoContextText(todos)` method (or extract to shared utility)
  - ADD marker: `@plan:PLAN-20260211-HIGHDENSITY.P23`
  - ADD marker: `@requirement:REQ-HD-011.3, REQ-HD-012.2`
  - ADD marker: `@pseudocode:prompts-todos.md lines 305-312`

- `packages/core/src/core/geminiChat.ts`
  - MODIFY `buildCompressionContext()` to populate `activeTodos` from todo state
  - ADD private `getActiveTodosForCompression()` method
  - ADD private `getTranscriptPath()` method (returns undefined for initial implementation — REQ-HD-012.3 low priority)
  - ADD marker: `@plan:PLAN-20260211-HIGHDENSITY.P23`
  - ADD marker: `@requirement:REQ-HD-011.2, REQ-HD-012.1`
  - ADD marker: `@pseudocode:prompts-todos.md lines 155-238`

### Implementation Mapping (Pseudocode → Code)

#### buildCompressionContext additions — pseudocode lines 155–186

```
Lines 162-165: Collect activeTodos and transcriptPath
Lines 167-186: Add to returned context object
```

The method already returns a CompressionContext object. Add two new fields:
- `activeTodos: this.getActiveTodosForCompression()`
- `transcriptPath: this.getTranscriptPath()`

#### getActiveTodosForCompression — pseudocode lines 190–223

```
Lines 195-210: Try TodoContextTracker via runtimeContext
Lines 215-222: Try/catch with undefined fallback
```

Access path: `this.runtimeContext.todoContextTracker?.getActiveTodos()`. If unavailable, return undefined.

#### getTranscriptPath — pseudocode lines 228–238

```
Line 238: Return undefined (low priority, CLI layer dependency)
```

Return undefined for initial implementation. Can be wired when CLI exposes the path.

#### MiddleOutStrategy todo injection — pseudocode lines 251–276

```
Lines 260-265: Check activeTodos, build text, push as human message
Lines 268-271: Check transcriptPath, include reference
Lines 273-276: Push trigger instruction LAST
```

Currently the compression request is:
1. `[{human: prompt}, ...toCompress, {human: TRIGGER_INSTRUCTION}]`

Change to:
1. `[{human: prompt}, ...toCompress]`
2. If activeTodos non-empty → push `{human: todoText}`
3. If transcriptPath → append to trigger or push separate message
4. Push `{human: TRIGGER_INSTRUCTION}` last

#### buildTodoContextText — pseudocode lines 285–299

```
Lines 287-290: Header text explaining todos
Lines 292-297: Format each todo with status and content, include subtasks
Lines 299: Join and return
```

#### OneShotStrategy — pseudocode lines 305–312

Same pattern as MiddleOutStrategy. Consider extracting `buildTodoContextText` to a shared utility if both strategies need it, or keep it as a private method on each (simpler, less coupling).

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P23
 * @requirement REQ-HD-011.3, REQ-HD-012.2
 * @pseudocode prompts-todos.md lines 251-276, 285-299
 */
private buildTodoContextText(todos: readonly Todo[]): string { ... }
```

### Anti-Patterns to Avoid (from pseudocode)

- **DO NOT** pass raw todo JSON to the LLM — format as readable text
- **DO NOT** include activeTodos in HighDensityStrategy or TopDownTruncationStrategy
- **DO NOT** import CLI-layer types into core — Todo type comes from core's own todo-schemas
- **DO NOT** block compression if todo state is unavailable — activeTodos is optional
- **DO NOT** modify existing prompt section framing — only ADD the todo/transcript injection
- **DO NOT** change the order of existing compression request elements

## Verification Commands

### Automated Checks

```bash
# 1. ALL P22 tests pass (this is the primary verification)
npm run test -- --run packages/core/src/core/__tests__/compression-prompts.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/compression-todos.test.ts
# Expected: All pass, 0 failures

# 2. ALL previous phase tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: All pass, 0 failures

# 3. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 4. Full test suite passes
npm run test -- --run
# Expected: All pass

# 5. Plan markers for P23
grep -rn "@plan.*HIGHDENSITY.P23" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts packages/core/src/core/geminiChat.ts | wc -l
# Expected: ≥ 3

# 6. Pseudocode references
grep -rn "@pseudocode.*prompts-todos" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts packages/core/src/core/geminiChat.ts | wc -l
# Expected: ≥ 2

# 7. buildTodoContextText method exists
grep "buildTodoContextText" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts
# Expected: ≥ 2

# 8. activeTodos check in strategies
grep "activeTodos" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts
# Expected: ≥ 2

# 9. activeTodos NOT used in non-LLM strategies
grep "activeTodos" packages/core/src/core/compression/HighDensityStrategy.ts packages/core/src/core/compression/TopDownTruncationStrategy.ts
# Expected: 0 matches

# 10. getActiveTodosForCompression in geminiChat
grep "getActiveTodosForCompression" packages/core/src/core/geminiChat.ts
# Expected: ≥ 2 (definition + call)
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P22)
- [ ] No skipped phases (P22 exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME in modified files
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts | grep -i "todo_context\|activeTodos\|transcript"
# Expected: No matches

# Note: getTranscriptPath() returning undefined is INTENTIONAL per REQ-HD-012.3 (low priority)
# It should have a comment explaining this, NOT a TODO marker

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts packages/core/src/core/geminiChat.ts | grep -v ".test.ts"
# Expected: No matches in new code (existing patterns may exist)
```

### Semantic Verification Checklist (MANDATORY)

1. **Does the code DO what the requirement says?**
   - [ ] REQ-HD-011.2: buildCompressionContext populates activeTodos
   - [ ] REQ-HD-011.3: MiddleOutStrategy adds todo text to compression request
   - [ ] REQ-HD-011.3: OneShotStrategy adds todo text to compression request
   - [ ] REQ-HD-011.4: HighDensityStrategy does NOT use activeTodos
   - [ ] REQ-HD-011.4: TopDownTruncationStrategy does NOT use activeTodos
   - [ ] REQ-HD-012.2: Transcript path included in LLM request when present

2. **Is this REAL implementation, not placeholder?**
   - [ ] buildTodoContextText formats todos with status and content
   - [ ] Todo injection actually adds a message to the compression request array
   - [ ] getActiveTodosForCompression tries to access real todo state

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing todo injection from MiddleOut → P22 test fails
   - [ ] Removing todo injection from OneShot → P22 test fails
   - [ ] Making getActiveTodosForCompression always return undefined → population test fails

4. **Is the feature REACHABLE by users?**
   - [ ] User creates todos → todo state available → buildCompressionContext picks them up → LLM strategies include them → compressed summary has better context

## Success Criteria

- ALL P22 tests pass
- ALL previous HD tests pass (no regression)
- Full test suite, lint, typecheck pass
- Todo injection implemented in MiddleOutStrategy and OneShotStrategy
- Todo population wired in buildCompressionContext
- Non-LLM strategies do NOT reference activeTodos
- Pseudocode line references match implementation logic

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/MiddleOutStrategy.ts`
2. `git checkout -- packages/core/src/core/compression/OneShotStrategy.ts`
3. `git checkout -- packages/core/src/core/geminiChat.ts`
4. Cannot proceed to Phase 24 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P23.md`
Contents:
```markdown
Phase: P23
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/compression/MiddleOutStrategy.ts [+N lines]
  - packages/core/src/core/compression/OneShotStrategy.ts [+N lines]
  - packages/core/src/core/geminiChat.ts [+N lines in buildCompressionContext]
Tests Passing:
  - compression-prompts.test.ts: [count]
  - compression-todos.test.ts: [count]
Verification: [paste verification output]

## Prompt & Todo Status
- Enriched prompt sections (4 new XML): COMPLETE (P21)
- CompressionContext fields (activeTodos, transcriptPath): COMPLETE (P21)
- Todo population in buildCompressionContext: COMPLETE (P23)
- Todo injection in LLM strategies: COMPLETE (P23)
- Transcript path: returns undefined (REQ-HD-012.3 low priority)
- Non-LLM strategies: VERIFIED unaffected (P23)
```
