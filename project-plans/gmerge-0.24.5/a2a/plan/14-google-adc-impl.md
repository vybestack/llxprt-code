# Phase 14: Google ADC Auth Provider - Implementation

## Phase ID

`PLAN-20260302-A2A.P14`

## Prerequisites

- Required: Phase 13 completed and verified
- Verification: GoogleADCAuthProvider tests exist and fail against stubs
- Expected files:
  - `packages/core/src/agents/auth-providers.ts` with GoogleADCAuthProvider stub
  - `packages/core/src/agents/__tests__/auth-providers.test.ts` with tests

## Requirements Implemented

### REQ A2A-AUTH-003: Full Google ADC Implementation

(All requirements implemented in P12-13, now making tests pass with full implementation)

**Why This Matters**: Implements actual Google ADC token retrieval using google-auth-library, enabling authentication with Vertex AI Agent Engine.

## Implementation Tasks

### Files to Modify

**`packages/core/src/agents/auth-providers.ts`** — Implement GoogleADCAuthProvider.getAuthHandler()

**Replace stub implementation:**

```typescript
/**
 * Google Application Default Credentials (ADC) authentication provider.
 * Uses google-auth-library to retrieve access tokens from ADC credential chain.
 * @plan PLAN-20260302-A2A.P14
 * @requirement A2A-AUTH-003
 */
export class GoogleADCAuthProvider implements RemoteAgentAuthProvider {
  async getAuthHandler(_agentCardUrl: string): Promise<AuthenticationHandler> {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    
    return {
      async headers(): Promise<Record<string, string>> {
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        
        if (!tokenResponse.token) {
          throw new Error('Failed to retrieve ADC access token');
        }
        
        return { Authorization: `Bearer ${tokenResponse.token}` };
      },
      async shouldRetryWithHeaders(): Promise<Record<string, string> | undefined> {
        // Re-fetch token on retry (handles token expiration)
        return this.headers();
      },
    };
  }
}
```

**`package.json`** — Add google-auth-library dependency

**Add to dependencies:**

```json
"google-auth-library": "^9.0.0"
```

### Required Code Markers

Update JSDoc to use P14 marker:
```typescript
/**
 * @plan PLAN-20260302-A2A.P14
 * @requirement A2A-AUTH-003
 */
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 14 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 13 completed by checking:
- `grep -c "@plan:PLAN-20260302-A2A.P13" packages/core/src/agents/__tests__/auth-providers.test.ts` returns 5+
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P13a-report.md` exists

YOUR TASK:
1. Replace GoogleADCAuthProvider stub with full implementation in `packages/core/src/agents/auth-providers.ts`
2. Add google-auth-library dependency to `package.json`

PART 1: Implement getAuthHandler()

Replace stub with:
```typescript
async getAuthHandler(_agentCardUrl: string): Promise<AuthenticationHandler> {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  
  return {
    async headers(): Promise<Record<string, string>> {
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      
      if (!tokenResponse.token) {
        throw new Error('Failed to retrieve ADC access token');
      }
      
      return { Authorization: `Bearer ${tokenResponse.token}` };
    },
    async shouldRetryWithHeaders(): Promise<Record<string, string> | undefined> {
      return this.headers();  // Re-fetch token on retry
    },
  };
}
```

Update JSDoc marker to @plan PLAN-20260302-A2A.P14 (keep @requirement A2A-AUTH-003).

Remove NOTE comment about missing google-auth-library (dependency added below).

PART 2: Add dependency to package.json

Find the "dependencies" section in `packages/core/package.json`.

Add (in alphabetical order):
```json
"google-auth-library": "^9.0.0"
```

PART 3: Install dependency

Run:
```bash
npm install
```

PART 4: Verify tests pass

Run:
```bash
npm test -- packages/core/src/agents/__tests__/auth-providers.test.ts
```

EXPECTED: All 15 tests pass (10 from P10 + 5 from P13).

DELIVERABLES:
- GoogleADCAuthProvider fully implemented
- google-auth-library dependency added
- All tests pass (15/15)
- JSDoc updated to P14 marker

DO NOT:
- Change NoAuthProvider (already complete)
- Modify test files (implementation only)
- Add new auth providers (only GoogleADC in this phase)
```

## Verification Commands

### Automated Checks

```bash
# All tests pass
npm test -- packages/core/src/agents/__tests__/auth-providers.test.ts
# Expected: 15/15 pass (10 from P10 + 5 from P13)

# Implementation uses GoogleAuth
grep "new GoogleAuth" packages/core/src/agents/auth-providers.ts
# Expected: 1 occurrence in GoogleADCAuthProvider

# Correct OAuth scope
grep "https://www.googleapis.com/auth/cloud-platform" packages/core/src/agents/auth-providers.ts
# Expected: 1 occurrence

# Error handling for missing token
grep "Failed to retrieve ADC access token" packages/core/src/agents/auth-providers.ts
# Expected: 1 occurrence

# Dependency added
grep '"google-auth-library"' packages/core/package.json
# Expected: 1 occurrence

# JSDoc updated
grep "@plan:PLAN-20260302-A2A.P14" packages/core/src/agents/auth-providers.ts
# Expected: 1 occurrence (GoogleADCAuthProvider class)

# No TODO in implementation
grep "@plan:PLAN-20260302-A2A.P14" packages/core/src/agents/auth-providers.ts -A 25 | grep -E "(TODO|FIXME|HACK|STUB)"
# Expected: Empty
```

### Semantic Verification Checklist

**Is implementation complete?**
- [ ] All 15 tests pass (10 from P10 + 5 from P13)
- [ ] GoogleADCAuthProvider.getAuthHandler() creates GoogleAuth instance
- [ ] GoogleAuth called with correct scopes: ['https://www.googleapis.com/auth/cloud-platform']
- [ ] handler.headers() retrieves token via getClient().getAccessToken()
- [ ] handler.headers() throws error if token is null
- [ ] handler.headers() returns { Authorization: `Bearer ${token}` }
- [ ] handler.shouldRetryWithHeaders() re-fetches token
- [ ] google-auth-library dependency added to package.json
- [ ] npm install completed successfully
- [ ] No TODO/FIXME/HACK in implementation

**Is code production-ready?**
- [ ] Error handling for missing ADC credentials
- [ ] Token refresh on retry
- [ ] Follows existing code style
- [ ] JSDoc updated to P14 marker

## Success Criteria

- All tests pass (15/15)
- No TODO comments in implementation
- google-auth-library dependency added and installed
- Implementation matches design doc
- Ready for P14a verification

## Failure Recovery

If this phase fails:

1. Fix identified issues in auth-providers.ts or package.json
2. Re-run tests
3. Verify fixes pass all checks
4. Cannot proceed to Phase 14a until implementation is complete and all tests pass

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P14.md`

Contents:
```markdown
Phase: P14
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: 
  - packages/core/src/agents/auth-providers.ts (GoogleADCAuthProvider implementation)
  - packages/core/package.json (+google-auth-library dependency)

Implementation Status:
  - GoogleADCAuthProvider: Complete (ADC token retrieval with google-auth-library)
  - All tests: PASS (15/15)

Verification: [paste npm test output]

Next Phase: P14a (Verification of P14)
```
