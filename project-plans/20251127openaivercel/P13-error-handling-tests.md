# Phase 13: Error Handling TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P13`

## Prerequisites

- Required: Phase 12 completed
- Verification: Streaming tests pass
- Expected files from previous phase: Updated `OpenAIVercelProvider.ts` with streaming
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates failing tests for comprehensive error handling. The provider must gracefully handle various API errors and provide meaningful error messages.

## Requirements Implemented (Expanded)

### REQ-OAV-009: Error Handling

**Full Text**: Must handle API errors with meaningful error messages
**Behavior**:
- GIVEN: An API error occurs
- WHEN: The error is caught
- THEN: A meaningful, user-friendly error message is provided
- AND: Rate limit information is preserved when available

**Test Cases**:
1. Rate limit errors (429)
2. Authentication errors (401)
3. Invalid model errors (404)
4. Server errors (500, 502, 503)
5. Network errors
6. Timeout errors
7. Invalid request errors (400)

## Pseudocode Reference

Tests verify behavior defined in `analysis/pseudocode/005-error-handling.md`:
- **ProviderError class**: Lines 001-013
- **RateLimitError class**: Lines 016-024
- **AuthenticationError class**: Lines 027-032
- **wrapError function**: Lines 040-088
- **createRateLimitError**: Lines 100-119
- **isNetworkError**: Lines 130-152

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P13
// @requirement:REQ-OAV-008
// @pseudocode:005-error-handling.md

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider';
import type { IMessage } from '../../../types';
import { streamText, generateText } from 'ai';
import { ProviderError, RateLimitError, AuthenticationError, wrapError } from '../errors';

vi.mock('ai', () => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
}));

describe('OpenAIVercelProvider Error Handling', () => {
  let provider: OpenAIVercelProvider;
  const testMessages: IMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  ];

  beforeEach(() => {
    provider = new OpenAIVercelProvider();
    provider.setKey('sk-test-key');
    vi.resetAllMocks();
  });

  describe('Rate Limit Errors', () => {
    it('should throw RateLimitError for 429 responses', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).status = 429;
      (rateLimitError as any).headers = {
        'retry-after': '30',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1700000000',
      };
      
      vi.mocked(streamText).mockImplementation(() => {
        throw rateLimitError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      await expect(iterator.next()).rejects.toThrow(RateLimitError);
    });

    it('should include retry-after information in rate limit error', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).status = 429;
      (rateLimitError as any).headers = { 'retry-after': '60' };
      
      vi.mocked(streamText).mockImplementation(() => {
        throw rateLimitError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      try {
        await iterator.next();
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).retryAfter).toBe(60);
      }
    });
  });

  describe('Authentication Errors', () => {
    it('should throw AuthenticationError for 401 responses', async () => {
      const authError = new Error('Invalid API key');
      (authError as any).status = 401;
      
      vi.mocked(streamText).mockImplementation(() => {
        throw authError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      await expect(iterator.next()).rejects.toThrow(AuthenticationError);
    });

    it('should provide helpful message for authentication errors', async () => {
      const authError = new Error('Unauthorized');
      (authError as any).status = 401;
      
      vi.mocked(streamText).mockImplementation(() => {
        throw authError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      try {
        await iterator.next();
      } catch (error) {
        expect((error as Error).message).toContain('API key');
      }
    });
  });

  describe('Model Errors', () => {
    it('should throw ProviderError for invalid model (404)', async () => {
      const modelError = new Error('Model not found');
      (modelError as any).status = 404;
      
      vi.mocked(streamText).mockImplementation(() => {
        throw modelError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'invalid-model' });
      
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });
  });

  describe('Server Errors', () => {
    it('should throw ProviderError for 500 server errors', async () => {
      const serverError = new Error('Internal server error');
      (serverError as any).status = 500;
      
      vi.mocked(streamText).mockImplementation(() => {
        throw serverError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });

    it('should throw ProviderError for 502 bad gateway', async () => {
      const gatewayError = new Error('Bad gateway');
      (gatewayError as any).status = 502;
      
      vi.mocked(streamText).mockImplementation(() => {
        throw gatewayError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });

    it('should throw ProviderError for 503 service unavailable', async () => {
      const unavailableError = new Error('Service unavailable');
      (unavailableError as any).status = 503;
      
      vi.mocked(streamText).mockImplementation(() => {
        throw unavailableError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });
  });

  describe('Network Errors', () => {
    it('should wrap network errors in ProviderError', async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error('ECONNREFUSED');
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Request timeout');
      (timeoutError as any).code = 'ETIMEDOUT';
      
      vi.mocked(streamText).mockImplementation(() => {
        throw timeoutError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });
  });

  describe('Invalid Request Errors', () => {
    it('should throw ProviderError for 400 bad request', async () => {
      const badRequestError = new Error('Invalid request body');
      (badRequestError as any).status = 400;
      
      vi.mocked(streamText).mockImplementation(() => {
        throw badRequestError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });
  });

  describe('Error Messages', () => {
    it('should preserve original error message', async () => {
      const originalError = new Error('Specific API error message');
      (originalError as any).status = 400;
      
      vi.mocked(streamText).mockImplementation(() => {
        throw originalError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      try {
        await iterator.next();
      } catch (error) {
        expect((error as Error).message).toContain('Specific API error message');
      }
    });

    it('should include provider name in error', async () => {
      const genericError = new Error('Something went wrong');
      
      vi.mocked(streamText).mockImplementation(() => {
        throw genericError;
      });

      const iterator = provider.generateChatCompletion(testMessages, { model: 'gpt-4' });
      
      try {
        await iterator.next();
      } catch (error) {
        expect((error as ProviderError).provider).toBe('openaivercel');
      }
    });
  });

  describe('Non-Streaming Errors', () => {
    it('should handle errors in non-streaming mode', async () => {
      vi.mocked(generateText).mockRejectedValue(new Error('API Error'));

      const iterator = provider.generateChatCompletion(testMessages, {
        model: 'gpt-4',
        streaming: false,
      });
      
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });
  });
  
  describe('Property-based tests', () => {
    // Property: All errors have provider field set
    test.prop([fc.string()])('wrapped errors always have provider field', (message) => {
      const error = new Error(message);
      const wrapped = wrapError(error);
      expect(wrapped.provider).toBe('openaivercel');
    });
    
    // Property: 429 errors always become RateLimitError
    test.prop([fc.string()])('429 status always produces RateLimitError', (message) => {
      const error = new Error(message);
      (error as any).status = 429;
      const wrapped = wrapError(error);
      expect(wrapped).toBeInstanceOf(RateLimitError);
    });
    
    // Property: 401 errors always become AuthenticationError
    test.prop([fc.string()])('401 status always produces AuthenticationError', (message) => {
      const error = new Error(message);
      (error as any).status = 401;
      const wrapped = wrapError(error);
      expect(wrapped).toBeInstanceOf(AuthenticationError);
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P13" packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts

# Check for requirement markers
grep "@req:REQ-OAV-009" packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts

# Run tests (expect FAIL - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] Tests cover rate limit errors
- [ ] Tests cover authentication errors
- [ ] Tests cover server errors
- [ ] Tests cover network errors
- [ ] Tests verify error messages
- [ ] Tests FAIL (because error classes don't exist)

## Success Criteria

- Tests exist and are properly structured
- Tests FAIL because error classes not implemented
- All error scenarios are covered

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE implementation (TDD Red)
- [ ] Tests import error classes that DON'T EXIST YET
- [ ] Running tests produces FAILURE (import error or wrong error type)
- [ ] Tests cover rate limit errors (429) with retry-after
- [ ] Tests cover authentication errors (401)
- [ ] Tests cover model not found errors (404)
- [ ] Tests cover server errors (500, 502, 503)
- [ ] Tests cover network errors
- [ ] Tests cover timeout errors
- [ ] Tests cover invalid request errors (400)
- [ ] Tests verify error messages are helpful
- [ ] Tests verify provider name is included in error
- [ ] Tests cover both streaming and non-streaming error paths
- [ ] No "always pass" tests

### Anti-Pattern Detection

```bash
# Check for stub tests that always pass
grep -n "expect(true)" packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts
# Expected: No matches

# Check for tests without assertions
grep -c "expect(" packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts
# Expected: Multiple matches (at least one per test)

# Verify tests fail as expected
npm run test -- packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts 2>&1 | head -20
# Expected: Import error for error classes or wrong error type
```

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts`
2. Review error handling patterns in existing providers
3. Re-create test file with correct structure

## Related Files

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- `packages/core/src/providers/openai-vercel/errors.ts` (to be created)

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When test file creation begins
- [ ] IN_PROGRESS → BLOCKED: If test infrastructure issues found
- [ ] IN_PROGRESS → COMPLETED: When tests exist and FAIL correctly (TDD Red)
- [ ] BLOCKED → IN_PROGRESS: After infrastructure issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P13.md`
Contents:

```markdown
Phase: P13
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts
Tests Added: [count]
Error Types Covered: RateLimitError, AuthenticationError, ProviderError
Test Run Output: [paste showing tests FAIL as expected]
Fraud Prevention Checklist: [all items checked]
```
