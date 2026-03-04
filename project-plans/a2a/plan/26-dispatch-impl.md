# Phase 26: Execution Dispatch - Implementation

## Phase ID

`PLAN-20260302-A2A.P26`

## Prerequisites

- Required: Phase 25a (Execution Dispatch TDD Verification) completed
- Verification: registry-dispatch.test.ts exists with ~5 FAIL tests
- Expected files: registry.ts (with stub), registry-dispatch.test.ts

## Requirements Implemented

### REQ A2A-EXEC-011: Full Execution Dispatch (Implementation)

**All dispatch tests from P25 must PASS after this implementation.**

**Why This Matters**: Implements the discriminated union dispatch pattern that routes local agents to SubagentInvocation and remote agents to RemoteAgentInvocation. This completes the execution pathway for remote agents.

## Implementation Tasks

### Files to Modify

**`packages/core/src/agents/registry.ts`** — Implement full createInvocation dispatch

### Implementation Strategy

Replace stub with discriminated union type narrowing pattern:

```typescript
/**
 * Creates an appropriate invocation for the given agent.
 * Canonical dispatch point: routes local agents to SubagentInvocation,
 * remote agents to RemoteAgentInvocation.
 * @plan PLAN-20260302-A2A.P26
 * @requirement A2A-EXEC-011
 */
createInvocation(
  agentName: string,
  params: AgentInputs,
  messageBus?: MessageBus,
  sessionState?: Map<string, { contextId?: string; taskId?: string }>,
): BaseToolInvocation<AgentInputs, ToolResult> {
  const definition = this.getDefinition(agentName);
  
  if (!definition) {
    throw new Error(`Agent '${agentName}' not found in registry`);
  }
  
  // Discriminated union type narrowing on 'kind' field
  if (definition.kind === 'remote') {
    // TypeScript knows definition is RemoteAgentDefinition here
    return new RemoteAgentInvocation(
      params,
      definition,
      sessionState || new Map(), // Default to empty Map if not provided
      this.config,
      messageBus,
    );
  }
  
  // TypeScript knows definition is LocalAgentDefinition here
  return new SubagentInvocation(
    params,
    definition,
    this.config,
    messageBus,
  );
}
```

**Add import:**

```typescript
import { RemoteAgentInvocation } from './remote-invocation.js';
```

**Update JSDoc marker from P24 to P26.**

### Key Implementation Details

1. **Type Narrowing**: `if (definition.kind === 'remote')` narrows type
2. **Remote Path**: Creates RemoteAgentInvocation with sessionState (default empty Map)
3. **Local Path**: Creates SubagentInvocation (no sessionState needed)
4. **No type casts**: TypeScript infers types correctly via narrowing
5. **sessionState default**: `sessionState || new Map()` ensures RemoteAgentInvocation always gets a Map

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 26 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 25a completed: tests exist and ~5 fail against stub.

YOUR TASK:
Replace createInvocation stub with full discriminated union dispatch in `packages/core/src/agents/registry.ts`.

CURRENT STATE (P24 stub):
- Always returns SubagentInvocation
- Uses `as any` cast
- sessionState ignored

TARGET STATE (P26):
- Checks `definition.kind === 'remote'`
- Remote → new RemoteAgentInvocation(params, definition, sessionState || new Map(), config, messageBus)
- Local → new SubagentInvocation(params, definition, config, messageBus)
- No type casts (TypeScript infers types)

SPECIFIC CHANGES:

1. **Add import** (top of file):
   ```typescript
   import { RemoteAgentInvocation } from './remote-invocation.js';
   ```

2. **Replace createInvocation method** (~line 70):
   - Remove `as any` cast
   - Add `if (definition.kind === 'remote')` check
   - Remote path: return new RemoteAgentInvocation
   - Local path: return new SubagentInvocation
   - sessionState: use `sessionState || new Map()` for remote agents

3. **Update marker**: Change @plan from P24 to P26

DELIVERABLES:
- registry.ts: createInvocation fully implemented
- All 10 dispatch tests PASS
- TypeScript compiles (no errors)
- No type casts

DO NOT:
- Change test file (tests already written)
- Modify other registry methods
```

## Verification Commands

### Automated Checks

```bash
# Check RemoteAgentInvocation import
grep "RemoteAgentInvocation" packages/core/src/agents/registry.ts
# Expected: Import statement

# Check discriminated union pattern
grep -A 10 "createInvocation" packages/core/src/agents/registry.ts | grep "definition.kind === 'remote'"
# Expected: Type narrowing check

# Check no type casts
grep -A 20 "createInvocation" packages/core/src/agents/registry.ts | grep "as any"
# Expected: NO MATCHES (removed cast)

# Run ALL dispatch tests (MUST PASS)
npm test -- packages/core/src/agents/__tests__/registry-dispatch.test.ts
# Expected: 10/10 PASS

# Type check
npm run typecheck
# Expected: Success (0 errors)

# Check plan marker updated
grep -c "@plan PLAN-20260302-A2A.P26" packages/core/src/agents/registry.ts
# Expected: 1 (updated from P24)
```

### Semantic Verification Checklist

**Is implementation complete?**
- [ ] All 10 tests PASS
- [ ] Type narrowing uses `if (definition.kind === 'remote')`
- [ ] Remote path returns RemoteAgentInvocation
- [ ] Local path returns SubagentInvocation
- [ ] sessionState defaults to new Map() for remote agents
- [ ] No type casts (`as any` removed)
- [ ] TypeScript compiles without errors

**Does dispatch work correctly?**
- [ ] Local agents → SubagentInvocation
- [ ] Remote agents → RemoteAgentInvocation
- [ ] Unknown agents → throw error
- [ ] sessionState passed to remote invocations
- [ ] messageBus passed to both invocation types

## Success Criteria

- All verification commands pass
- All 10 tests PASS (0 FAIL)
- No type casts in implementation
- TypeScript type narrowing works
- @plan marker updated to P26

## Failure Recovery

If this phase fails:

1. Review test failures:
   - Remote agent tests fail → check RemoteAgentInvocation instantiation
   - Type errors → verify type narrowing logic
   - Local agent tests fail → check SubagentInvocation path

2. Fix issues and re-run tests

3. Cannot proceed to Phase 26a until all tests pass

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P26.md`

Contents:
```markdown
Phase: P26
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/registry.ts (~15 lines changed)

Implementation:
  - Discriminated union dispatch on definition.kind
  - Remote agents → RemoteAgentInvocation
  - Local agents → SubagentInvocation
  - sessionState default: new Map()
  - No type casts

Test Results: All 10 tests PASS

Verification: [paste npm test output]

Next Phase: P26a (Verification of P26)
```
