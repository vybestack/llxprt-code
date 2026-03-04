# Phase 22: RemoteAgentInvocation - TDD

## Phase ID

`PLAN-20260302-A2A.P22`

## Prerequisites

- Required: Phase 21a (RemoteAgentInvocation Stub Verification) completed
- Verification: `npm run typecheck` succeeds with remote-invocation.ts stub
- Expected files:
  - `packages/core/src/agents/remote-invocation.ts` with stub implementation
  - `packages/core/src/agents/a2a-client-manager.ts` fully implemented (P15-17)
  - `packages/core/src/agents/a2a-utils.ts` fully implemented (P06-08)

## Requirements Implemented (Test Coverage)

### REQ A2A-EXEC-001: Delegate to A2AClientManager (Tests)

**Behavior to Test**:
- RemoteAgentInvocation calls A2AClientManager.sendMessage()
- Does not directly use A2A SDK Client

### REQ A2A-EXEC-002: Session State Persistence (Tests)

**Behavior to Test**:
- First call returns contextId/taskId
- Second call includes previous contextId/taskId
- Session state scoped to agent + session ID

### REQ A2A-EXEC-003: Terminal State Handling (Tests)

**Behavior to Test**:
- Completed task clears taskId, preserves contextId
- Failed task clears taskId
- Canceled task clears taskId
- Working/submitted tasks preserve taskId

### REQ A2A-EXEC-006: Query Validation (Tests)

**Behavior to Test**:
- Constructor throws on empty query
- Constructor throws on missing query

### REQ A2A-EXEC-009: Input-Required State (Tests)

**Behavior to Test**:
- input-required state returns error ToolResult
- Error message indicates agent needs input

### Abort Handling (Tests)

**Behavior to Test**:
- Abort signal cancels remote task
- Cancellation is best-effort

## Implementation Tasks

### File to Create

**`packages/core/src/agents/__tests__/remote-invocation.test.ts`** — Behavioral tests

### Test Implementation

```typescript
/**
 * @plan PLAN-20260302-A2A.P22
 * @requirement A2A-EXEC-001, A2A-EXEC-002, A2A-EXEC-003, A2A-EXEC-006, A2A-EXEC-009
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RemoteAgentInvocation } from '../remote-invocation.js';
import type { RemoteAgentDefinition, AgentInputs } from '../types.js';
import { A2AClientManager } from '../a2a-client-manager.js';
import type { Message, Task } from '@a2a-js/sdk';
import { ToolErrorType } from '../../tools/tool-error.js';

describe('RemoteAgentInvocation @plan PLAN-20260302-A2A.P22', () => {
  let definition: RemoteAgentDefinition;
  let sessionState: Map<string, { contextId?: string; taskId?: string }>;
  
  beforeEach(() => {
    definition = {
      kind: 'remote',
      name: 'test-agent',
      description: 'Test remote agent',
      inputConfig: { 
        inputs: {
          query: {
            description: 'The query to send to the remote agent',
            type: 'string',
            required: true
          }
        }
      },
      agentCardUrl: 'https://example.com/card'
    };
    
    sessionState = new Map();
  });
  
  /**
   * @requirement A2A-EXEC-006
   */
  describe('Query Validation', () => {
    it('should throw on missing query', () => {
      const params = {} as AgentInputs;
      
      expect(() => {
        new RemoteAgentInvocation(params, definition, sessionState);
      }).toThrow(/query/i);
    });
    
    it('should throw on empty query', () => {
      const params = { query: '' } as AgentInputs;
      
      expect(() => {
        new RemoteAgentInvocation(params, definition, sessionState);
      }).toThrow(/query/i);
    });
    
    it('should accept valid query', () => {
      const params = { query: 'test query' } as AgentInputs;
      
      expect(() => {
        new RemoteAgentInvocation(params, definition, sessionState);
      }).not.toThrow();
    });
  });
  
  /**
   * @requirement A2A-EXEC-001
   */
  describe('A2AClientManager Delegation', () => {
    it('should create A2AClientManager and send message', async () => {
      const params = { query: 'test query' } as AgentInputs;
      const invocation = new RemoteAgentInvocation(params, definition, sessionState);
      
      // Mock A2AClientManager behavior
      const mockMessage: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-1',
        contextId: 'ctx-1',
        parts: [{ kind: 'text', text: 'Response' }]
      };
      
      // Spy on A2AClientManager (behavioral test: verify message sent)
      const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage');
      sendMessageSpy.mockResolvedValue(mockMessage);
      
      const signal = new AbortController().signal;
      const result = await invocation.execute(signal);
      
      expect(sendMessageSpy).toHaveBeenCalledWith(
        'test-agent',
        'test query',
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      );
      
      expect(result.llmContent[0].text).toContain('Response');
      
      sendMessageSpy.mockRestore();
    });
  });
  
  /**
   * @requirement A2A-EXEC-002
   */
  describe('Session State Persistence', () => {
    it('should persist contextId and taskId across calls', async () => {
      const params = { query: 'first query' } as AgentInputs;
      const invocation1 = new RemoteAgentInvocation(params, definition, sessionState);
      
      // First call returns contextId and taskId
      const mockMessage1: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-1',
        contextId: 'ctx-1',
        taskId: 'task-1',
        parts: [{ kind: 'text', text: 'First response' }]
      };
      
      const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage');
      sendMessageSpy.mockResolvedValue(mockMessage1);
      
      const signal = new AbortController().signal;
      await invocation1.execute(signal);
      
      // Verify session state stored
      // NOTE: Actual session key construction will be in implementation
      // Test checks that state was stored with some key containing agent name
      const storedKeys = Array.from(sessionState.keys());
      const sessionKey = storedKeys.find(k => k.includes('test-agent'));
      expect(sessionKey).toBeDefined();
      expect(sessionState.get(sessionKey!)).toEqual({
        contextId: 'ctx-1',
        taskId: 'task-1'
      });
      
      // Second call to same agent
      const params2 = { query: 'second query' } as AgentInputs;
      const invocation2 = new RemoteAgentInvocation(params2, definition, sessionState);
      
      const mockMessage2: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-2',
        contextId: 'ctx-1',
        taskId: 'task-1',
        parts: [{ kind: 'text', text: 'Second response' }]
      };
      
      sendMessageSpy.mockResolvedValue(mockMessage2);
      
      await invocation2.execute(signal);
      
      // Verify contextId and taskId included in second call
      expect(sendMessageSpy).toHaveBeenNthCalledWith(2,
        'test-agent',
        'second query',
        expect.objectContaining({
          contextId: 'ctx-1',
          taskId: 'task-1'
        })
      );
      
      sendMessageSpy.mockRestore();
    });
  });
  
  /**
   * @requirement A2A-EXEC-003
   */
  describe('Terminal State Handling', () => {
    it('should clear taskId on completed task', async () => {
      const params = { query: 'test query' } as AgentInputs;
      const invocation = new RemoteAgentInvocation(params, definition, sessionState);
      
      const mockTask: Task = {
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: {
          state: 'completed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: 'msg-1',
            parts: [{ kind: 'text', text: 'Done' }]
          }
        }
      };
      
      const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage');
      sendMessageSpy.mockResolvedValue(mockTask);
      
      const signal = new AbortController().signal;
      await invocation.execute(signal);
      
      // Verify taskId cleared (contextId preserved)
      const storedKeys = Array.from(sessionState.keys());
      const sessionKey = storedKeys.find(k => k.includes('test-agent'));
      expect(sessionKey).toBeDefined();
      const state = sessionState.get(sessionKey!);
      expect(state?.contextId).toBe('ctx-1');
      expect(state?.taskId).toBeUndefined();
      
      sendMessageSpy.mockRestore();
    });
    
    it('should clear taskId on failed task', async () => {
      const params = { query: 'test query' } as AgentInputs;
      const invocation = new RemoteAgentInvocation(params, definition, sessionState);
      
      const mockTask: Task = {
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: {
          state: 'failed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: 'msg-1',
            parts: [{ kind: 'text', text: 'Error' }]
          }
        }
      };
      
      const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage');
      sendMessageSpy.mockResolvedValue(mockTask);
      
      const signal = new AbortController().signal;
      const result = await invocation.execute(signal);
      
      // Verify taskId cleared
      const storedKeys = Array.from(sessionState.keys());
      const sessionKey = storedKeys.find(k => k.includes('test-agent'));
      expect(sessionKey).toBeDefined();
      const state = sessionState.get(sessionKey!);
      expect(state?.contextId).toBe('ctx-1');
      expect(state?.taskId).toBeUndefined();
      
      // Failed task should include error
      expect(result.error).toBeDefined();
      
      sendMessageSpy.mockRestore();
    });
    
    it('should preserve taskId on working task', async () => {
      const params = { query: 'test query' } as AgentInputs;
      const invocation = new RemoteAgentInvocation(params, definition, sessionState);
      
      const mockTask: Task = {
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: {
          state: 'working'
        }
      };
      
      const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage');
      sendMessageSpy.mockResolvedValue(mockTask);
      
      const signal = new AbortController().signal;
      await invocation.execute(signal);
      
      // Verify taskId preserved
      const storedKeys = Array.from(sessionState.keys());
      const sessionKey = storedKeys.find(k => k.includes('test-agent'));
      expect(sessionKey).toBeDefined();
      const state = sessionState.get(sessionKey!);
      expect(state?.contextId).toBe('ctx-1');
      expect(state?.taskId).toBe('task-1');
      
      sendMessageSpy.mockRestore();
    });
  });
  
  /**
   * @requirement A2A-EXEC-009
   */
  describe('Input-Required State Handling', () => {
    it('should return error on input-required state', async () => {
      const params = { query: 'test query' } as AgentInputs;
      const invocation = new RemoteAgentInvocation(params, definition, sessionState);
      
      const mockTask: Task = {
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: {
          state: 'input-required',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: 'msg-1',
            parts: [{ kind: 'text', text: 'Need user input' }]
          }
        }
      };
      
      const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage');
      sendMessageSpy.mockResolvedValue(mockTask);
      
      const signal = new AbortController().signal;
      const result = await invocation.execute(signal);
      
      // Verify error returned
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.llmContent[0].text).toContain('input');
      
      sendMessageSpy.mockRestore();
    });
  });
  
  describe('Abort Handling', () => {
    it('should cancel task on abort', async () => {
      const params = { query: 'test query' } as AgentInputs;
      const invocation = new RemoteAgentInvocation(params, definition, sessionState);
      
      // Set up session state with taskId (using agent name as key for test)
      const sessionKey = 'test-agent#test-session';
      sessionState.set(sessionKey, { contextId: 'ctx-1', taskId: 'task-1' });
      
      const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage');
      const cancelTaskSpy = vi.spyOn(A2AClientManager.prototype, 'cancelTask');
      
      // Simulate abort during sendMessage
      sendMessageSpy.mockRejectedValue(new Error('Aborted'));
      cancelTaskSpy.mockResolvedValue({
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'canceled' }
      });
      
      const controller = new AbortController();
      controller.abort();
      
      const result = await invocation.execute(controller.signal);
      
      // Verify cancellation attempted
      expect(cancelTaskSpy).toHaveBeenCalledWith('test-agent', 'task-1');
      
      // Verify error returned
      expect(result.error).toBeDefined();
      
      sendMessageSpy.mockRestore();
      cancelTaskSpy.mockRestore();
    });
  });
  
  describe('Text Extraction', () => {
    it('should extract text from Message response', async () => {
      const params = { query: 'test query' } as AgentInputs;
      const invocation = new RemoteAgentInvocation(params, definition, sessionState);
      
      const mockMessage: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-1',
        parts: [{ kind: 'text', text: 'Hello, world!' }]
      };
      
      const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage');
      sendMessageSpy.mockResolvedValue(mockMessage);
      
      const signal = new AbortController().signal;
      const result = await invocation.execute(signal);
      
      expect(result.llmContent[0].text).toBe('Hello, world!');
      
      sendMessageSpy.mockRestore();
    });
    
    it('should extract text from Task response', async () => {
      const params = { query: 'test query' } as AgentInputs;
      const invocation = new RemoteAgentInvocation(params, definition, sessionState);
      
      const mockTask: Task = {
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: {
          state: 'completed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: 'msg-1',
            parts: [{ kind: 'text', text: 'Task completed' }]
          }
        }
      };
      
      const sendMessageSpy = vi.spyOn(A2AClientManager.prototype, 'sendMessage');
      sendMessageSpy.mockResolvedValue(mockTask);
      
      const signal = new AbortController().signal;
      const result = await invocation.execute(signal);
      
      expect(result.llmContent[0].text).toContain('Task [task-1]: completed');
      expect(result.llmContent[0].text).toContain('Task completed');
      
      sendMessageSpy.mockRestore();
    });
  });
});
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 22 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 21a completed by checking:
- `npm run typecheck` succeeds
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P21a-report.md` exists

YOUR TASK:
Create `packages/core/src/agents/__tests__/remote-invocation.test.ts` with behavioral tests.

TEST COVERAGE:
1. Query Validation (A2A-EXEC-006):
   - Throw on missing query
   - Throw on empty query
   - Accept valid query

2. A2AClientManager Delegation (A2A-EXEC-001):
   - Verify sendMessage called
   - Verify message sent to correct agent
   - Verify query passed correctly

3. Session State Persistence (A2A-EXEC-002):
   - First call stores contextId/taskId
   - Second call includes previous IDs
   - Session key includes agent name + session ID

4. Terminal State Handling (A2A-EXEC-003):
   - completed: clear taskId, preserve contextId
   - failed: clear taskId, return error
   - canceled: clear taskId
   - working: preserve taskId

5. Input-Required State (A2A-EXEC-009):
   - Return error ToolResult
   - Error message indicates input needed

6. Abort Handling:
   - Cancel task on abort
   - Best-effort cancellation

7. Text Extraction:
   - Extract from Message
   - Extract from Task (formatted)

TESTING APPROACH:
- Use vitest spies for A2AClientManager methods (behavioral)
- Mock return values (Message/Task objects)
- Verify data flows (params in → result out)
- No mock theater (test actual behavior)

DELIVERABLES:
- remote-invocation.test.ts with 12 tests (3 validation, 1 delegation, 1 session state, 3 terminal state, 1 input-required, 1 abort, 2 text extraction)
- Tests FAIL against P21 stub (expected)
- Tests cover all requirements
- No mock theater
- Ready for P23 implementation

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P22.md`

Contents:
```markdown
Phase: P22
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/__tests__/remote-invocation.test.ts (~400 lines)

Tests Added: 12 (3 query validation, 1 delegation, 1 session state, 3 terminal states, 1 input-required, 1 abort, 2 text extraction)
Test Results: FAIL (expected against P21 stub)

Verification: [paste npm test output showing failures]

Next Phase: P22a (Verification of P22)
```
