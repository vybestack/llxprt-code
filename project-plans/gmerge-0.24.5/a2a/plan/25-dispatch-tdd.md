# Phase 25: Execution Dispatch - TDD

## Phase ID

`PLAN-20260302-A2A.P25`

## Prerequisites

- Required: Phase 24a (Execution Dispatch Stub Verification) completed
- Verification: createInvocation stub exists and compiles
- Expected files:
  - `packages/core/src/agents/registry.ts` with createInvocation stub

## Requirements Implemented

### REQ A2A-EXEC-011: Execution Dispatch Tests

**Full EARS Text**: The agent invocation dispatch point shall support both local and remote agents via type-based routing.

**Test Scenarios** (9 tests total):
1. Local agent → returns SubagentInvocation (2 tests)
2. Remote agent → returns RemoteAgentInvocation (3 tests)
3. Error handling → throws on unknown agent (2 tests)
4. Type narrowing works (2 tests)

**Why This Matters**: Tests verify the factory method correctly dispatches based on agent kind, ensuring type safety and proper invocation routing. These tests will FAIL against the P24 stub (which always returns SubagentInvocation) and PASS after P26 implementation.

## Implementation Tasks

### Files to Create

**`packages/core/src/agents/__tests__/registry-dispatch.test.ts`** — Dispatch factory tests

```typescript
/**
 * Tests for AgentRegistry.createInvocation() dispatch factory.
 * @plan PLAN-20260302-A2A.P25
 * @requirement A2A-EXEC-011
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../registry.js';
import { SubagentInvocation } from '../invocation.js';
import { RemoteAgentInvocation } from '../remote-invocation.js';
import { Config } from '../../config/config.js';
import type { LocalAgentDefinition, RemoteAgentDefinition } from '../types.js';

describe('AgentRegistry.createInvocation()', () => {
  let registry: AgentRegistry;
  let config: Config;
  
  beforeEach(async () => {
    config = new Config();
    registry = new AgentRegistry(config);
    await registry.initialize();
  });
  
  /**
   * @plan PLAN-20260302-A2A.P25
   * @requirement A2A-EXEC-011
   * @scenario Local agent dispatch
   */
  describe('Local Agent Dispatch', () => {
    it('should return SubagentInvocation for local agent', async () => {
      // Register a local agent
      const localDef: LocalAgentDefinition = {
        kind: 'local',
        name: 'test-local',
        description: 'Test local agent',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test prompt' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      await registry['registerAgent'](localDef);
      
      // Create invocation
      const invocation = registry.createInvocation(
        'test-local',
        { query: 'test query' }
      );
      
      // Should be SubagentInvocation
      expect(invocation).toBeInstanceOf(SubagentInvocation);
    });
    
    it('should pass correct parameters to SubagentInvocation', async () => {
      const localDef: LocalAgentDefinition = {
        kind: 'local',
        name: 'test-local',
        description: 'Test',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      await registry['registerAgent'](localDef);
      
      const params = { query: 'test query', data: { foo: 'bar' } };
      const invocation = registry.createInvocation('test-local', params);
      
      // Verify params are passed (check via invocation's internal state)
      expect(invocation).toBeDefined();
      expect(invocation.getDescription()).toContain('test-local');
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P25
   * @requirement A2A-EXEC-011
   * @scenario Remote agent dispatch
   */
  describe('Remote Agent Dispatch', () => {
    it('should return RemoteAgentInvocation for remote agent', async () => {
      // Register a remote agent (mock - won't actually fetch card)
      const remoteDef: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test-remote',
        description: 'Test remote agent',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      // Bypass registerAgent to avoid network call
      // Use getAllDefinitions to access internal agents map via reflection
      const agentsMap = (registry as { agents: Map<string, RemoteAgentDefinition> }).agents;
      agentsMap.set('test-remote', remoteDef);
      
      // Create invocation
      const sessionState = new Map();
      const invocation = registry.createInvocation(
        'test-remote',
        { query: 'test query' },
        undefined,
        sessionState
      );
      
      // Should be RemoteAgentInvocation
      expect(invocation).toBeInstanceOf(RemoteAgentInvocation);
    });
    
    it('should pass sessionState to RemoteAgentInvocation', async () => {
      const remoteDef: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test-remote',
        description: 'Test',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      const agentsMap = (registry as { agents: Map<string, RemoteAgentDefinition> }).agents;
      agentsMap.set('test-remote', remoteDef);
      
      const sessionState = new Map();
      const invocation = registry.createInvocation(
        'test-remote',
        { query: 'test' },
        undefined,
        sessionState
      );
      
      // Verify invocation created (RemoteAgentInvocation requires sessionState)
      expect(invocation).toBeInstanceOf(RemoteAgentInvocation);
    });
    
    it('should create new session state Map if not provided', async () => {
      const remoteDef: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test-remote',
        description: 'Test',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      const agentsMap = (registry as { agents: Map<string, RemoteAgentDefinition> }).agents;
      agentsMap.set('test-remote', remoteDef);
      
      // Call without sessionState parameter
      const invocation = registry.createInvocation(
        'test-remote',
        { query: 'test' }
      );
      
      // Should not throw (RemoteAgentInvocation handles missing sessionState)
      expect(invocation).toBeInstanceOf(RemoteAgentInvocation);
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P25
   * @requirement A2A-EXEC-011
   * @scenario Error handling
   */
  describe('Error Handling', () => {
    it('should throw error for unknown agent', () => {
      expect(() => {
        registry.createInvocation('nonexistent-agent', { query: 'test' });
      }).toThrow(/not found/);
    });
    
    it('should include agent name in error message', () => {
      expect(() => {
        registry.createInvocation('unknown-agent', { query: 'test' });
      }).toThrow(/unknown-agent/);
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P25
   * @requirement A2A-EXEC-011
   * @scenario Type narrowing correctness
   */
  describe('Type Narrowing', () => {
    it('should narrow to LocalAgentDefinition for local agents', async () => {
      const localDef: LocalAgentDefinition = {
        kind: 'local',
        name: 'test-local',
        description: 'Test',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      await registry['registerAgent'](localDef);
      
      const invocation = registry.createInvocation('test-local', { query: 'test' });
      
      // Type check: SubagentInvocation expects LocalAgentDefinition
      expect(invocation).toBeInstanceOf(SubagentInvocation);
    });
    
    it('should narrow to RemoteAgentDefinition for remote agents', async () => {
      const remoteDef: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test-remote',
        description: 'Test',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      const agentsMap = (registry as { agents: Map<string, RemoteAgentDefinition> }).agents;
      agentsMap.set('test-remote', remoteDef);
      
      const invocation = registry.createInvocation('test-remote', { query: 'test' });
      
      // Type check: RemoteAgentInvocation expects RemoteAgentDefinition
      expect(invocation).toBeInstanceOf(RemoteAgentInvocation);
    });
  });
});
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 25 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 24a completed: createInvocation stub exists.

YOUR TASK:
Create test file `packages/core/src/agents/__tests__/registry-dispatch.test.ts` with dispatch factory tests.

TEST SCENARIOS (10 tests total):

**Local Agent Dispatch** (2 tests):
1. Returns SubagentInvocation for local agent
2. Passes correct parameters to SubagentInvocation

**Remote Agent Dispatch** (3 tests):
1. Returns RemoteAgentInvocation for remote agent
2. Passes sessionState to RemoteAgentInvocation
3. Creates new sessionState Map if not provided

**Error Handling** (2 tests):
1. Throws error for unknown agent
2. Includes agent name in error message

**Type Narrowing** (2 tests):
1. Narrows to LocalAgentDefinition for local agents
2. Narrows to RemoteAgentDefinition for remote agents

KEY NOTES:
- Tests should FAIL against P24 stub (throws on remote agents)
- Tests will PASS after P26 implementation
- Use type assertion `(registry as { agents: Map<...> }).agents.set()` to bypass registerRemoteAgent
- Use bracket notation `registry['registerAgent']()` to access protected method
- All tests have @plan PLAN-20260302-A2A.P25 and @requirement A2A-EXEC-011 markers

DELIVERABLES:
- registry-dispatch.test.ts created (~150 lines)
- 9 tests total
- Tests FAIL against stub (expected)

DO NOT:
- Make tests pass by changing stub (that's P26)
- Mock A2AClientManager (behavioral tests)
```

## Verification Commands

### Automated Checks

```bash
# Check test file exists
test -f packages/core/src/agents/__tests__/registry-dispatch.test.ts && echo "FOUND" || echo "MISSING"

# Check plan markers
grep -c "@plan PLAN-20260302-A2A.P25" packages/core/src/agents/__tests__/registry-dispatch.test.ts
# Expected: 9+ (one per test scenario)

# Check requirement markers
grep -c "@requirement A2A-EXEC-011" packages/core/src/agents/__tests__/registry-dispatch.test.ts
# Expected: 9+

# Run tests (SHOULD FAIL against stub)
npm test -- packages/core/src/agents/__tests__/registry-dispatch.test.ts
# Expected: Some failures (remote agent tests fail because stub returns SubagentInvocation)
```

### Expected Test Results

**Against P24 stub:**
- Local agent tests: PASS (2/2)
- Remote agent tests: FAIL (3/3) — stub throws on remote agents
- Error handling: PASS (2/2)
- Type narrowing: FAIL (1/2 tests) — stub throws on remote agents

**Total: ~4 PASS, ~5 FAIL (expected for TDD phase)**

## Success Criteria

- Test file created with 9 tests
- All tests have @plan and @requirement markers
- Tests compile and run (some fail against stub)
- No syntax errors
- No implementation-coupled test code (`as any` on internal registry map replaced with type assertion)

## Failure Recovery

If this phase fails:

1. Fix syntax/compilation errors
2. Ensure all markers present
3. Verify test structure matches template
4. Cannot proceed to Phase 25a until tests exist

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P25.md`

Contents:
```markdown
Phase: P25
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/__tests__/registry-dispatch.test.ts (~150 lines)

Tests Added: 9
  - Local agent dispatch: 2 tests
  - Remote agent dispatch: 3 tests
  - Error handling: 2 tests
  - Type narrowing: 2 tests

Test Results Against Stub: ~4 PASS, ~5 FAIL (expected)

Next Phase: P25a (Verification of P25)
```
