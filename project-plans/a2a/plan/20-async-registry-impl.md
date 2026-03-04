# Phase 20: Async AgentRegistry - Implementation

## Phase ID

`PLAN-20260302-A2A.P20`

## Prerequisites

- Required: Phase 19a (Async AgentRegistry TDD Verification) completed
- Verification: `npm test -- packages/core/src/agents/__tests__/registry.test.ts` all tests PASS against stub
- Expected files:
  - `packages/core/src/agents/registry.ts` with async methods and registerRemoteAgent stub
  - `packages/core/src/agents/__tests__/registry.test.ts` with 11 tests
  - `packages/core/src/agents/a2a-client-manager.ts` fully implemented (P15-17)

## Requirements Implemented

### REQ A2A-REG-002: Async Registration (Implementation)

**Full implementation of agent card fetching and remote agent registration.**

### REQ A2A-DISC-001, A2A-DISC-002, A2A-DISC-003

**Agent card discovery, error handling, and caching via A2AClientManager.**

## Implementation Tasks

### Files to Modify

**`packages/core/src/agents/registry.ts`** — Implement registerRemoteAgent with A2AClientManager

### Implementation Details

Replace `registerRemoteAgent` stub with full implementation:

```typescript
import type { Config } from '../config/config.js';
import type { AgentDefinition, RemoteAgentDefinition } from './types.js';
import type { z } from 'zod';
import { DebugLogger } from '../debug/DebugLogger.js';
import { isRemoteAgent } from './types.js';
import { A2AClientManager } from './a2a-client-manager.js';

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();
  private readonly logger = new DebugLogger('llxprt:agents:registry');
  private clientManager?: A2AClientManager;

  constructor(private readonly config: Config) {
    void this.config;
  }

  /**
   * Discovers and loads agents.
   * @plan PLAN-20260302-A2A.P20
   */
  async initialize(): Promise<void> {
    // Create session-scoped A2AClientManager
    // NOTE: Config.getRemoteAgentAuthProvider() will be added in auth provider integration
    // For P20, use optional chaining in case method doesn't exist yet
    const authProvider = this.config.getRemoteAgentAuthProvider?.();
    this.clientManager = new A2AClientManager(authProvider);
    
    await this.loadBuiltInAgents();
    
    this.logger.debug(
      () => `[AgentRegistry] Initialized with ${this.agents.size} agents.`,
    );
  }

  private async loadBuiltInAgents(): Promise<void> {
    // No built-in agents registered
  }

  /**
   * Registers an agent definition.
   * @plan PLAN-20260302-A2A.P20
   * @requirement A2A-REG-002
   */
  protected async registerAgent<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
  ): Promise<void> {
    // Validation
    if (!definition.name || !definition.description) {
      this.logger.warn(
        `[AgentRegistry] Skipping invalid agent definition. Missing name or description.`,
      );
      return;
    }

    if (this.agents.has(definition.name)) {
      this.logger.debug(
        `[AgentRegistry] Overriding agent '${definition.name}'`,
      );
    }

    // Dispatch based on kind
    if (isRemoteAgent(definition)) {
      await this.registerRemoteAgent(definition);
    } else {
      // Local agent - direct registration
      // Cast needed for generic variance - Map stores union type, callers cast as needed
      this.agents.set(definition.name, definition as unknown as AgentDefinition);
    }
  }

  /**
   * Registers a remote agent by fetching its card and creating client.
   * @plan PLAN-20260302-A2A.P20
   * @requirement A2A-REG-002, A2A-DISC-001, A2A-DISC-002
   */
  private async registerRemoteAgent(definition: RemoteAgentDefinition): Promise<void> {
    if (!this.clientManager) {
      this.logger.error(
        `[AgentRegistry] Cannot register remote agent '${definition.name}': A2AClientManager not initialized`,
      );
      return;
    }
    
    try {
      // Fetch agent card via A2AClientManager
      const agentCard = await this.clientManager.loadAgent(
        definition.name,
        definition.agentCardUrl
      );
      
      // Populate description from skills if not provided
      if (!definition.description && agentCard.skills?.length) {
        definition.description = agentCard.skills
          .map(s => `${s.name}: ${s.description}`)
          .join('\n');
      }
      
      // Register the definition
      // Cast needed for generic variance - Map stores union type, callers cast as needed
      this.agents.set(definition.name, definition as unknown as AgentDefinition);
      
      this.logger.debug(
        `[AgentRegistry] Registered remote agent '${definition.name}' from ${definition.agentCardUrl}`,
      );
    } catch (error) {
      // Error isolation: log and continue (don't throw)
      this.logger.error(
        `[AgentRegistry] Failed to load remote agent '${definition.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
      // Agent is not registered - skip it
    }
  }

  /**
   * Retrieves an agent definition by name.
   */
  getDefinition(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Returns all active agent definitions.
   */
  getAllDefinitions(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}
```

### Key Implementation Details

1. **A2AClientManager Lifecycle**:
   - Created once in `initialize()` method
   - Session-scoped (not singleton, not per-invocation)
   - Auth provider retrieved from Config
   - Stored as instance field for reuse in registerRemoteAgent

2. **registerRemoteAgent Implementation**:
   - Check clientManager exists (initialize must run first)
   - Call `clientManager.loadAgent()` to fetch card
   - Populate description from agent card skills if not provided
   - Register definition in agents Map
   - Error handling: log and skip (don't throw)

3. **Error Isolation**:
   - try/catch around loadAgent call
   - Log error with agent name and URL
   - Don't throw — allows other agents to register
   - Failed agent not added to registry

4. **Description Population**:
   - If definition.description is falsy and agentCard.skills exists
   - Format: `"skill1: desc1\nskill2: desc2"`
   - Improves discoverability in tool listings

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 20 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 19a completed by checking:
- `npm test -- packages/core/src/agents/__tests__/registry.test.ts` all tests PASS
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P19a-report.md` exists

YOUR TASK:
Implement full registerRemoteAgent in `packages/core/src/agents/registry.ts`.

CURRENT STATE (P18 stub):
- registerRemoteAgent just stores definition
- No A2AClientManager usage
- No agent card fetching

TARGET STATE (P20):
- Create A2AClientManager in initialize()
- registerRemoteAgent fetches agent card via clientManager
- Populate description from skills
- Error isolation (log and skip on failure)

SPECIFIC CHANGES:

1. **Add instance field** (after logger):
   ```typescript
   private clientManager?: A2AClientManager;
   ```

2. **Add import** (top of file):
   ```typescript
   import { A2AClientManager } from './a2a-client-manager.js';
   ```

3. **Update initialize()** (line ~30):
   ```typescript
   async initialize(): Promise<void> {
     // Create session-scoped A2AClientManager
     const authProvider = this.config.getRemoteAgentAuthProvider?.();
     this.clientManager = new A2AClientManager(authProvider);
     
     await this.loadBuiltInAgents();
     
     this.logger.debug(
       () => `[AgentRegistry] Initialized with ${this.agents.size} agents.`,
     );
   }
   ```

4. **Replace registerRemoteAgent** (line ~70):
   - Add clientManager null check (log error and return if not initialized)
   - try/catch block around loadAgent call
   - Populate description from agentCard.skills if not provided
   - Register definition in agents Map
   - Log success
   - Catch: log error with agent name, don't throw, don't register

IMPLEMENTATION REQUIREMENTS:
- All 11 tests from P19 must PASS
- Session-scoped lifecycle (one manager per registry instance)
- Error isolation (one failure doesn't block others)
- Description population from agent card
- @plan markers updated to P20

DELIVERABLES:
- registry.ts fully implemented
- All tests PASS
- No TODO comments

DO NOT:
- Make clientManager a singleton (instance field only)
- Throw errors from registerRemoteAgent (log and skip)
- Change validation logic in registerAgent
```

## Verification Commands

```bash
# Check A2AClientManager import
grep "A2AClientManager" packages/core/src/agents/registry.ts

# Check clientManager field
grep "private clientManager" packages/core/src/agents/registry.ts

# Check initialize creates manager
grep -A 5 "async initialize" packages/core/src/agents/registry.ts | grep "new A2AClientManager"

# Check registerRemoteAgent uses clientManager
grep -A 15 "registerRemoteAgent" packages/core/src/agents/registry.ts | grep "clientManager.loadAgent"

# Run ALL tests (MUST PASS)
npm test -- packages/core/src/agents/__tests__/registry.test.ts

# Type check
npm run typecheck
```

## Success Criteria

- All verification commands succeed
- All 11 tests PASS
- A2AClientManager created in initialize
- registerRemoteAgent fetches agent card
- Description populated from skills
- Error isolation works (logged, not thrown)
- @plan markers updated to P20

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P20.md`

Contents:
```markdown
Phase: P20
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/registry.ts (~30 lines changed)

Implementation:
  - A2AClientManager instance field added
  - initialize() creates session-scoped manager
  - registerRemoteAgent fetches agent cards
  - Description population from skills
  - Error isolation (log and skip)

Test Results: All 11 tests PASS

Verification: [paste npm test output]

Next Phase: P20a (Verification of P20)
```
