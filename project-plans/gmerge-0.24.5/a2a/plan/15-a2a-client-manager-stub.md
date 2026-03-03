# Phase 15: A2A Client Manager - Stub

## Phase ID

`PLAN-20260302-A2A.P15`

## Prerequisites

- Required: Phase 14a (Google ADC Implementation Verification) completed
- Verification: `npm test -- packages/core/src/agents/__tests__/auth-providers.test.ts` all tests PASS (15 tests)
- Expected files:
  - `packages/core/src/agents/auth-providers.ts` with RemoteAgentAuthProvider, NoAuthProvider, GoogleADCAuthProvider
  - `packages/core/src/agents/a2a-utils.ts` with text extraction functions
  - `packages/core/src/agents/types.ts` with discriminated union types
- **NEW DEPENDENCY**: Must add `@a2a-js/sdk` to package.json BEFORE starting this phase

## Requirements Implemented

### REQ A2A-DISC-001: Agent Card Discovery

**Full Text**: The system shall support discovering remote agents via agent card URLs.

**Behavior**:
- GIVEN: A valid HTTPS agent card URL
- WHEN: The system fetches the agent card via A2A SDK
- THEN: It shall retrieve an AgentCard object with name, skills, and capabilities
- AND: The AgentCard shall be cached for the session

**Why This Matters**: Agent cards are the standard A2A protocol mechanism for describing agent capabilities. Caching prevents redundant network requests.

### REQ A2A-DISC-002: Error Handling

**Full Text**: When an agent card fetch fails, the system shall log an error and skip registration without blocking initialization.

### REQ A2A-DISC-003: Agent Card Caching

**Full Text**: The system shall cache fetched agent cards to avoid redundant network requests within a session.

### REQ A2A-EXEC-012: Vertex AI Dialect Adapter

**Full Text**: The A2AClientManager shall wrap fetch with a Vertex AI Agent Engine dialect adapter to handle proto-JSON format differences.

**Why This Matters**: Upstream includes createAdapterFetch() (~120 LoC) that normalizes Vertex AI's proto-JSON responses. Without this, Vertex AI Agent Engine responses fail to parse.

## Implementation Tasks

### Add Dependency FIRST

```bash
cd packages/core
npm install --save @a2a-js/sdk
# Verify installation
npm ls @a2a-js/sdk
```

### File to Create

**`packages/core/src/agents/a2a-client-manager.ts`** — Client lifecycle manager

### Stub Implementation

```typescript
/**
 * @plan PLAN-20260302-A2A.P15
 * @requirement A2A-DISC-001, A2A-DISC-002, A2A-DISC-003, A2A-EXEC-012
 */

import { Client, type AuthenticationHandler, type AgentCard, type Message, type Task } from '@a2a-js/sdk';
import type { RemoteAgentAuthProvider } from './auth-providers.js';

/**
 * Manages A2A SDK client lifecycle and agent card caching.
 * Session-scoped - created once by registry, held for session duration.
 * @plan PLAN-20260302-A2A.P15
 */
export class A2AClientManager {
  private readonly clients = new Map<string, Client>();
  private readonly agentCards = new Map<string, AgentCard>();
  private readonly authProvider?: RemoteAgentAuthProvider;
  
  /**
   * @param authProvider Optional auth provider for remote agents
   */
  constructor(authProvider?: RemoteAgentAuthProvider) {
    this.authProvider = authProvider;
  }
  
  /**
   * Load an agent by fetching its agent card and creating an A2A client.
   * @plan PLAN-20260302-A2A.P15
   * @requirement A2A-DISC-001
   */
  async loadAgent(name: string, agentCardUrl: string): Promise<AgentCard> {
    // Stub: return empty agent card
    return {
      name,
      url: agentCardUrl,
      skills: [],
      capabilities: []
    };
  }
  
  /**
   * Send a message to a remote agent.
   * @plan PLAN-20260302-A2A.P15
   * @requirement A2A-EXEC-001
   */
  async sendMessage(
    agentName: string,
    message: string,
    options?: {
      contextId?: string;
      taskId?: string;
      signal?: AbortSignal;
    }
  ): Promise<Message | Task> {
    // Stub: return empty Message
    return {
      kind: 'message' as const,
      role: 'agent' as const,
      messageId: 'stub-msg-id',
      parts: []
    };
  }
  
  /**
   * Get a task by ID.
   * @plan PLAN-20260302-A2A.P15
   */
  async getTask(agentName: string, taskId: string): Promise<Task> {
    // Stub: return empty Task
    return {
      kind: 'task' as const,
      id: taskId,
      contextId: 'stub-context',
      status: {
        state: 'submitted' as const
      }
    };
  }
  
  /**
   * Cancel a task.
   * @plan PLAN-20260302-A2A.P15
   * @requirement A2A-EXEC-005
   */
  async cancelTask(agentName: string, taskId: string): Promise<Task> {
    // Stub: return cancelled Task
    return {
      kind: 'task' as const,
      id: taskId,
      contextId: 'stub-context',
      status: {
        state: 'canceled' as const
      }
    };
  }
  
  /**
   * Get cached agent card.
   * @plan PLAN-20260302-A2A.P15
   * @requirement A2A-DISC-003
   */
  getAgentCard(name: string): AgentCard | undefined {
    return this.agentCards.get(name);
  }
  
  /**
   * Get A2A SDK client for agent.
   * @plan PLAN-20260302-A2A.P15
   */
  getClient(name: string): Client | undefined {
    return this.clients.get(name);
  }
}

/**
 * Create Vertex AI Agent Engine dialect adapter.
 * Normalizes proto-JSON format to standard A2A format.
 * @plan PLAN-20260302-A2A.P15
 * @requirement A2A-EXEC-012
 */
function createAdapterFetch(): typeof fetch {
  // Stub: return native fetch
  return fetch;
}

/**
 * Map Vertex AI task state to A2A task state.
 * @plan PLAN-20260302-A2A.P15
 * @requirement A2A-EXEC-012
 */
function mapTaskState(protoState: string): 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' {
  // Stub: pass through
  return protoState as any;
}
```

### STUB RULES

1. **Return empty values** of correct type
2. **NO error throwing** — stubs return dummy data
3. **NO TODO comments**
4. **Maximum ~100 lines** for stub
5. **Must compile** with strict TypeScript

## Verification Commands

```bash
# Dependency installed
npm ls @a2a-js/sdk
# Expected: installed version

# File created
ls -la packages/core/src/agents/a2a-client-manager.ts
# Expected: file exists

# No forbidden patterns
grep -E "NotYetImplemented|TODO|throw new Error" packages/core/src/agents/a2a-client-manager.ts
# Expected: no matches

# TypeScript compiles
npm run typecheck
# Expected: no errors
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 15 of 33 for A2A Remote Agent support.

CRITICAL: ADD DEPENDENCY FIRST
Before writing any code:
cd packages/core
npm install --save @a2a-js/sdk

PREREQUISITE CHECK:
Verify Phase 14a completed by checking:
- `npm test -- packages/core/src/agents/__tests__/auth-providers.test.ts` all tests PASS (15 tests)
- types.ts has discriminated union (P03-05)
- a2a-utils.ts exists (P06-08)
- auth-providers.ts has RemoteAgentAuthProvider, NoAuthProvider, GoogleADCAuthProvider (P09-14)

YOUR TASK:
Create packages/core/src/agents/a2a-client-manager.ts as a STUB.

CLASS STRUCTURE:
- A2AClientManager class with Maps for clients and agent cards
- Constructor accepts optional RemoteAgentAuthProvider
- Methods: loadAgent, sendMessage, getTask, cancelTask, getAgentCard, getClient
- Helper functions: createAdapterFetch, mapTaskState

STUB RULES:
1. All methods return EMPTY VALUES of correct type
2. loadAgent returns: { name, url, skills: [], capabilities: [] }
3. sendMessage returns: { kind: 'message', role: 'agent', messageId: '', parts: [] }
4. getTask/cancelTask returns: { kind: 'task', id, contextId, status: { state: 'submitted' } }
5. NO error throwing (return dummy data)
6. NO TODO comments
7. Maximum ~100 lines

DELIVERABLES:
- a2a-client-manager.ts with stub implementation
- All methods have @plan and @requirement markers
- Compiles with no errors
- Imports from @a2a-js/sdk work

DO NOT:
- Implement actual HTTP fetching (that's P17)
- Add authentication logic (that's P17)
- Create adapter logic (that's P17)
- Throw errors on failure (return stubs)

IMPORTANT NOTES:
- A2AClientManager is SESSION-SCOPED: created once by registry initialization, held for session duration
- It is NOT a singleton (no static instance)
- It is NOT per-invocation (RemoteAgentInvocation receives the manager from registry, does NOT create new one)
- Registry creates manager in initialize() and passes to RemoteAgentInvocation via factory method
