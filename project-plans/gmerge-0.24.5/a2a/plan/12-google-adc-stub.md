# Phase 12: Google ADC Auth Provider - Stub

## Phase ID

`PLAN-20260302-A2A.P12`

## Prerequisites

- Required: Phase 11a (Auth Provider Implementation Verification) completed
- Verification: `npm test -- packages/core/src/agents/__tests__/auth-providers.test.ts` all tests PASS
- Expected files:
  - `packages/core/src/agents/auth-providers.ts` exists with RemoteAgentAuthProvider and NoAuthProvider

## Requirements Implemented

### REQ A2A-AUTH-003: Google ADC Auth Provider

**Full EARS Text**: The system shall provide a GoogleADCAuthProvider for Google Cloud agents.

**Behavior Specification**:
- GIVEN: A GoogleADCAuthProvider is configured
- WHEN: The system loads a remote agent at https://agent.googleapis.com/...
- THEN: authProvider.getAuthHandler() shall return an ADCHandler
- AND: HTTP requests shall include Google ADC bearer tokens

**Why This Matters**: Upstream ships ADCHandler as the only auth path in 0.24.5 (`96b9be3ec`). Without it, Vertex AI Agent Engine integration doesn't work. LLxprt wraps this in the pluggable `RemoteAgentAuthProvider` interface so it's swappable for other cloud providers (OCI, AWS, Azure).

**Rationale**: Vertex AI Agent Engine is the most common A2A deployment target for Google Cloud users. Google's Application Default Credentials (ADC) pattern is the standard authentication mechanism for GCP services. This provider enables seamless integration with Vertex AI agents without requiring manual token management.

## Implementation Tasks

### File to Modify

**`packages/core/src/agents/auth-providers.ts`** — Add GoogleADCAuthProvider class

**Add after NoAuthProvider:**

```typescript
import { GoogleAuth } from 'google-auth-library';

/**
 * Google Application Default Credentials (ADC) authentication provider.
 * Uses google-auth-library to retrieve access tokens from ADC credential chain.
 * @plan PLAN-20260302-A2A.P12
 * @requirement A2A-AUTH-003
 */
export class GoogleADCAuthProvider implements RemoteAgentAuthProvider {
  async getAuthHandler(_agentCardUrl: string): Promise<AuthenticationHandler> {
    // STUB: Return minimal handler that returns empty headers
    return {
      async headers(): Promise<Record<string, string>> {
        return {};
      },
      async shouldRetryWithHeaders(): Promise<Record<string, string> | undefined> {
        return undefined;
      },
    };
  }
}
```

**Add import at top of file:**

```typescript
import { GoogleAuth } from 'google-auth-library';
```

**Add NOTE comment below existing SDK comment:**

```typescript
// NOTE: google-auth-library dependency will be added to package.json in Phase 14
// TypeScript errors about missing module are expected for stub phase
```

### Required Code Markers

Class MUST include:
```typescript
/**
 * @plan PLAN-20260302-A2A.P12
 * @requirement A2A-AUTH-003
 */
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 12 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 11a completed by checking:
- `npm test -- packages/core/src/agents/__tests__/auth-providers.test.ts` all tests PASS (10 tests)
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P11a-report.md` exists

YOUR TASK:
Add GoogleADCAuthProvider class stub to `packages/core/src/agents/auth-providers.ts`.

LOCATION:
Add after NoAuthProvider class, before end of file.

CLASS STRUCTURE:
```typescript
export class GoogleADCAuthProvider implements RemoteAgentAuthProvider {
  async getAuthHandler(_agentCardUrl: string): Promise<AuthenticationHandler> {
    // STUB: Return minimal handler with empty headers
    return {
      async headers(): Promise<Record<string, string>> {
        return {};
      },
      async shouldRetryWithHeaders(): Promise<Record<string, string> | undefined> {
        return undefined;
      },
    };
  }
}
```

IMPORTS TO ADD:
```typescript
import { GoogleAuth } from 'google-auth-library';
```

NOTE TO ADD (below existing SDK note):
```typescript
// NOTE: google-auth-library dependency will be added to package.json in Phase 14
// TypeScript errors about missing module are expected for stub phase
```

JSDOC:
```typescript
/**
 * Google Application Default Credentials (ADC) authentication provider.
 * Uses google-auth-library to retrieve access tokens from ADC credential chain.
 * @plan PLAN-20260302-A2A.P12
 * @requirement A2A-AUTH-003
 */
```

STUB RULES:
- Class implements RemoteAgentAuthProvider interface
- getAuthHandler returns minimal AuthenticationHandler with empty headers
- No actual ADC token retrieval (that's P14)
- Import GoogleAuth even though it will error (add explanatory NOTE)

DELIVERABLES:
- GoogleADCAuthProvider class added to auth-providers.ts
- Class exported
- JSDoc with markers
- File compiles (ignore google-auth-library import error)

DO NOT:
- Implement actual token retrieval (that's P14)
- Write tests (that's P13)
- Add validation logic
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check class exists
grep "export class GoogleADCAuthProvider" packages/core/src/agents/auth-providers.ts
# Expected: 1 occurrence

# Check plan markers
grep -c "@plan:PLAN-20260302-A2A.P12" packages/core/src/agents/auth-providers.ts
# Expected: 1 occurrence

# Check requirements
grep "@requirement:A2A-AUTH-003" packages/core/src/agents/auth-providers.ts
# Expected: 1 occurrence

# Check import
grep "import.*GoogleAuth.*google-auth-library" packages/core/src/agents/auth-providers.ts
# Expected: 1 occurrence

# TypeScript compiles (will have import error, acceptable)
npx tsc --noEmit packages/core/src/agents/auth-providers.ts 2>&1 | grep "Cannot find module 'google-auth-library'"
# Expected: Module not found error (acceptable until P14)
```

### Deferred Implementation Detection

```bash
# Check for TODO in class body (NOTE at file top OK)
grep "@plan:PLAN-20260302-A2A.P12" packages/core/src/agents/auth-providers.ts -A 20 | grep -E "(TODO|FIXME|HACK|STUB)" | grep -v "STUB:"
# Expected: No matches (STUB: comment in stub return OK)
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] I read the auth-providers.ts file
- [ ] GoogleADCAuthProvider class exists
- [ ] Class implements RemoteAgentAuthProvider interface
- [ ] getAuthHandler method exists with correct signature
- [ ] Method returns AuthenticationHandler (stub with empty headers)
- [ ] Class has JSDoc with @plan and @requirement A2A-AUTH-003
- [ ] Class is exported
- [ ] GoogleAuth import added (with NOTE about availability)

**Is this REAL stub implementation, not placeholder?**
- [ ] getAuthHandler returns correct type (AuthenticationHandler)
- [ ] Handler has headers() and shouldRetryWithHeaders() methods
- [ ] Stub returns empty but valid structure
- [ ] No TODO in class body (STUB: comment OK)

**Would stub prevent P13 tests from compiling?**
- [ ] Class signature matches interface
- [ ] Return type correct
- [ ] Methods callable

**What's MISSING (acceptable for stub phase)?**
- Actual ADC token retrieval (P14)
- Tests (P13)
- google-auth-library dependency (P14)

## Success Criteria

- All verification commands return expected results
- GoogleADCAuthProvider class added to auth-providers.ts
- Class exported and implements RemoteAgentAuthProvider
- JSDoc with @plan and @requirement markers
- File compiles (ignore google-auth-library import error)
- No TODO in class body
- Ready for P12a verification

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   git checkout -- packages/core/src/agents/auth-providers.ts
   ```
2. Fix issues based on verification failures
3. Cannot proceed to Phase 12a until stub is correct

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P12.md`

Contents:
```markdown
Phase: P12
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/auth-providers.ts (+~25 lines)

Components Added:
  - GoogleADCAuthProvider class (stub)
  - GoogleAuth import from google-auth-library

Markers: 1 @plan, 1 @requirement

TypeScript Status: Module 'google-auth-library' not found (expected, added in P14)

Verification: [paste grep output showing class export and markers]

Next Phase: P12a (Verification of P12)
```
