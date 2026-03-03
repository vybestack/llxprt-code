# Phase 16: A2A Client Manager - TDD

## Phase ID

`PLAN-20260302-A2A.P16`

## Prerequisites

- Required: Phase 15a (A2A Client Manager Stub Verification) completed
- Verification: a2a-client-manager.ts exists with stub implementation
- Expected files:
  - `packages/core/src/agents/a2a-client-manager.ts` with stubs
  - `@a2a-js/sdk` dependency installed

## Requirements Implemented

### REQ A2A-DISC-001: Agent Card Discovery

**Full EARS Text**: The system shall support discovering remote agents via agent card URLs.

**Behavior Specification**:
- GIVEN: A valid HTTPS agent card URL
- WHEN: The system fetches the agent card via A2A SDK
- THEN: It shall retrieve an AgentCard object with name, skills, and capabilities
- AND: The AgentCard shall be cached for the session

**Why This Matters**: Agent cards are the standard A2A protocol mechanism for describing agent capabilities. Caching prevents redundant network requests and improves performance.

### REQ A2A-DISC-002: Error Handling for Unreachable Agents

**Full EARS Text**: When an agent card fetch fails, the system shall log an error and skip registration without blocking initialization.

**Why This Matters**: Single agent failures should not crash the system or prevent other agents from loading.

### REQ A2A-DISC-003: Agent Card Caching

**Full EARS Text**: The system shall cache fetched agent cards to avoid redundant network requests within a session.

**Behavior Specification**:
- GIVEN: An agent has been loaded once in a session
- WHEN: The system accesses the agent's metadata again
- THEN: It shall use the cached AgentCard without making a new HTTP request
- AND: The cache shall be scoped to the A2AClientManager instance lifecycle

**Why This Matters**: Multiple invocations of the same remote agent in a session should reuse the cached card, reducing network overhead and improving response time.

### REQ A2A-EXEC-001: SDK Client Delegation

**Full EARS Text**: The system shall delegate remote agent invocations to the A2AClientManager.

**Why This Matters**: A2AClientManager encapsulates all A2A SDK interactions for consistency and testability.

### REQ A2A-EXEC-005: Task Cancellation on Abort

**Full EARS Text**: When a remote agent invocation is aborted, the system shall attempt to cancel the remote task.

**Behavior Specification**:
- GIVEN: A remote agent invocation is executing with taskId="task-1"
- WHEN: The abort signal is triggered
- THEN: The system shall call A2AClientManager.cancelTask("agent-name", "task-1")
- AND: Shall ignore errors from the cancel operation (best-effort)

**Why This Matters**: Graceful cleanup prevents orphaned tasks on remote agents and conserves remote resources.

### REQ A2A-EXEC-012: Vertex AI Dialect Adapter

**Full EARS Text**: The A2AClientManager shall wrap fetch with a Vertex AI Agent Engine dialect adapter to handle proto-JSON format differences.

**Behavior Specification**:
- WHEN: A2AClientManager sets up a client
- THEN: It shall wrap fetch with createAdapterFetch()
- AND: The adapter shall normalize proto-JSON responses (e.g., TASK_STATE_WORKING → working)

**Why This Matters**: Vertex AI Agent Engine is the most common A2A deployment target. Without dialect adaptation, responses fail to parse.

## Implementation Tasks

### File to Create

**`packages/core/src/agents/__tests__/a2a-client-manager.test.ts`** — Behavioral tests for A2AClientManager

### Test Implementation Strategy

**CRITICAL: Follow RULES.md — Test Behavior, Not Implementation**

1. **No Mocking SDK Internals**: The A2A SDK Client is an EXTERNAL BOUNDARY. Mocking HTTP calls via SDK is appropriate. Mocking A2AClientManager methods is NOT appropriate.

2. **Behavioral Verification**: Tests verify data flows (inputs → outputs), not method calls.

3. **Real Objects**: Use actual AgentCard, Message, Task objects from SDK types, not test doubles.

### Test Structure

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { A2AClientManager } from '../a2a-client-manager.js';
import { NoAuthProvider } from '../auth-providers.js';
import type { Client, AgentCard, Message, Task } from '@a2a-js/sdk';

/**
 * @plan PLAN-20260302-A2A.P16
 * @requirement A2A-DISC-001, A2A-DISC-002, A2A-DISC-003, A2A-EXEC-001, A2A-EXEC-005, A2A-EXEC-012
 */
describe('A2AClientManager', () => {
  let manager: A2AClientManager;

  beforeEach(() => {
    manager = new A2AClientManager(new NoAuthProvider());
  });

  describe('Agent Card Loading (A2A-DISC-001)', () => {
    it('should load agent card from URL and return AgentCard object', async () => {
      // Arrange: Mock SDK Client.getAgentCard to return test card
      // Act: Call manager.loadAgent(name, url)
      // Assert: Returned AgentCard has expected name, url, skills, capabilities
    });

    it('should cache agent card after first load', async () => {
      // Arrange: Load agent once
      // Act: Call getAgentCard(name) without reloading
      // Assert: Cached card returned, no new HTTP request
    });

    it('should create SDK client for agent', async () => {
      // Arrange: No client exists
      // Act: loadAgent(name, url)
      // Assert: getClient(name) returns Client instance
    });
  });

  describe('Agent Card Caching (A2A-DISC-003)', () => {
    it('should return cached agent card on subsequent accesses', async () => {
      // Arrange: loadAgent() called once
      // Act: Call getAgentCard(name) multiple times
      // Assert: Same object returned each time
    });

    it('should not make HTTP request for cached agent card', async () => {
      // Arrange: loadAgent() called, spy on SDK client
      // Act: getAgentCard(name) called again
      // Assert: No additional SDK call made
    });
  });

  describe('Error Handling (A2A-DISC-002)', () => {
    it('should throw error when agent card fetch fails', async () => {
      // Arrange: Mock SDK client.getAgentCard to throw error
      // Act: Call loadAgent(name, unreachable-url)
      // Assert: Error thrown (caller handles gracefully)
    });

    it('should handle network timeout gracefully', async () => {
      // Arrange: Mock SDK timeout
      // Act: loadAgent() with timeout
      // Assert: Error thrown with timeout message
    });
  });

  describe('Message Sending (A2A-EXEC-001)', () => {
    it('should send message via SDK client', async () => {
      // Arrange: Agent loaded, mock client.sendMessage
      // Act: sendMessage(agentName, 'test query')
      // Assert: Returns Message or Task response
    });

    it('should include contextId in message when provided', async () => {
      // Arrange: Agent loaded
      // Act: sendMessage(name, query, { contextId: 'ctx-1' })
      // Assert: SDK client called with contextId
    });

    it('should include taskId in message when provided', async () => {
      // Arrange: Agent loaded
      // Act: sendMessage(name, query, { taskId: 'task-1' })
      // Assert: SDK client called with taskId
    });

    it('should support abort signal for cancellation', async () => {
      // Arrange: Agent loaded, AbortController
      // Act: sendMessage(name, query, { signal })
      // Assert: Abort signal wired to SDK call
    });
  });

  describe('Task Operations (A2A-EXEC-005)', () => {
    it('should retrieve task by ID', async () => {
      // Arrange: Agent loaded, mock client.getTask
      // Act: getTask(agentName, taskId)
      // Assert: Returns Task object
    });

    it('should cancel task by ID', async () => {
      // Arrange: Agent loaded, mock client.cancelTask
      // Act: cancelTask(agentName, taskId)
      // Assert: Returns Task with state: 'canceled'
    });

    it('should ignore errors during task cancellation (best-effort)', async () => {
      // Arrange: Mock client.cancelTask to throw
      // Act: cancelTask(agentName, taskId)
      // Assert: Does not throw (logs error internally)
    });
  });

  describe('Vertex AI Dialect Adapter (A2A-EXEC-012)', () => {
    it('should normalize proto-JSON task state to A2A standard', () => {
      // Arrange: Test mapTaskState function
      // Act: mapTaskState('TASK_STATE_WORKING')
      // Assert: Returns 'working'
    });

    it('should handle all proto-JSON state mappings', () => {
      // Test: TASK_STATE_COMPLETED → completed
      // Test: TASK_STATE_FAILED → failed
      // Test: TASK_STATE_CANCELED → canceled
      // Test: TASK_STATE_SUBMITTED → submitted
      // Test: TASK_STATE_INPUT_REQUIRED → input-required
    });

    it('should use createAdapterFetch when creating clients', async () => {
      // Arrange: Spy on createAdapterFetch
      // Act: loadAgent(name, url)
      // Assert: Adapter fetch used by SDK client
    });
  });

  describe('Authentication Integration', () => {
    it('should retrieve auth handler from auth provider', async () => {
      // Arrange: Custom auth provider with spy
      // Act: loadAgent(name, url)
      // Assert: authProvider.getAuthHandler(url) called
    });

    it('should pass auth handler to SDK client', async () => {
      // Arrange: Mock auth provider returning handler
      // Act: loadAgent(name, url)
      // Assert: Client created with auth handler
    });

    it('should work with no auth provider (undefined)', async () => {
      // Arrange: new A2AClientManager() with no provider
      // Act: loadAgent(name, url)
      // Assert: Client created without auth
    });
  });

  describe('Session Scoping', () => {
    it('should maintain separate client instances per agent name', async () => {
      // Arrange: Load two different agents
      // Act: getClient(agent1), getClient(agent2)
      // Assert: Different Client instances returned
    });

    it('should reuse client for same agent name', async () => {
      // Arrange: loadAgent(name, url) called once
      // Act: getClient(name) called twice
      // Assert: Same Client instance returned
    });
  });
});
```

### Test Count Estimate

- Agent Card Loading: 3 tests
- Agent Card Caching: 2 tests
- Error Handling: 2 tests
- Message Sending: 4 tests
- Task Operations: 3 tests
- Vertex AI Dialect Adapter: 3 tests
- Authentication Integration: 3 tests
- Session Scoping: 2 tests

**Total: ~22 behavioral tests**

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 16 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 15a completed by checking:
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P15a-report.md` exists
- `npm run typecheck` succeeds with a2a-client-manager.ts

YOUR TASK:
Create `packages/core/src/agents/__tests__/a2a-client-manager.test.ts` with behavioral tests.

CRITICAL RULES (from RULES.md):
1. **Test Behavior, Not Implementation**: Verify data flows (inputs → outputs), not method calls
2. **Mock External Boundaries Only**: A2A SDK Client is external → mocking HTTP calls via SDK IS appropriate
3. **No Mock Theater**: Do NOT mock A2AClientManager methods themselves
4. **Use Real Objects**: Create actual AgentCard, Message, Task objects from SDK types

TEST STRUCTURE:
8 describe blocks covering:
1. Agent Card Loading (3 tests)
2. Agent Card Caching (2 tests)
3. Error Handling (2 tests)
4. Message Sending (4 tests)
5. Task Operations (3 tests)
6. Vertex AI Dialect Adapter (3 tests)
7. Authentication Integration (3 tests)
8. Session Scoping (2 tests)

EXAMPLE TEST (Agent Card Loading):
```typescript
it('should load agent card from URL and return AgentCard object', async () => {
  // Arrange: Mock SDK Client behavior
  const mockCard: AgentCard = {
    name: 'Test Agent',
    url: 'https://test.example.com/card',
    skills: [{ name: 'analyze', description: 'Analyze code' }],
    capabilities: ['blocking']
  };
  
  // Mock the SDK Client.getAgentCard method
  vi.spyOn(Client.prototype, 'getAgentCard').mockResolvedValue(mockCard);
  
  // Act
  const result = await manager.loadAgent('test-agent', 'https://test.example.com/card');
  
  // Assert
  expect(result.name).toBe('Test Agent');
  expect(result.skills).toHaveLength(1);
  expect(result.skills[0].name).toBe('analyze');
});
```

MOCKING STRATEGY:
- **DO**: Mock SDK Client methods (getAgentCard, sendMessage, getTask, cancelTask)
- **DO**: Mock AuthenticationHandler.headers() for auth tests
- **DO**: Mock fetch behavior in dialect adapter tests
- **DO NOT**: Mock A2AClientManager methods
- **DO NOT**: Mock private fields (clients, agentCards maps)

DELIVERABLES:
- Test file created: packages/core/src/agents/__tests__/a2a-client-manager.test.ts
- ~22 behavioral tests
- All tests tagged with @plan PLAN-20260302-A2A.P16 and relevant @requirement markers
- Tests FAIL against stubs (expected behavior)
- Tests verify data flows, not implementation details

DO NOT:
- Implement A2AClientManager (that's P17)
- Mock A2AClientManager methods (violates RULES.md)
- Test private implementation details
- Skip error handling tests
```

## Verification Commands

### Automated Checks

```bash
# Test file created
ls packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: File exists

# Check plan markers
grep -c "@plan:PLAN-20260302-A2A.P16" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: 8+ occurrences (describe blocks)

# Check requirements covered
grep -E "@requirement:A2A-DISC|@requirement:A2A-EXEC" packages/core/src/agents/__tests__/a2a-client-manager.test.ts | wc -l
# Expected: 6+ occurrences

# Run tests (SHOULD FAIL against stubs)
npm test -- packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: Tests run, most fail (stubs don't implement behavior)

# Check for mock theater violations
grep -E "toHaveBeenCalled|toHaveBeenCalledWith" packages/core/src/agents/__tests__/a2a-client-manager.test.ts | grep "manager\." || echo "OK: No A2AClientManager method mocking"
# Expected: OK (no mocking of manager methods)

# Check test count
grep -c "^\s*it(" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: ~22 tests
```

### Deferred Implementation Detection

```bash
# Check for implementation in test file (should not exist)
grep -E "class A2AClientManager" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: No matches

# Check for TODO comments
grep -E "(TODO|FIXME|HACK)" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: No matches
```

### Semantic Verification Checklist

**Are tests behavioral?**
- [ ] Tests verify outputs given inputs (not method calls)
- [ ] Tests use real SDK types (AgentCard, Message, Task)
- [ ] Tests mock external boundary (SDK Client) not A2AClientManager
- [ ] No mock theater (no manager.method.toHaveBeenCalled)

**Do tests cover all requirements?**
- [ ] A2A-DISC-001: Agent card loading and retrieval
- [ ] A2A-DISC-002: Error handling for failed loads
- [ ] A2A-DISC-003: Agent card caching verification
- [ ] A2A-EXEC-001: Message sending via SDK client
- [ ] A2A-EXEC-005: Task cancellation
- [ ] A2A-EXEC-012: Vertex AI dialect adapter

**Would tests fail if implementation was broken?**
- [ ] If loadAgent didn't cache, caching tests would fail
- [ ] If sendMessage didn't pass contextId, tests would fail
- [ ] If cancelTask threw on error, best-effort test would fail
- [ ] If mapTaskState didn't normalize, adapter tests would fail

**Test quality:**
- [ ] ~22 tests cover all major behaviors
- [ ] Tests are isolated (beforeEach creates fresh manager)
- [ ] Async operations use async/await correctly
- [ ] Error cases tested (network failures, invalid responses)

## Success Criteria

- All verification commands return expected results
- Test file created with ~22 behavioral tests
- All tests tagged with @plan and @requirement markers
- Tests FAIL against stubs (natural failures, not compilation errors)
- No mock theater violations (no mocking manager methods)
- Tests use real SDK types
- Ready for P16a verification

## Failure Recovery

If this phase fails:

1. **Tests pass against stubs**: Tests are not rigorous enough, add assertions
2. **Mock theater found**: Remove mocks of manager methods, mock SDK instead
3. **Compilation errors**: Fix import paths, SDK types
4. **Missing coverage**: Add tests for missing requirements

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P16.md`

Contents:
```markdown
Phase: P16
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/__tests__/a2a-client-manager.test.ts (~400 lines)

Test Suites:
  - Agent Card Loading (3 tests)
  - Agent Card Caching (2 tests)
  - Error Handling (2 tests)
  - Message Sending (4 tests)
  - Task Operations (3 tests)
  - Vertex AI Dialect Adapter (3 tests)
  - Authentication Integration (3 tests)
  - Session Scoping (2 tests)

Total Tests: ~22

Requirements Covered:
  - A2A-DISC-001, A2A-DISC-002, A2A-DISC-003
  - A2A-EXEC-001, A2A-EXEC-005, A2A-EXEC-012

Test Results: [Expected FAIL count]/22 (tests fail naturally against stubs)

Verification: [paste npm test output]

Next Phase: P16a (Verification of P16)
```
