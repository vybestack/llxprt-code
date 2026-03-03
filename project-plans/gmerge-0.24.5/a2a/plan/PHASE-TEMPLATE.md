# Phase Template for A2A Implementation

**Use this template to generate remaining phase files following the established pattern.**

## Pattern: Stub → TDD → Implementation

Every feature follows a 3-phase cycle:

### Stub Phase (P{N})
- Create file structure with empty methods
- Return dummy values of correct type
- NO error throwing
- ~100 lines maximum

### TDD Phase (P{N+1})
- Write behavioral tests for REAL functionality
- Tests expect actual behavior (will fail until implementation)
- NO testing for stubs or NotYetImplemented
- 15-20 tests minimum

### Implementation Phase (P{N+2})
- Implement to make ALL tests pass
- Follow pseudocode/design doc exactly
- NO TODO comments
- Update existing files, never create parallel versions

## Phases Not Yet Created

Generate these using the pattern established in P03-05, P15, P21:

### A2A Utils (P06-08)
**Stub (P06)**:
- File: `packages/core/src/agents/a2a-utils.ts`
- Functions: extractMessageText, extractTaskText, extractIdsFromResponse
- Return: Empty strings and undefined IDs

**TDD (P07)**:
- File: `packages/core/src/agents/__tests__/a2a-utils.test.ts`
- Test: Text extraction from Message parts (TextPart, DataPart, FilePart)
- Test: Task formatting (status, message, artifacts)
- Test: ID extraction with terminal state logic

**Implementation (P08)**:
- Implement text extraction for all part types
- Format task output: "Task [id]: [state]\n[status message]\n[artifacts]"
- Clear taskId if state is terminal (completed/failed/canceled)

### Auth Providers (P09-11)
**Stub (P09)**:
- File: `packages/core/src/agents/auth-providers.ts`
- Interface: RemoteAgentAuthProvider
- Class: NoAuthProvider
- Modify: `packages/core/src/config/config.ts` (add getter/setter)

**TDD (P10)**:
- File: `packages/core/src/agents/__tests__/auth-providers.test.ts`
- Test: NoAuthProvider returns undefined
- Test: Config stores and retrieves auth provider

**Implementation (P11)**:
- NoAuthProvider.getAuthHandler returns undefined
- Config methods: setRemoteAgentAuthProvider, getRemoteAgentAuthProvider

### Google ADC Auth (P12-14)
**Stub (P12)**:
- File: `packages/core/src/agents/auth-providers.ts` (add GoogleADCAuthProvider)
- Dependency: Add `google-auth-library` to package.json
- Return: Empty AuthenticationHandler

**TDD (P13)**:
- File: `packages/core/src/agents/__tests__/auth-providers.test.ts` (extend)
- Test: GoogleADCAuthProvider returns AuthenticationHandler
- Test: AuthenticationHandler.headers() returns bearer token (mock GoogleAuth)

**Implementation (P14)**:
- Import google-auth-library
- Create GoogleAuth with cloud-platform scope
- Return AuthenticationHandler that fetches ADC tokens

### A2A Client Manager TDD (P16)
**File**: `packages/core/src/agents/__tests__/a2a-client-manager.test.ts`
- Test: loadAgent fetches and caches agent card
- Test: sendMessage calls SDK with contextId/taskId
- Test: getTask retrieves task by ID
- Test: cancelTask cancels task
- Test: Vertex AI adapter normalizes proto-JSON responses

### A2A Client Manager Implementation (P17)
**File**: `packages/core/src/agents/a2a-client-manager.ts` (implement)
- Implement loadAgent: fetch agent card via SDK, cache in map
- Implement sendMessage: get/create client, pass auth, send message with options
- Implement getTask: get client, fetch task by ID
- Implement cancelTask: get client, cancel task
- Implement createAdapterFetch: wrap fetch with proto-JSON normalization
- Implement mapTaskState: normalize TASK_STATE_* to lowercase

### Async AgentRegistry (P18-20)
**Stub (P18)**:
- File: `packages/core/src/agents/registry.ts` (modify)
- Change: registerAgent becomes async
- Change: Add registerRemoteAgent method (stub)
- Change: loadBuiltInAgents becomes async

**TDD (P19)**:
- File: `packages/core/src/agents/__tests__/registry.test.ts` (extend)
- Test: registerAgent accepts both local and remote definitions
- Test: registerRemoteAgent calls A2AClientManager.loadAgent
- Test: Parallel registration with Promise.allSettled
- Test: Individual failures don't block other registrations

**Implementation (P20)**:
- Make registerAgent async, dispatch on definition.kind
- Implement registerRemoteAgent: call clientManager.loadAgent, populate description from skills, store in map
- Update loadBuiltInAgents: use Promise.allSettled for concurrent registration
- Update initialize: ensure A2AClientManager is created with auth provider from Config

### RemoteAgentInvocation TDD (P22)
**File**: `packages/core/src/agents/__tests__/remote-invocation.test.ts`
- Test: Query validation (reject empty query)
- Test: Session state retrieval and persistence
- Test: contextId/taskId included in sendMessage
- Test: Terminal state clears taskId
- Test: input-required state returns error
- Test: Abort signal cancels task
- Test: Text extraction from response

### RemoteAgentInvocation Implementation (P23)
**File**: `packages/core/src/agents/remote-invocation.ts` (implement)
- Validate query in constructor (throw if empty)
- Retrieve session state from map (key: "{agentName}#{sessionId}")
- Get auth provider from Config, create A2AClientManager
- Lazy load agent if not already loaded
- Call clientManager.sendMessage with contextId/taskId/signal
- Extract IDs from response, persist to session state
- Handle input-required state: return error ToolResult
- Handle abort: best-effort cancelTask in finally block
- Extract text from response via a2a-utils

### Execution Dispatch (P24-26)
**Stub (P24)**:
- File: `packages/core/src/agents/registry.ts` (add method)
- Method: createInvocation(agentName, params, messageBus, sessionState)
- Return: Stub invocation (SubagentInvocation with dummy definition)

**TDD (P25)**:
- File: `packages/core/src/agents/__tests__/registry.test.ts` (extend)
- Test: createInvocation dispatches to SubagentInvocation for local agents
- Test: createInvocation dispatches to RemoteAgentInvocation for remote agents
- Test: Throws if agent not found

**Implementation (P26)**:
- Get definition from registry
- Narrow type via kind check
- If local: return new SubagentInvocation(params, definition, config, messageBus)
- If remote: return new RemoteAgentInvocation(params, definition, sessionState, messageBus)

### TOML Integration (P27-29)
**Stub (P27)**:
- File: Identify TOML loader (search codebase for existing TOML loading)
- Add: remoteAgentSchema Zod schema
- Schema: kind = 'remote' (inferred from agent_card_url presence), name, agent_card_url

**TDD (P28)**:
- File: Extend TOML loader tests
- Test: Parse remote agent from TOML
- Test: Infer kind = 'remote' if agent_card_url present
- Test: Validate agent_card_url is valid URL
- Test: Reject invalid entries

**Implementation (P29)**:
- Add remoteAgentSchema to TOML schemas
- Parse remote agents during initialization
- Call AgentRegistry.registerAgent for each remote agent
- Use Zod validation for schema enforcement

### Integration (P30)
**File**: All call sites of registerAgent, SubagentInvocation constructor
- Find all registerAgent calls: make async, add await
- Find all SubagentInvocation instantiations: replace with AgentRegistry.createInvocation
- Update tests: add type narrowing where needed

### Migration (P31)
**File**: `packages/core/src/agents/executor.ts`, `packages/core/src/agents/invocation.ts`
- AgentExecutor.create signature: change to accept LocalAgentDefinition<TOutput> only
- SubagentInvocation constructor: change to accept LocalAgentDefinition<TOutput> only
- Add type guards at call sites if needed

### E2E Testing (P32)
**File**: `packages/core/src/agents/__tests__/a2a-integration.test.ts` (new)
- Setup: Mock A2A server (or use actual test server)
- Test: Register remote agent from TOML
- Test: Invoke remote agent via createInvocation
- Test: Session state persists across invocations
- Test: Auth provider is called
- Test: Abort signal works end-to-end

### Final Verification (P33)
- Run ALL tests
- Verify all 62 requirements satisfied
- Check mutation test coverage (80%+)
- Verify no TODOs or NotYetImplemented
- Verify documentation updated

## Verification Phase Pattern (P{N}a)

Every implementation phase has a verification phase:

```markdown
# Phase {N}a: {Feature} Verification

## Phase ID
`PLAN-20260302-A2A.P{N}a`

## Verification Commands

### Structural Verification
```bash
# Check plan markers
grep -r "@plan:PLAN-20260302-A2A.P{N}" . | wc -l

# Check requirements
grep -r "@requirement:{REQ-ID}" . | wc -l

# Run tests
npm test -- {test-file}
```

### Semantic Verification

1. Did you READ the implementation code (not just check file exists)?
2. Does it DO what the requirement says (explain HOW)?
3. Would tests FAIL if implementation removed?
4. Is feature REACHABLE by users?
5. What's MISSING?

### Success Criteria
- [ ] All structural checks pass
- [ ] All semantic questions answered YES
- [ ] Tests pass with expected behavior
- [ ] No stubs or TODOs remain

## If Verification Fails
- Document specific issues
- Return to implementation phase (P{N})
- Remediate issues
- Re-run verification

## Next Phase
Proceed to P{N+1}
```

## Subagent Selection

**Implementation phases** (stub, impl):
- Subagent: `typescriptexpert` or `cherrypicker`
- Prompt: Explicit implementation instructions

**TDD phases**:
- Subagent: `typescriptexpert`
- Prompt: "Write behavioral tests expecting real behavior"

**Verification phases**:
- Subagent: `typescriptreviewer` or `deepthinker`
- Prompt: "Verify both structural and semantic correctness"

## Common Patterns

### Type Narrowing
```typescript
if (definition.kind === 'local') {
  // TypeScript knows: definition is LocalAgentDefinition
  definition.promptConfig; // OK
}

if (definition.kind === 'remote') {
  // TypeScript knows: definition is RemoteAgentDefinition
  definition.agentCardUrl; // OK
  definition.promptConfig; // Error
}
```

### Session State Key
```typescript
const sessionKey = `${agentName}#${config.getSessionId()}`;
const state = sessionState.get(sessionKey) || {};
```

### Error Wrapping
```typescript
try {
  // operation
} catch (error) {
  throw new Error(`A2AClient ${method} error [${agentName}]: ${error}`);
}
```

### Abort Handling
```typescript
try {
  const result = await operation(signal);
} catch (error) {
  if (signal.aborted) {
    // Best-effort cleanup
    await cancelTask(taskId).catch(() => {});
  }
  throw error;
}
```

Use these patterns consistently across all implementation phases.
