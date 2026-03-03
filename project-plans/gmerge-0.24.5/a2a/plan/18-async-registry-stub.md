# Phase 18: Async AgentRegistry - Stub

## Phase ID

`PLAN-20260302-A2A.P18`

## Prerequisites

- Required: Phase 17a (A2A Client Manager Implementation Verification) completed
- Verification: `npm test -- packages/core/src/agents/__tests__/a2a-client-manager.test.ts` all tests PASS
- Expected files:
  - `packages/core/src/agents/a2a-client-manager.ts` fully implemented
  - `packages/core/src/agents/types.ts` with discriminated union types
  - `packages/core/src/agents/auth-providers.ts` with RemoteAgentAuthProvider

## Requirements Implemented

### REQ A2A-REG-002: Async Agent Registration

**Full EARS Text**: The AgentRegistry.registerAgent() method shall be asynchronous to support remote agent card fetching.

**Behavior Specification**:
- GIVEN: A call to AgentRegistry.registerAgent(definition)
- WHEN: The definition has `kind: 'remote'`
- THEN: The method shall await agent card fetching from the A2A client manager
- AND: Return a Promise<void> that resolves when registration completes or fails
- AND: All callers shall await the Promise

**Why This Matters**: Remote agents require async operations (HTTP fetches) during registration. Making registerAgent async is a BREAKING CHANGE — the method signature changes from sync to async. This enables parallel agent loading and proper error handling for network failures.

## Implementation Tasks

### Files to Modify

**`packages/core/src/agents/registry.ts`** — Make registerAgent async, add registerRemoteAgent stub

**Current state** (line 48):
```typescript
protected registerAgent<TOutput extends z.ZodTypeAny>(
  definition: AgentDefinition<TOutput>,
): void {
```

**Target state**:
```typescript
protected async registerAgent<TOutput extends z.ZodTypeAny>(
  definition: AgentDefinition<TOutput>,
): Promise<void> {
```

### Stub Implementation Details

For stub phase, add `async` keyword and `Promise<void>` return type. Add `registerRemoteAgent` method skeleton. Keep all existing validation logic.

**Changes:**

1. **Make registerAgent async** (line 48):
   - Change signature: `async registerAgent<TOutput>(...): Promise<void>`
   - Keep all existing validation
   - For stub: If `kind === 'remote'`, call `await this.registerRemoteAgent(definition)` (stub method)
   - For local agents, keep existing logic

2. **Add registerRemoteAgent stub** (after registerAgent):
   ```typescript
   /**
    * Registers a remote agent by fetching its card and creating client.
    * @plan PLAN-20260302-A2A.P18
    * @requirement A2A-REG-002
    */
   private async registerRemoteAgent(definition: RemoteAgentDefinition): Promise<void> {
     // Stub: just register the definition as-is
     this.agents.set(definition.name, definition as unknown as AgentDefinition);
   }
   ```

3. **Make loadBuiltInAgents async** (line 38):
   - Change signature: `private async loadBuiltInAgents(): Promise<void>`
   - Keep empty body (no built-in agents)

4. **Update initialize to await** (line 30):
   - Change: `this.loadBuiltInAgents();` to `await this.loadBuiltInAgents();`

5. **Add import for RemoteAgentDefinition** (top of file):
   ```typescript
   import type { AgentDefinition, RemoteAgentDefinition } from './types.js';
   ```

### Required Code Markers

All modified methods MUST include:
```typescript
/**
 * @plan PLAN-20260302-A2A.P18
 * @requirement A2A-REG-002
 */
```

### Breaking Change Notice

**CRITICAL**: This IS a breaking change. The `registerAgent` method signature changes from synchronous to asynchronous.

**What breaks:**
- All callers of `registerAgent()` must add `await` keyword
- `loadBuiltInAgents()` must become async
- Currently, only `loadBuiltInAgents()` calls `registerAgent`, so breakage is contained to registry.ts

**Call site analysis (verified against codebase):**
- `registerAgent` is `protected` — only called from within `registry.ts` itself
- `loadBuiltInAgents()` is the sole caller — fixed in this phase (step 4)
- `initialize()` is already async — no change needed for its callers
- No test files call `registerAgent` directly (verified via grep)
- **Result: NO compile gap.** After this phase, all callers are updated. TypeScript compiles clean.

**Phase 30 scope clarified:** Phase 30 handles the *type narrowing* migration
(AgentDefinition → LocalAgentDefinition in executor/invocation), NOT async migration.
The async change is fully self-contained in this phase.

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 18 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 17a completed by checking:
- `npm test -- packages/core/src/agents/__tests__/a2a-client-manager.test.ts` all tests PASS
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P17a-report.md` exists

YOUR TASK:
Modify `packages/core/src/agents/registry.ts` to make registerAgent async (STUB phase).

CURRENT STATE:
- Line 48: `protected registerAgent<TOutput>(...): void` (synchronous)
- Line 38: `private loadBuiltInAgents(): void` (synchronous, empty)
- Line 31: `this.loadBuiltInAgents();` (no await)

TARGET STATE (STUB):
- registerAgent becomes async: `protected async registerAgent<TOutput>(...): Promise<void>`
- loadBuiltInAgents becomes async: `private async loadBuiltInAgents(): Promise<void>`
- initialize awaits: `await this.loadBuiltInAgents();`
- Add registerRemoteAgent STUB method (just stores definition, no fetching)

SPECIFIC CHANGES:

1. **Line 7**: Add import:
   ```typescript
   import type { AgentDefinition, RemoteAgentDefinition } from './types.js';
   ```

2. **Line 31** (initialize method): Change to:
   ```typescript
   await this.loadBuiltInAgents();
   ```

3. **Line 38** (loadBuiltInAgents): Add `async` and `Promise<void>`:
   ```typescript
   private async loadBuiltInAgents(): Promise<void> {
     // No built-in agents registered...
   }
   ```

4. **Line 48** (registerAgent): Add `async` and `Promise<void>`:
   ```typescript
   /**
    * @plan PLAN-20260302-A2A.P18
    * @requirement A2A-REG-002
    */
   protected async registerAgent<TOutput extends z.ZodTypeAny>(
     definition: AgentDefinition<TOutput>,
   ): Promise<void> {
     // Keep existing validation (lines 50-57 unchanged)
     
     // After validation, add dispatch logic:
     // Import at top: import { isRemoteAgent } from './types.js';
     if (isRemoteAgent(definition)) {
       await this.registerRemoteAgent(definition);
     } else {
       // Existing local agent registration logic (lines 59-66 unchanged)
     }
   }
   ```

5. **After registerAgent** (new method ~line 70): Add stub:
   ```typescript
   /**
    * Registers a remote agent by fetching its card and creating client.
    * @plan PLAN-20260302-A2A.P18
    * @requirement A2A-REG-002
    */
   private async registerRemoteAgent(definition: RemoteAgentDefinition): Promise<void> {
     // Stub: just register the definition without fetching card
     this.agents.set(definition.name, definition as unknown as AgentDefinition);
     this.logger.debug(`[AgentRegistry] Registered remote agent '${definition.name}' (stub)`);
   }
   ```

STUB RULES:
- registerRemoteAgent is a STUB: it just stores the definition, no A2A fetching
- Keep all existing validation logic
- Add @plan PLAN-20260302-A2A.P18 to modified methods
- NO TODO comments

DELIVERABLES:
- registry.ts with async registerAgent signature
- registerRemoteAgent stub method added
- All existing functionality preserved
- Compiles with no errors
- No TODO comments

DO NOT:
- Implement actual agent card fetching (that's P20)
- Add A2AClientManager usage (that's P20)
- Change validation logic
- Remove existing code

IMPORT NOTE:
Add these imports at top:
```typescript
import { isRemoteAgent, type RemoteAgentDefinition } from './types.js';
```
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check async signature added
grep "async registerAgent" packages/core/src/agents/registry.ts
# Expected: method signature with async

# Check Promise<void> return type
grep "Promise<void>" packages/core/src/agents/registry.ts
# Expected: 2+ occurrences (registerAgent, loadBuiltInAgents, registerRemoteAgent)

# Check await in initialize
grep "await this.loadBuiltInAgents" packages/core/src/agents/registry.ts
# Expected: found

# Check registerRemoteAgent stub exists
grep "registerRemoteAgent" packages/core/src/agents/registry.ts
# Expected: method defined

# Check plan markers
grep -c "@plan:PLAN-20260302-A2A.P18" packages/core/src/agents/registry.ts
# Expected: 2+ occurrences

# TypeScript compiles
npm run typecheck
# Expected: no errors
```

### Deferred Implementation Detection

```bash
# Check for TODO in implementation
grep -E "(TODO|FIXME|HACK|STUB)" packages/core/src/agents/registry.ts | grep -v "No built-in agents" | grep -v "@plan"
# Expected: No matches (stub is OK, but no TODO comments)
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] registerAgent signature is `async (...): Promise<void>`
- [ ] registerAgent can be awaited by callers
- [ ] registerRemoteAgent stub method exists (just stores definition)
- [ ] loadBuiltInAgents is async
- [ ] initialize awaits loadBuiltInAgents
- [ ] File compiles successfully

**Is this REAL stub, not placeholder?**
- [ ] Stub registerRemoteAgent stores definition (doesn't throw, doesn't return empty)
- [ ] Existing validation logic preserved
- [ ] No TODO comments

**Breaking changes expected?**
- [ ] registerAgent is now async (breaking change documented)
- [ ] Callers must await (fixed in registry.ts, tests fixed in P30-31)
- [ ] This is intentional and acceptable for stub phase

**What's MISSING (acceptable for stub)?**
- Agent card fetching (P20)
- A2AClientManager integration (P20)
- Error handling for network failures (P20)
- Parallel registration with Promise.allSettled (P20)

## Success Criteria

- All verification commands return expected results
- registerAgent signature is async with Promise<void> return
- registerRemoteAgent stub method exists
- File compiles successfully
- No TODO comments
- Existing validation logic preserved
- Breaking change documented

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   git checkout -- packages/core/src/agents/registry.ts
   ```
2. Fix issues based on verification failures
3. Re-run typecheck
4. Cannot proceed to Phase 18a until stub compiles

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P18.md`

Contents:
```markdown
Phase: P18
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/registry.ts (+15 lines)

Signature Changes:
  - registerAgent: void → Promise<void> (BREAKING CHANGE)
  - loadBuiltInAgents: void → Promise<void>
  - initialize: synchronous await added

Methods Added:
  - registerRemoteAgent(definition: RemoteAgentDefinition): Promise<void> (stub)

Verification: [paste typecheck output showing success]

Breaking Changes Introduced:
- registerAgent() is now async — callers must await
- All call sites in registry.ts updated to await
- Test updates deferred to P30-31

Next Phase: P18a (Verification of P18)
```
