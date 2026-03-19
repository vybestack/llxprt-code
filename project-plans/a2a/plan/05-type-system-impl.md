# Phase 05: Type System Evolution - Implementation

## Phase ID

`PLAN-20260302-A2A.P05`

## Prerequisites

- Required: Phase 04 completed and verified (P04a)
- Verification: `npm test -- packages/core/src/agents/__tests__/types.test.ts` all tests PASS
- Expected: Discriminated union types exist in types.ts, behavioral tests pass

## Requirements Implemented

### REQ A2A-REG-001: Type Narrowing and Validation Utilities

**Full EARS Text**: The system shall support registering both local and remote agent definitions via a discriminated union type.

**Behavior Specification**:
- GIVEN: Helper functions for type narrowing
- WHEN: Code needs to distinguish local from remote agents
- THEN: Type guard functions provide type-safe narrowing
- AND: Runtime validation ensures agent definitions are valid before use

**Why This Matters**: While TypeScript provides compile-time type safety, runtime validation is needed when loading agents from external sources (TOML files, APIs). Type guard functions make narrowing code cleaner and more maintainable. This phase completes the type system by adding runtime utilities to complement the compile-time safety from P03-04.

## Implementation Tasks

### Files to Modify

#### 1. **`packages/core/src/agents/types.ts`** — Add type guard utilities

**Add at end of file (after existing interfaces):**

```typescript
/**
 * Type guard to check if an agent definition is a local agent.
 * @plan PLAN-20260302-A2A.P05
 * @requirement A2A-REG-001
 */
export function isLocalAgent<TOutput extends z.ZodTypeAny = z.ZodUnknown>(
  definition: AgentDefinition<TOutput>,
): definition is LocalAgentDefinition<TOutput> {
  return definition.kind === 'local';
}

/**
 * Type guard to check if an agent definition is a remote agent.
 * @plan PLAN-20260302-A2A.P05
 * @requirement A2A-REG-001
 */
export function isRemoteAgent(
  definition: AgentDefinition,
): definition is RemoteAgentDefinition {
  return definition.kind === 'remote';
}

/**
 * Validates that a local agent definition has all required fields.
 * Throws error if validation fails.
 * @plan PLAN-20260302-A2A.P05
 * @requirement A2A-REG-001
 */
export function validateLocalAgentDefinition<TOutput extends z.ZodTypeAny>(
  definition: LocalAgentDefinition<TOutput>,
): void {
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error('Local agent definition must have a valid name');
  }
  if (!definition.promptConfig) {
    throw new Error(`Local agent '${definition.name}' must have promptConfig`);
  }
  if (!definition.modelConfig) {
    throw new Error(`Local agent '${definition.name}' must have modelConfig`);
  }
  if (!definition.runConfig) {
    throw new Error(`Local agent '${definition.name}' must have runConfig`);
  }
  if (!definition.inputConfig) {
    throw new Error(`Local agent '${definition.name}' must have inputConfig`);
  }
}

/**
 * Validates that a remote agent definition has all required fields.
 * Throws error if validation fails.
 * @plan PLAN-20260302-A2A.P05
 * @requirement A2A-REG-001
 */
export function validateRemoteAgentDefinition(
  definition: RemoteAgentDefinition,
): void {
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error('Remote agent definition must have a valid name');
  }
  if (!definition.agentCardUrl || typeof definition.agentCardUrl !== 'string') {
    throw new Error(`Remote agent '${definition.name}' must have agentCardUrl`);
  }
  if (!definition.agentCardUrl.startsWith('https://')) {
    throw new Error(
      `Remote agent '${definition.name}' agentCardUrl must use HTTPS (security requirement)`,
    );
  }
  if (!definition.inputConfig) {
    throw new Error(`Remote agent '${definition.name}' must have inputConfig`);
  }
}

/**
 * Validates any agent definition based on its kind.
 * Throws error if validation fails.
 * @plan PLAN-20260302-A2A.P05
 * @requirement A2A-REG-001
 */
export function validateAgentDefinition<TOutput extends z.ZodTypeAny>(
  definition: AgentDefinition<TOutput>,
): void {
  if (isLocalAgent(definition)) {
    validateLocalAgentDefinition(definition);
  } else if (isRemoteAgent(definition)) {
    validateRemoteAgentDefinition(definition);
  } else {
    throw new Error('Agent definition must have kind "local" or "remote"');
  }
}
```

#### 2. **`packages/core/src/agents/__tests__/types.test.ts`** — Add validation tests

**Add new describe block at end:**

```typescript
  /**
   * @plan PLAN-20260302-A2A.P05
   * @requirement A2A-REG-001
   * @scenario Runtime validation utilities
   */
  describe('Validation and Type Guards', () => {
    describe('Type Guards', () => {
      it('isLocalAgent returns true for local agents', () => {
        const def: AgentDefinition = {
          kind: 'local',
          name: 'test',
          inputConfig: { inputs: {} },
          promptConfig: { systemPrompt: 'Test' },
          modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
          runConfig: { max_time_minutes: 5 }
        };
        
        expect(isLocalAgent(def)).toBe(true);
        expect(isRemoteAgent(def)).toBe(false);
      });
      
      it('isRemoteAgent returns true for remote agents', () => {
        const def: AgentDefinition = {
          kind: 'remote',
          name: 'test',
          inputConfig: { inputs: {} },
          agentCardUrl: 'https://example.com/card'
        };
        
        expect(isRemoteAgent(def)).toBe(true);
        expect(isLocalAgent(def)).toBe(false);
      });
    });
    
    describe('Validation', () => {
      it('validateLocalAgentDefinition accepts valid local agent', () => {
        const def: LocalAgentDefinition = {
          kind: 'local',
          name: 'test',
          inputConfig: { inputs: {} },
          promptConfig: { systemPrompt: 'Test' },
          modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
          runConfig: { max_time_minutes: 5 }
        };
        
        expect(() => validateLocalAgentDefinition(def)).not.toThrow();
      });
      
      it('validateLocalAgentDefinition rejects missing promptConfig', () => {
        const def = {
          kind: 'local',
          name: 'test',
          inputConfig: { inputs: {} },
          modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
          runConfig: { max_time_minutes: 5 }
        } as LocalAgentDefinition;
        
        expect(() => validateLocalAgentDefinition(def)).toThrow(/promptConfig/);
      });
      
      it('validateRemoteAgentDefinition accepts valid remote agent', () => {
        const def: RemoteAgentDefinition = {
          kind: 'remote',
          name: 'test',
          inputConfig: { inputs: {} },
          agentCardUrl: 'https://example.com/card'
        };
        
        expect(() => validateRemoteAgentDefinition(def)).not.toThrow();
      });
      
      it('validateRemoteAgentDefinition rejects http URLs (requires HTTPS)', () => {
        const def: RemoteAgentDefinition = {
          kind: 'remote',
          name: 'test',
          inputConfig: { inputs: {} },
          agentCardUrl: 'http://example.com/card'  // http, not https
        };
        
        expect(() => validateRemoteAgentDefinition(def)).toThrow(/HTTPS/);
      });
      
      it('validateRemoteAgentDefinition rejects missing agentCardUrl', () => {
        const def = {
          kind: 'remote',
          name: 'test',
          inputConfig: { inputs: {} }
        } as RemoteAgentDefinition;
        
        expect(() => validateRemoteAgentDefinition(def)).toThrow(/agentCardUrl/);
      });
      
      it('validateAgentDefinition dispatches to correct validator', () => {
        const localDef: AgentDefinition = {
          kind: 'local',
          name: 'test',
          inputConfig: { inputs: {} },
          promptConfig: { systemPrompt: 'Test' },
          modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
          runConfig: { max_time_minutes: 5 }
        };
        
        const remoteDef: AgentDefinition = {
          kind: 'remote',
          name: 'test',
          inputConfig: { inputs: {} },
          agentCardUrl: 'https://example.com/card'
        };
        
        expect(() => validateAgentDefinition(localDef)).not.toThrow();
        expect(() => validateAgentDefinition(remoteDef)).not.toThrow();
      });
    });
  });
```

**Add imports at top of file:**
```typescript
import {
  isLocalAgent,
  isRemoteAgent,
  validateLocalAgentDefinition,
  validateRemoteAgentDefinition,
  validateAgentDefinition,
} from '../types.js';
```

### Implementation Notes

1. **Type guards** (`isLocalAgent`, `isRemoteAgent`):
   - Use TypeScript type predicates (`is` keyword)
   - Check `kind` field for discrimination
   - Enable type narrowing in calling code

2. **Validation functions**:
   - Throw errors with descriptive messages
   - Include agent name in error messages for debugging
   - Validate all required fields for each agent type
   - **SECURITY**: Enforce HTTPS-only for remote agent URLs (per requirements.md A2A-SEC-001)

3. **HTTPS enforcement rationale**:
   - Agent card URLs must use HTTPS to prevent MITM attacks
   - HTTP URLs rejected at validation time (fail-fast)
   - Error message includes "security requirement" explanation

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 05 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 04 completed by checking:
- `npm test -- packages/core/src/agents/__tests__/types.test.ts` all tests PASS
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P04a-report.md` exists

YOUR TASK:
Add type guard utilities and validation functions to `packages/core/src/agents/types.ts`.
Extend test file `packages/core/src/agents/__tests__/types.test.ts` with validation tests.

SPECIFIC CHANGES:

1. **In types.ts**, add at END of file (after existing interfaces):
   - `isLocalAgent<TOutput>(definition): definition is LocalAgentDefinition<TOutput>`
   - `isRemoteAgent(definition): definition is RemoteAgentDefinition`
   - `validateLocalAgentDefinition<TOutput>(definition): void` (throws if invalid)
   - `validateRemoteAgentDefinition(definition): void` (throws if invalid, enforces HTTPS)
   - `validateAgentDefinition<TOutput>(definition): void` (dispatches based on kind)

2. **In types.test.ts**, add new describe block "Validation and Type Guards":
   - Test isLocalAgent returns true for local, false for remote
   - Test isRemoteAgent returns true for remote, false for local
   - Test validateLocalAgentDefinition accepts valid, rejects missing fields
   - Test validateRemoteAgentDefinition accepts valid HTTPS URL, rejects HTTP URL
   - Test validateAgentDefinition dispatches correctly

IMPLEMENTATION REQUIREMENTS:
- All functions have @plan PLAN-20260302-A2A.P05 and @requirement A2A-REG-001 markers
- Validation functions throw descriptive errors (include agent name)
- HTTPS enforcement: reject http:// URLs in validateRemoteAgentDefinition
- Type guards use TypeScript `is` predicates for type narrowing
- All new tests PASS

DELIVERABLES:
- types.ts: +80 lines (5 exported functions with JSDoc)
- types.test.ts: +60 lines (new describe block with 7+ tests)
- All tests PASS (existing 12+ tests + new 7+ tests = 19+ total)
- No TODO comments

DO NOT:
- Modify existing tests (only add new describe block)
- Change existing type definitions (LocalAgentDefinition, etc.)
- Add validation calls to registry/executor (that's P18-P31)
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers in implementation
grep -c "@plan PLAN-20260302-A2A.P05" packages/core/src/agents/types.ts
# Expected: 5 (isLocalAgent, isRemoteAgent, validateLocal, validateRemote, validateAgent)

# Check requirement markers
grep -c "@requirement A2A-REG-001" packages/core/src/agents/types.ts
# Expected: 5+ (existing 4 from P03 + new 5 from P05 = 9 total)

# Check exports
grep "export function is" packages/core/src/agents/types.ts
# Expected: isLocalAgent and isRemoteAgent

grep "export function validate" packages/core/src/agents/types.ts
# Expected: validateLocalAgent, validateRemoteAgent, validateAgentDefinition

# Run ALL tests (old + new)
npm test -- packages/core/src/agents/__tests__/types.test.ts
# Expected: 19+ tests all PASS

# Check for TODO/FIXME
grep -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/agents/types.ts
# Expected: No matches
```

### Deferred Implementation Detection

```bash
# Check for placeholder implementations
grep -E "return \[\]|return \{\}|return null|throw new Error\('Not" packages/core/src/agents/types.ts
# Expected: Only throw statements in validation functions (actual errors, not NotYetImplemented)
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] Type guards (isLocalAgent, isRemoteAgent) work and provide type narrowing
- [ ] Validation functions throw errors with agent name for invalid definitions
- [ ] HTTPS enforcement: http:// URLs are rejected
- [ ] All tests PASS (existing + new)

**Would tests FAIL if implementation was broken?**
- [ ] If isLocalAgent returned wrong value, tests would fail
- [ ] If validateRemoteAgentDefinition didn't enforce HTTPS, test would fail
- [ ] If validation functions didn't throw on missing fields, tests would fail

## Success Criteria

- All verification commands return expected results
- 5 new functions added to types.ts (2 type guards + 3 validators)
- 7+ new tests added to types.test.ts
- ALL tests PASS (19+ total)
- HTTPS enforcement works (rejects http:// URLs)
- All functions have @plan and @requirement markers
- No TODO comments

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   git checkout -- packages/core/src/agents/types.ts
   git checkout -- packages/core/src/agents/__tests__/types.test.ts
   ```
2. Fix issues based on verification failures
3. Re-run tests
4. Cannot proceed to Phase 05a until all tests pass

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P05.md`

Contents:
```markdown
Phase: P05
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified:
  - packages/core/src/agents/types.ts (+80 lines)
  - packages/core/src/agents/__tests__/types.test.ts (+60 lines)

Functions Added:
  - isLocalAgent<TOutput>() - Type guard for local agents
  - isRemoteAgent() - Type guard for remote agents
  - validateLocalAgentDefinition<TOutput>() - Validation for local agents
  - validateRemoteAgentDefinition() - Validation for remote agents (HTTPS enforced)
  - validateAgentDefinition<TOutput>() - Dispatch validator

Tests Added: 7+ (validation and type guard tests)
Total Tests: 19+ (12 from P04 + 7 from P05)
Test Results: All PASS

Verification: [paste npm test output]

Next Phase: P05a (Verification of P05)
```
