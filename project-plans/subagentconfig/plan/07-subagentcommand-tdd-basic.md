# Phase 07: SubagentCommand TDD - Basic Commands

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P07`

## Prerequisites
- Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P06" packages/cli/src/ui/commands/subagentCommand.ts`
- Expected files from previous phase:
  - `packages/cli/src/ui/commands/subagentCommand.ts` (stub)

## Implementation Tasks

### File to Create

**File**: `packages/cli/src/ui/commands/test/subagentCommand.test.ts` (CREATE)

Additional supporting change:
- Update `packages/cli/src/test-utils/mockCommandContext.ts` so the helper accepts an injected `subagentManager` and provides a default stub when the caller does not supply one. Tag the new defaults with `@plan:PLAN-20250117-SUBAGENTCONFIG.P07` markers and update its corresponding tests if required.

Create behavioral tests for basic commands (save manual mode, list, show, delete):

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SubagentManager, ProfileManager } from '@vybestack/llxprt-code-core';
import { CommandContext } from '../types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { saveCommand, listCommand, showCommand, deleteCommand } from '../subagentCommand.js';

/**
 * SubagentCommand behavioral tests - Basic commands
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P07
 * @requirement:REQ-004, REQ-005, REQ-006, REQ-007, REQ-014
 * 
 * Tests verify command interactions with SubagentManager
 * Mock GeminiClient, use real file system
 */
describe('subagentCommand - basic @plan:PLAN-20250117-SUBAGENTCONFIG.P07', () => {
  let context: CommandContext;
  let subagentManager: SubagentManager;
  let profileManager: ProfileManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-cmd-test-'));
    const subagentsDir = path.join(tempDir, 'subagents');
    const profilesDir = path.join(tempDir, 'profiles');
    
    // Initialize managers
    profileManager = new ProfileManager(profilesDir);
    subagentManager = new SubagentManager(subagentsDir, profileManager);
    
    // Create test profile
    await fs.mkdir(profilesDir, { recursive: true });
    await profileManager.saveProfile('testprofile', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {}
    });
    
    // Create mock context with helper so the services shape stays in sync with production code
    context = createMockCommandContext({
      services: {
        profileManager,
        subagentManager,
      },
      overwriteConfirmed: false,
    }) as CommandContext;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('saveCommand - manual mode @requirement:REQ-004', () => {
    it('should save new subagent with manual mode', async () => {
      const args = 'testagent testprofile manual "You are a test agent"';
      const result = await saveCommand.action(context, args);
      
      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/created successfully/i);
      
      // Verify subagent was saved
      const exists = await subagentManager.subagentExists('testagent');
      expect(exists).toBe(true);
      
      const loaded = await subagentManager.loadSubagent('testagent');
      expect(loaded.profile).toBe('testprofile');
      expect(loaded.systemPrompt).toBe('You are a test agent');
    });

    it('should reject invalid syntax', async () => {
      const invalidArgs = [
        'testagent',  // Missing profile and mode
        'testagent testprofile',  // Missing mode and prompt
        'testagent testprofile manual',  // Missing prompt
        'testagent testprofile invalid "prompt"',  // Invalid mode
      ];
      
      for (const args of invalidArgs) {
        const result = await saveCommand.action(context, args);
        expect(result.messageType).toBe('error');
        expect(result.content).toMatch(/usage|syntax/i);
      }
    });

    it('should error when subagentManager service missing', async () => {
      const contextWithoutManager = createMockCommandContext({
        services: {
          profileManager,
          subagentManager: undefined,
        },
      }) as CommandContext;

      const result = await saveCommand.action(
        contextWithoutManager,
        'testagent testprofile manual "Prompt"'
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/service .* unavailable/i);
    });

    it('should reject non-existent profile @requirement:REQ-013', async () => {
      const args = 'testagent nonexistent manual "prompt"';
      const result = await saveCommand.action(context, args);
      
      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/profile.*not found/i);
    });

    it('should prompt for confirmation on overwrite @requirement:REQ-014', async () => {
      // Create existing subagent
      await subagentManager.saveSubagent('testagent', 'testprofile', 'Original prompt');
      
      // Try to overwrite without confirmation
      const args = 'testagent testprofile manual "New prompt"';
      const result = await saveCommand.action(context, args);
      
      expect(result.type).toBe('confirm_action');
      expect(result.content).toMatch(/overwrite/i);
      expect(result.confirmAction).toBeDefined();
    });

    it('should overwrite when confirmed', async () => {
      // Create existing subagent
      await subagentManager.saveSubagent('testagent', 'testprofile', 'Original prompt');
      
      // Set confirmation flag
      context.overwriteConfirmed = true;
      
      const args = 'testagent testprofile manual "New prompt"';
      const result = await saveCommand.action(context, args);
      
      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/updated successfully/i);
      
      // Verify updated
      const loaded = await subagentManager.loadSubagent('testagent');
      expect(loaded.systemPrompt).toBe('New prompt');
    });
  });

  describe('listCommand @requirement:REQ-005', () => {
    it('should show message when no subagents exist', async () => {
      const result = await listCommand.action(context, '');
      
      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/no subagents found/i);
    });

    it('should list all subagents with details', async () => {
      // Create multiple subagents
      await subagentManager.saveSubagent('agent1', 'testprofile', 'Prompt 1');
      await subagentManager.saveSubagent('agent2', 'testprofile', 'Prompt 2');
      
      const result = await listCommand.action(context, '');
      
      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/agent1/);
      expect(result.content).toMatch(/agent2/);
      expect(result.content).toMatch(/testprofile/);
    });
  });

  describe('showCommand @requirement:REQ-006', () => {
    it('should display full subagent configuration', async () => {
      await subagentManager.saveSubagent('testagent', 'testprofile', 'Test system prompt');
      
      const result = await showCommand.action(context, 'testagent');
      
      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/testagent/);
      expect(result.content).toMatch(/testprofile/);
      expect(result.content).toMatch(/Test system prompt/);
    });

    it('should error for non-existent subagent', async () => {
      const result = await showCommand.action(context, 'nonexistent');
      
      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/not found/i);
    });

    it('should error when name not provided', async () => {
      const result = await showCommand.action(context, '');
      
      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/usage|name required/i);
    });
  });

  describe('deleteCommand @requirement:REQ-007', () => {
    it('should delete subagent with confirmation', async () => {
      await subagentManager.saveSubagent('testagent', 'testprofile', 'Test prompt');
      
      // First call: should prompt for confirmation
      const result1 = await deleteCommand.action(context, 'testagent');
      expect(result1.type).toBe('confirm_action');
      
      // Second call: with confirmation
      context.overwriteConfirmed = true;
      const result2 = await deleteCommand.action(context, 'testagent');
      
      expect(result2.messageType).toBe('info');
      expect(result2.content).toMatch(/deleted/i);
      
      // Verify deleted
      const exists = await subagentManager.subagentExists('testagent');
      expect(exists).toBe(false);
    });

    it('should error for non-existent subagent', async () => {
      const result = await deleteCommand.action(context, 'nonexistent');
      
      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/not found/i);
    });
  });
});
```

### Test Requirements

1. **Behavioral Testing**: Test command interactions, not internal implementation
2. **Real SubagentManager**: Use real SubagentManager with temp directories
3. **Context Setup**: Use `createMockCommandContext` to build the CommandContext and inject `subagentManager`
4. **Service Availability**: Include tests covering missing `subagentManager` service
5. **Error Cases**: Test all validation and error paths
6. **Confirmation Flow**: Test overwrite and delete confirmations

### Required Code Markers

Every test suite MUST include:
```typescript
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P07
 * @requirement:REQ-XXX
 */
```

## Verification Commands

```bash
# Check plan markers
grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P07" packages/cli/src/ui/commands/test/subagentCommand.test.ts
# Expected: 5+

# Ensure mock context helper exposes subagentManager
grep -q "subagentManager" packages/cli/src/test-utils/mockCommandContext.ts || exit 1

# Tests exist but will fail (stub implementation)
npm test -- subagentCommand.test.ts 2>&1 | grep -q "FAIL\|fail" || echo "WARNING: Tests should fail"

# TypeScript compiles
npm run typecheck
# Expected: No errors
```

## Success Criteria

- Test file created with 15+ tests
- All basic commands tested (save manual, list, show, delete)
- Tests cover missing SubagentManager service scenario
- Tests use behavioral approach
- Tests will fail naturally due to stub implementation
- All markers present

## Phase Completion Marker

Create: `project-plans/subagentconfig/.completed/P07.md`

```markdown
# Phase 07: SubagentCommand TDD - Basic Complete

**Completed**: [TIMESTAMP]

## Files Created
- packages/cli/src/ui/commands/test/subagentCommand.test.ts

## Test Coverage
- saveCommand (manual mode): 5 tests
- listCommand: 2 tests
- showCommand: 3 tests
- deleteCommand: 2 tests

Total: 12+ behavioral tests

## Next Phase
Ready for Phase 08: SubagentCommand Implementation - Basic
```

---

**CRITICAL**: Tests MUST fail at this stage (stub returns). Auto mode tests will be added in Phase 13.
