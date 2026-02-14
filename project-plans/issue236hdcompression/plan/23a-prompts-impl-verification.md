# Phase 23a: Enriched Prompts & Todo-Aware Summarization — Implementation Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P23a`

## Purpose

Verify the todo-aware summarization implementation from P23 is complete, all P22 tests pass, LLM strategies correctly inject todo context, non-LLM strategies are unaffected, and buildCompressionContext populates the new fields.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers for P23
grep -rn "@plan.*HIGHDENSITY.P23" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts packages/core/src/core/geminiChat.ts | wc -l
# Expected: ≥ 3

# 3. Pseudocode references
grep -rn "@pseudocode.*prompts-todos" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts packages/core/src/core/geminiChat.ts | wc -l
# Expected: ≥ 2

# 4. No deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts | grep -i "todo\|transcript\|active"
# Expected: No matches

# 5. activeTodos NOT in non-LLM strategies
grep "activeTodos" packages/core/src/core/compression/HighDensityStrategy.ts packages/core/src/core/compression/TopDownTruncationStrategy.ts 2>/dev/null
# Expected: No matches
```

## Behavioral Verification

### All Tests Pass

```bash
# P22 prompt and todo tests — primary verification
npm run test -- --run packages/core/src/core/__tests__/compression-prompts.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/compression-todos.test.ts
# Expected: All pass, 0 failures

# All HD tests — regression check
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: All pass, 0 failures
```

### Full Suite Regression

```bash
npm run test -- --run 2>&1 | tail -10
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: All pass
```

### MiddleOutStrategy Verification

The verifier MUST read `packages/core/src/core/compression/MiddleOutStrategy.ts` and confirm:

- [ ] `buildTodoContextText(todos)` method exists and formats todos as readable text
- [ ] In `compress()`: if `context.activeTodos` is non-empty, a human message with todo text is pushed to `compressionRequest`
- [ ] The todo message is pushed BEFORE the trigger instruction (TRIGGER_INSTRUCTION is last)
- [ ] If `context.activeTodos` is undefined or empty, no todo message is added
- [ ] If `context.transcriptPath` is set, the transcript path appears in the request
- [ ] If `context.transcriptPath` is undefined, no transcript reference
- [ ] Existing compression request assembly is preserved (prompt → history → [todo] → [transcript] → trigger)

### OneShotStrategy Verification

The verifier MUST read `packages/core/src/core/compression/OneShotStrategy.ts` and confirm:

- [ ] Same todo injection pattern as MiddleOutStrategy
- [ ] `buildTodoContextText(todos)` method exists (or uses shared utility)
- [ ] Trigger instruction remains the last message
- [ ] Transcript path injection when present

### buildCompressionContext Verification

The verifier MUST read `packages/core/src/core/geminiChat.ts` and confirm:

- [ ] `buildCompressionContext()` includes `activeTodos: this.getActiveTodosForCompression()`
- [ ] `buildCompressionContext()` includes `transcriptPath: this.getTranscriptPath()`
- [ ] `getActiveTodosForCompression()` attempts to read todo state from available services
- [ ] `getActiveTodosForCompression()` returns undefined if todo state unavailable (not throwing)
- [ ] `getTranscriptPath()` returns undefined (low priority per REQ-HD-012.3)
- [ ] Existing buildCompressionContext fields are UNCHANGED

### Todo Text Format Verification

The verifier MUST inspect `buildTodoContextText()` output format:

- [ ] Header explains that todos are active and should be contextualized
- [ ] Each todo includes its status (e.g., `[PENDING]`, `[IN_PROGRESS]`)
- [ ] Each todo includes its content text
- [ ] Subtasks are included when present (indented under parent)
- [ ] Output is human-readable text, NOT raw JSON

### Anti-Pattern Verification

- [ ] No raw JSON passed to LLM (todos formatted as text)
- [ ] No activeTodos reference in HighDensityStrategy
- [ ] No activeTodos reference in TopDownTruncationStrategy
- [ ] No CLI-layer imports in core compression strategies
- [ ] No blocking behavior when todo state is unavailable
- [ ] Existing prompt sections not modified

## End-to-End Data Flow Verification

1. **User creates todos** via `todo_write` tool call
   - [ ] TodoContextTracker tracks the state

2. **Compression triggered** (threshold exceeded)
   - [ ] `buildCompressionContext()` calls `getActiveTodosForCompression()`
   - [ ] Active todos populated in context

3. **LLM strategy receives context**
   - [ ] MiddleOutStrategy/OneShotStrategy checks `context.activeTodos`
   - [ ] If present: builds todo text, adds to compression request
   - [ ] LLM sees todos and can provide context in summary

4. **Non-LLM strategies receive context**
   - [ ] HighDensityStrategy ignores `activeTodos` entirely
   - [ ] TopDownTruncationStrategy ignores `activeTodos` entirely

## Success Criteria

- ALL P22 tests pass
- ALL previous HD tests pass
- Full verification cycle passes (test, lint, typecheck, format, build)
- Todo injection in MiddleOut and OneShot strategies
- Todo population in buildCompressionContext
- Non-LLM strategies unaffected
- Pseudocode compliance verified
- Anti-patterns absent
- Manual integration test passes

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P23 to fix
3. Re-run P23a
