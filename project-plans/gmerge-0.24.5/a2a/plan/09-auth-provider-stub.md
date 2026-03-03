# Phase 09: Auth Provider Abstraction - Stub

## Phase ID

`PLAN-20260302-A2A.P09`

## Prerequisites

- Required: Phase 08a (A2A Utils Implementation Verification) completed
- Verification: `npm test -- packages/core/src/agents/__tests__/a2a-utils.test.ts` all tests PASS
- Expected files: 
  - `packages/core/src/agents/a2a-utils.ts` with implemented extractMessageText, extractTaskText, extractIdsFromResponse
  - `packages/core/src/config/config.ts` exists

## Requirements Implemented

### REQ A2A-AUTH-001: Pluggable Auth Provider Interface

**Full EARS Text**: The system shall support pluggable authentication providers via a RemoteAgentAuthProvider interface.

**Behavior Specification**:
- GIVEN: A RemoteAgentAuthProvider implementation
- WHEN: The system loads a remote agent
- THEN: It shall call authProvider.getAuthHandler(agentCardUrl)
- AND: Use the returned AuthenticationHandler for all HTTP requests to that agent
- AND: The interface shall be: `getAuthHandler(url: string): Promise<AuthenticationHandler | undefined>`

**Why This Matters**: Different remote agents may require different authentication mechanisms (Google ADC, bearer tokens, OAuth, custom). A pluggable interface allows LLxprt to support multiple authentication strategies without hard-coding any single provider, maintaining the multi-provider philosophy that defines the LLxprt architecture.

### REQ A2A-AUTH-002: NoAuthProvider for Unauthenticated Agents

**Full EARS Text**: The system shall provide a NoAuthProvider for unauthenticated remote agents.

**Behavior Specification**:
- GIVEN: A NoAuthProvider is configured
- WHEN: The system loads a remote agent
- THEN: authProvider.getAuthHandler() shall return undefined
- AND: The system shall use native fetch without authentication headers

**Why This Matters**: Not all remote agents require authentication (public demo agents, internal corporate agents on trusted networks). NoAuthProvider supports this use case without special-casing "no auth" throughout the codebase.

### REQ A2A-CFG-001: Config Integration for Auth Provider

**Full EARS Text**: The system shall accept a RemoteAgentAuthProvider via the Config class.

**Behavior Specification**:
- GIVEN: A Config instance
- WHEN: config.setRemoteAgentAuthProvider(provider) is called
- THEN: The provider shall be stored for retrieval
- AND: config.getRemoteAgentAuthProvider() shall return the provider
- AND: RemoteAgentInvocation shall retrieve the provider from Config when creating A2AClientManager instances

**Why This Matters**: Centralized configuration ensures all remote agent operations use consistent authentication. Config is LLxprt's dependency injection container, making it the natural integration point for auth providers.

## Implementation Tasks

### Files to Create

**`packages/core/src/agents/auth-providers.ts`** — Auth provider interface and NoAuthProvider implementation

**Create with stubs:**

```typescript
import type { AuthenticationHandler } from '@google/genai-a2a-sdk';

/**
 * Authentication provider for remote A2A agents.
 * Enables pluggable authentication strategies (ADC, bearer token, OAuth, etc.).
 * @plan PLAN-20260302-A2A.P09
 * @requirement A2A-AUTH-001
 */
export interface RemoteAgentAuthProvider {
  /**
   * Get authentication handler for a specific agent URL.
   * @param agentCardUrl The agent's card URL
   * @returns AuthenticationHandler for this agent, or undefined for no auth
   */
  getAuthHandler(agentCardUrl: string): Promise<AuthenticationHandler | undefined>;
}

/**
 * No-op authentication provider for unauthenticated remote agents.
 * @plan PLAN-20260302-A2A.P09
 * @requirement A2A-AUTH-002
 */
export class NoAuthProvider implements RemoteAgentAuthProvider {
  async getAuthHandler(_agentCardUrl: string): Promise<undefined> {
    // STUB: Return undefined (no authentication)
    return undefined;
  }
}
```

### File to Modify

**`packages/core/src/config/config.ts`** — Add auth provider getter/setter

**Add after line 611 (after getProviderManager method):**

```typescript
/**
 * Set the remote agent authentication provider.
 * @plan PLAN-20260302-A2A.P09
 * @requirement A2A-CFG-001
 */
setRemoteAgentAuthProvider(provider: RemoteAgentAuthProvider): void {
  // STUB: Store but don't use yet
  this.remoteAgentAuthProvider = provider;
}

/**
 * Get the remote agent authentication provider.
 * @plan PLAN-20260302-A2A.P09
 * @requirement A2A-CFG-001
 */
getRemoteAgentAuthProvider(): RemoteAgentAuthProvider | undefined {
  // STUB: Return stored provider
  return this.remoteAgentAuthProvider;
}
```

**Add private field after line 93 (after providerManager field):**

```typescript
/**
 * Authentication provider for remote A2A agents.
 * @plan PLAN-20260302-A2A.P09
 * @requirement A2A-CFG-001
 */
private remoteAgentAuthProvider?: RemoteAgentAuthProvider;
```

**Add import at top of file (after existing imports):**

```typescript
import type { RemoteAgentAuthProvider } from '../agents/auth-providers.js';
```

### Required Code Markers

Every new interface/class/method MUST include:
```typescript
/**
 * @plan PLAN-20260302-A2A.P09
 * @requirement A2A-AUTH-001 | A2A-AUTH-002 | A2A-CFG-001
 */
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 09 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 08a completed by checking:
- `npm test -- packages/core/src/agents/__tests__/a2a-utils.test.ts` all tests PASS
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P08a-report.md` exists

YOUR TASK:
1. Create `packages/core/src/agents/auth-providers.ts` with RemoteAgentAuthProvider interface and NoAuthProvider class
2. Modify `packages/core/src/config/config.ts` to add auth provider storage

PART 1: Create auth-providers.ts

**RemoteAgentAuthProvider interface:**
- Method: `getAuthHandler(agentCardUrl: string): Promise<AuthenticationHandler | undefined>`
- Import `AuthenticationHandler` from `@google/genai-a2a-sdk` (add NOTE comment about SDK availability in P15)
- JSDoc markers: @plan PLAN-20260302-A2A.P09, @requirement A2A-AUTH-001

**NoAuthProvider class:**
- Implements RemoteAgentAuthProvider
- Method `getAuthHandler` returns `undefined` (stub)
- JSDoc markers: @plan PLAN-20260302-A2A.P09, @requirement A2A-AUTH-002

NOTE at top of file:
```typescript
// NOTE: @google/genai-a2a-sdk dependency will be added in Phase 15
// TypeScript errors about missing module are expected for stub phase
```

PART 2: Modify config.ts

**Add private field** (after line 93, after providerManager):
```typescript
private remoteAgentAuthProvider?: RemoteAgentAuthProvider;
```

**Add import** (after existing imports):
```typescript
import type { RemoteAgentAuthProvider } from '../agents/auth-providers.js';
```

**Add methods** (after line 611, after getProviderManager):
```typescript
setRemoteAgentAuthProvider(provider: RemoteAgentAuthProvider): void {
  this.remoteAgentAuthProvider = provider;
}

getRemoteAgentAuthProvider(): RemoteAgentAuthProvider | undefined {
  return this.remoteAgentAuthProvider;
}
```

All methods need JSDoc with @plan PLAN-20260302-A2A.P09, @requirement A2A-CFG-001 markers.

STUB RULES:
- NoAuthProvider.getAuthHandler returns undefined (stub)
- Config methods just store/retrieve (no validation)
- No implementation logic (that's P11)

DELIVERABLES:
- auth-providers.ts created (~40 lines)
- config.ts modified (+~30 lines)
- All types/methods have JSDoc markers
- Files compile (ignore SDK import error)

DO NOT:
- Implement GoogleADCAuthProvider (that's P12-14)
- Add validation logic (that's P11)
- Write tests (that's P10)
- Use the auth provider anywhere (that's P15-17)
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check auth-providers.ts exists
ls packages/core/src/agents/auth-providers.ts
# Expected: File exists

# Check plan markers in auth-providers.ts
grep -c "@plan PLAN-20260302-A2A.P09" packages/core/src/agents/auth-providers.ts
# Expected: 2 occurrences (interface + class)

# Check requirements in auth-providers.ts
grep "@requirement A2A-AUTH-001\|@requirement A2A-AUTH-002" packages/core/src/agents/auth-providers.ts
# Expected: 2 occurrences

# Check Config modifications
grep -c "@plan PLAN-20260302-A2A.P09" packages/core/src/config/config.ts
# Expected: 3 occurrences (field + 2 methods)

# Check Config requirements
grep "@requirement A2A-CFG-001" packages/core/src/config/config.ts
# Expected: 3 occurrences

# Check exports
grep "^export.*RemoteAgentAuthProvider\|^export.*NoAuthProvider" packages/core/src/agents/auth-providers.ts
# Expected: Both exported

# TypeScript compiles (will have SDK import error, acceptable)
npx tsc --noEmit packages/core/src/agents/auth-providers.ts 2>&1 | grep "Cannot find module '@google/genai-a2a-sdk'"
# Expected: Module not found error (acceptable, SDK added in P15)

# Config compiles
npx tsc --noEmit packages/core/src/config/config.ts
# Expected: SUCCESS (config.ts itself should compile)
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME in implementation (file-level comment OK)
grep -E "(TODO|FIXME|HACK|STUB)" packages/core/src/agents/auth-providers.ts | grep -v "NOTE:"
# Expected: No matches in function bodies

grep -E "(TODO|FIXME|HACK|STUB)" packages/core/src/config/config.ts | grep "@plan PLAN-20260302-A2A.P09" -A 5 -B 5
# Expected: No TODO in new methods
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] I read auth-providers.ts (not just checked file exists)
- [ ] RemoteAgentAuthProvider interface has getAuthHandler(agentCardUrl: string): Promise<AuthenticationHandler | undefined>
- [ ] NoAuthProvider class implements RemoteAgentAuthProvider
- [ ] NoAuthProvider.getAuthHandler returns undefined
- [ ] Config has setRemoteAgentAuthProvider and getRemoteAgentAuthProvider methods
- [ ] Config has private remoteAgentAuthProvider field

**Is this REAL stub implementation, not placeholder?**
- [ ] Interface method signature correct
- [ ] NoAuthProvider stub returns correct type (undefined)
- [ ] Config methods store and retrieve correctly
- [ ] All items have JSDoc markers

**Would stub prevent P10 tests from compiling?**
- [ ] Interface exported correctly
- [ ] NoAuthProvider exported correctly
- [ ] Config methods have correct signatures
- [ ] Return types match requirements

**What's MISSING (acceptable for stub phase)?**
- GoogleADCAuthProvider (P12-14)
- Validation logic (P11)
- Actual usage (P15-17)
- Tests (P10)

## Success Criteria

- All verification commands return expected results
- auth-providers.ts created with interface and NoAuthProvider class
- config.ts modified with auth provider storage
- All types/methods have @plan and @requirement markers
- Files compile (ignore SDK import error)
- No TODO comments in method bodies
- Ready for P09a verification

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   rm -f packages/core/src/agents/auth-providers.ts
   git checkout -- packages/core/src/config/config.ts
   ```
2. Fix issues based on verification failures
3. Cannot proceed to Phase 09a until stubs are correct

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P09.md`

Contents:
```markdown
Phase: P09
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/auth-providers.ts (~40 lines)
Files Modified: packages/core/src/config/config.ts (+~30 lines)

Components Added:
  - RemoteAgentAuthProvider interface
  - NoAuthProvider class
  - Config.setRemoteAgentAuthProvider() method
  - Config.getRemoteAgentAuthProvider() method
  - Config.remoteAgentAuthProvider private field

Markers: 2 in auth-providers.ts, 3 in config.ts

Verification: [paste grep output showing exports and markers]

Next Phase: P09a (Verification of P09)
```
