# Phase 23: RemoteAgentInvocation - Implementation

## Phase ID

`PLAN-20260302-A2A.P23`

## Prerequisites

- Required: Phase 22a (RemoteAgentInvocation TDD Verification) completed
- Verification: `npm test -- packages/core/src/agents/__tests__/remote-invocation.test.ts` shows tests FAIL against stub
- Expected files: remote-invocation.ts (stub), remote-invocation.test.ts (tests), a2a-client-manager.ts (implemented), a2a-utils.ts (implemented)

## Requirements Implemented

ALL requirements from P21-22 (full implementation).

## Implementation Tasks

### File to Modify

**`packages/core/src/agents/remote-invocation.ts`** — Implement full RemoteAgentInvocation

### Implementation Strategy

Follow SubagentInvocation pattern from invocation.ts. Key differences:
- Uses A2AClientManager instead of AgentExecutor
- Session state for contextId/taskId persistence
- SDK blocking mode for task completion
- Error handling for input-required state

### Full Implementation

Replace execute() stub with complete implementation:

```typescript
import { BaseToolInvocation, type ToolResult } from '../tools/tools.js';
import { ToolErrorType } from '../tools/tool-error.js';
import type { AgentInputs } from './types.js';
import type { RemoteAgentDefinition } from './types.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { ToolCallConfirmationDetails } from '../tools/tool-confirmation-types.js';
import { A2AClientManager } from './a2a-client-manager.js';
import { extractMessageText, extractTaskText, extractIdsFromResponse } from './a2a-utils.js';
import type { Config } from '../config/config.js';

/**
 * Executes a remote agent via the A2A protocol.
 * @plan PLAN-20260302-A2A.P23
 */
export class RemoteAgentInvocation extends BaseToolInvocation<AgentInputs, ToolResult> {
  private readonly definition: RemoteAgentDefinition;
  private readonly sessionState: Map<string, { contextId?: string; taskId?: string }>;
  private readonly config: Config;
  
  constructor(
    params: AgentInputs,
    definition: RemoteAgentDefinition,
    sessionState: Map<string, { contextId?: string; taskId?: string }>,
    config: Config,
    messageBus?: MessageBus,
    displayName?: string
  ) {
    super(params, messageBus, definition.name, displayName);
    
    // Validation
    if (!params.query || typeof params.query !== 'string' || params.query.trim() === '') {
      throw new Error('RemoteAgentInvocation requires non-empty query parameter');
    }
    
    this.definition = definition;
    this.sessionState = sessionState;
    this.config = config;
  }
  
  getDescription(): string {
    const query = this.params.query as string || 'no query';
    return `Remote agent '${this.definition.name}': ${query.slice(0, 100)}`;
  }
  
  /**
   * @plan PLAN-20260302-A2A.P23
   * @requirement A2A-EXEC-001, A2A-EXEC-002, A2A-EXEC-009, A2A-EXEC-010
   */
  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    try {
      // Create A2AClientManager instance
      const authProvider = this.config.getRemoteAgentAuthProvider?.();
      const clientManager = new A2AClientManager(authProvider);
      
      // Lazy load agent
      if (!clientManager.getClient(this.definition.name)) {
        await clientManager.loadAgent(this.definition.name, this.definition.agentCardUrl);
      }
      
      // Retrieve session state
      const sessionId = this.config.getSessionId?.() || 'default';
      const sessionKey = `${this.definition.name}#${sessionId}`;
      const state = this.sessionState.get(sessionKey) || {};
      
      if (updateOutput) {
        updateOutput(`Contacting remote agent '${this.definition.name}'...\\n`);
      }
      
      // Send message with SDK blocking mode
      const result = await clientManager.sendMessage(
        this.definition.name,
        this.params.query as string,
        {
          contextId: state.contextId,
          taskId: state.taskId,
          signal
        }
      );
      
      // Extract and persist IDs
      const { contextId, taskId } = extractIdsFromResponse(result);
      this.sessionState.set(sessionKey, { contextId, taskId });
      
      // Handle input-required state
      if (result.kind === 'task' && result.status.state === 'input-required') {
        const errorMsg = `Remote agent paused and requires user input: ${extractTaskText(result)}`;
        return {
          llmContent: [{ text: errorMsg }],
          returnDisplay: errorMsg,
          error: {
            message: 'Agent requires user input',
            type: ToolErrorType.EXECUTION_FAILED
          }
        };
      }
      
      // Extract text
      const text = result.kind === 'message' 
        ? extractMessageText(result)
        : extractTaskText(result);
      
      if (updateOutput) {
        updateOutput(`\\nRemote agent completed.\\n`);
      }
      
      return {
        llmContent: [{ text }],
        returnDisplay: text
      };
    } catch (error) {
      // Check if error is due to abort
      if (signal.aborted) {
        // Best-effort cancellation
        const sessionId = this.config.getSessionId?.() || 'default';
        const sessionKey = `${this.definition.name}#${sessionId}`;
        const state = this.sessionState.get(sessionKey);
        
        if (state?.taskId) {
          try {
            const authProvider = this.config.getRemoteAgentAuthProvider?.();
            const clientManager = new A2AClientManager(authProvider);
            await clientManager.cancelTask(this.definition.name, state.taskId);
          } catch {
            // Ignore cancellation errors
          }
        }
        
        // Clear taskId on abort
        if (state) {
          this.sessionState.set(sessionKey, {
            contextId: state.contextId,
            taskId: undefined
          });
        }
      }
      
      return {
        llmContent: [{ text: `Remote agent '${this.definition.name}' failed: ${error}` }],
        returnDisplay: `Remote agent failed: ${error}`,
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: ToolErrorType.EXECUTION_FAILED
        }
      };
    }
  }
  
  protected getConfirmationDetails(): ToolCallConfirmationDetails | null {
    return {
      type: 'info',
      title: `Remote Agent: ${this.definition.displayName || this.definition.name}`,
      prompt: `Invoking remote agent at ${this.definition.agentCardUrl}\\n\\nWARNING: This will send your query and context to an external service.`,
      previewContent: `Query: ${this.params.query || 'none'}`
    };
  }
}
```

### Key Changes from Stub

1. **Constructor**: Add Config parameter, add query validation (throw on empty)
2. **execute()**:
   - Create A2AClientManager instance
   - Lazy load agent if needed
   - Retrieve session state from Map
   - Send message with contextId/taskId/signal
   - Extract IDs from response and persist
   - Handle input-required state (return error)
   - Extract text using a2a-utils
   - Error handling: abort → cancel task, clear taskId
3. **Abort handling**: try/catch in finally block, best-effort cancellation

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 23 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 22a completed: tests exist and fail against stub.

YOUR TASK:
Implement full RemoteAgentInvocation.execute() to make all 15+ tests pass.

REFERENCE:
- SubagentInvocation pattern (invocation.ts)
- A2AClientManager usage (a2a-client-manager.ts)
- Text extraction (a2a-utils.ts)

KEY IMPLEMENTATIONS:
1. Constructor: Add Config param, validate query (throw if empty)
2. execute():
   - Create A2AClientManager (auth from config)
   - Lazy load agent via clientManager.loadAgent
   - Get session state from Map (key: name#sessionId)
   - Call clientManager.sendMessage with contextId/taskId/signal
   - Extract IDs via extractIdsFromResponse, persist to sessionState
   - Handle input-required: return error ToolResult
   - Extract text via extractMessageText/extractTaskText
   - Error handling: if aborted, cancel task, clear taskId
   - Return ToolResult with text or error

DELIVERABLES:
- remote-invocation.ts fully implemented
- All 15+ tests PASS
- @plan markers updated to P23
- No TODO comments

DO NOT:
- Implement explicit polling (SDK blocking mode handles it)
- Change SubagentInvocation (separate class)
```

## Verification Commands

```bash
# Run ALL tests (MUST PASS)
npm test -- packages/core/src/agents/__tests__/remote-invocation.test.ts

# Type check
npm run typecheck

# No TODO
grep -E "(TODO|FIXME|HACK|STUB)" packages/core/src/agents/remote-invocation.ts
```

## Success Criteria

- All 15+ tests PASS
- TypeScript compiles
- @plan markers updated to P23
- No TODO comments

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P23.md`

Contents:
```markdown
Phase: P23
Completed: [timestamp]
Files Modified: remote-invocation.ts

Test Results: All 15+ tests PASS

Next Phase: P23a (Verification)
```
