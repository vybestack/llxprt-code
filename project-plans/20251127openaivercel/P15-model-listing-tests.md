# Phase 15: Model Listing TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P15`

## Prerequisites

- Required: Phase 14 completed
- Verification: Error handling tests pass
- Expected files from previous phase: `errors.ts`, updated `OpenAIVercelProvider.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates failing tests for the model listing functionality. The provider must return a list of available models.

## Requirements Implemented (Expanded)

### REQ-OAV-010: Model Listing

**Full Text**: Must provide a list of available models via listModels()
**Behavior**:
- GIVEN: A configured provider
- WHEN: listModels() is called
- THEN: Returns array of ModelInfo with id, name, provider, and contextWindow

**Test Cases**:
1. Returns array of models
2. Each model has required properties
3. Provider field matches 'openaivercel'
4. Includes common GPT-4 models
5. Includes O1 models

## Pseudocode Reference

Model listing is a static implementation per specification requirements REQ-OAV-009.

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P15
// @requirement:REQ-OAV-009

import { describe, it, expect, beforeEach } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider';
import type { ModelInfo } from '../../IProvider';

describe('OpenAIVercelProvider Model Listing', () => {
  let provider: OpenAIVercelProvider;

  beforeEach(() => {
    provider = new OpenAIVercelProvider();
  });

  describe('listModels', () => {
    it('should return an array of models', async () => {
      const models = await provider.listModels();
      
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it('should return models with required properties', async () => {
      const models = await provider.listModels();
      
      for (const model of models) {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('provider');
        expect(model).toHaveProperty('contextWindow');
        
        expect(typeof model.id).toBe('string');
        expect(typeof model.name).toBe('string');
        expect(typeof model.provider).toBe('string');
        expect(typeof model.contextWindow).toBe('number');
      }
    });

    it('should have provider field set to openaivercel', async () => {
      const models = await provider.listModels();
      
      for (const model of models) {
        expect(model.provider).toBe('openaivercel');
      }
    });

    it('should include GPT-4 models', async () => {
      const models = await provider.listModels();
      const modelIds = models.map(m => m.id);
      
      expect(modelIds).toContain('gpt-4o');
      expect(modelIds).toContain('gpt-4o-mini');
      expect(modelIds).toContain('gpt-4-turbo');
    });

    it('should include GPT-3.5 models', async () => {
      const models = await provider.listModels();
      const modelIds = models.map(m => m.id);
      
      expect(modelIds).toContain('gpt-3.5-turbo');
    });

    it('should include O1 reasoning models', async () => {
      const models = await provider.listModels();
      const modelIds = models.map(m => m.id);
      
      expect(modelIds).toContain('o1-preview');
      expect(modelIds).toContain('o1-mini');
    });

    it('should have correct context window for GPT-4o', async () => {
      const models = await provider.listModels();
      const gpt4o = models.find(m => m.id === 'gpt-4o');
      
      expect(gpt4o).toBeDefined();
      expect(gpt4o?.contextWindow).toBe(128000);
    });

    it('should have correct context window for GPT-3.5 Turbo', async () => {
      const models = await provider.listModels();
      const gpt35 = models.find(m => m.id === 'gpt-3.5-turbo');
      
      expect(gpt35).toBeDefined();
      expect(gpt35?.contextWindow).toBe(16385);
    });

    it('should return models sorted by name', async () => {
      const models = await provider.listModels();
      const names = models.map(m => m.name);
      const sortedNames = [...names].sort();
      
      expect(names).toEqual(sortedNames);
    });

    it('should not require API key to list models', async () => {
      // Provider without key set
      const providerNoKey = new OpenAIVercelProvider();
      
      const models = await providerNoKey.listModels();
      
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('Model ID Format', () => {
    it('should use valid model IDs that can be passed to API', async () => {
      const models = await provider.listModels();
      
      for (const model of models) {
        // Model IDs should not contain spaces or special characters (except hyphen and dot)
        expect(model.id).toMatch(/^[a-z0-9\-\.]+$/);
      }
    });
  });
  
  describe('Property-based tests', () => {
    // Property: All models have required fields
    it('all models have complete structure', async () => {
      const models = await provider.listModels();
      
      models.forEach(model => {
        expect(typeof model.id).toBe('string');
        expect(model.id.length).toBeGreaterThan(0);
        expect(typeof model.name).toBe('string');
        expect(model.name.length).toBeGreaterThan(0);
        expect(model.provider).toBe('openaivercel');
        expect(typeof model.contextWindow).toBe('number');
        expect(model.contextWindow).toBeGreaterThan(0);
      });
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P15" packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts

# Check for requirement markers
grep "@req:REQ-OAV-010" packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts

# Run tests (expect FAIL - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] Tests verify model array structure
- [ ] Tests verify model properties
- [ ] Tests verify specific models exist
- [ ] Tests verify context windows
- [ ] Tests FAIL (because listModels throws "Not yet implemented")

## Success Criteria

- Tests exist and are properly structured
- Tests FAIL because listModels throws "Not yet implemented"
- All model listing scenarios are covered

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE implementation (TDD Red)
- [ ] Tests call listModels which throws "Not yet implemented"
- [ ] Running tests produces FAILURE (throws error)
- [ ] Tests verify return is an array
- [ ] Tests verify models have required properties (id, name, provider, contextWindow)
- [ ] Tests verify provider field is 'openaivercel'
- [ ] Tests verify GPT-4 models are included
- [ ] Tests verify GPT-3.5 models are included
- [ ] Tests verify O1 models are included
- [ ] Tests verify context windows are correct
- [ ] Tests verify models are sorted
- [ ] Tests verify no API key required for listing
- [ ] No "always pass" tests

### Anti-Pattern Detection

```bash
# Check for stub tests that always pass
grep -n "expect(true)" packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts
# Expected: No matches

# Check for tests without assertions
grep -c "expect(" packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts
# Expected: Multiple matches (at least one per test)

# Verify tests fail as expected
npm run test -- packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts 2>&1 | head -20
# Expected: "Not yet implemented" error
```

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts`
2. Review ModelInfo interface
3. Re-create test file with correct types

## Related Files

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- `packages/core/src/providers/IProvider.ts` (ModelInfo type)

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When test file creation begins
- [ ] IN_PROGRESS → BLOCKED: If test infrastructure issues found
- [ ] IN_PROGRESS → COMPLETED: When tests exist and FAIL correctly (TDD Red)
- [ ] BLOCKED → IN_PROGRESS: After infrastructure issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P15.md`
Contents:

```markdown
Phase: P15
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/__tests__/modelListing.test.ts
Tests Added: [count]
Test Run Output: [paste showing tests FAIL as expected]
Fraud Prevention Checklist: [all items checked]
```
