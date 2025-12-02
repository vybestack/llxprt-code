# Phase 7: Authentication TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P07`

## Prerequisites

- Required: Phase 6 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts` passes
- Expected files from previous phase: Updated `OpenAIVercelProvider.ts` with message conversion
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates failing tests for the authentication functionality. The OpenAIVercelProvider supports all standard API key authentication methods:
- `/key` command (interactive mode)
- `/keyfile` command (interactive mode)
- `--key` CLI argument
- `--keyfile` CLI argument

**Testing Note**: Automated tests can only use CLI arguments (`--key`, `--keyfile`) because slash commands require interactive mode.

## Requirements Implemented (Expanded)

### REQ-OAV-002: Standard Authentication

**Full Text**: Must support all standard API key authentication methods
**Behavior**:
- GIVEN: User provides API key via any of:
  - `/key <key>` command (interactive mode)
  - `/keyfile <path>` command (interactive mode)
  - `--key <key>` CLI argument
  - `--keyfile <path>` CLI argument
- WHEN: setKey or setKeyFile is called
- THEN: The key is stored and used for API calls

**CLI Testing Format** (for automated tests):
```bash
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"
```

### REQ-OAV-003: BaseURL Configuration

**Full Text**: Must support `--base-url` CLI argument for custom endpoints
**Behavior**:
- GIVEN: User provides a custom base URL via `--base-url` CLI argument
- WHEN: setBaseUrl is called
- THEN: The URL is stored and used for API calls

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P07
// @requirement:REQ-OAV-002
// @requirement:REQ-OAV-003

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

describe('OpenAIVercelProvider Authentication - Behavioral Tests', () => {
  /**
   * BEHAVIORAL TESTING APPROACH:
   * These tests verify INPUT -> OUTPUT transformations, not implementation details.
   * We focus on: What behavior does the user observe?
   */
  let provider: OpenAIVercelProvider;

  beforeEach(() => {
    provider = new OpenAIVercelProvider();
    vi.resetAllMocks();
  });

  describe('setKey - API Key Configuration', () => {
    // BEHAVIORAL: Given a valid key, when hasApiKey() is called, returns true
    it('should enable API access when valid key is provided', () => {
      // INPUT: Valid API key string
      provider.setKey('sk-test-key-12345');
      
      // OUTPUT: Provider reports it has a key (ready for API calls)
      expect(provider.hasApiKey()).toBe(true);
    });

    // BEHAVIORAL: Given multiple keys, only the last one should be effective
    it('should use the most recent key when multiple are provided', () => {
      provider.setKey('sk-first-key');
      provider.setKey('sk-second-key');
      
      // OUTPUT: Provider still has a key (the second one)
      expect(provider.hasApiKey()).toBe(true);
    });

    // BEHAVIORAL: Given empty string, should not enable API access
    it('should not enable API access when empty key is provided', () => {
      provider.setKey('');
      
      // OUTPUT: Provider reports no valid key
      expect(provider.hasApiKey()).toBe(false);
    });
  });

  describe('setKeyFile - Key File Loading', () => {
    // BEHAVIORAL: Given a file path with valid key, should enable API access
    it('should load and enable API access from file with valid key', async () => {
      // ARRANGE: File contains key with trailing newline (common for echo/vim)
      vi.mocked(fs.readFile).mockResolvedValue('sk-file-key-67890\n');
      
      // ACT: Load key from file
      await provider.setKeyFile('/path/to/keyfile');
      
      // ASSERT: Key was read from correct path AND provider is ready
      expect(fs.readFile).toHaveBeenCalledWith('/path/to/keyfile', 'utf-8');
      expect(provider.hasApiKey()).toBe(true);
    });

    // BEHAVIORAL: Should handle keys with surrounding whitespace
    it('should trim whitespace from key in file', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('  sk-key-with-whitespace  \n\n');
      
      await provider.setKeyFile('/path/to/keyfile');
      
      // OUTPUT: Provider has usable key after trimming
      expect(provider.hasApiKey()).toBe(true);
    });

    // BEHAVIORAL: Should fail gracefully when file doesn't exist
    it('should propagate file-not-found error for user handling', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file'));
      
      // OUTPUT: Error propagates for CLI to display helpful message
      await expect(provider.setKeyFile('/nonexistent/path')).rejects.toThrow();
    });

    // BEHAVIORAL: Should reject empty files with clear error
    it('should reject empty key file with descriptive error', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('');
      
      // OUTPUT: Clear error message user can act on
      await expect(provider.setKeyFile('/path/to/empty')).rejects.toThrow('Key file is empty');
    });
  });

  describe('setBaseUrl - Custom Endpoint Configuration', () => {
    // BEHAVIORAL: Given a custom URL, should report custom endpoint is configured
    it('should enable custom endpoint when URL is provided', () => {
      provider.setBaseUrl('https://custom-api.example.com/v1');
      
      expect(provider.hasCustomBaseUrl()).toBe(true);
    });

    // BEHAVIORAL: Should normalize trailing slashes for consistent API calls
    it('should normalize trailing slash for consistent API behavior', () => {
      provider.setBaseUrl('https://api.example.com/v1/');
      
      // OUTPUT: URL without trailing slash (prevents double-slash in API paths)
      expect(provider.getBaseUrl()).toBe('https://api.example.com/v1');
    });
  });

  describe('validateConfiguration - Pre-Request Validation', () => {
    // BEHAVIORAL: Should prevent API calls without key
    it('should throw when attempting operation without API key', () => {
      // OUTPUT: Clear error before wasting API call
      expect(() => provider.validateConfiguration()).toThrow('API key is required');
    });

    // BEHAVIORAL: Should allow operations with key configured
    it('should allow operations when API key is configured', () => {
      provider.setKey('sk-valid-key');
      
      expect(() => provider.validateConfiguration()).not.toThrow();
    });
  });

  describe('createOpenAIClient - Client Factory', () => {
    // BEHAVIORAL: Should create working client with valid config
    it('should create client ready for API calls when key is set', () => {
      provider.setKey('sk-test-key');
      
      const client = provider.createOpenAIClient();
      
      // OUTPUT: Client exists (can be used for API calls)
      expect(client).toBeDefined();
    });

    // BEHAVIORAL: Should prevent client creation without auth
    it('should prevent client creation without authentication', () => {
      // OUTPUT: Fail fast rather than making unauthorized API call
      expect(() => provider.createOpenAIClient()).toThrow('API key is required');
    });
  });

  describe('Property-Based Tests (30% coverage)', () => {
    // Property: Any non-empty string key should enable API access
    test.prop([fc.string({ minLength: 1 })])('non-empty key always enables API access', (key) => {
      provider.setKey(key);
      expect(provider.hasApiKey()).toBe(true);
    });

    // Property: Setting key multiple times should not corrupt state
    test.prop([fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 })])('multiple setKey calls leave provider in valid state', (keys) => {
      keys.forEach(k => provider.setKey(k));
      // Should have a key (the last one)
      expect(provider.hasApiKey()).toBe(true);
    });

    // Property: URL with or without trailing slash should normalize consistently
    test.prop([fc.webUrl()])('any valid URL normalizes consistently', (url) => {
      provider.setBaseUrl(url);
      const result = provider.getBaseUrl();
      // Should never end with slash
      expect(result?.endsWith('/')).toBe(false);
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P07" packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts

# Check for requirement markers
grep -E "@req:REQ-OAV-00[23]" packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts

# Run tests (expect FAIL - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers present
- [ ] Requirement markers present (REQ-OAV-002, REQ-OAV-003)
- [ ] Tests cover setKey functionality
- [ ] Tests cover setKeyFile functionality
- [ ] Tests cover setBaseUrl functionality
- [ ] Tests cover configuration validation
- [ ] Tests FAIL (because new methods don't exist yet)

## Success Criteria

- Tests exist and are properly structured
- Tests FAIL because hasApiKey, hasCustomBaseUrl, etc. don't exist
- All authentication scenarios are covered
- Error cases are tested

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE implementation (TDD Red)
- [ ] Tests call methods that DON'T EXIST YET (hasApiKey, hasCustomBaseUrl, etc.)
- [ ] Running tests produces FAILURE (method not found)
- [ ] Tests cover setKey, setKeyFile, setBaseUrl
- [ ] Tests cover configuration validation
- [ ] Tests cover createOpenAIClient
- [ ] Tests cover error cases (missing key, empty file, etc.)
- [ ] No "always pass" tests

### Anti-Pattern Detection

```bash
# Check for stub tests that always pass
grep -n "expect(true)" packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts
# Expected: No matches

# Check for tests without assertions
grep -c "expect(" packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts
# Expected: Multiple matches (at least one per test)

# Verify tests fail as expected
npm run test -- packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts 2>&1 | head -20
# Expected: Method not found or similar error
```

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts`
2. Review fs.promises mocking patterns
3. Re-create test file with correct mocking

## Related Files

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- `packages/core/src/providers/anthropic/AnthropicProvider.ts` (reference)

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When test file creation begins
- [ ] IN_PROGRESS → BLOCKED: If test infrastructure issues found
- [ ] IN_PROGRESS → COMPLETED: When tests exist and FAIL correctly (TDD Red)
- [ ] BLOCKED → IN_PROGRESS: After infrastructure issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P07.md`
Contents:

```markdown
Phase: P07
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts
Tests Added: [count]
Test Run Output: [paste showing tests FAIL as expected]
Fraud Prevention Checklist: [all items checked]
```
