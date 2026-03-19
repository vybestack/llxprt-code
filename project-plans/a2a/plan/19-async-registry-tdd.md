# Phase 19: Async AgentRegistry - TDD

## Phase ID

`PLAN-20260302-A2A.P19`

## Prerequisites

- Required: Phase 18a (Async AgentRegistry Stub Verification) completed
- Verification: `npm run typecheck` succeeds with async registerAgent
- Expected files:
  - `packages/core/src/agents/registry.ts` with async methods and registerRemoteAgent stub

## Requirements Implemented (Test Coverage)

### REQ A2A-REG-002: Async Registration (Tests)

**Behavior to Test**:
- Async registration with await
- Remote agent registration (mocked card fetch)
- Error isolation (one failing agent doesn't block others)
- getAllDefinitions returns both local and remote

### REQ A2A-REG-003: Parallel Registration (Tests)

**Behavior to Test**:
- Multiple agents register concurrently
- Failures logged but don't throw
- Successful agents still registered

### REQ A2A-DISC-002: Error Handling (Tests)

**Behavior to Test**:
- Agent card fetch failure logged
- Failed agent not in registry
- Initialization completes successfully

## Implementation Tasks

### File to Create

**`packages/core/src/agents/__tests__/registry.test.ts`** — Behavioral tests for async registry

### Test Implementation

```typescript
/**
 * @plan PLAN-20260302-A2A.P19
 * @requirement A2A-REG-002, A2A-REG-003, A2A-DISC-002
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRegistry } from '../registry.js';
import { Config } from '../../config/config.js';
import type { LocalAgentDefinition, RemoteAgentDefinition, AgentDefinition } from '../types.js';

describe('AgentRegistry - Async Registration @plan PLAN-20260302-A2A.P19', () => {
  let registry: AgentRegistry;
  let config: Config;
  
  beforeEach(() => {
    config = new Config();
    registry = new AgentRegistry(config);
  });
  
  /**
   * @requirement A2A-REG-002
   */
  describe('Async Registration', () => {
    it('should await registerAgent for local agents', async () => {
      const localAgent: LocalAgentDefinition = {
        kind: 'local',
        name: 'test-local',
        description: 'Test local agent',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      // registerAgent is now async - must await
      await registry['registerAgent'](localAgent);
      
      const retrieved = registry.getDefinition('test-local');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-local');
      expect(retrieved?.kind).toBe('local');
    });
    
    it('should await registerAgent for remote agents (stub)', async () => {
      const remoteAgent: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'test-remote',
        description: 'Test remote agent',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      // registerAgent dispatches to registerRemoteAgent (stub)
      await registry['registerAgent'](remoteAgent);
      
      const retrieved = registry.getDefinition('test-remote');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-remote');
      expect(retrieved?.kind).toBe('remote');
    });
    
    it('should support both local and remote agents in registry', async () => {
      const localAgent: LocalAgentDefinition = {
        kind: 'local',
        name: 'local',
        description: 'Local',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      const remoteAgent: RemoteAgentDefinition = {
        kind: 'remote',
        name: 'remote',
        description: 'Remote',
        inputConfig: { inputs: {} },
        agentCardUrl: 'https://example.com/card'
      };
      
      await registry['registerAgent'](localAgent);
      await registry['registerAgent'](remoteAgent);
      
      const all = registry.getAllDefinitions();
      expect(all).toHaveLength(2);
      expect(all.find(a => a.name === 'local')).toBeDefined();
      expect(all.find(a => a.name === 'remote')).toBeDefined();
    });
  });
  
  /**
   * @requirement A2A-REG-003
   */
  describe('Parallel Registration', () => {
    it('should register multiple agents concurrently', async () => {
      const agents: AgentDefinition[] = [
        {
          kind: 'local',
          name: 'agent1',
          description: 'Agent 1',
          inputConfig: { inputs: {} },
          promptConfig: { systemPrompt: 'Test' },
          modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
          runConfig: { max_time_minutes: 5 }
        },
        {
          kind: 'local',
          name: 'agent2',
          description: 'Agent 2',
          inputConfig: { inputs: {} },
          promptConfig: { systemPrompt: 'Test' },
          modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
          runConfig: { max_time_minutes: 5 }
        },
        {
          kind: 'remote',
          name: 'agent3',
          description: 'Agent 3',
          inputConfig: { inputs: {} },
          agentCardUrl: 'https://example.com/card3'
        }
      ];
      
      // Register in parallel using Promise.allSettled
      await Promise.allSettled(
        agents.map(agent => registry['registerAgent'](agent))
      );
      
      const all = registry.getAllDefinitions();
      expect(all).toHaveLength(3);
    });
    
    it('should isolate errors - one failure does not block others (simulated)', async () => {
      // In P19 (stub phase), registerRemoteAgent never fails
      // This test documents expected behavior for P20
      // When implemented, this will test actual error isolation
      
      const validAgent: LocalAgentDefinition = {
        kind: 'local',
        name: 'valid',
        description: 'Valid agent',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      // Register valid agent (should succeed)
      await registry['registerAgent'](validAgent);
      
      const all = registry.getAllDefinitions();
      expect(all.find(a => a.name === 'valid')).toBeDefined();
      
      // P20 will add actual error simulation with mocked A2AClientManager
    });
  });
  
  /**
   * @requirement A2A-DISC-002
   */
  describe('Error Handling', () => {
    it('should skip agents with missing name', async () => {
      const invalidAgent = {
        kind: 'local',
        description: 'No name',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      } as LocalAgentDefinition;
      
      await registry['registerAgent'](invalidAgent);
      
      const all = registry.getAllDefinitions();
      expect(all).toHaveLength(0);
    });
    
    it('should skip agents with missing description', async () => {
      const invalidAgent = {
        kind: 'local',
        name: 'no-desc',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      } as LocalAgentDefinition;
      
      await registry['registerAgent'](invalidAgent);
      
      const all = registry.getAllDefinitions();
      expect(all).toHaveLength(0);
    });
    
    it('should complete initialization successfully even if no agents loaded', async () => {
      await registry.initialize();
      
      const all = registry.getAllDefinitions();
      expect(all).toHaveLength(0);
    });
  });
  
  describe('Existing Functionality (Regression)', () => {
    it('should override existing agent with same name', async () => {
      const agent1: LocalAgentDefinition = {
        kind: 'local',
        name: 'duplicate',
        description: 'First version',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      const agent2: LocalAgentDefinition = {
        kind: 'local',
        name: 'duplicate',
        description: 'Second version',
        inputConfig: { inputs: {} },
        promptConfig: { systemPrompt: 'Test' },
        modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
        runConfig: { max_time_minutes: 5 }
      };
      
      await registry['registerAgent'](agent1);
      await registry['registerAgent'](agent2);
      
      const retrieved = registry.getDefinition('duplicate');
      expect(retrieved?.description).toBe('Second version');
    });
    
    it('should return undefined for non-existent agent', () => {
      const retrieved = registry.getDefinition('does-not-exist');
      expect(retrieved).toBeUndefined();
    });
    
    it('should return empty array when no agents registered', () => {
      const all = registry.getAllDefinitions();
      expect(all).toEqual([]);
    });
  });
});
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 19 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 18a completed by checking:
- `npm run typecheck` succeeds
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P18a-report.md` exists

YOUR TASK:
Create `packages/core/src/agents/__tests__/registry.test.ts` with behavioral tests for async registration.

TEST STRUCTURE:
1. Async Registration tests:
   - Await registerAgent for local agents
   - Await registerAgent for remote agents (stub)
   - Both types coexist in registry

2. Parallel Registration tests:
   - Multiple agents via Promise.allSettled
   - Error isolation (placeholder for P20)

3. Error Handling tests:
   - Skip invalid agents (missing name/description)
   - Initialization succeeds with no agents

4. Regression tests:
   - Override duplicate names
   - Return undefined for missing
   - Empty array when no agents

TESTING PHILOSOPHY (RULES.md):
- Test BEHAVIOR, not implementation
- Use real Config and AgentRegistry instances (no mocks for these classes)
- Verify actual data flows (agent in → agent out)
- Tests will PASS against stub (registerRemoteAgent just stores definition)

DELIVERABLES:
- registry.test.ts with 11 tests (3 async, 2 parallel, 3 error, 3 regression)
- All tests PASS against P18 stub
- All tests have @plan and @requirement markers
- No mock theater (use real instances)

DO NOT:
- Mock AgentRegistry or Config
- Mock A2AClientManager in P19 (stub doesn't use it yet)
- Add test-specific logic to production code
- Create integration tests (those are P32)
```

## Verification Commands

```bash
# File created
ls -la packages/core/src/agents/__tests__/registry.test.ts

# Tests exist and pass
npm test -- packages/core/src/agents/__tests__/registry.test.ts
# Expected: 11 tests all PASS

# Plan markers
grep -c "@plan PLAN-20260302-A2A.P19" packages/core/src/agents/__tests__/registry.test.ts
# Expected: 1+ (file-level marker)

# Requirement markers
grep -c "@requirement" packages/core/src/agents/__tests__/registry.test.ts
# Expected: 3+ (A2A-REG-002, A2A-REG-003, A2A-DISC-002)

# No TODO
grep -E "(TODO|FIXME|HACK|STUB)" packages/core/src/agents/__tests__/registry.test.ts
# Expected: No matches
```

## Success Criteria

- registry.test.ts created with 11 tests
- All tests PASS against P18 stub
- Tests cover async registration, parallel loading, error handling
- No mock theater
- Ready for P20 implementation

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P19.md`

Contents:
```markdown
Phase: P19
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/__tests__/registry.test.ts (~250 lines)

Tests Added: 11 (3 async registration, 2 parallel, 3 errors, 3 regression)
Test Results: All PASS against P18 stub

Verification: [paste npm test output]

Next Phase: P19a (Verification of P19)
```
