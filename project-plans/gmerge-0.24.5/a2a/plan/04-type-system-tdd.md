# Phase 04: Type System Evolution - TDD

## Phase ID

`PLAN-20260302-A2A.P04`

## Prerequisites

- Required: Phase 03 completed and verified
- Verification: `grep -c "@plan:PLAN-20260302-A2A.P03" packages/core/src/agents/types.ts` returns 4
- Expected: Discriminated union types exist in types.ts (BaseAgentDefinition, LocalAgentDefinition, RemoteAgentDefinition, union type AgentDefinition)

## Requirements Implemented

### REQ A2A-REG-001: Type System Behavioral Tests

**Full EARS Text**: The system shall support registering both local and remote agent definitions via a discriminated union type.

**Behavior Specification**:
- GIVEN: Type narrowing via kind field
- WHEN: Code checks `definition.kind === 'local'`
- THEN: TypeScript allows access to promptConfig, modelConfig, runConfig
- AND: TypeScript prevents access to agentCardUrl

- GIVEN: Type narrowing via kind field
- WHEN: Code checks `definition.kind === 'remote'`
- THEN: TypeScript allows access to agentCardUrl
- AND: TypeScript prevents access to promptConfig, modelConfig, runConfig

- GIVEN: Generic AgentDefinition without narrowing
- WHEN: Code attempts to access kind-specific fields
- THEN: TypeScript compile error (must narrow first)

**Why This Matters**: Runtime type narrowing must work correctly to ensure the discriminated union provides actual type safety. These tests verify that TypeScript's control flow analysis correctly narrows the union type based on the `kind` discriminant, and that the fields are only accessible after narrowing.

## Implementation Tasks

### File to Create

**`packages/core/src/agents/__tests__/types.test.ts`** — Type system behavioral tests

### Test Structure and Requirements

**MANDATORY RULES**:
1. **Test BEHAVIOR, not structure**: Tests verify type narrowing works at runtime
2. **NO mocking**: These are pure type tests with real objects
3. **Use `@ts-expect-error`**: Document expected compile errors for wrong type access
4. **Every test has markers**: `@plan`, `@requirement`, and `@scenario` in JSDoc
5. **Cover all narrowing paths**: Local narrowing, remote narrowing, common fields, type guards

### Required Tests

```typescript
import { describe, it, expect } from 'vitest';
import type {
  AgentDefinition,
  LocalAgentDefinition,
  RemoteAgentDefinition,
} from '../types.js';

/**
 * @plan PLAN-20260302-A2A.P04
 * @requirement A2A-REG-001
 * @scenario Type system discriminated union behavioral tests
 */
describe('AgentDefinition Types', () => {
  /**
   * @plan PLAN-20260302-A2A.P04
   * @requirement A2A-REG-001
   * @scenario Local agent type narrowing via kind discriminant
   */
  describe('LocalAgentDefinition', () => {
    it('should narrow to local type when kind is local', () => {
      const def: AgentDefinition = {
        kind: 'local',
        name: 'test-local',
        description: 'Test local agent',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test system prompt' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      // Type narrowing allows access to local-specific fields
      if (def.kind === 'local') {
        expect(def.promptConfig).toBeDefined();
        expect(def.promptConfig.systemPrompt).toBe('Test system prompt');
        expect(def.modelConfig).toBeDefined();
        expect(def.modelConfig.model).toBe('gemini-2.0-flash-exp');
        expect(def.runConfig).toBeDefined();
        expect(def.runConfig.max_time_minutes).toBe(5);
      } else {
        throw new Error('Type narrowing failed for local agent');
      }
    });
    
    it('should require all mandatory fields for local agents', () => {
      const def: LocalAgentDefinition = {
        kind: 'local',
        name: 'test-agent',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      // Verify all required fields are present and have correct types
      expect(def.kind).toBe('local');
      expect(def.name).toBe('test-agent');
      expect(def.promptConfig).toBeDefined();
      expect(def.modelConfig).toBeDefined();
      expect(def.runConfig).toBeDefined();
      expect(def.inputConfig).toBeDefined();
    });
    
    it('should allow optional fields on local agents', () => {
      const def: LocalAgentDefinition = {
        kind: 'local',
        name: 'test-agent',
        displayName: 'Test Agent Display',
        description: 'Test agent description',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 },
        toolConfig: { tools: [] }
      };
      
      expect(def.displayName).toBe('Test Agent Display');
      expect(def.description).toBe('Test agent description');
      expect(def.toolConfig).toBeDefined();
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P04
   * @requirement A2A-REG-001
   * @scenario Remote agent type narrowing via kind discriminant
   */
  describe('RemoteAgentDefinition', () => {
    it('should narrow to remote type when kind is remote', () => {
      const def: AgentDefinition = {
        kind: 'remote',
        name: 'test-remote',
        description: 'Test remote agent',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://agent.example.com/card'
      };
      
      // Type narrowing allows access to remote-specific fields
      if (def.kind === 'remote') {
        expect(def.agentCardUrl).toBe('https://agent.example.com/card');
        
        // TypeScript should NOT allow promptConfig access after narrowing
        // @ts-expect-error - promptConfig doesn't exist on RemoteAgentDefinition
        expect(def.promptConfig).toBeUndefined();
      } else {
        throw new Error('Type narrowing failed for remote agent');
      }
    });
    
    it('should only require agentCardUrl for remote agents', () => {
      const def: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test-remote',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://agent.example.com/card'
      };
      
      // Verify required fields
      expect(def.kind).toBe('remote');
      expect(def.name).toBe('test-remote');
      expect(def.agentCardUrl).toBe('https://agent.example.com/card');
      expect(def.inputConfig).toBeDefined();
      
      // Remote agents don't have promptConfig, modelConfig, or runConfig
    });
    
    it('should allow optional description on remote agents', () => {
      const def: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test-remote',
        description: 'Remote agent with description',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://agent.example.com/card'
      };
      
      expect(def.description).toBe('Remote agent with description');
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P04
   * @requirement A2A-REG-001
   * @scenario Type guards and discriminated union runtime behavior
   */
  describe('Type Guards and Discrimination', () => {
    it('should discriminate using kind field at runtime', () => {
      const localDef: AgentDefinition = {
        kind: 'local',
        name: 'local-agent',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      const remoteDef: AgentDefinition = {
        kind: 'remote',
        name: 'remote-agent',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      // Type narrowing works correctly for local
      if (localDef.kind === 'local') {
        expect(localDef.promptConfig).toBeDefined();
        expect(localDef.modelConfig).toBeDefined();
      }
      
      // Type narrowing works correctly for remote
      if (remoteDef.kind === 'remote') {
        expect(remoteDef.agentCardUrl).toBeDefined();
      }
    });
    
    it('should support type guard functions', () => {
      const isLocalAgent = (def: AgentDefinition): def is LocalAgentDefinition => {
        return def.kind === 'local';
      };
      
      const isRemoteAgent = (def: AgentDefinition): def is RemoteAgentDefinition => {
        return def.kind === 'remote';
      };
      
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
      
      expect(isLocalAgent(localDef)).toBe(true);
      expect(isRemoteAgent(localDef)).toBe(false);
      expect(isLocalAgent(remoteDef)).toBe(false);
      expect(isRemoteAgent(remoteDef)).toBe(true);
      
      // After type guard, TypeScript knows the specific type
      if (isLocalAgent(localDef)) {
        expect(localDef.promptConfig).toBeDefined();
      }
      
      if (isRemoteAgent(remoteDef)) {
        expect(remoteDef.agentCardUrl).toBeDefined();
      }
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P04
   * @requirement A2A-REG-001
   * @scenario Common fields accessible on both agent types
   */
  describe('BaseAgentDefinition Common Fields', () => {
    it('should allow name on both agent types', () => {
      const localDef: LocalAgentDefinition = {
        kind: 'local',
        name: 'local-agent',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      const remoteDef: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'remote-agent',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      // Common fields accessible without narrowing
      expect(localDef.name).toBe('local-agent');
      expect(remoteDef.name).toBe('remote-agent');
    });
    
    it('should allow optional displayName on both agent types', () => {
      const localDef: LocalAgentDefinition = {
        kind: 'local',
        name: 'test',
        displayName: 'Local Agent Display',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      const remoteDef: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test',
        displayName: 'Remote Agent Display',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      expect(localDef.displayName).toBe('Local Agent Display');
      expect(remoteDef.displayName).toBe('Remote Agent Display');
    });
    
    it('should allow optional description on both agent types', () => {
      const localDef: LocalAgentDefinition = {
        kind: 'local',
        name: 'test',
        description: 'Local agent description',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      const remoteDef: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test',
        description: 'Remote agent description',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      expect(localDef.description).toBe('Local agent description');
      expect(remoteDef.description).toBe('Remote agent description');
    });
    
    it('should require inputConfig on both agent types', () => {
      const localDef: LocalAgentDefinition = {
        kind: 'local',
        name: 'test',
        inputConfig: { inputs: { query: { description: 'Test query', type: 'string', required: true } } },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      const remoteDef: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test',
        inputConfig: { inputs: { query: { description: 'Test query', type: 'string', required: true } } },
        agentCardUrl: 'https://example.com/card'
      };
      
      expect(localDef.inputConfig).toBeDefined();
      expect(remoteDef.inputConfig).toBeDefined();
      expect(localDef.inputConfig.inputs.query).toBeDefined();
      expect(remoteDef.inputConfig.inputs.query).toBeDefined();
    });
  });
});
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 04 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 03 completed by checking:
- `grep -c "@plan:PLAN-20260302-A2A.P03" packages/core/src/agents/types.ts` returns 4
- LocalAgentDefinition, RemoteAgentDefinition, and discriminated union AgentDefinition exist in types.ts
- File `project-plans/gmerge-0.24.5/a2a/plan/.completed/P03.md` exists

YOUR TASK:
Create `packages/core/src/agents/__tests__/types.test.ts` with behavioral tests for type system.

MANDATORY RULES:
1. Test ACTUAL TYPE NARROWING at runtime (not just structure)
2. Use `@ts-expect-error` to document expected compile errors when accessing wrong type's fields
3. NO mocking - these are pure type tests with real objects
4. Every test has `@plan PLAN-20260302-A2A.P04`, `@requirement A2A-REG-001`, and `@scenario` markers in JSDoc
5. Tests verify TypeScript enforces fields correctly after narrowing via `kind` discriminant

TEST COVERAGE REQUIRED:
1. **Local narrowing**: When `definition.kind === 'local'`, can access promptConfig/modelConfig/runConfig
2. **Remote narrowing**: When `definition.kind === 'remote'`, can access agentCardUrl but NOT promptConfig
3. **Common fields**: name, displayName, description, inputConfig accessible on both types without narrowing
4. **Type guards**: Custom type guard functions (`isLocalAgent`, `isRemoteAgent`) work correctly
5. **All mandatory fields**: Verify Local requires promptConfig/modelConfig/runConfig, Remote requires agentCardUrl

IMPORTS:
```typescript
import { describe, it, expect } from 'vitest';
import type {
  AgentDefinition,
  LocalAgentDefinition,
  RemoteAgentDefinition,
} from '../types.js';
```

DELIVERABLES:
- types.test.ts with 10+ behavioral tests (4 describe blocks as shown above)
- All tests PASS (types from P03 are correct)
- Coverage: local narrowing, remote narrowing, common fields, type guards
- All tests have @plan, @requirement, @scenario markers

DO NOT:
- Test for NotYetImplemented (no stubs to test)
- Mock any objects (pure type tests with real objects)
- Add validation logic (that's P05)
- Test implementation behavior (only test type system)
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20260302-A2A.P04" packages/core/src/agents/__tests__/types.test.ts
# Expected: 10+ occurrences (one per test)

# Check requirements covered
grep -c "@requirement:A2A-REG-001" packages/core/src/agents/__tests__/types.test.ts
# Expected: 10+ occurrences

# Run tests (they should ALL PASS since types exist from P03)
npm test -- packages/core/src/agents/__tests__/types.test.ts
# Expected: All pass, 10+ tests

# Check for @ts-expect-error annotations (should have at least 1 for documenting compile error)
grep -c "@ts-expect-error" packages/core/src/agents/__tests__/types.test.ts
# Expected: 1+ occurrences
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/agents/__tests__/types.test.ts
# Expected: No matches
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] I read the test file (not just checked file exists)
- [ ] Tests verify type narrowing via `if (definition.kind === 'local')` allows accessing promptConfig
- [ ] Tests verify type narrowing via `if (definition.kind === 'remote')` allows accessing agentCardUrl
- [ ] Tests verify `@ts-expect-error` documents that accessing promptConfig on remote type fails
- [ ] Tests verify common fields (name, displayName, description, inputConfig) work on both types

**Is this REAL implementation, not placeholder?**
- [ ] No TODO/HACK/STUB comments
- [ ] Tests use real objects (not mocks)
- [ ] Tests PASS (verify actual type behavior)
- [ ] All tests have @plan, @requirement, @scenario markers

**Would tests FAIL if types were broken?**
- [ ] If LocalAgentDefinition didn't have promptConfig, tests would fail
- [ ] If RemoteAgentDefinition had promptConfig, `@ts-expect-error` test would fail (compile error expected but didn't happen)
- [ ] If discriminant wasn't 'kind', narrowing wouldn't work

**What's MISSING (acceptable for TDD phase)?**
- Runtime validation logic (P05)
- Integration with registry/executor (P18-P31)
- Actual agent execution tests (those are in executor/invocation tests)

## Success Criteria

- All verification commands return expected results
- 10+ tests exist covering all narrowing scenarios
- All tests PASS
- Tests use `@ts-expect-error` to document expected compile errors
- All tests have @plan, @requirement, @scenario markers
- No mocking, no stubs
- Tests verify actual TypeScript type narrowing behavior

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   git checkout -- packages/core/src/agents/__tests__/types.test.ts
   rm -f packages/core/src/agents/__tests__/types.test.ts
   ```
2. Files to revert: types.test.ts
3. Cannot proceed to Phase 04a until tests are correct and passing

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P04.md`

Contents:
```markdown
Phase: P04
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/__tests__/types.test.ts (~200 lines)
Tests Added: 
  - LocalAgentDefinition narrowing (3 tests)
  - RemoteAgentDefinition narrowing (3 tests)
  - Type guards and discrimination (2 tests)
  - BaseAgentDefinition common fields (4 tests)
Total Tests: 12
Test Results: All PASS
Verification: [paste npm test output showing all tests passing]

Next Phase: P04a (Verification of P04)
```
