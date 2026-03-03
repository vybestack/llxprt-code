# Phase 21: RemoteAgentInvocation - Stub

## Phase ID

`PLAN-20260302-A2A.P21`

## Prerequisites

- Required: Phases 03-20 completed
- Verification: A2AClientManager exists, AgentRegistry is async
- Expected: a2a-client-manager.ts, registry.ts with registerRemoteAgent method

## Requirements Implemented

### REQ A2A-EXEC-001: Delegate to A2AClientManager

**Full Text**: The system shall delegate remote agent invocations to the A2AClientManager.

**Behavior**:
- GIVEN: A RemoteAgentInvocation is executed
- WHEN: The invocation sends a message to the remote agent
- THEN: It shall call A2AClientManager.sendMessage()
- AND: Shall not directly import or use the A2A SDK Client

**Why This Matters**: Encapsulates all A2A SDK interactions for consistency and testability.

### REQ A2A-EXEC-002: Session State Persistence

**Full Text**: When executing a remote agent invocation, the system shall persist contextId and taskId for conversation continuity.

**Behavior**:
- GIVEN: A first call to a remote agent returns contextId="ctx-1" and taskId="task-1"
- WHEN: A second call is made to the same agent in the same session
- THEN: The system shall include contextId="ctx-1" and taskId="task-1" in the message
- AND: The remote agent shall continue the same conversation/task
- AND: The session state shall be scoped to the runtime session (not global static)
- AND: The session state key shall include both agent name and session ID to prevent collisions

### REQ A2A-EXEC-006: Query Validation

**Full Text**: The system shall validate that remote agent invocations include a non-empty 'query' parameter.

**Why This Matters**: Remote agents require a query/task description to execute.

### REQ A2A-EXEC-009: Input-Required State Handling

**Full Text**: When a remote agent task enters 'input-required' state, the system shall return an error to the LLM indicating the agent is blocked.

**Why This Matters**: LLxprt operates in non-interactive mode and cannot prompt users during remote agent execution. The LLM needs to know the task is blocked.

## Implementation Tasks

### File to Create

**`packages/core/src/agents/remote-invocation.ts`** — RemoteAgentInvocation class

### Stub Implementation

```typescript
/**
 * @plan PLAN-20260302-A2A.P21
 * @requirement A2A-EXEC-001, A2A-EXEC-002, A2A-EXEC-006, A2A-EXEC-009
 */

import { BaseToolInvocation, type ToolResult } from '../tools/tools.js';
import { ToolErrorType } from '../tools/tool-error.js';
import type { AgentInputs } from './types.js';
import type { RemoteAgentDefinition } from './types.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { ToolCallConfirmationDetails } from '../tools/tool-confirmation-types.js';

/**
 * Executes a remote agent via the A2A protocol.
 * @plan PLAN-20260302-A2A.P21
 */
export class RemoteAgentInvocation extends BaseToolInvocation<AgentInputs, ToolResult> {
  private readonly definition: RemoteAgentDefinition;
  private readonly sessionState: Map<string, { contextId?: string; taskId?: string }>;
  
  /**
   * @param params The validated input parameters for the agent.
   * @param definition The remote agent definition.
   * @param sessionState Session-scoped state map for contextId/taskId persistence.
   * @param messageBus Optional message bus for policy enforcement.
   * @param displayName Optional display name for logging.
   */
  constructor(
    params: AgentInputs,
    definition: RemoteAgentDefinition,
    sessionState: Map<string, { contextId?: string; taskId?: string }>,
    messageBus?: MessageBus,
    displayName?: string
  ) {
    super(params, messageBus, definition.name, displayName);
    
    // Stub: basic validation
    if (!params.query || typeof params.query !== 'string' || params.query.trim() === '') {
      // In stub, just store invalid state (will throw in implementation)
    }
    
    this.definition = definition;
    this.sessionState = sessionState;
  }
  
  /**
   * Returns a description of the invocation.
   * @plan PLAN-20260302-A2A.P21
   */
  getDescription(): string {
    const query = this.params.query as string || 'no query';
    return `Remote agent '${this.definition.name}': ${query.slice(0, 100)}`;
  }
  
  /**
   * Executes the remote agent invocation.
   * @plan PLAN-20260302-A2A.P21
   * @requirement A2A-EXEC-001, A2A-EXEC-002, A2A-EXEC-009
   */
  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    // Stub: return empty success
    return {
      llmContent: [{ text: '' }],
      returnDisplay: ''
    };
  }
  
  /**
   * Returns confirmation details for remote agent execution.
   * @plan PLAN-20260302-A2A.P21
   * @requirement A2A-APPR-001, A2A-APPR-002
   */
  protected getConfirmationDetails(): ToolCallConfirmationDetails | null {
    // Stub: return info-level confirmation
    return {
      type: 'info',
      title: `Remote Agent: ${this.definition.displayName || this.definition.name}`,
      prompt: `Invoking remote agent at ${this.definition.agentCardUrl}\n\nWARNING: This will send your query and context to an external service.`,
      previewContent: `Query: ${this.params.query || 'none'}`
    };
  }
}
```

### STUB RULES

1. **Return empty ToolResult** from execute()
2. **NO error throwing** — stubs return dummy success
3. **Constructor validation** — store invalid state, don't throw
4. **NO TODO comments**
5. **Maximum ~100 lines**

## Verification Commands

```bash
# File created
ls -la packages/core/src/agents/remote-invocation.ts
# Expected: file exists

# No forbidden patterns
grep -E "NotYetImplemented|TODO|throw new Error" packages/core/src/agents/remote-invocation.ts
# Expected: no matches (except constructor validation comments)

# TypeScript compiles
npm run typecheck
# Expected: no errors

# Imports resolve
grep "import.*BaseToolInvocation" packages/core/src/agents/remote-invocation.ts
# Expected: import found
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 21 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify phases 03-20 completed:
- grep "@plan:PLAN-20260302-A2A.P17" packages/core/src/agents/a2a-client-manager.ts
- grep "@plan:PLAN-20260302-A2A.P20" packages/core/src/agents/registry.ts

YOUR TASK:
Create packages/core/src/agents/remote-invocation.ts as a STUB.

CLASS STRUCTURE:
- RemoteAgentInvocation extends BaseToolInvocation<AgentInputs, ToolResult>
- Constructor: params, definition (RemoteAgentDefinition), sessionState (Map), messageBus, displayName
- Methods: getDescription(), execute(), getConfirmationDetails()
- Private fields: definition, sessionState

STUB RULES:
1. Constructor: Accept all parameters, store them, no validation throws
2. getDescription(): Return string describing agent and query
3. execute(): Return empty ToolResult { llmContent: [{ text: '' }], returnDisplay: '' }
4. getConfirmationDetails(): Return info-type confirmation with agent name and URL
5. NO actual A2A calls (return stubs)
6. NO error throwing (return empty success)
7. Maximum ~100 lines

DELIVERABLES:
- remote-invocation.ts with stub implementation
- All methods have @plan and @requirement markers
- Compiles with no errors
- Extends BaseToolInvocation correctly

DO NOT:
- Implement actual A2A sendMessage calls (that's P23)
- Add session state retrieval logic (that's P23)
- Handle abort signals (that's P23)
- Throw errors on validation failure (store invalid state)
