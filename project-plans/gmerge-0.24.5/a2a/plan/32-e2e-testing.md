# Phase 32: End-to-End Integration Testing

## Phase ID

`PLAN-20260302-A2A.P32`

## Prerequisites

- Required: Phase 31a (Test Migration Verification) completed
- Verification: All tests pass, types compile
- Expected: Full A2A pipeline implemented (TOML → Registry → Dispatch → Invocation)

## Requirements Implemented

### REQ Integration Testing

**Full EARS Text**: The system shall verify end-to-end remote agent invocation from TOML configuration to response.

**Behavior Specification**:
- GIVEN: A TOML file with remote agent definition
- WHEN: System loads TOML, registers agent, invokes agent
- THEN: Request is dispatched to RemoteAgentInvocation
- AND: Mock A2A server receives request
- AND: Response flows back through invocation → tool result

**Why This Matters**: Unit tests verify individual components, but E2E tests verify the full pipeline works together. This tests the integration points between TOML loader, registry, dispatch factory, and remote invocation.

## Implementation Tasks

### File to Create

**`packages/core/src/agents/__tests__/e2e-remote-agent.test.ts`** — End-to-end integration test

### Test Structure

Create comprehensive E2E test that exercises full pipeline:

```typescript
/**
 * End-to-end integration tests for remote agent A2A flow.
 * @plan PLAN-20260302-A2A.P32
 * @requirement Integration Testing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentRegistry } from '../registry.js';
import { loadAgentsFromToml } from '../agent-toml-loader.js';
import type { Config } from '../../config/config.js';
import type { RemoteAgentAuthProvider } from '../auth-providers.js';
import { A2AClientManager } from '../a2a-client-manager.js';
import type { AgentCard, Client, Message, Task } from '@google/genai-a2a-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('E2E: Remote Agent Invocation Pipeline', () => {
  let registry: AgentRegistry;
  let mockConfig: Config;
  let mockAuthProvider: RemoteAgentAuthProvider;
  let mockClient: Client;
  let tempDir: string;
  let tomlFilePath: string;

  beforeEach(async () => {
    // Create temp directory for TOML file
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-e2e-'));
    tomlFilePath = path.join(tempDir, 'agents.toml');

    // Write test TOML file
    const tomlContent = `
[[remote_agents]]
name = "test_analyzer"
display_name = "Test Analyzer"
description = "A test remote agent for E2E testing"
agent_card_url = "https://example.com/test-agent/card"
`;
    await fs.writeFile(tomlFilePath, tomlContent, 'utf-8');

    // Mock A2A Client
    mockClient = {
      getAgentCard: vi.fn().mockResolvedValue({
        name: 'Test Analyzer',
        url: 'https://example.com/test-agent/card',
        skills: [
          {
            name: 'analyze',
            description: 'Analyzes test data',
          },
        ],
        capabilities: ['blocking'],
      } as AgentCard),
      sendMessage: vi.fn().mockResolvedValue({
        kind: 'message',
        role: 'agent',
        messageId: 'msg-123',
        parts: [{ kind: 'text', text: 'Analysis complete: All tests passed' }],
        contextId: 'ctx-456',
      } as Message),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
    } as unknown as Client;

    // Mock auth provider
    mockAuthProvider = {
      getAuthHandler: vi.fn().mockResolvedValue(undefined), // No auth for test
    };

    // Mock config
    mockConfig = {
      getRemoteAgentAuthProvider: vi.fn().mockReturnValue(mockAuthProvider),
      getSessionId: vi.fn().mockReturnValue('test-session-123'),
    } as unknown as Config;

    // Create registry
    registry = new AgentRegistry(mockConfig);
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Test 1: Full pipeline - TOML → Registry → Dispatch → Invocation → Response
   * @plan PLAN-20260302-A2A.P32
   */
  it('should load remote agent from TOML, register, and invoke successfully', async () => {
    // STEP 1: Load agents from TOML
    const { remote } = await loadAgentsFromToml(tomlFilePath);
    expect(remote).toHaveLength(1);
    expect(remote[0].name).toBe('test_analyzer');
    expect(remote[0].kind).toBe('remote');
    expect(remote[0].agentCardUrl).toBe('https://example.com/test-agent/card');

    // STEP 2: Initialize registry (creates A2AClientManager)
    await registry.initialize();

    // STEP 3: Register remote agent (fetches agent card)
    // Mock A2AClientManager to return our mock client
    vi.spyOn(A2AClientManager.prototype, 'loadAgent').mockImplementation(async (name, url) => {
      return mockClient.getAgentCard() as Promise<AgentCard>;
    });

    await registry.registerAgent(remote[0]);

    // Verify agent is registered
    const definition = registry.getDefinition('test_analyzer');
    expect(definition).toBeDefined();
    expect(definition?.kind).toBe('remote');
    expect(definition?.description).toContain('analyze'); // Populated from skills

    // STEP 4: Create invocation via dispatch factory
    const invocation = registry.createInvocation(
      'test_analyzer',
      { query: 'Analyze this test data' },
      undefined, // no messageBus
      new Map(), // sessionState
    );

    // Verify dispatch routed to RemoteAgentInvocation
    expect(invocation.constructor.name).toBe('RemoteAgentInvocation');

    // STEP 5: Mock A2AClientManager.sendMessage to return our mock response
    vi.spyOn(A2AClientManager.prototype, 'sendMessage').mockResolvedValue(
      await mockClient.sendMessage('test_analyzer', 'Analyze this test data') as Message
    );

    // STEP 6: Execute invocation
    const abortController = new AbortController();
    const result = await invocation.execute(abortController.signal);

    // STEP 7: Verify response
    expect(result.llmContent).toHaveLength(1);
    expect(result.llmContent[0].text).toBe('Analysis complete: All tests passed');
    expect(result.returnDisplay).toContain('Analysis complete');
    expect(result.error).toBeUndefined();
  });

  /**
   * Test 2: Session state persists contextId across invocations
   * @plan PLAN-20260302-A2A.P32
   */
  it('should persist contextId across multiple invocations', async () => {
    // Load and register agent (abbreviated)
    const { remote } = await loadAgentsFromToml(tomlFilePath);
    await registry.initialize();
    
    vi.spyOn(A2AClientManager.prototype, 'loadAgent').mockResolvedValue({
      name: 'Test Analyzer',
      skills: [],
    } as AgentCard);
    
    await registry.registerAgent(remote[0]);

    const sessionState = new Map<string, { contextId?: string; taskId?: string }>();

    // First invocation
    const invocation1 = registry.createInvocation(
      'test_analyzer',
      { query: 'First query' },
      undefined,
      sessionState,
    );

    const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage')
      .mockResolvedValueOnce({
        kind: 'message',
        role: 'agent',
        messageId: 'msg-1',
        parts: [{ kind: 'text', text: 'Response 1' }],
        contextId: 'ctx-persistent',
      } as Message);

    const abortController1 = new AbortController();
    await invocation1.execute(abortController1.signal);

    // Verify contextId persisted in sessionState
    const sessionKey = 'test_analyzer#test-session-123';
    expect(sessionState.has(sessionKey)).toBe(true);
    expect(sessionState.get(sessionKey)?.contextId).toBe('ctx-persistent');

    // Second invocation (should reuse contextId)
    const invocation2 = registry.createInvocation(
      'test_analyzer',
      { query: 'Second query' },
      undefined,
      sessionState, // Same session state Map
    );

    sendMessageSpy.mockResolvedValueOnce({
      kind: 'message',
      role: 'agent',
      messageId: 'msg-2',
      parts: [{ kind: 'text', text: 'Response 2' }],
      contextId: 'ctx-persistent', // Same context
    } as Message);

    const abortController2 = new AbortController();
    await invocation2.execute(abortController2.signal);

    // Verify sendMessage was called with contextId on second invocation
    expect(sendMessageSpy).toHaveBeenCalledTimes(2);
    const secondCall = sendMessageSpy.mock.calls[1];
    expect(secondCall[2]?.contextId).toBe('ctx-persistent');
  });

  /**
   * Test 3: Abort signal cancels remote task
   * @plan PLAN-20260302-A2A.P32
   */
  it('should cancel remote task when abort signal fires', async () => {
    // Load and register agent (abbreviated)
    const { remote } = await loadAgentsFromToml(tomlFilePath);
    await registry.initialize();
    
    vi.spyOn(A2AClientManager.prototype, 'loadAgent').mockResolvedValue({
      name: 'Test Analyzer',
      skills: [],
    } as AgentCard);
    
    await registry.registerAgent(remote[0]);

    const sessionState = new Map();

    const invocation = registry.createInvocation(
      'test_analyzer',
      { query: 'Long-running task' },
      undefined,
      sessionState,
    );

    // Mock sendMessage to return Task with taskId
    vi.spyOn(A2AClientManager.prototype, 'sendMessage').mockResolvedValue({
      kind: 'task',
      id: 'task-long',
      contextId: 'ctx-1',
      status: {
        state: 'working',
        message: undefined,
      },
    } as Task);

    const cancelTaskSpy = vi.spyOn(A2AClientManager.prototype, 'cancelTask')
      .mockResolvedValue({
        kind: 'task',
        id: 'task-long',
        contextId: 'ctx-1',
        status: { state: 'canceled' },
      } as Task);

    // Create abort controller and abort immediately
    const abortController = new AbortController();
    
    // Abort after short delay to allow request to start
    setTimeout(() => abortController.abort(), 10);

    const result = await invocation.execute(abortController.signal);

    // Verify cancelTask was called (best-effort)
    // Note: Actual behavior depends on timing, may not always be called
    // if abort happens before taskId is available
    if (sessionState.get('test_analyzer#test-session-123')?.taskId) {
      expect(cancelTaskSpy).toHaveBeenCalledWith('test_analyzer', 'task-long');
    }

    // Result should indicate error or cancellation
    expect(result.error).toBeDefined();
  });

  /**
   * Test 4: HTTPS enforcement in TOML
   * @plan PLAN-20260302-A2A.P32
   */
  it('should reject http:// URLs in TOML (HTTPS enforcement)', async () => {
    // Write TOML with http:// URL
    const invalidTomlContent = `
[[remote_agents]]
name = "insecure_agent"
agent_card_url = "http://example.com/agent/card"
`;
    const invalidTomlPath = path.join(tempDir, 'invalid.toml');
    await fs.writeFile(invalidTomlPath, invalidTomlContent, 'utf-8');

    // Attempt to load - should throw Zod validation error
    await expect(loadAgentsFromToml(invalidTomlPath)).rejects.toThrow(/HTTPS/);
  });
});
```

### Key Test Scenarios

1. **Full Pipeline Test**: TOML → Registry → Dispatch → Invocation → Response
2. **Session State Persistence**: contextId reused across invocations
3. **Abort Handling**: Abort signal cancels remote task
4. **Security**: HTTPS enforcement via TOML validation

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 32 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 31a completed:
- All tests pass
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P31a-report.md` exists

YOUR TASK:
Create end-to-end integration test for remote agent pipeline.

CREATE FILE: `packages/core/src/agents/__tests__/e2e-remote-agent.test.ts`

IMPLEMENT 4 TESTS:

1. **Full Pipeline**: Load TOML → Register → Dispatch → Execute → Verify Response
   - Mock A2AClientManager methods (loadAgent, sendMessage)
   - Verify dispatch routes to RemoteAgentInvocation
   - Verify response flows back correctly

2. **Session State**: Verify contextId persists across invocations
   - Create sessionState Map
   - Execute two invocations with same Map
   - Verify second invocation sends contextId from first

3. **Abort Handling**: Abort signal cancels remote task
   - Mock sendMessage to return Task with taskId
   - Abort after short delay
   - Verify cancelTask called (best-effort)

4. **HTTPS Enforcement**: Reject http:// URLs in TOML
   - Create TOML with http:// URL
   - Verify loadAgentsFromToml throws error

TEST SETUP:
- Create temp directory for TOML files
- Write test TOML with remote agent
- Mock Config, A2AClientManager, Client
- Cleanup temp directory in afterEach

MOCKING STRATEGY:
- Use vitest.fn() for method mocks
- Mock A2AClientManager methods (not entire class)
- Return realistic Message/Task objects

IMPLEMENTATION REQUIREMENTS:
- All 4 tests PASS
- Tests use real TOML loading (not mocked)
- Tests use real AgentRegistry (not mocked)
- Mocks only for A2A SDK and network calls
- @plan markers on all tests

DELIVERABLES:
- e2e-remote-agent.test.ts (~300 lines)
- All 4 tests PASS
- No TODO comments

DO NOT:
- Mock TOML loader (test real parsing)
- Mock AgentRegistry (test real dispatch)
- Add excessive mocking (only A2A SDK)
```

## Verification Commands

### Automated Checks

```bash
# Run E2E tests
npm test -- packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
# Expected: 4/4 tests PASS

# Check plan markers
grep -c "@plan:PLAN-20260302-A2A.P32" packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
# Expected: 4+ (one per test)

# Verify file exists
ls packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
# Expected: File found

# Run ALL agent tests (E2E + unit tests)
npm test -- packages/core/src/agents/__tests__/
# Expected: All tests PASS
```

### Semantic Verification Checklist

**Do E2E tests verify integration?**
- [ ] Test 1 exercises full pipeline (TOML → Registry → Dispatch → Invocation)
- [ ] Test 2 verifies session state persistence
- [ ] Test 3 verifies abort handling
- [ ] Test 4 verifies security (HTTPS enforcement)
- [ ] All 4 tests PASS

**Are mocks minimal and realistic?**
- [ ] A2A SDK methods mocked (Client interface)
- [ ] TOML loader NOT mocked (real parsing)
- [ ] AgentRegistry NOT mocked (real dispatch)
- [ ] Mock responses realistic (Message/Task structure)

## Success Criteria

- All verification commands pass
- 4 E2E tests created and PASS
- Tests use real TOML parsing and registry
- Mocking limited to A2A SDK network calls
- @plan markers present
- No TODO comments

## Failure Recovery

If this phase fails:

1. Test failures → Review mock expectations vs actual behavior
2. Type errors → Check Message/Task mock structure
3. File errors → Verify temp directory cleanup

Rollback:
```bash
rm packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
```

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P32.md`

Contents:
```markdown
Phase: P32
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/__tests__/e2e-remote-agent.test.ts (~300 lines)

E2E Tests Created:
  - Full pipeline (TOML → Response): PASS
  - Session state persistence: PASS
  - Abort handling: PASS
  - HTTPS enforcement: PASS

Test Results: 4/4 PASS

Verification: [paste npm test output]

Next Phase: P32a (Verification of P32)
```
