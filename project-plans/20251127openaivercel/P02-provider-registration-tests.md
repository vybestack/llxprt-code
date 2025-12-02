# Phase 2: Provider Registration TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P02`

## Prerequisites

- Required: Phase 1 completed
- Verification: `ls project-plans/20251127openaivercel/P01-architecture.md`
- Expected files from previous phase: Architecture documentation
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates the failing tests for provider registration. Following TDD principles, we write tests first that define the expected behavior, then implement the code to make them pass in the next phase.

## Requirements Implemented (Expanded)

### REQ-OAV-001: Provider Registration

**Full Text**: Provider must be selectable via `--provider openaivercel` CLI argument
**Behavior**:
- GIVEN: The application is running
- WHEN: User starts with `--provider openaivercel` argument
- THEN: The OpenAIVercelProvider is activated
- AND: The provider is ready to accept configuration

**CLI Testing Format**:
```bash
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"
```

**Note**: Automated tests must use CLI arguments (`--keyfile`, `--key`) because slash commands (`/keyfile`, `/key`) only work in interactive mode.

**Test Cases**:
1. Provider exports are correct
2. Provider has correct name and ID
3. Provider implements IProvider interface
4. Provider is registered in provider registry

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P02
// @requirement:REQ-OAV-001

import { describe, it, expect, beforeEach } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider';
import type { IProvider } from '../../IProvider';

describe('OpenAIVercelProvider Registration', () => {
  describe('Provider Identity - Behavioral Tests', () => {
    /**
     * These tests verify INPUT -> OUTPUT behavior, not implementation details.
     * We test WHAT the provider returns, not HOW it's implemented.
     */
    let provider: OpenAIVercelProvider;

    beforeEach(() => {
      provider = new OpenAIVercelProvider();
    });

    // BEHAVIORAL: Given a new provider instance, when getId() is called, it returns 'openaivercel'
    it('should return openaivercel as provider ID for routing', () => {
      // This ID is used by ProviderManager for routing - verify the contract
      const id = provider.getId();
      expect(id).toBe('openaivercel');
      // Verify ID is suitable for use as lookup key (no spaces, lowercase)
      expect(id).toMatch(/^[a-z0-9]+$/);
    });

    // BEHAVIORAL: Given a new provider instance, when getName() is called, it returns display name
    it('should return human-readable display name', () => {
      const name = provider.getName();
      expect(name).toBe('OpenAI (Vercel AI SDK)');
      // Verify name is non-empty for UI display
      expect(name.length).toBeGreaterThan(0);
    });
  });

  describe('IProvider Interface Compliance - Behavioral Tests', () => {
    /**
     * These tests verify the provider implements IProvider contract.
     * We verify methods exist AND behave correctly when called.
     */
    let provider: IProvider;

    beforeEach(() => {
      provider = new OpenAIVercelProvider();
    });

    // BEHAVIORAL: setKey should accept a string and not throw
    it('should accept API key via setKey without error', () => {
      expect(() => provider.setKey('sk-test-key')).not.toThrow();
    });

    // BEHAVIORAL: setBaseUrl should accept a URL string and not throw
    it('should accept base URL via setBaseUrl without error', () => {
      expect(() => provider.setBaseUrl('https://api.example.com')).not.toThrow();
    });

    // BEHAVIORAL: generateChatCompletion should return an async iterable
    it('should return async iterable from generateChatCompletion', () => {
      const result = provider.generateChatCompletion([], { model: 'gpt-4' });
      // Verify it's an async iterable (has Symbol.asyncIterator)
      expect(typeof result[Symbol.asyncIterator]).toBe('function');
    });

    // BEHAVIORAL: listModels should return a Promise
    it('should return Promise from listModels', () => {
      const result = provider.listModels();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Provider Exports - Behavioral Tests', () => {
    // BEHAVIORAL: Module should export the provider class for instantiation
    it('should export OpenAIVercelProvider class that can be instantiated', async () => {
      const module = await import('../index');
      expect(module.OpenAIVercelProvider).toBeDefined();
      // Verify it can be instantiated
      const instance = new module.OpenAIVercelProvider();
      expect(instance.getId()).toBe('openaivercel');
    });
  });

  describe('Property-Based Tests (30% coverage)', () => {
    // Property: Provider ID should always be consistent regardless of state
    test.prop([fc.string()])('provider ID is constant regardless of key value', (key) => {
      const provider = new OpenAIVercelProvider();
      provider.setKey(key);
      expect(provider.getId()).toBe('openaivercel');
    });

    // Property: Provider name should always be consistent regardless of state
    test.prop([fc.string()])('provider name is constant regardless of base URL', (url) => {
      const provider = new OpenAIVercelProvider();
      try {
        provider.setBaseUrl(url);
      } catch {
        // URL validation may throw - that's ok for this test
      }
      expect(provider.getName()).toBe('OpenAI (Vercel AI SDK)');
    });

    // Property: Multiple setKey calls should not throw
    test.prop([fc.array(fc.string(), { minLength: 1, maxLength: 10 })])('multiple setKey calls should be idempotent', (keys) => {
      const provider = new OpenAIVercelProvider();
      expect(() => {
        keys.forEach(k => provider.setKey(k));
      }).not.toThrow();
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P02" packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts

# Check for requirement markers
grep "@req:REQ-OAV-001" packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts

# Run tests (expect FAIL - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers present (`@plan:PLAN-20251127-OPENAIVERCEL.P02`)
- [ ] Requirement markers present (`@req:REQ-OAV-001`)
- [ ] All IProvider methods tested
- [ ] Tests FAIL (because implementation doesn't exist yet)

## Success Criteria

- Test file exists with proper structure
- Tests FAIL because OpenAIVercelProvider doesn't exist yet
- All test cases defined per requirements
- Plan and requirement markers are present

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE implementation (TDD Red)
- [ ] Tests import from files that DON'T EXIST YET
- [ ] Running tests produces FAILURE (not error from missing imports in test setup)
- [ ] Tests define BEHAVIOR, not implementation details
- [ ] Tests use assertions that verify OUTCOMES
- [ ] No "always pass" tests (e.g., `expect(true).toBe(true)`)
- [ ] Each test would FAIL if the requirement wasn't implemented

### Anti-Pattern Detection

```bash
# Check for stub tests that always pass
grep -n "expect(true)" packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts
# Expected: No matches

# Check for tests without assertions
grep -c "expect(" packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts
# Expected: Multiple matches (at least one per test)
```

## Failure Recovery

If this phase fails:
1. Verify directory structure exists
2. Check vitest configuration
3. Review existing provider test patterns
4. Re-create test file with correct imports

## Related Files

- `packages/core/src/providers/IProvider.ts`
- `packages/core/src/providers/anthropic/__tests__/` (reference)
- `packages/core/vitest.config.ts`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When test file creation begins
- [ ] IN_PROGRESS → BLOCKED: If test infrastructure issues found
- [ ] IN_PROGRESS → COMPLETED: When tests exist and FAIL correctly (TDD Red)
- [ ] BLOCKED → IN_PROGRESS: After infrastructure issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P02.md`
Contents:

```markdown
Phase: P02
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts
Tests Added: [count]
Test Run Output: [paste showing tests FAIL as expected]
Fraud Prevention Checklist: [all items checked]
```
