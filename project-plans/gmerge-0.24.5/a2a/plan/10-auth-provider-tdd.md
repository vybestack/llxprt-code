# Phase 10: Auth Provider Abstraction - TDD

## Phase ID

`PLAN-20260302-A2A.P10`

## Prerequisites

- Required: Phase 09 completed and verified
- Verification: `ls packages/core/src/agents/auth-providers.ts` file exists
- Expected: RemoteAgentAuthProvider interface and NoAuthProvider class exist

## Requirements Implemented

### REQ A2A-AUTH-001: Auth Provider Interface Contract

**Full EARS Text**: The system shall support pluggable authentication providers via a RemoteAgentAuthProvider interface.

**Behavior Specification** (TDD Tests):
- GIVEN: A RemoteAgentAuthProvider implementation
- WHEN: getAuthHandler() is called with an agent URL
- THEN: It shall return a Promise resolving to AuthenticationHandler or undefined

**Why This Matters**: Tests verify the interface contract is correctly implemented by all auth providers. This ensures any provider can be swapped without breaking remote agent functionality.

### REQ A2A-AUTH-002: NoAuthProvider Behavior

**Full EARS Text**: The system shall provide a NoAuthProvider for unauthenticated remote agents.

**Behavior Specification** (TDD Tests):
- GIVEN: A NoAuthProvider instance
- WHEN: getAuthHandler() is called
- THEN: It shall return undefined (no authentication)

**Why This Matters**: Tests verify NoAuthProvider correctly implements the "no authentication" use case without errors or side effects.

### REQ A2A-CFG-001: Config Storage Behavior

**Full EARS Text**: The system shall accept a RemoteAgentAuthProvider via the Config class.

**Behavior Specification** (TDD Tests):
- GIVEN: A Config instance
- WHEN: setRemoteAgentAuthProvider(provider) is called
- THEN: getRemoteAgentAuthProvider() shall return the same provider instance

**Why This Matters**: Tests verify Config correctly stores and retrieves auth providers, ensuring provider state is maintained across the session.

## Implementation Tasks

### File to Create

**`packages/core/src/agents/__tests__/auth-providers.test.ts`** — Behavioral tests for auth provider system

### Test Structure and Requirements

**MANDATORY RULES**:
1. **Test BEHAVIOR, not structure**: Tests verify actual provider contract fulfillment
2. **NO mocking**: Use real NoAuthProvider instances
3. **Tests WILL PASS against stubs**: Stubs already return correct types
4. **Every test has markers**: `@plan`, `@requirement`, and `@scenario` in JSDoc
5. **Cover interface contract and Config integration**

### Required Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { NoAuthProvider } from '../auth-providers.js';
import type { RemoteAgentAuthProvider } from '../auth-providers.js';
import { Config } from '../../config/config.js';

/**
 * @plan PLAN-20260302-A2A.P10
 * @requirement A2A-AUTH-001
 * @requirement A2A-AUTH-002
 * @requirement A2A-CFG-001
 * @scenario Auth provider system behavioral tests
 */
describe('Auth Provider System', () => {
  /**
   * @plan PLAN-20260302-A2A.P10
   * @requirement A2A-AUTH-002
   * @scenario NoAuthProvider returns undefined for any agent URL
   */
  describe('NoAuthProvider', () => {
    it('should return undefined for any agent URL', async () => {
      const provider = new NoAuthProvider();
      const handler = await provider.getAuthHandler('https://agent.example.com/card');
      
      expect(handler).toBeUndefined();
    });
    
    it('should return undefined for different URLs', async () => {
      const provider = new NoAuthProvider();
      
      const handler1 = await provider.getAuthHandler('https://agent1.example.com/card');
      const handler2 = await provider.getAuthHandler('https://agent2.example.com/card');
      
      expect(handler1).toBeUndefined();
      expect(handler2).toBeUndefined();
    });
    
    it('should not throw on empty string URL', async () => {
      const provider = new NoAuthProvider();
      
      await expect(provider.getAuthHandler('')).resolves.toBeUndefined();
    });
    
    /**
     * @plan PLAN-20260302-A2A.P10
     * @requirement A2A-AUTH-001
     * @scenario NoAuthProvider implements RemoteAgentAuthProvider contract
     */
    it('should implement RemoteAgentAuthProvider interface', () => {
      const provider = new NoAuthProvider();
      
      // TypeScript type check: NoAuthProvider is assignable to interface
      const interfaceProvider: RemoteAgentAuthProvider = provider;
      
      expect(interfaceProvider).toBeDefined();
      expect(typeof interfaceProvider.getAuthHandler).toBe('function');
    });
    
    it('should return Promise from getAuthHandler', async () => {
      const provider = new NoAuthProvider();
      const result = provider.getAuthHandler('https://test.com/card');
      
      expect(result).toBeInstanceOf(Promise);
      await result; // Ensure it resolves
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P10
   * @requirement A2A-CFG-001
   * @scenario Config stores and retrieves auth providers
   */
  describe('Config Integration', () => {
    let config: Config;
    
    beforeEach(() => {
      config = new Config();
    });
    
    it('should store and retrieve auth provider', () => {
      const provider = new NoAuthProvider();
      
      config.setRemoteAgentAuthProvider(provider);
      const retrieved = config.getRemoteAgentAuthProvider();
      
      expect(retrieved).toBe(provider);
    });
    
    it('should return undefined when no provider is set', () => {
      const retrieved = config.getRemoteAgentAuthProvider();
      
      expect(retrieved).toBeUndefined();
    });
    
    it('should allow overwriting existing provider', () => {
      const provider1 = new NoAuthProvider();
      const provider2 = new NoAuthProvider();
      
      config.setRemoteAgentAuthProvider(provider1);
      config.setRemoteAgentAuthProvider(provider2);
      
      const retrieved = config.getRemoteAgentAuthProvider();
      expect(retrieved).toBe(provider2);
      expect(retrieved).not.toBe(provider1);
    });
    
    it('should maintain provider across multiple retrievals', () => {
      const provider = new NoAuthProvider();
      
      config.setRemoteAgentAuthProvider(provider);
      const retrieved1 = config.getRemoteAgentAuthProvider();
      const retrieved2 = config.getRemoteAgentAuthProvider();
      
      expect(retrieved1).toBe(provider);
      expect(retrieved2).toBe(provider);
      expect(retrieved1).toBe(retrieved2);
    });
    
    /**
     * @plan PLAN-20260302-A2A.P10
     * @requirement A2A-AUTH-001
     * @scenario Config accepts any RemoteAgentAuthProvider implementation
     */
    it('should accept any RemoteAgentAuthProvider implementation', () => {
      // Custom provider for test
      class CustomAuthProvider implements RemoteAgentAuthProvider {
        async getAuthHandler(_url: string) {
          return undefined;
        }
      }
      
      const provider = new CustomAuthProvider();
      
      config.setRemoteAgentAuthProvider(provider);
      const retrieved = config.getRemoteAgentAuthProvider();
      
      expect(retrieved).toBe(provider);
    });
  });
});
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 10 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 09 completed by checking:
- `ls packages/core/src/agents/auth-providers.ts` file exists
- `grep -c "@plan:PLAN-20260302-A2A.P09" packages/core/src/agents/auth-providers.ts` returns 2
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P09a-report.md` exists

YOUR TASK:
Create `packages/core/src/agents/__tests__/auth-providers.test.ts` with behavioral tests for auth provider system.

MANDATORY RULES:
1. Test ACTUAL BEHAVIOR (not just structure)
2. Use real NoAuthProvider instances (no mocks)
3. Tests should PASS against stubs (stubs already return correct types)
4. Every test has `@plan PLAN-20260302-A2A.P10`, `@requirement`, and `@scenario` markers in JSDoc
5. Cover NoAuthProvider behavior and Config integration

TEST COVERAGE REQUIRED:

**NoAuthProvider tests** (5 tests):
1. Returns undefined for any agent URL
2. Returns undefined for different URLs
3. Does not throw on empty string URL
4. Implements RemoteAgentAuthProvider interface (TypeScript type check)
5. Returns Promise from getAuthHandler

**Config Integration tests** (5 tests):
1. Store and retrieve auth provider
2. Return undefined when no provider set
3. Allow overwriting existing provider
4. Maintain provider across multiple retrievals
5. Accept any RemoteAgentAuthProvider implementation (custom test provider)

IMPORTS:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { NoAuthProvider } from '../auth-providers.js';
import type { RemoteAgentAuthProvider } from '../auth-providers.js';
import { Config } from '../../config/config.js';
```

DELIVERABLES:
- auth-providers.test.ts with 10 behavioral tests (2 describe blocks)
- All tests have @plan, @requirement, @scenario markers
- Tests use real objects (no mocks)
- Tests PASS against stubs
- Coverage: NoAuthProvider contract, Config storage

DO NOT:
- Mock any objects (use real NoAuthProvider and Config)
- Test for NotYetImplemented
- Add validation logic (that's P11)
- Test GoogleADCAuthProvider (that's P13)
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20260302-A2A.P10" packages/core/src/agents/__tests__/auth-providers.test.ts
# Expected: 10+ occurrences (one per test)

# Check requirements covered
grep -c "@requirement:A2A-AUTH\|@requirement:A2A-CFG" packages/core/src/agents/__tests__/auth-providers.test.ts
# Expected: 10+ occurrences

# Run tests (they should ALL PASS against stubs)
npm test -- packages/core/src/agents/__tests__/auth-providers.test.ts
# Expected: All pass, 10 tests

# Check for mocks (should be NONE)
grep -E "(vi\.mock|jest\.mock|createMock)" packages/core/src/agents/__tests__/auth-providers.test.ts
# Expected: No matches
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/agents/__tests__/auth-providers.test.ts
# Expected: No matches
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] I read the test file (not just checked file exists)
- [ ] Tests verify NoAuthProvider.getAuthHandler() returns undefined
- [ ] Tests verify Config stores and retrieves auth providers correctly
- [ ] Tests verify Config accepts any RemoteAgentAuthProvider implementation
- [ ] All tests have @plan, @requirement, @scenario markers

**Is this REAL testing, not placeholder?**
- [ ] No mocking (tests use real NoAuthProvider and Config instances)
- [ ] Tests verify actual behavior (return values, type compliance)
- [ ] Tests PASS (verify by running npm test)
- [ ] All tests have assertions

**Would tests FAIL if behavior was broken?**
- [ ] If NoAuthProvider returned non-undefined, tests would fail
- [ ] If Config didn't store provider, tests would fail
- [ ] If provider was lost between retrievals, tests would fail

**What's MISSING (acceptable for TDD phase)?**
- Implementation validation logic (P11)
- GoogleADCAuthProvider tests (P13)

## Success Criteria

- All verification commands return expected results
- 10 tests exist covering all scenarios
- Tests PASS against stubs
- No mocking, no stubs
- All tests have @plan, @requirement, @scenario markers
- Tests verify actual provider behavior and Config integration

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   rm -f packages/core/src/agents/__tests__/auth-providers.test.ts
   ```
2. Fix issues based on verification failures
3. Cannot proceed to Phase 10a until tests are correct and passing

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P10.md`

Contents:
```markdown
Phase: P10
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/__tests__/auth-providers.test.ts (~150 lines)
Tests Added: 
  - NoAuthProvider tests (5 tests)
  - Config Integration tests (5 tests)
Total Tests: 10
Test Results: All PASS
Verification: [paste npm test output showing all tests passing]

Next Phase: P10a (Verification of P10)
```
