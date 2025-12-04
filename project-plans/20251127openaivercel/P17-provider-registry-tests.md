# Phase 17: Provider Registry Integration Tests (TDD RED)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P17`

## Prerequisites

- Required: Phase 16 completed
- Verification: All unit tests pass for OpenAIVercelProvider
- Expected files from previous phase: Complete OpenAIVercelProvider implementation
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates failing integration tests that verify the OpenAIVercelProvider can be registered with and retrieved from the ProviderManager. This ensures the provider is actually accessible to users.

## Requirements Implemented (Expanded)

### REQ-INT-001.1: ProviderManager Registration

**Full Text**: Provider MUST be registered in ProviderManager
**Behavior**:
- GIVEN: Application initializes ProviderManager
- WHEN: ProviderManager.getProvider('openaivercel') is called
- THEN: Returns an OpenAIVercelProvider instance
**Why This Matters**: Provider is useless if not discoverable/instantiable

### REQ-OAV-001.1: Provider Selection via CLI

**Full Text**: Provider MUST be selectable via `--provider openaivercel` CLI argument
**Behavior**:
- GIVEN: User is starting the CLI
- WHEN: User starts with `--provider openaivercel` argument
- THEN: OpenAIVercelProvider becomes the active provider
**Why This Matters**: User access point for the feature

**CLI Testing Format**:
```bash
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"
```

**IMPORTANT**: Testing must use command-line arguments (`--key`, `--keyfile`), NOT interactive slash commands (`/key`, `/keyfile`). Slash commands only work in interactive mode and agents cannot test them.

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P17
// @requirement:REQ-INT-001.1
// @requirement:REQ-OAV-001.1

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderManager } from '../../ProviderManager';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider';
import type { Config } from '../../../config/config';
import type { SettingsService } from '../../../settings/SettingsService';

describe('OpenAIVercelProvider Registry Integration', () => {
  let providerManager: ProviderManager;
  let mockConfig: Config;
  let mockSettings: SettingsService;

  beforeEach(() => {
    // Create minimal mocks for ProviderManager dependencies
    mockConfig = {
      provider: 'openaivercel',
      model: 'gpt-4o',
    } as unknown as Config;

    mockSettings = {
      getProviderSettings: vi.fn().mockReturnValue({}),
      getSetting: vi.fn(),
      getConversationSettings: vi.fn().mockReturnValue({}),
    } as unknown as SettingsService;

    providerManager = new ProviderManager(mockConfig, mockSettings);
  });

  describe('Provider Discovery', () => {
    it('should include openaivercel in available providers list', () => {
      // This tests that the provider is registered in the system
      const providers = providerManager.getProviderNames();
      
      expect(providers).toContain('openaivercel');
    });

    it('should be able to instantiate OpenAIVercelProvider', () => {
      // This tests that the provider factory can create the provider
      const provider = providerManager.getProvider('openaivercel');
      
      expect(provider).toBeDefined();
      expect(provider.name).toBe('openaivercel');
    });

    it('should return OpenAIVercelProvider instance', () => {
      const provider = providerManager.getProvider('openaivercel');
      
      expect(provider).toBeInstanceOf(OpenAIVercelProvider);
    });
  });

  describe('Provider Activation', () => {
    it('should be able to set openaivercel as active provider', async () => {
      await providerManager.setActiveProvider('openaivercel');
      
      const active = providerManager.getActiveProvider();
      expect(active?.name).toBe('openaivercel');
    });

    it('should maintain openaivercel as active after switch', async () => {
      await providerManager.setActiveProvider('openaivercel');
      const active1 = providerManager.getActiveProvider();
      
      // Provider should still be active
      const active2 = providerManager.getActiveProvider();
      expect(active2?.name).toBe('openaivercel');
    });
  });

  describe('Provider Interface Compliance', () => {
    it('should implement getModels method', async () => {
      const provider = providerManager.getProvider('openaivercel');
      
      expect(typeof provider.getModels).toBe('function');
      
      const models = await provider.getModels();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should implement generateChatCompletion method', () => {
      const provider = providerManager.getProvider('openaivercel');
      
      expect(typeof provider.generateChatCompletion).toBe('function');
    });

    it('should implement getDefaultModel method', () => {
      const provider = providerManager.getProvider('openaivercel');
      
      expect(typeof provider.getDefaultModel).toBe('function');
      
      const defaultModel = provider.getDefaultModel();
      expect(typeof defaultModel).toBe('string');
      expect(defaultModel.length).toBeGreaterThan(0);
    });
  });

  describe('Provider Configuration', () => {
    it('should read API key from settings', async () => {
      mockSettings.getProviderSettings = vi.fn().mockReturnValue({
        apiKey: 'sk-test-key',
      });

      await providerManager.setActiveProvider('openaivercel');
      const provider = providerManager.getActiveProvider();
      
      // Provider should be configured with API key from settings
      expect(mockSettings.getProviderSettings).toHaveBeenCalledWith('openaivercel');
    });

    it('should support baseURL configuration', async () => {
      mockSettings.getProviderSettings = vi.fn().mockReturnValue({
        baseURL: 'https://custom.api.com',
      });

      await providerManager.setActiveProvider('openaivercel');
      
      expect(mockSettings.getProviderSettings).toHaveBeenCalled();
    });
  });
});
```

### File: `packages/cli/src/ui/commands/__tests__/providerCommand.openaivercel.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P17
// @requirement:REQ-OAV-001.1
// @requirement:REQ-INT-001.2

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { providerCommand } from '../providerCommand';
import type { CommandContext } from '../types';

// Mock the provider manager instance
vi.mock('../../../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(),
}));

describe('providerCommand with openaivercel', () => {
  let mockContext: CommandContext;
  let mockProviderManager: {
    setActiveProvider: ReturnType<typeof vi.fn>;
    getActiveProvider: ReturnType<typeof vi.fn>;
    getProviderNames: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockProviderManager = {
      setActiveProvider: vi.fn().mockResolvedValue(undefined),
      getActiveProvider: vi.fn().mockReturnValue({ name: 'openaivercel' }),
      getProviderNames: vi.fn().mockReturnValue(['openai', 'anthropic', 'gemini', 'openaivercel']),
    };

    const { getProviderManager } = await import('../../../providers/providerManagerInstance.js');
    vi.mocked(getProviderManager).mockReturnValue(mockProviderManager as any);

    mockContext = {
      // Minimal context for testing
    } as unknown as CommandContext;
  });

  it('should accept openaivercel as valid provider name', async () => {
    if (!providerCommand.action) {
      throw new Error('providerCommand must have an action');
    }

    await providerCommand.action(mockContext, 'openaivercel');

    expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith('openaivercel');
  });

  it('should show openaivercel in provider completions', () => {
    const completions = providerCommand.complete?.('open', mockContext);
    
    expect(completions).toContain('openaivercel');
  });

  it('should distinguish openaivercel from openai', async () => {
    if (!providerCommand.action) {
      throw new Error('providerCommand must have an action');
    }

    // Select openaivercel
    await providerCommand.action(mockContext, 'openaivercel');
    expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith('openaivercel');

    // Not openai
    expect(mockProviderManager.setActiveProvider).not.toHaveBeenCalledWith('openai');
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test files exist
ls -la packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts
ls -la packages/cli/src/ui/commands/__tests__/providerCommand.openaivercel.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P17" packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts

# Check for requirement markers
grep "@requirement:REQ-INT-001" packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts

# Run tests (expect FAIL - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts
npm run test -- packages/cli/src/ui/commands/__tests__/providerCommand.openaivercel.test.ts
```

### Structural Verification Checklist

- [ ] Test file created for ProviderManager integration
- [ ] Test file created for CLI command integration
- [ ] Plan markers present
- [ ] Requirement markers present (REQ-INT-001, REQ-OAV-001)
- [ ] Tests verify provider is discoverable
- [ ] Tests verify provider can be activated
- [ ] Tests verify CLI command works
- [ ] Tests FAIL (because registration not implemented)

## Success Criteria

- Tests exist and are properly structured
- Tests FAIL because:
  - 'openaivercel' is not in provider list
  - ProviderManager.getProvider('openaivercel') returns undefined
  - CLI command doesn't recognize 'openaivercel'
- All integration scenarios are covered

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE implementation (TDD Red)
- [ ] Tests call ProviderManager methods that DON'T SUPPORT openaivercel YET
- [ ] Running tests produces FAILURE (provider not found)
- [ ] Tests verify provider is in available list
- [ ] Tests verify provider can be instantiated
- [ ] Tests verify provider can be activated
- [ ] Tests verify CLI command integration
- [ ] No "always pass" tests

### Anti-Pattern Detection

```bash
# Check for stub tests that always pass
grep -n "expect(true)" packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts
# Expected: No matches

# Verify tests fail as expected
npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts 2>&1 | head -30
# Expected: Provider not found or similar error
```

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts`
2. Review ProviderManager API
3. Re-create test file with correct ProviderManager usage

## Related Files

- `packages/core/src/providers/ProviderManager.ts`
- `packages/cli/src/ui/commands/providerCommand.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P17.md`
Contents:

```markdown
Phase: P17
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts
- packages/cli/src/ui/commands/__tests__/providerCommand.openaivercel.test.ts
Tests Added: [count]
Test Run Output: [paste showing tests FAIL as expected]
```
