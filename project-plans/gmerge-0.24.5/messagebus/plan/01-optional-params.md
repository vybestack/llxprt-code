# Phase 01: Optional MessageBus Parameters (Upstream Phase 1)

## Phase ID
`PLAN-20260303-MESSAGEBUS.P01`

## Prerequisites
- Phase 00a preflight verified
- All tests passing

## Requirements Implemented

### REQ MB-DI-001: Optional MessageBus Constructor Parameter
**EARS**: WHERE a class currently retrieves MessageBus via `config.getMessageBus()`, the class SHALL accept an optional `messageBus?: MessageBus` constructor parameter, falling back to `config.getMessageBus()` when not provided.

**Behavior**:
- GIVEN: CoreToolScheduler receives `messageBus` in constructor
- WHEN: MessageBus is provided
- THEN: Uses the provided instance directly
- AND: Does NOT call `config.getMessageBus()`

- GIVEN: CoreToolScheduler does NOT receive `messageBus` in constructor
- WHEN: MessageBus is needed
- THEN: Falls back to `config.getMessageBus()` (backward compatible)

## Implementation Tasks

### Reference Diff
`git show eec5d5ebf839` — Upstream Phase 1. Adapt for LLxprt (different file structure, tool names).

### Files to Modify (~16 files)

**1. `packages/core/src/tools/tool-registry.ts`**
- Add `messageBus?: MessageBus` to constructor
- Store as `private readonly messageBus?: MessageBus`
- In `createInvocation()`, use `this.messageBus ?? this.config.getMessageBus()`
- Keep `setMessageBus()` stub (removed in Phase 3)

**2. `packages/core/src/tools/tools.ts`** (DeclarativeTool base)
- Ensure `createInvocation()` accepts `messageBus?: MessageBus` param (many already do)
- For tools that don't yet accept it, add the parameter

**3. `packages/core/src/test-utils/mock-tool.ts`**
- Update mock tool factory to accept and pass MessageBus
- Create helper: `createMockMessageBus()` returning a mock with `publish` and `subscribe` spies

**4. Test files (~12 files)**
Reference upstream diff for exact test changes. Key pattern:
```typescript
// Before
const invocation = tool.createInvocation(params);
// After
const messageBus = createMockMessageBus();
const invocation = tool.createInvocation(params, messageBus);
```

Files:
- `tools/edit.test.ts`
- `tools/glob.test.ts`
- `tools/grep.test.ts`
- `tools/ls.test.ts`
- `tools/read-file.test.ts`
- `tools/read-many-files.test.ts`
- `tools/write-file.test.ts`
- `tools/message-bus-integration.test.ts`
- `utils/editCorrector.test.ts`
- `utils/tool-utils.test.ts`
- `cli/src/ui/hooks/useToolScheduler.test.ts`
- `a2a-server/src/http/app.test.ts`

**5. `packages/core/src/index.ts`**
- Remove any re-exports of `setMessageBus` from public API (if present)

### Approach
- Use upstream diff as a guide but adapt to LLxprt's tool names and structure
- LLxprt doesn't have `smart-edit.ts` — skip that file
- LLxprt tool names differ (e.g., `ripGrep.ts` for grep)
- Keep changes backward-compatible: `messageBus?:` (optional), with fallback

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 01 of the MessageBus DI migration (PLAN-20260303-MESSAGEBUS.P01).

READ FIRST:
1. project-plans/gmerge-0.24.5/messagebus/design.md — full design spec
2. This phase file (project-plans/gmerge-0.24.5/messagebus/plan/01-optional-params.md)
3. packages/core/src/config/config.ts — find getMessageBus()
4. packages/core/src/confirmation-bus/message-bus.ts — MessageBus class

TASK: Add optional `messageBus?: MessageBus` constructor parameter to ~16 classes that currently call config.getMessageBus(). Each class should:
1. Accept optional messageBus in constructor
2. Store as `this.messageBus = messageBus ?? config.getMessageBus()`
3. Use this.messageBus instead of calling config.getMessageBus() repeatedly

This is BACKWARD COMPATIBLE — the parameter is optional with fallback.

VERIFY: npm run typecheck && npm run test && npm run lint
All must pass with zero changes to existing tests.
```

## Verification Commands
```bash
npm run typecheck
npm run test
npm run lint
```

## Success Criteria
- TypeScript compiles
- All tests pass
- MessageBus can be explicitly passed OR omitted (backward compatible)
- No behavior changes

## Failure Recovery
If tests fail, compare failing tests against upstream changes. The most common issue is test mocks not providing MessageBus where now expected. Fix by adding `createMockMessageBus()` to test setup.

## Required Code Markers (@plan Strategy)

Every modified function/class/constructor in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260303-MESSAGEBUS.P01
 * MessageBus optional parameter added (Phase 1)
 */
```

**Marker Placement**:
- Add above constructor that receives `messageBus?: MessageBus`
- Add above `createInvocation()` methods that now accept optional messageBus
- Add to test helper functions (e.g., `createMockMessageBus()`)

**Example**:
```typescript
/**
 * @plan PLAN-20260303-MESSAGEBUS.P01
 * MessageBus optional parameter added (Phase 1)
 */
constructor(
  private readonly config: Config,
  private readonly messageBus?: MessageBus,
) {
  this.messageBus = messageBus ?? this.config.getMessageBus();
}
```

## Structural Verification Checklist

- [ ] `ToolRegistry` accepts `messageBus?: MessageBus` in constructor
- [ ] `ToolRegistry` uses `this.messageBus ?? this.config.getMessageBus()` pattern
- [ ] `DeclarativeTool.createInvocation()` signature includes `messageBus?: MessageBus`
- [ ] `createMockMessageBus()` helper exists in test-utils/mock-tool.ts
- [ ] Test files updated to pass MessageBus explicitly (~12 test files)
- [ ] `config.getMessageBus()` STILL EXISTS (backward compatibility)
- [ ] All @plan markers present in modified code
- [ ] TypeScript compiles
- [ ] All tests pass

## Semantic Verification Checklist

**Behavioral Verification Questions**:

1. **Does the code DO what the requirement says?**
   - [ ] When MessageBus is provided to constructor, it uses the provided instance
   - [ ] When MessageBus is NOT provided, it falls back to `config.getMessageBus()`
   - [ ] Both code paths work correctly

2. **Is this REAL implementation, not placeholder?**
   - [ ] No TODO/HACK/STUB markers in implementation
   - [ ] Actual fallback logic implemented (`?? this.config.getMessageBus()`)
   - [ ] Tests verify both code paths (with and without MessageBus)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests explicitly create and pass MessageBus
   - [ ] Tests verify MessageBus is used for tool invocations
   - [ ] Mock verification would fail if MessageBus not passed

4. **Is the feature REACHABLE by users?**
   - [ ] Constructors are called from production code
   - [ ] `createInvocation()` is called by ToolRegistry
   - [ ] Backward compatibility maintained (existing code still works)

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] N/A or [list any gaps]

**Backward Compatibility Test**:
```bash
# Verify config.getMessageBus() still works
grep -n "config.getMessageBus()" packages/core/src/tools/tool-registry.ts
# Expected: Should find at least one reference (fallback)
```

## Verification Commands
```bash
npm run typecheck
npm run test
npm run lint

# Verify @plan markers
grep -r "@plan:PLAN-20260303-MESSAGEBUS.P01" packages/core/src/ | wc -l
# Expected: At least 10 occurrences (ToolRegistry, test-utils, tool createInvocation methods)
```

## Phase Completion Marker

**Create**: `project-plans/gmerge-0.24.5/messagebus/.completed/P01.md`

**Contents**:
```markdown
# Phase 01: Optional MessageBus Parameters — COMPLETED

**Completed**: YYYY-MM-DD HH:MM
**Files Modified**: ~16 files (matching upstream Phase 1 scope)

## Files Changed

### Production Code
- packages/core/src/tools/tool-registry.ts (added optional messageBus constructor param)
- packages/core/src/tools/tools.ts (updated createInvocation signatures)
- packages/core/src/test-utils/mock-tool.ts (added createMockMessageBus helper)

### Test Files (~12 files)
[List actual test files modified with line counts]

## Verification Results

### TypeScript Compilation
```
[Paste npm run typecheck output]
```

### Test Suite
```
[Paste npm run test summary — all pass]
```

### @plan Marker Check
```bash
grep -r "@plan:PLAN-20260303-MESSAGEBUS.P01" packages/core/src/ | wc -l
# Result: [N] occurrences
```

### Backward Compatibility Verified
- config.getMessageBus() still exists: YES
- Fallback logic works: YES (tested)
- Existing code unmodified: YES

## Diff Stats
```
[Paste git diff --stat output]
```

## Proceed to Phase 01a
Ready for verification phase.
```
