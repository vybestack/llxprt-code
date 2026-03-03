# Phase 13: Google ADC Auth Provider - TDD

## Phase ID

`PLAN-20260302-A2A.P13`

## Prerequisites

- Required: Phase 12 completed and verified
- Verification: `ls packages/core/src/agents/auth-providers.ts` contains GoogleADCAuthProvider class
- Expected: GoogleADCAuthProvider stub exists

## Requirements Implemented

### REQ A2A-AUTH-003: Google ADC Token Retrieval

**Full EARS Text**: The system shall provide a GoogleADCAuthProvider for Google Cloud agents.

**Behavior Specification** (TDD Tests):
- GIVEN: A GoogleADCAuthProvider instance
- WHEN: getAuthHandler() is called
- THEN: It shall return an AuthenticationHandler with Google ADC bearer token in headers()

**Why This Matters**: Tests verify that GoogleADCAuthProvider correctly integrates with google-auth-library to retrieve and format ADC tokens. This ensures Vertex AI Agent Engine authentication works correctly.

**CRITICAL TESTING NOTE**: Per RULES.md, mocking google-auth-library is APPROPRIATE here because it's an **external boundary** (third-party library, network I/O). We test our integration with the library, not the library itself.

## Implementation Tasks

### File to Modify

**`packages/core/src/agents/__tests__/auth-providers.test.ts`** — Add GoogleADCAuthProvider tests

### Test Structure and Requirements

**MANDATORY RULES**:
1. **Mock google-auth-library**: This is an external boundary (network I/O, third-party SDK)
2. **Test INTEGRATION behavior**: Verify we correctly call GoogleAuth APIs and format tokens
3. **Tests WILL FAIL against stubs**: Stubs return empty headers
4. **Every test has markers**: `@plan`, `@requirement`, and `@scenario` in JSDoc

### Required Tests

**Add new describe block to existing test file:**

```typescript
import { vi } from 'vitest';

/**
 * @plan PLAN-20260302-A2A.P13
 * @requirement A2A-AUTH-003
 * @scenario GoogleADCAuthProvider integrates with google-auth-library
 */
describe('GoogleADCAuthProvider', () => {
  /**
   * @plan PLAN-20260302-A2A.P13
   * @requirement A2A-AUTH-003
   * @scenario ADC token retrieval via google-auth-library
   */
  it('should return handler with ADC bearer token in headers', async () => {
    // Mock google-auth-library (external boundary)
    const mockGetAccessToken = vi.fn().mockResolvedValue({ token: 'mock-adc-token-12345' });
    const mockGetClient = vi.fn().mockResolvedValue({
      getAccessToken: mockGetAccessToken,
    });
    
    vi.mock('google-auth-library', () => ({
      GoogleAuth: vi.fn().mockImplementation(() => ({
        getClient: mockGetClient,
      })),
    }));
    
    const { GoogleADCAuthProvider } = await import('../auth-providers.js');
    const provider = new GoogleADCAuthProvider();
    
    const handler = await provider.getAuthHandler('https://agent.googleapis.com/card');
    
    const headers = await handler!.headers();
    expect(headers.Authorization).toBe('Bearer mock-adc-token-12345');
  });
  
  it('should request correct OAuth scopes', async () => {
    const mockGoogleAuth = vi.fn();
    vi.mock('google-auth-library', () => ({
      GoogleAuth: mockGoogleAuth,
    }));
    
    const { GoogleADCAuthProvider } = await import('../auth-providers.js');
    const provider = new GoogleADCAuthProvider();
    
    await provider.getAuthHandler('https://test.com');
    
    expect(mockGoogleAuth).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  });
  
  it('should throw if ADC token is unavailable', async () => {
    const mockGetAccessToken = vi.fn().mockResolvedValue({ token: null });
    const mockGetClient = vi.fn().mockResolvedValue({
      getAccessToken: mockGetAccessToken,
    });
    
    vi.mock('google-auth-library', () => ({
      GoogleAuth: vi.fn().mockImplementation(() => ({
        getClient: mockGetClient,
      })),
    }));
    
    const { GoogleADCAuthProvider } = await import('../auth-providers.js');
    const provider = new GoogleADCAuthProvider();
    
    const handler = await provider.getAuthHandler('https://test.com');
    
    await expect(handler!.headers()).rejects.toThrow('Failed to retrieve ADC access token');
  });
  
  it('should support token refresh on shouldRetryWithHeaders', async () => {
    const mockGetAccessToken = vi.fn()
      .mockResolvedValueOnce({ token: 'first-token' })
      .mockResolvedValueOnce({ token: 'refreshed-token' });
    const mockGetClient = vi.fn().mockResolvedValue({
      getAccessToken: mockGetAccessToken,
    });
    
    vi.mock('google-auth-library', () => ({
      GoogleAuth: vi.fn().mockImplementation(() => ({
        getClient: mockGetClient,
      })),
    }));
    
    const { GoogleADCAuthProvider } = await import('../auth-providers.js');
    const provider = new GoogleADCAuthProvider();
    
    const handler = await provider.getAuthHandler('https://test.com');
    
    const headers1 = await handler!.headers();
    expect(headers1.Authorization).toBe('Bearer first-token');
    
    const retryHeaders = await handler!.shouldRetryWithHeaders!();
    expect(retryHeaders!.Authorization).toBe('Bearer refreshed-token');
  });
  
  it('should implement RemoteAgentAuthProvider interface', async () => {
    const { GoogleADCAuthProvider } = await import('../auth-providers.js');
    const provider = new GoogleADCAuthProvider();
    
    const interfaceProvider: RemoteAgentAuthProvider = provider;
    expect(typeof interfaceProvider.getAuthHandler).toBe('function');
  });
});
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 13 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 12 completed by checking:
- `grep "export class GoogleADCAuthProvider" packages/core/src/agents/auth-providers.ts` returns 1 match
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P12a-report.md` exists

YOUR TASK:
Add GoogleADCAuthProvider tests to `packages/core/src/agents/__tests__/auth-providers.test.ts`.

MANDATORY RULES:
1. **MOCKING IS ALLOWED**: google-auth-library is an external boundary (network I/O, third-party SDK)
2. Test INTEGRATION behavior (how we call GoogleAuth, how we format tokens)
3. Tests WILL FAIL against stubs (stubs return empty headers)
4. Every test has `@plan PLAN-20260302-A2A.P13`, `@requirement A2A-AUTH-003`, and `@scenario` markers

TEST COVERAGE REQUIRED (5 tests):

1. **ADC token retrieval**: Mock GoogleAuth.getClient().getAccessToken() returning token, verify handler.headers() includes "Bearer {token}"
2. **Correct OAuth scopes**: Verify GoogleAuth constructor called with scopes: ['https://www.googleapis.com/auth/cloud-platform']
3. **Missing token error**: Mock getAccessToken() returning { token: null }, verify handler.headers() throws "Failed to retrieve ADC access token"
4. **Token refresh**: Mock getAccessToken() returning different tokens on multiple calls, verify shouldRetryWithHeaders() re-fetches token
5. **Interface compliance**: Verify GoogleADCAuthProvider implements RemoteAgentAuthProvider

MOCKING PATTERN:
```typescript
import { vi } from 'vitest';

// Mock google-auth-library
const mockGetAccessToken = vi.fn().mockResolvedValue({ token: 'mock-token' });
const mockGetClient = vi.fn().mockResolvedValue({
  getAccessToken: mockGetAccessToken,
});

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getClient: mockGetClient,
  })),
}));
```

ADD TO EXISTING FILE:
Add new describe block after Config Integration tests.

DELIVERABLES:
- 5 tests added to auth-providers.test.ts
- All tests have @plan, @requirement, @scenario markers
- Tests use vi.mock for google-auth-library
- Tests FAIL against stubs (prove behavioral testing)
- Coverage: token retrieval, scopes, error handling, refresh, interface

DO NOT:
- Test google-auth-library itself (test our integration only)
- Make tests pass (they should fail against stubs)
- Add implementation logic (that's P14)
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -c "@plan PLAN-20260302-A2A.P13" packages/core/src/agents/__tests__/auth-providers.test.ts
# Expected: 5+ occurrences

# Check requirements
grep -c "@requirement A2A-AUTH-003" packages/core/src/agents/__tests__/auth-providers.test.ts
# Expected: 5+ occurrences

# Run tests (they should FAIL against stubs)
npm test -- packages/core/src/agents/__tests__/auth-providers.test.ts 2>&1 | grep -E "(FAIL|failing)"
# Expected: GoogleADCAuthProvider tests fail (stubs return empty headers)

# Check for mocking (should exist for google-auth-library)
grep "vi\.mock.*google-auth-library" packages/core/src/agents/__tests__/auth-providers.test.ts
# Expected: Matches found (mocking external boundary is correct per RULES.md)
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] I read the test file
- [ ] Tests verify handler.headers() returns Authorization: Bearer {token}
- [ ] Tests verify GoogleAuth called with correct scopes
- [ ] Tests verify error thrown when token unavailable
- [ ] Tests verify shouldRetryWithHeaders() refreshes token
- [ ] All tests have @plan, @requirement, @scenario markers

**Is this REAL testing, not placeholder?**
- [ ] Tests mock google-auth-library (external boundary - correct per RULES.md)
- [ ] Tests verify our integration behavior (not library internals)
- [ ] Tests FAIL against stubs (checked by running npm test)
- [ ] All tests have assertions

**Would tests FAIL if integration was broken?**
- [ ] If we don't call GoogleAuth, tests would fail
- [ ] If we don't format token as "Bearer {token}", tests would fail
- [ ] If we don't request correct scopes, tests would fail

**What's MISSING (acceptable for TDD phase)?**
- Implementation logic (P14)
- google-auth-library dependency (P14)

## Success Criteria

- All verification commands return expected results
- 5+ tests added covering all scenarios
- Tests FAIL against stubs (proving behavioral testing)
- Mocking used for google-auth-library (external boundary)
- All tests have @plan, @requirement, @scenario markers

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   git checkout -- packages/core/src/agents/__tests__/auth-providers.test.ts
   ```
2. Fix issues based on verification failures
3. Cannot proceed to Phase 13a until tests are correct and failing against stubs

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P13.md`

Contents:
```markdown
Phase: P13
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/__tests__/auth-providers.test.ts (+~80 lines)
Tests Added: GoogleADCAuthProvider tests (5 tests)
Total Tests: 15 (10 from P10 + 5 new)
Test Results: GoogleADCAuthProvider tests FAIL against stubs (expected - proves behavioral testing)
Verification: [paste npm test output showing failures]

Next Phase: P13a (Verification of P13)
```
