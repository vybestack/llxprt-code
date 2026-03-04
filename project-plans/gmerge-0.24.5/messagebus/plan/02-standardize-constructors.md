# Phase 02: Standardize Constructors (Upstream Phase 2)

## Phase ID
`PLAN-20260303-MESSAGEBUS.P02`

## Prerequisites
- Phase 01a verified

## Requirements Implemented

### REQ MB-DI-002: Standardize Tool/Agent Constructor MessageBus Parameter
**EARS**: ALL tool `createInvocation()` methods and agent invocation constructors SHALL accept `messageBus?: MessageBus` as a parameter and pass it to the invocation instance.

**Behavior**:
- GIVEN: A tool's `createInvocation()` is called with a messageBus
- WHEN: The invocation is created
- THEN: The invocation stores the messageBus for use during execution
- AND: Does NOT rely on config.getMessageBus() (though fallback still available)

## Implementation Tasks

### Reference Diff
`git show 90be9c35876d` — Upstream Phase 2.

### Files to Modify (~23 files)

**Agent invocations:**
- `packages/core/src/agents/delegate-to-agent-tool.ts` — Accept and pass messageBus
- `packages/core/src/agents/subagent-tool-wrapper.ts` — Accept and pass messageBus
- `packages/core/src/agents/local-invocation.ts` — Accept messageBus in constructor
- `packages/core/src/agents/remote-invocation.ts` — Accept messageBus in constructor

**Tools (ensure all createInvocation methods accept messageBus):**
- `tools/get-internal-docs.ts`
- `tools/glob.ts`
- `tools/grep.ts` / `tools/ripGrep.ts`
- `tools/ls.ts`
- `tools/mcp-tool.ts`
- `tools/read-file.ts`
- `tools/read-many-files.ts`
- `tools/shell.ts`
- `tools/web-fetch.ts`
- `tools/web-search.ts`
- `tools/write-todos.ts`

**Test files (~8 files):**
- `agents/delegate-to-agent-tool.test.ts`
- `agents/subagent-tool-wrapper.test.ts`
- `core/coreToolScheduler.test.ts`
- `tools/message-bus-integration.test.ts`
- `test-utils/mock-tool.ts`
- Others as needed per upstream diff

### Key Pattern
```typescript
// Before (each tool):
createInvocation(params: ToolContext): SomeInvocation {
  return new SomeInvocation(this, params);
}

// After:
createInvocation(params: ToolContext, messageBus?: MessageBus): SomeInvocation {
  return new SomeInvocation(this, params, messageBus);
}
```

### LLxprt-Specific Adaptations
- Skip `smart-edit.ts` (removed from LLxprt)
- `ripGrep.ts` = LLxprt's grep tool (not just `grep.ts`)
- Tool names may differ from upstream — check actual file names
- Some LLxprt tools have additional parameters (e.g., `apply-patch.ts`) — preserve them

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 02 of the MessageBus DI migration (PLAN-20260303-MESSAGEBUS.P02).

READ FIRST:
1. project-plans/gmerge-0.24.5/messagebus/design.md
2. This phase file (project-plans/gmerge-0.24.5/messagebus/plan/02-standardize-constructors.md)
3. packages/core/src/agents/invocation.ts — SubagentInvocation constructor
4. packages/core/src/agents/executor.ts — agent execution flow
5. packages/core/src/core/coreToolScheduler.ts — how MessageBus flows through tool scheduling

TASK: Standardize constructors so MessageBus flows through the call chain:
1. Update createInvocation() methods to accept and forward optional messageBus
2. Update agent invocation constructors to thread messageBus through
3. Ensure all ~23 intermediate classes pass messageBus down rather than re-fetching from config

This is STILL BACKWARD COMPATIBLE — all parameters remain optional with config.getMessageBus() fallback.

VERIFY: npm run typecheck && npm run test
```

## Verification Commands
```bash
npm run typecheck
npm run test
```

## Success Criteria
- All `createInvocation()` methods accept optional `messageBus` parameter
- All agent invocations accept optional `messageBus` parameter
- TypeScript compiles
- All tests pass

## Failure Recovery
If a tool's `createInvocation()` signature doesn't match expected pattern, read the actual file first. Some tools have non-standard invocation creation. Adapt the pattern to match.

## Required Code Markers (@plan Strategy)

Every modified `createInvocation()` method and agent constructor MUST include:

```typescript
/**
 * @plan PLAN-20260303-MESSAGEBUS.P02
 * Standardized MessageBus parameter in createInvocation/constructor (Phase 2)
 */
```

**Marker Placement**:
- Above every `createInvocation()` method that adds `messageBus` parameter
- Above agent invocation constructors (LocalInvocation, RemoteInvocation, SubagentInvocation)
- Above agent wrapper constructors (DelegateToAgentTool, SubagentToolWrapper)

**Example**:
```typescript
/**
 * @plan PLAN-20260303-MESSAGEBUS.P02
 * Standardized MessageBus parameter in createInvocation (Phase 2)
 */
createInvocation(params: ToolContext, messageBus?: MessageBus): SomeInvocation {
  return new SomeInvocation(this, params, messageBus);
}
```

## Structural Verification Checklist

- [ ] ALL `createInvocation()` methods accept `messageBus?: MessageBus` parameter
- [ ] Agent invocations (LocalInvocation, RemoteInvocation) accept `messageBus` in constructor
- [ ] Agent wrappers (DelegateToAgentTool, SubagentToolWrapper) accept `messageBus` in constructor
- [ ] ToolRegistry passes MessageBus when calling `createInvocation()`
- [ ] Test files updated to pass MessageBus (~8 test files)
- [ ] All @plan:PLAN-20260303-MESSAGEBUS.P02 markers present
- [ ] TypeScript compiles
- [ ] All tests pass

**Tool Coverage** (verify each has messageBus parameter):
- [ ] get-internal-docs.ts
- [ ] glob.ts
- [ ] grep.ts / ripGrep.ts
- [ ] ls.ts
- [ ] mcp-tool.ts
- [ ] read-file.ts
- [ ] read-many-files.ts
- [ ] shell.ts
- [ ] web-fetch.ts
- [ ] web-search.ts
- [ ] write-todos.ts
- [ ] LLxprt-specific tools (ast-grep, structural-analysis, etc.)

## Semantic Verification Checklist

**Behavioral Verification Questions**:

1. **Does the code DO what the requirement says?**
   - [ ] All tools accept and pass MessageBus to invocations
   - [ ] All agent invocations receive MessageBus
   - [ ] MessageBus flows through: ToolRegistry → Tool → Invocation

2. **Is this REAL implementation, not placeholder?**
   - [ ] No TODO/HACK/STUB markers
   - [ ] Actual parameter passing implemented
   - [ ] Tests verify MessageBus propagation

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests create MessageBus and pass to createInvocation
   - [ ] Tests verify invocations receive MessageBus
   - [ ] Mock verification would fail if parameter removed

4. **Is the feature REACHABLE by users?**
   - [ ] ToolRegistry calls createInvocation with MessageBus
   - [ ] Agent execution paths pass MessageBus
   - [ ] All code paths tested

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] N/A or [list any gaps]

**Integration Points Verified**:
- [ ] ToolRegistry → Tool.createInvocation() → Invocation (MessageBus flows through)
- [ ] AgentExecutor → Agent Invocation (MessageBus propagates)
- [ ] Tests mock MessageBus correctly

## Verification Commands
```bash
npm run typecheck
npm run test
npm run lint

# Verify all createInvocation methods have messageBus parameter
grep -rn "createInvocation" packages/core/src/tools/ --include="*.ts" | grep -v test | grep -v ".d.ts"
# Manually verify each has messageBus parameter

# Verify @plan markers
grep -r "@plan:PLAN-20260303-MESSAGEBUS.P02" packages/core/src/ | wc -l
# Expected: At least 20 occurrences (all tools + agents)
```

## Phase Completion Marker

**Create**: `project-plans/gmerge-0.24.5/messagebus/.completed/P02.md`

**Contents**:
```markdown
# Phase 02: Standardize Constructors — COMPLETED

**Completed**: YYYY-MM-DD HH:MM
**Files Modified**: ~23 files (matching upstream Phase 2 scope)

## Files Changed

### Production Code
**Tools** (~12 files):
[List each tool file modified]

**Agents** (~4 files):
- packages/core/src/agents/delegate-to-agent-tool.ts
- packages/core/src/agents/subagent-tool-wrapper.ts
- packages/core/src/agents/local-invocation.ts
- packages/core/src/agents/remote-invocation.ts

**Registry**:
- packages/core/src/tools/tool-registry.ts (passes MessageBus to createInvocation)

### Test Files (~8 files)
[List test files modified]

## Verification Results

### createInvocation Coverage
```bash
# All createInvocation methods accept messageBus
grep -rn "createInvocation.*messageBus" packages/core/src/tools/ | wc -l
# Result: [N] matches
```

### Agent Constructor Coverage
```bash
grep -rn "constructor.*messageBus" packages/core/src/agents/ | wc -l
# Result: [N] matches
```

### Test Suite
```
[Paste npm run test summary — all pass]
```

### @plan Marker Check
```bash
grep -r "@plan:PLAN-20260303-MESSAGEBUS.P02" packages/core/src/ | wc -l
# Result: [N] occurrences
```

## Diff Stats
```
[Paste git diff --stat output]
```

## Proceed to Phase 02a
Ready for verification phase.
```
