# Phase 31: Test Migration

## Phase ID

`PLAN-20260302-A2A.P31`

## Prerequisites

- Required: Phase 30a (Caller Migration Verification) completed
- Verification: TypeScript compiles, all tests pass
- Expected: Production code uses LocalAgentDefinition where appropriate

## Requirements Implemented

### REQ A2A-REG-001, A2A-REG-002: Test Fixture Updates

**Full EARS Text**: Tests creating AgentDefinition fixtures must use discriminated union types.

**Behavior Specification**:
- GIVEN: AgentDefinition is now a discriminated union (LocalAgentDefinition | RemoteAgentDefinition)
- WHEN: Test code creates agent definition fixtures
- THEN: All local agent fixtures must include `kind: 'local'`
- AND: All remote agent fixtures must include `kind: 'remote'`
- AND: Tests calling registerAgent must await the Promise

**Why This Matters**: Test fixtures created before P05 don't have `kind` field. Tests calling registerAgent before P18-P20 don't await. This phase updates test files to match the new type system and async behavior.

## Implementation Tasks

### Files to Modify

Based on analysis, test files that need updates:

#### 1. Agent Test Files (if they exist and create fixtures)

**Search pattern**: Find all test files that create AgentDefinition objects:
```bash
grep -r "AgentDefinition" packages/core/src/agents/__tests__/ --include="*.ts" -l
```

**For each file found**, update test fixtures:

**Pattern 1**: Local agent fixtures need `kind: 'local'`
```typescript
// BEFORE
const testAgent: AgentDefinition = {
  name: 'test',
  description: 'Test agent',
  inputConfig: { inputs: {} },
  promptConfig: { systemPrompt: 'Test' },
  modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
  runConfig: { max_time_minutes: 5 }
};

// AFTER
const testAgent: LocalAgentDefinition = {  // Type changed
  kind: 'local',  // ADD
  name: 'test',
  description: 'Test agent',
  inputConfig: { inputs: {} },
  promptConfig: { systemPrompt: 'Test' },
  modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
  runConfig: { max_time_minutes: 5 }
};
```

**Pattern 2**: Remote agent fixtures need `kind: 'remote'`
```typescript
// NEW (likely not many existing tests create remote agents)
const testRemoteAgent: RemoteAgentDefinition = {
  kind: 'remote',
  name: 'test-remote',
  description: 'Test remote agent',
  inputConfig: { inputs: {} },
  agentCardUrl: 'https://example.com/card'
};
```

**Pattern 3**: Tests calling registerAgent need await
```typescript
// BEFORE
registry.registerAgent(testAgent);

// AFTER
await registry.registerAgent(testAgent);  // Add await
```

**Pattern 4**: Tests may need to be async
```typescript
// BEFORE
it('should register agent', () => {
  registry.registerAgent(testAgent);
  expect(registry.getDefinition('test')).toBeDefined();
});

// AFTER
it('should register agent', async () => {  // Add async
  await registry.registerAgent(testAgent);  // Add await
  expect(registry.getDefinition('test')).toBeDefined();
});
```

#### 2. Update Test Imports

**Change**:
```typescript
// BEFORE
import type { AgentDefinition } from '../types.js';

// AFTER
import type { AgentDefinition, LocalAgentDefinition, RemoteAgentDefinition } from '../types.js';
```

### Expected Test Files to Update

Based on plan phases, these test files likely exist:

1. **`packages/core/src/agents/__tests__/types.test.ts`** (P04, P05)
   - Already uses LocalAgentDefinition/RemoteAgentDefinition (created in P04-P05)
   - Verify `kind` field is present in all fixtures
   - Should not need changes

2. **`packages/core/src/agents/__tests__/registry.test.ts`** (P19)
   - May have agent fixtures
   - May call registerAgent (needs await)

3. **`packages/core/src/agents/__tests__/registry-dispatch.test.ts`** (P25)
   - Already uses LocalAgentDefinition/RemoteAgentDefinition (created in P25)
   - Should not need changes

4. **Other test files** (executor.test.ts, invocation.test.ts if they exist)
   - Check for AgentDefinition fixtures
   - Add `kind` field if missing

### Migration Strategy

1. **Find all test files**: Use grep to find tests importing or creating AgentDefinition
2. **For each file**:
   - Add `kind: 'local'` to all local agent fixtures
   - Change type annotations from AgentDefinition to LocalAgentDefinition where appropriate
   - Add `await` to all registerAgent calls
   - Make test functions `async` if needed
3. **Run tests**: Verify all tests still pass (no behavior changes)
4. **Add markers**: Add `@plan PLAN-20260302-A2A.P31` to modified test functions

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 31 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 30a completed:
- TypeScript compiles successfully
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P30a-report.md` exists

YOUR TASK:
Update test files to match new discriminated union types and async registerAgent.

STEP 1: Find test files that need updates
```bash
grep -r "AgentDefinition\b" packages/core/src/agents/__tests__/ --include="*.ts" -l
```

STEP 2: For EACH file found (excluding types.test.ts, registry-dispatch.test.ts if already correct):

**Add imports** (if not present):
```typescript
import type { LocalAgentDefinition, RemoteAgentDefinition } from '../types.js';
```

**Update fixtures**: Add `kind: 'local'` to all local agent test objects:
```typescript
const testAgent: LocalAgentDefinition = {
  kind: 'local',  // ADD
  name: 'test',
  // ... rest of fields
};
```

**Update registerAgent calls**: Add await + make test function async:
```typescript
// Before
it('test description', () => {
  registry.registerAgent(agent);
});

// After
it('test description', async () => {  // Add async
  await registry.registerAgent(agent);  // Add await
});
```

**Add plan markers**:
```typescript
it('test description @plan:PLAN-20260302-A2A.P31', async () => {
  // ...
});
```

STEP 3: Run tests and verify:
```bash
npm test -- packages/core/src/agents/__tests__/
```

IMPLEMENTATION REQUIREMENTS:
- All local agent fixtures have `kind: 'local'`
- All registerAgent calls are awaited
- All containing test functions are async
- All tests still PASS (no behavior changes)
- @plan markers added to modified tests

DELIVERABLES:
- Test files updated (exact count depends on grep results)
- All tests PASS
- No changes to test behavior (only fixtures and async syntax)

DO NOT:
- Change test assertions (behavior should be unchanged)
- Add new tests (just update existing)
- Modify production code (P30 already did that)
```

## Verification Commands

### Automated Checks

```bash
# Find test files with AgentDefinition
grep -r "AgentDefinition\b" packages/core/src/agents/__tests__/ --include="*.ts" -l

# Check for kind field in test fixtures
grep -r "kind: 'local'" packages/core/src/agents/__tests__/ --include="*.ts" | wc -l
# Expected: Multiple matches (all local agent fixtures)

# Check for await registerAgent
grep -r "await.*registerAgent" packages/core/src/agents/__tests__/ --include="*.ts" | wc -l
# Expected: Matches for all registerAgent calls

# Run ALL agent tests
npm test -- packages/core/src/agents/__tests__/
# Expected: All tests PASS

# TypeScript compiles
npm run typecheck
# Expected: 0 errors
```

### Semantic Verification Checklist

**Are tests updated correctly?**
- [ ] All local agent fixtures have `kind: 'local'` field
- [ ] All registerAgent calls have `await`
- [ ] All test functions with await are `async`
- [ ] All tests still PASS (no behavior changes)

**Is migration complete?**
- [ ] No more AgentDefinition fixtures without `kind` field in tests
- [ ] No synchronous registerAgent calls in tests
- [ ] TypeScript compiles

## Success Criteria

- All verification commands pass
- All test files updated with `kind` field
- All registerAgent calls awaited
- All tests PASS
- TypeScript compiles with 0 errors
- No behavior changes (tests verify same things)

## Failure Recovery

If this phase fails:

1. Test failures → Check if kind field added correctly
2. Type errors → Check if LocalAgentDefinition imported
3. Async errors → Check if await added and function is async

Rollback:
```bash
git checkout -- packages/core/src/agents/__tests__/
```

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P31.md`

Contents:
```markdown
Phase: P31
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: [list test files updated]

Test Fixture Updates:
  - All local agent fixtures have `kind: 'local'`
  - All remote agent fixtures have `kind: 'remote'` (if any)
  - All registerAgent calls awaited
  - All test functions made async as needed

Test Results: [paste npm test output - all PASS]

Verification: [paste typecheck output]

Next Phase: P31a (Verification of P31)
```
