# Phase 17: A2A Client Manager - Implementation

## Phase ID

`PLAN-20260302-A2A.P17`

## Prerequisites

- Required: Phase 16a (A2A Client Manager TDD Verification) completed
- Verification: `npm test -- packages/core/src/agents/__tests__/a2a-client-manager.test.ts` shows ~22 tests FAIL against stubs
- Expected files:
  - `packages/core/src/agents/a2a-client-manager.ts` with stubs
  - `packages/core/src/agents/__tests__/a2a-client-manager.test.ts` with tests

## Requirements Implemented

### All Requirements from Phase 16 (Full Implementation)

(All requirements A2A-DISC-001, A2A-DISC-002, A2A-DISC-003, A2A-EXEC-001, A2A-EXEC-005, A2A-EXEC-012 are implemented in this phase to make all tests pass)

**Why This Matters**: Implements the complete A2A client lifecycle manager with agent card loading, caching, authentication, Vertex AI dialect adaptation, and session-scoped state management. This is the core component that enables remote agent communication.

## Implementation Tasks

### File to Modify

**`packages/core/src/agents/a2a-client-manager.ts`** — Implement full A2AClientManager

### Implementation Strategy

**Pattern from a2a-server/src/agent/executor.ts:**
- Uses `@a2a-js/sdk` Client for communication
- Async operations with error handling
- Session-scoped state management (not singleton)

### Full Implementation

Replace stub methods with complete implementations:

```typescript
/**
 * @plan PLAN-20260302-A2A.P17
 * @requirement A2A-DISC-001, A2A-DISC-002, A2A-DISC-003, A2A-EXEC-012
 */

import { Client, type AuthenticationHandler, type AgentCard, type Message, type Task } from '@a2a-js/sdk';
import type { RemoteAgentAuthProvider } from './auth-providers.js';

/**
 * Manages A2A SDK client lifecycle and agent card caching.
 * Session-scoped - created once by registry, held for session duration.
 * @plan PLAN-20260302-A2A.P17
 */
export class A2AClientManager {
  private readonly clients = new Map<string, Client>();
  private readonly agentCards = new Map<string, AgentCard>();
  private readonly authProvider?: RemoteAgentAuthProvider;
  
  constructor(authProvider?: RemoteAgentAuthProvider) {
    this.authProvider = authProvider;
  }
  
  /**
   * Load an agent by fetching its agent card and creating an A2A client.
   * @plan PLAN-20260302-A2A.P17
   * @requirement A2A-DISC-001
   */
  async loadAgent(name: string, agentCardUrl: string): Promise<AgentCard> {
    // Check if already loaded (cached)
    const cached = this.agentCards.get(name);
    if (cached) {
      return cached;
    }
    
    // Get authentication handler from provider
    const authHandler = await this.authProvider?.getAuthHandler(agentCardUrl);
    
    // Create adapter fetch for Vertex AI dialect
    const adapterFetch = createAdapterFetch();
    
    // Create SDK client with auth and adapter
    const client = new Client({
      url: agentCardUrl,
      authenticationHandler: authHandler,
      fetch: adapterFetch,
    });
    
    // Fetch agent card via SDK
    const agentCard = await client.getAgentCard();
    
    // Cache client and card
    this.clients.set(name, client);
    this.agentCards.set(name, agentCard);
    
    return agentCard;
  }
  
  /**
   * Send a message to a remote agent.
   * @plan PLAN-20260302-A2A.P17
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
    const client = this.clients.get(agentName);
    if (!client) {
      throw new Error(`A2AClient sendMessage error [${agentName}]: Agent not loaded. Call loadAgent() first.`);
    }
    
    try {
      // Send message via SDK with blocking mode (MVP)
      const result = await client.sendMessage({
        message,
        contextId: options?.contextId,
        taskId: options?.taskId,
        blocking: true,  // MVP: SDK handles wait internally
      }, {
        signal: options?.signal,
      });
      
      return result;
    } catch (error) {
      throw new Error(`A2AClient sendMessage error [${agentName}]: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get a task by ID.
   * @plan PLAN-20260302-A2A.P17
   */
  async getTask(agentName: string, taskId: string): Promise<Task> {
    const client = this.clients.get(agentName);
    if (!client) {
      throw new Error(`A2AClient getTask error [${agentName}]: Agent not loaded`);
    }
    
    try {
      return await client.getTask(taskId);
    } catch (error) {
      throw new Error(`A2AClient getTask error [${agentName}]: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Cancel a task.
   * @plan PLAN-20260302-A2A.P17
   * @requirement A2A-EXEC-005
   */
  async cancelTask(agentName: string, taskId: string): Promise<Task> {
    const client = this.clients.get(agentName);
    if (!client) {
      throw new Error(`A2AClient cancelTask error [${agentName}]: Agent not loaded`);
    }
    
    try {
      return await client.cancelTask(taskId);
    } catch (error) {
      // Best-effort: log error but don't throw (caller ignores cancellation failures)
      console.error(`A2AClient cancelTask error [${agentName}]: ${error instanceof Error ? error.message : String(error)}`);
      // Return stub Task with canceled state
      return {
        kind: 'task',
        id: taskId,
        contextId: '',
        status: {
          state: 'canceled',
        },
      };
    }
  }
  
  /**
   * Get cached agent card.
   * @plan PLAN-20260302-A2A.P17
   * @requirement A2A-DISC-003
   */
  getAgentCard(name: string): AgentCard | undefined {
    return this.agentCards.get(name);
  }
  
  /**
   * Get A2A SDK client for agent.
   * @plan PLAN-20260302-A2A.P17
   */
  getClient(name: string): Client | undefined {
    return this.clients.get(name);
  }
}

/**
 * Create Vertex AI Agent Engine dialect adapter.
 * Normalizes proto-JSON format to standard A2A format.
 * @plan PLAN-20260302-A2A.P17
 * @requirement A2A-EXEC-012
 */
function createAdapterFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Use native fetch for actual HTTP request
    const response = await fetch(input, init);
    
    // If not JSON response, return as-is
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return response;
    }
    
    // Parse JSON response
    const json = await response.json();
    
    // Normalize proto-JSON format
    const normalized = normalizeResponse(json);
    
    // Create new response with normalized JSON
    return new Response(JSON.stringify(normalized), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/**
 * Normalize Vertex AI proto-JSON response to standard A2A format.
 */
function normalizeResponse(json: any): any {
  // Handle JSON-RPC 2.0 envelope (unwrap params)
  if (json.jsonrpc === '2.0' && json.result?.params) {
    json = json.result.params;
  }
  
  // Normalize task state if present
  if (json.task?.status?.state) {
    json.task.status.state = mapTaskState(json.task.status.state);
  }
  
  // Add kind field to top-level result if missing
  if (json.task && !json.kind) {
    json.kind = 'task';
  } else if (json.message && !json.kind) {
    json.kind = 'message';
  }
  
  // Normalize parts if present (strip SDK-specific fields)
  if (json.message?.parts) {
    json.message.parts = json.message.parts.map((part: any) => {
      // Add kind field to parts if missing
      if (part.text && !part.kind) {
        part.kind = 'text';
      } else if (part.data && !part.kind) {
        part.kind = 'data';
      } else if (part.file && !part.kind) {
        part.kind = 'file';
      }
      return part;
    });
  }
  
  return json;
}

/**
 * Map Vertex AI task state to A2A task state.
 * @plan PLAN-20260302-A2A.P17
 * @requirement A2A-EXEC-012
 */
function mapTaskState(protoState: string): 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' {
  const mapping: Record<string, 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required'> = {
    'TASK_STATE_SUBMITTED': 'submitted',
    'TASK_STATE_WORKING': 'working',
    'TASK_STATE_COMPLETED': 'completed',
    'TASK_STATE_FAILED': 'failed',
    'TASK_STATE_CANCELED': 'canceled',
    'TASK_STATE_INPUT_REQUIRED': 'input-required',
  };
  
  return mapping[protoState] || protoState as any;
}
```

**Update markers:**
- Change @plan markers from P15 to P17 in all JSDoc
- Keep @requirement markers unchanged

### Key Implementation Details

1. **Agent Card Loading (loadAgent)**:
   - Check cache first (avoid redundant fetches)
   - Get auth handler from provider
   - Create adapter fetch for Vertex AI dialect
   - Create SDK Client with auth + adapter
   - Fetch card via client.getAgentCard()
   - Cache both client and card

2. **Message Sending (sendMessage)**:
   - Retrieve client from map (throw if not loaded)
   - Pass contextId, taskId, blocking flag to SDK
   - Wire abort signal to SDK call
   - Wrap errors with agent name context

3. **Task Cancellation (cancelTask)**:
   - Best-effort: catch errors, log, return stub Task
   - Caller ignores cancellation failures per requirements

4. **Caching (getAgentCard, getClient)**:
   - Simple Map lookups
   - No expiration in MVP

5. **Vertex AI Dialect Adapter (createAdapterFetch)**:
   - Wraps fetch to intercept responses
   - Normalizes proto-JSON state names (TASK_STATE_WORKING → working)
   - Unwraps JSON-RPC 2.0 envelopes
   - Adds kind fields to parts/results

6. **State Mapping (mapTaskState)**:
   - Maps all 6 Vertex AI proto-JSON states to A2A standard
   - Fallback to pass-through for unknown states

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 17 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 16a completed by checking:
- `npm test -- packages/core/src/agents/__tests__/a2a-client-manager.test.ts` shows ~22 tests FAIL
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P16a-report.md` exists

YOUR TASK:
Implement the full A2AClientManager in `packages/core/src/agents/a2a-client-manager.ts` to make all tests pass.

REFERENCE PATTERN:
See `packages/a2a-server/src/agent/executor.ts` for SDK usage patterns:
- Creating Client instances
- Async operations
- Error wrapping

KEY IMPLEMENTATIONS:

1. **loadAgent(name, agentCardUrl)**:
   - Check agentCards cache first (return if exists)
   - Get auth handler: `await this.authProvider?.getAuthHandler(agentCardUrl)`
   - Create adapter fetch: `const adapterFetch = createAdapterFetch()`
   - Create client: `new Client({ url, authenticationHandler, fetch: adapterFetch })`
   - Fetch card: `await client.getAgentCard()`
   - Cache: `this.clients.set(name, client)`, `this.agentCards.set(name, agentCard)`
   - Return card

2. **sendMessage(agentName, message, options)**:
   - Get client from map (throw if not found)
   - Try: `await client.sendMessage({ message, contextId, taskId, blocking: true }, { signal })`
   - Catch: Wrap error with agent name context

3. **getTask(agentName, taskId)**:
   - Get client from map (throw if not found)
   - Return: `await client.getTask(taskId)`
   - Catch: Wrap error

4. **cancelTask(agentName, taskId)**:
   - Get client from map (throw if not found)
   - Try: `await client.cancelTask(taskId)`
   - Catch: Log error, return stub Task with state='canceled' (best-effort)

5. **getAgentCard(name)** / **getClient(name)**:
   - Return: `this.agentCards.get(name)` / `this.clients.get(name)`

6. **createAdapterFetch()**:
   - Wrap native fetch
   - Intercept JSON responses
   - Call normalizeResponse(json) to map proto-JSON
   - Return new Response with normalized JSON

7. **normalizeResponse(json)**:
   - Unwrap JSON-RPC 2.0 envelope if present
   - Map task.status.state via mapTaskState()
   - Add kind='task'/'message' if missing
   - Add kind='text'/'data'/'file' to parts if missing

8. **mapTaskState(protoState)**:
   - Map: TASK_STATE_SUBMITTED → submitted
   - Map: TASK_STATE_WORKING → working
   - Map: TASK_STATE_COMPLETED → completed
   - Map: TASK_STATE_FAILED → failed
   - Map: TASK_STATE_CANCELED → canceled
   - Map: TASK_STATE_INPUT_REQUIRED → input-required
   - Fallback: pass-through

CRITICAL NOTES:
- A2AClientManager is SESSION-SCOPED (created once by registry)
- Use `blocking: true` in sendMessage for MVP (SDK handles waiting)
- cancelTask is best-effort (catch errors, log, return stub)
- Cache both client and card after loadAgent
- Error messages include agent name for debugging

DELIVERABLES:
- a2a-client-manager.ts fully implemented (~200 lines)
- All 22 tests PASS: `npm test -- packages/core/src/agents/__tests__/a2a-client-manager.test.ts`
- @plan markers updated to P17
- No TODO/STUB comments

DO NOT:
- Change function signatures (tests depend on them)
- Add new public methods (not in stub)
- Implement explicit polling (SDK blocking mode handles it)
- Change session scope (not singleton, not per-invocation)
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers updated to P17
grep -c "@plan:PLAN-20260302-A2A.P17" packages/core/src/agents/a2a-client-manager.ts
# Expected: 7+ (all methods + helpers)

# Check requirements still present
grep -c "@requirement:A2A-" packages/core/src/agents/a2a-client-manager.ts
# Expected: 4+ (unchanged from stub)

# Run ALL tests (MUST PASS)
npm test -- packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: All 22 tests PASS

# Check for TODO/FIXME/STUB
grep -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/agents/a2a-client-manager.ts
# Expected: No matches

# Check loadAgent uses cache
grep -A 5 "async loadAgent" packages/core/src/agents/a2a-client-manager.ts | grep "this.agentCards.get"
# Expected: Cache check present

# Check sendMessage uses blocking mode
grep -A 10 "async sendMessage" packages/core/src/agents/a2a-client-manager.ts | grep "blocking: true"
# Expected: Blocking flag present

# Check cancelTask is best-effort (catches errors)
grep -A 15 "async cancelTask" packages/core/src/agents/a2a-client-manager.ts | grep "catch"
# Expected: Try-catch block present

# Check dialect adapter exists
grep "function createAdapterFetch" packages/core/src/agents/a2a-client-manager.ts
# Expected: Function defined

# Check state mapping complete
grep -A 10 "function mapTaskState" packages/core/src/agents/a2a-client-manager.ts | grep "TASK_STATE_WORKING"
# Expected: Mapping logic present
```

### Deferred Implementation Detection

```bash
# Check for placeholder returns
grep -E "return \[\]|return null|throw new Error\('Not" packages/core/src/agents/a2a-client-manager.ts
# Expected: No matches (real implementation)

# Check for empty function bodies (excluding getters)
grep -A 2 "async.*{" packages/core/src/agents/a2a-client-manager.ts | grep "^\s*}$"
# Expected: No matches (all methods have logic)
```

### Semantic Verification Checklist

**Does the code DO what the requirements say?**
- [ ] loadAgent fetches card via SDK and caches it
- [ ] loadAgent creates client with auth handler and adapter fetch
- [ ] sendMessage passes contextId, taskId, signal to SDK
- [ ] sendMessage uses blocking: true for MVP
- [ ] getAgentCard returns cached card (no new fetch)
- [ ] cancelTask catches errors and returns stub (best-effort)
- [ ] createAdapterFetch wraps native fetch
- [ ] mapTaskState normalizes all 6 proto-JSON states
- [ ] All 22 tests PASS

**Would tests FAIL if implementation was broken?**
- [ ] If loadAgent didn't cache, caching tests would fail
- [ ] If sendMessage didn't pass contextId, tests would fail
- [ ] If cancelTask threw on error, best-effort test would fail
- [ ] If mapTaskState didn't normalize, adapter tests would fail

**Implementation Quality:**
- [ ] No hardcoded test data (generic implementation)
- [ ] Error handling wraps errors with agent name
- [ ] Async operations use await (no callbacks)
- [ ] Maps use for O(1) lookups
- [ ] No memory leaks (maps cleared by GC when manager destroyed)

## Success Criteria

- All verification commands return expected results
- ALL 22 tests PASS
- @plan markers updated to P17
- No TODO/STUB comments
- Implementations match design.md architecture
- Session-scoped lifecycle maintained (not singleton)
- Vertex AI dialect adapter complete
- Auth provider integration works
- Ready for P17a verification

## Failure Recovery

If this phase fails:

1. **Tests still failing**:
   - Review test expectations vs implementation
   - Check SDK Client API usage (sendMessage params)
   - Verify proto-JSON normalization logic
   - Re-run tests with verbose output

2. **Caching not working**:
   - Verify Map.set() called after fetch
   - Check cache lookup before fetch

3. **Adapter not working**:
   - Verify createAdapterFetch wraps native fetch
   - Check normalizeResponse logic
   - Test mapTaskState with all 6 states

4. Cannot proceed to Phase 17a until all tests pass

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P17.md`

Contents:
```markdown
Phase: P17
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/a2a-client-manager.ts (~200 lines total)

Components Implemented:
  - A2AClientManager.loadAgent() — agent card fetching + caching
  - A2AClientManager.sendMessage() — message sending with contextId/taskId
  - A2AClientManager.getTask() — task retrieval
  - A2AClientManager.cancelTask() — best-effort cancellation
  - A2AClientManager.getAgentCard() — cache lookup
  - A2AClientManager.getClient() — client lookup
  - createAdapterFetch() — Vertex AI dialect adapter (~30 lines)
  - normalizeResponse() — proto-JSON normalization
  - mapTaskState() — state mapping (6 mappings)

Test Results: All 22 tests PASS
Verification: [paste npm test output showing all passing]

Key Implementation Details:
- Session-scoped lifecycle (not singleton)
- Agent card caching (Map)
- SDK blocking mode (blocking: true)
- Best-effort task cancellation
- Vertex AI proto-JSON normalization
- Auth handler injection

Next Phase: P17a (Verification of P17)
```
