# Phase 02a: Verify Standardized Constructors

## Phase ID
`PLAN-20260303-MESSAGEBUS.P02a`

## Prerequisites
- Phase 02 completed

## Verification Tasks

### 1. All createInvocation methods accept messageBus
```bash
# Find all createInvocation definitions
grep -rn "createInvocation" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" | grep "messageBus"
# Count should match total createInvocation definitions
```

### 2. Agent invocations accept messageBus
```bash
grep -n "messageBus" packages/core/src/agents/local-invocation.ts
grep -n "messageBus" packages/core/src/agents/remote-invocation.ts
grep -n "messageBus" packages/core/src/agents/delegate-to-agent-tool.ts
grep -n "messageBus" packages/core/src/agents/subagent-tool-wrapper.ts
```

### 3. Full test suite
```bash
npm run typecheck
npm run test
npm run lint
```

## Success Criteria
- Every `createInvocation()` method accepts `messageBus` parameter
- All agent invocations accept `messageBus`
- All tests pass

## Failure Recovery
Compare against upstream `90be9c35876d` diff if tests fail.

## Subagent Prompt

```markdown
CONTEXT: You are verifying Phase 02 of the MessageBus DI migration (PLAN-20260303-MESSAGEBUS.P02a).

Run all structural and semantic verification checks below. Report PASS/FAIL for each.
Verify that constructor standardization was done correctly and messageBus flows through the call chain.
```


## Structural Verification Checklist

- [ ] Every `createInvocation()` method accepts `messageBus` parameter
- [ ] All agent invocations accept `messageBus` in constructor
- [ ] ToolRegistry passes MessageBus to createInvocation calls
- [ ] All @plan:PLAN-20260303-MESSAGEBUS.P02 markers present
- [ ] TypeScript compiles without errors
- [ ] All tests pass
- [ ] Lint passes

## Semantic Verification Checklist

**Behavioral Verification Questions**:

1. **Does the code DO what Phase 2 requires?**
   - [ ] MessageBus flows through entire tool invocation chain
   - [ ] Agent invocations receive MessageBus correctly
   - [ ] No tools left without MessageBus parameter

2. **Would the tests FAIL if implementation was removed?**
   - [ ] Tests verify MessageBus parameter is passed
   - [ ] Tests would fail if MessageBus removed from signatures
   - [ ] Integration tests verify end-to-end flow

3. **Is the feature REACHABLE and STILL BACKWARD COMPATIBLE?**
   - [ ] MessageBus is still optional (Phase 3 makes it required)
   - [ ] Old code (Phase 1 fallback) still works
   - [ ] New code paths tested

4. **Integration Points Verified**:
   - [ ] ToolRegistry → createInvocation() → Invocation (verified by reading code)
   - [ ] AgentExecutor → Agent Invocation (verified by reading code)
   - [ ] MessageBus used for confirmations (verified by test)

5. **Lifecycle Verified**:
   - [ ] MessageBus created at session start
   - [ ] MessageBus passed down through dependency tree
   - [ ] MessageBus available for publish/subscribe operations

6. **What's MISSING before proceeding to Phase 3?**
   - [ ] N/A or [list any gaps]

## Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK in Phase 2 changes
git diff HEAD~1 -- packages/core/src/ | grep -E "(TODO|FIXME|HACK|STUB|XXX)"
# Expected: No matches

# Check for placeholder implementations
git diff HEAD~1 -- packages/core/src/ | grep -E "return null|return undefined|throw new Error\('not implemented'\)"
# Expected: No matches
```

## Phase Completion Marker

**Create**: `project-plans/gmerge-0.24.5/messagebus/.completed/P02a.md`

**Contents**:
```markdown
# Phase 02a: Verify Standardized Constructors — COMPLETED

**Completed**: YYYY-MM-DD HH:MM
**Phase 02 Status**: Verified and ready for Phase 3

## Verification Results

### createInvocation Coverage
All createInvocation methods accept messageBus:
```bash
grep -rn "createInvocation" packages/core/src/tools/ --include="*.ts" | grep -v test | wc -l
# Result: [N] methods
grep -rn "createInvocation.*messageBus" packages/core/src/tools/ --include="*.ts" | grep -v test | wc -l
# Result: [N] methods (should match)
```

### Agent Invocation Coverage
All agent invocations accept messageBus:
```bash
grep -n "messageBus" packages/core/src/agents/local-invocation.ts
grep -n "messageBus" packages/core/src/agents/remote-invocation.ts
grep -n "messageBus" packages/core/src/agents/delegate-to-agent-tool.ts
grep -n "messageBus" packages/core/src/agents/subagent-tool-wrapper.ts
# Result: [paste line numbers — all should have messageBus]
```

### Test Suite Status
```
[Paste npm run test summary]
All tests passing: YES/NO
```

### Backward Compatibility
- MessageBus still optional: YES (Phase 2 maintains `messageBus?:` signature)
- Fallback logic works: YES (from Phase 1)

### Deferred Implementation Check
```
No TODO/FIXME/HACK in Phase 2 implementation: PASS
No placeholder returns: PASS
```

## Gate Decision: PROCEED TO PHASE 3
All structural and semantic verifications passed. Phase 2 complete. Ready for final phase (mandatory injection + cleanup).
```
