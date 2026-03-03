# Phase 24: Execution Dispatch - Stub

## Phase ID

`PLAN-20260302-A2A.P24`

## Prerequisites

- Required: Phase 23a (RemoteAgentInvocation Verification) completed
- Verification: RemoteAgentInvocation fully implemented and tested
- Expected files:
  - `packages/core/src/agents/remote-invocation.ts` (complete)
  - `packages/core/src/agents/registry.ts` (async, with registerRemoteAgent)
  - `packages/core/src/agents/invocation.ts` (SubagentInvocation)

## Requirements Implemented

### REQ A2A-EXEC-011: Execution Dispatch Factory (Stub)

**Full EARS Text**: The agent invocation dispatch point shall support both local and remote agents via type-based routing.

**Behavior Specification**:
- GIVEN: AgentRegistry has both local and remote agent definitions
- WHEN: Code needs to create an invocation for an agent
- THEN: A single factory method dispatches based on agent kind
- AND: Type narrowing ensures SubagentInvocation receives LocalAgentDefinition
- AND: Type narrowing ensures RemoteAgentInvocation receives RemoteAgentDefinition

**Why This Matters**: Currently, code directly instantiates SubagentInvocation, which only works for local agents. Without a dispatch factory, remote agents cannot be invoked. This phase establishes the canonical dispatch point that uses discriminated union type narrowing for type-safe routing.

## Implementation Tasks

### Files to Modify

**`packages/core/src/agents/registry.ts`** — Add createInvocation factory method (stub)

**Add after getAllDefinitions() method:**

```typescript
  /**
   * Creates an appropriate invocation for the given agent.
   * Canonical dispatch point: routes local agents to SubagentInvocation,
   * remote agents to RemoteAgentInvocation.
   * @plan PLAN-20260302-A2A.P24
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
    
    // STUB: Always return SubagentInvocation for now
    // P26 will implement discriminated union dispatch
    return new SubagentInvocation(
      params,
      definition as any, // Cast to bypass type check (will be fixed in P26)
      this.config,
      messageBus,
    );
  }
```

**Add imports at top:**

```typescript
import type { AgentInputs } from './types.js';
import { SubagentInvocation } from './invocation.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { BaseToolInvocation, type ToolResult } from '../tools/tools.js';
```

### Implementation Notes

1. **Factory Pattern**: Single method centralizes dispatch logic
2. **Stub Behavior**: Returns SubagentInvocation for ALL agents (local or remote)
3. **Type Cast**: Uses `as any` to bypass type check (temporary)
4. **sessionState Parameter**: Included for future remote agent use (unused in stub)
5. **Error Handling**: Throws if agent not found

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 24 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 23a completed by checking:
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P23a-report.md` exists

YOUR TASK:
Add AgentRegistry.createInvocation() stub method to `packages/core/src/agents/registry.ts`.

SPECIFIC CHANGES:

1. **Add imports** (at top of file):
   ```typescript
   import type { AgentInputs } from './types.js';
   import { SubagentInvocation } from './invocation.js';
   import type { MessageBus } from '../confirmation-bus/message-bus.js';
   import { BaseToolInvocation, type ToolResult } from '../tools/tools.js';
   ```

2. **Add method** (after getAllDefinitions()):
   ```typescript
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
     
     // STUB: Always return SubagentInvocation for now
     return new SubagentInvocation(
       params,
       definition as any,
       this.config,
       messageBus,
     );
   }
   ```

STUB CHARACTERISTICS:
- Returns SubagentInvocation for ALL agents (no remote agent support yet)
- Uses `as any` cast to bypass type check
- sessionState parameter ignored (for future use)

DELIVERABLES:
- registry.ts: +1 method (createInvocation stub)
- Compiles successfully
- @plan PLAN-20260302-A2A.P24 marker

DO NOT:
- Implement remote agent dispatch (that's P26)
- Change existing methods
- Add tests (tests in P25)
```

## Verification Commands

### Automated Checks

```bash
# Check method exists
grep -n "createInvocation" packages/core/src/agents/registry.ts
# Expected: Method definition found

# Check plan marker
grep -c "@plan:PLAN-20260302-A2A.P24" packages/core/src/agents/registry.ts
# Expected: 1

# Check requirement marker
grep -c "@requirement:A2A-EXEC-011" packages/core/src/agents/registry.ts
# Expected: 1

# Check imports added
grep "import.*SubagentInvocation" packages/core/src/agents/registry.ts
grep "import.*BaseToolInvocation" packages/core/src/agents/registry.ts
# Expected: Both imports present

# Type check
npm run typecheck
# Expected: No errors

# Check stub behavior (always SubagentInvocation)
grep -A 10 "createInvocation" packages/core/src/agents/registry.ts | grep "new SubagentInvocation"
# Expected: Stub returns SubagentInvocation
```

### Semantic Verification Checklist

**Does the code exist?**
- [ ] createInvocation method exists in AgentRegistry
- [ ] Method has correct signature (4 parameters, returns BaseToolInvocation)
- [ ] Method has @plan and @requirement markers
- [ ] Imports added for SubagentInvocation, BaseToolInvocation, etc.

**Is this a valid stub?**
- [ ] Returns SubagentInvocation for all agents (no dispatch yet)
- [ ] Uses `as any` cast (temporary)
- [ ] Throws error if agent not found
- [ ] Compiles successfully

## Success Criteria

- All verification commands pass
- createInvocation method exists with stub implementation
- TypeScript compiles without errors
- Method signature matches design
- @plan and @requirement markers present

## Failure Recovery

If this phase fails:

1. Rollback:
   ```bash
   git checkout -- packages/core/src/agents/registry.ts
   ```
2. Fix issues and re-run verification
3. Cannot proceed to Phase 24a until stub is complete

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P24.md`

Contents:
```markdown
Phase: P24
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/registry.ts (+25 lines)

Stub Added:
  - AgentRegistry.createInvocation() - Factory method stub
  - Returns SubagentInvocation for all agents (no remote dispatch yet)
  - sessionState parameter included but unused

Verification: Compiles successfully
Next Phase: P24a (Verification of P24)
```
