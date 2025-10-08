# Phase 04: SubagentManager TDD Tests

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P04`

## Prerequisites
- Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P03" packages/core/src/config/subagentManager.ts`
- Expected files from previous phase:
  - `packages/core/src/config/subagentManager.ts` (stub)
  - `packages/core/src/config/types.ts` (with SubagentConfig)

## Implementation Tasks

### Files to Create

#### 1. SubagentManager Test Suite
**File**: `packages/core/src/config/test/subagentManager.test.ts` (CREATE)

Create comprehensive behavioral tests following this structure:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SubagentManager } from '../subagentManager.js';
import { ProfileManager } from '../profileManager.js';
import { SubagentConfig } from '../types.js';

/**
 * SubagentManager behavioral tests
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P04
 * @requirement:REQ-002, REQ-013
 * 
 * Tests verify file I/O, validation, and business logic
 * No mocks - real file system operations with temp directories
 */
describe('SubagentManager @plan:PLAN-20250117-SUBAGENTCONFIG.P04', () => {
  let subagentManager: SubagentManager;
  let profileManager: ProfileManager;
  let tempDir: string;
  let subagentsDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    // Create temp directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-test-'));
    subagentsDir = path.join(tempDir, 'subagents');
    profilesDir = path.join(tempDir, 'profiles');
    
    // Initialize managers
    profileManager = new ProfileManager(profilesDir);
    subagentManager = new SubagentManager(subagentsDir, profileManager);
    
    // Create a test profile
    await fs.mkdir(profilesDir, { recursive: true });
    const testProfile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {}
    };
    await profileManager.saveProfile('testprofile', testProfile);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('saveSubagent @requirement:REQ-002', () => {
    it('should create new subagent file with correct structure', async () => {
      const name = 'testagent';
      const profile = 'testprofile';
      const systemPrompt = 'You are a test agent';
      
      await subagentManager.saveSubagent(name, profile, systemPrompt);
      
      // Verify file was created
      const filePath = path.join(subagentsDir, `${name}.json`);
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
      
      // Verify file contents
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const config: SubagentConfig = JSON.parse(fileContent);
      
      expect(config.name).toBe(name);
      expect(config.profile).toBe(profile);
      expect(config.systemPrompt).toBe(systemPrompt);
      expect(config.createdAt).toBeDefined();
      expect(config.updatedAt).toBeDefined();
      expect(new Date(config.createdAt).getTime()).toBeGreaterThan(0);
      expect(new Date(config.updatedAt).getTime()).toBeGreaterThan(0);
    });

    it('should update existing subagent and preserve createdAt', async () => {
      const name = 'testagent';
      const profile = 'testprofile';
      const systemPrompt1 = 'Original prompt';
      const systemPrompt2 = 'Updated prompt';
      
      // Create initial subagent
      await subagentManager.saveSubagent(name, profile, systemPrompt1);
      const original = await subagentManager.loadSubagent(name);
      const originalCreatedAt = original.createdAt;
      
      // Wait 10ms to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Update subagent
      await subagentManager.saveSubagent(name, profile, systemPrompt2);
      const updated = await subagentManager.loadSubagent(name);
      
      // Verify createdAt preserved, updatedAt changed
      expect(updated.createdAt).toBe(originalCreatedAt);
      expect(updated.updatedAt).not.toBe(original.updatedAt);
      expect(updated.systemPrompt).toBe(systemPrompt2);
    });

    it('should reject invalid subagent name @requirement:REQ-013', async () => {
      const invalidNames = ['', 'test/agent', 'test\\agent', 'test..agent'];
      
      for (const invalidName of invalidNames) {
        await expect(
          subagentManager.saveSubagent(invalidName, 'testprofile', 'Test prompt')
        ).rejects.toThrow(/invalid.*name/i);
      }
    });

    it('should reject empty system prompt @requirement:REQ-013', async () => {
      await expect(
        subagentManager.saveSubagent('testagent', 'testprofile', '')
      ).rejects.toThrow(/empty.*prompt/i);
    });

    it('should reject non-existent profile @requirement:REQ-013', async () => {
      await expect(
        subagentManager.saveSubagent('testagent', 'nonexistent', 'Test prompt')
      ).rejects.toThrow(/profile.*not found/i);
    });

    it('should create subagents directory if not exists', async () => {
      // Remove the subagents directory
      await fs.rm(subagentsDir, { recursive: true, force: true });
      
      // Save should create directory
      await subagentManager.saveSubagent('testagent', 'testprofile', 'Test prompt');
      
      // Verify directory exists
      const dirExists = await fs.access(subagentsDir).then(() => true).catch(() => false);
      expect(dirExists).toBe(true);
    });
  });

  describe('loadSubagent @requirement:REQ-002', () => {
    it('should load existing subagent correctly', async () => {
      const name = 'testagent';
      const profile = 'testprofile';
      const systemPrompt = 'You are a test agent';
      
      await subagentManager.saveSubagent(name, profile, systemPrompt);
      const loaded = await subagentManager.loadSubagent(name);
      
      expect(loaded.name).toBe(name);
      expect(loaded.profile).toBe(profile);
      expect(loaded.systemPrompt).toBe(systemPrompt);
    });

    it('should throw error for non-existent subagent @requirement:REQ-013', async () => {
      await expect(
        subagentManager.loadSubagent('nonexistent')
      ).rejects.toThrow(/not found/i);
    });

    it('should throw error for invalid JSON @requirement:REQ-013', async () => {
      // Create invalid JSON file
      await fs.mkdir(subagentsDir, { recursive: true });
      const invalidPath = path.join(subagentsDir, 'invalid.json');
      await fs.writeFile(invalidPath, 'not valid json', 'utf-8');
      
      await expect(
        subagentManager.loadSubagent('invalid')
      ).rejects.toThrow(/invalid.*json/i);
    });

    it('should throw error for missing required fields @requirement:REQ-013', async () => {
      // Create file missing systemPrompt
      await fs.mkdir(subagentsDir, { recursive: true });
      const incompletePath = path.join(subagentsDir, 'incomplete.json');
      const incomplete = {
        name: 'incomplete',
        profile: 'testprofile',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
        // Missing systemPrompt
      };
      await fs.writeFile(incompletePath, JSON.stringify(incomplete), 'utf-8');
      
      await expect(
        subagentManager.loadSubagent('incomplete')
      ).rejects.toThrow(/required field/i);
    });
  });

  describe('listSubagents @requirement:REQ-002', () => {
    it('should return empty array when no subagents exist', async () => {
      const list = await subagentManager.listSubagents();
      expect(list).toEqual([]);
    });

    it('should list all subagent names', async () => {
      await subagentManager.saveSubagent('agent1', 'testprofile', 'Prompt 1');
      await subagentManager.saveSubagent('agent2', 'testprofile', 'Prompt 2');
      await subagentManager.saveSubagent('agent3', 'testprofile', 'Prompt 3');
      
      const list = await subagentManager.listSubagents();
      
      expect(list).toHaveLength(3);
      expect(list).toContain('agent1');
      expect(list).toContain('agent2');
      expect(list).toContain('agent3');
    });

    it('should handle directory not existing', async () => {
      // Don't create any subagents (directory won't exist)
      const list = await subagentManager.listSubagents();
      expect(list).toEqual([]);
    });

    it('should ignore non-json files', async () => {
      await fs.mkdir(subagentsDir, { recursive: true });
      await subagentManager.saveSubagent('agent1', 'testprofile', 'Prompt 1');
      await fs.writeFile(path.join(subagentsDir, 'readme.txt'), 'text file', 'utf-8');
      await fs.writeFile(path.join(subagentsDir, 'data.xml'), '<xml/>', 'utf-8');
      
      const list = await subagentManager.listSubagents();
      
      expect(list).toHaveLength(1);
      expect(list).toContain('agent1');
    });
  });

  describe('deleteSubagent @requirement:REQ-002', () => {
    it('should delete existing subagent and return true', async () => {
      const name = 'testagent';
      await subagentManager.saveSubagent(name, 'testprofile', 'Test prompt');
      
      const deleted = await subagentManager.deleteSubagent(name);
      
      expect(deleted).toBe(true);
      
      // Verify file no longer exists
      const filePath = path.join(subagentsDir, `${name}.json`);
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });

    it('should return false for non-existent subagent', async () => {
      const deleted = await subagentManager.deleteSubagent('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('subagentExists @requirement:REQ-002', () => {
    it('should return true for existing subagent', async () => {
      await subagentManager.saveSubagent('testagent', 'testprofile', 'Test prompt');
      
      const exists = await subagentManager.subagentExists('testagent');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent subagent', async () => {
      const exists = await subagentManager.subagentExists('nonexistent');
      expect(exists).toBe(false);
    });
  });

  describe('validateProfileReference @requirement:REQ-002', () => {
    it('should return true for existing profile', async () => {
      const isValid = await subagentManager.validateProfileReference('testprofile');
      expect(isValid).toBe(true);
    });

    it('should return false for non-existent profile', async () => {
      const isValid = await subagentManager.validateProfileReference('nonexistent');
      expect(isValid).toBe(false);
    });
  });
});
```

### Test Requirements

1. **Behavioral Testing**: Test what the code DOES, not how it's implemented
2. **Real File System**: Use temp directories, no mocks
3. **Error Cases**: Test all validation and error paths
4. **Edge Cases**: Empty inputs, missing files, invalid data
5. **Cleanup**: Always cleanup temp directories in afterEach
6. **No NotYetImplemented**: Tests verify actual behavior, not stub placeholders

### Required Code Markers

Every test suite MUST include:
```typescript
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P04
 * @requirement:REQ-XXX
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P04" packages/core/src/config/test/ | wc -l
# Expected: 8+ occurrences

# Check requirement markers
grep -r "@requirement:REQ-002" packages/core/src/config/test/subagentManager.test.ts | wc -l
# Expected: 7+ occurrences

# Tests exist but will fail naturally (stub implementation)
npm test -- subagentManager.test.ts 2>&1 | grep -q "FAIL\|fail\|0 passed" || echo "WARNING: Tests should fail at this stage"

# Check no forbidden patterns in tests
grep -r "NotYetImplemented\|TODO" packages/core/src/config/test/subagentManager.test.ts
# Expected: No matches
```

### Manual Verification Checklist

- [ ] Test file created in correct location
- [ ] All REQ-002 methods have tests
- [ ] Tests use real file system (temp directories)
- [ ] Tests cleanup after themselves
- [ ] Error cases tested (invalid name, missing profile, empty prompt)
- [ ] Edge cases tested (directory not exists, invalid JSON)
- [ ] All tests have @plan:markers
- [ ] All tests have @requirement:markers
- [ ] Tests will fail naturally (because of stub implementation)
- [ ] No test checks for "NotYetImplemented" error

## Success Criteria

- Test file created with 20+ tests
- All SubagentManager methods tested
- Tests use behavioral approach (no mocks)
- Tests will fail naturally due to stub implementation
- All @plan:and @requirement:markers present
- TypeScript compiles
- No forbidden patterns (NotYetImplemented checks)

## Failure Recovery

If tests pass unexpectedly:

1. Check if tests are checking stub behavior (WRONG)
2. Rewrite tests to check actual behavior
3. Ensure tests expect real file I/O, not empty returns

If tests have compilation errors:

1. Check import paths
2. Verify temp directory setup
3. Ensure all types are correct

## Phase Completion Marker

Create: `project-plans/subagentconfig/.completed/P04.md`

Contents:
```markdown
# Phase 04: SubagentManager TDD Complete

**Completed**: [TIMESTAMP]

## Files Created
- packages/core/src/config/test/subagentManager.test.ts ([LINE_COUNT] lines, [TEST_COUNT] tests)

## Test Coverage
- saveSubagent: 6 tests
- loadSubagent: 4 tests
- listSubagents: 4 tests
- deleteSubagent: 2 tests
- subagentExists: 2 tests
- validateProfileReference: 2 tests

Total: [TEST_COUNT] behavioral tests

## Verification
```
$ npm test -- subagentManager.test.ts
[ERROR] Tests fail naturally (stub implementation)

$ grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P04" packages/core/src/config/test/subagentManager.test.ts
8+

$ grep -c "@requirement:REQ-002" packages/core/src/config/test/subagentManager.test.ts
7+
```

## Next Phase
Ready for Phase 05: SubagentManager Implementation
```

---

**CRITICAL**: Tests MUST fail at this stage because the stub implementation returns empty values. Tests verify ACTUAL behavior, not stub placeholders. Implementation in Phase 05 will make these tests pass.
