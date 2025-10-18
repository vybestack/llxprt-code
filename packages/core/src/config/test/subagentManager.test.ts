/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { it as itProp } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SubagentManager } from '../subagentManager.js';
import { ProfileManager } from '../profileManager.js';
import { SubagentConfig } from '../config/types.js';

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

  const validNameValues = [
    'agent1',
    'agent_2',
    'agent-3',
    'robot4',
    'unit5',
    'node6',
    'alpha',
    'beta',
  ] as const;
  const validNameArb = fc.constantFrom(...validNameValues);

  beforeEach(async () => {
    // Create temp directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-test-'));
    subagentsDir = path.join(tempDir, 'subagents');
    profilesDir = path.join(tempDir, 'profiles');

    // Initialize managers with temp directories
    profileManager = new ProfileManager(profilesDir);
    subagentManager = new SubagentManager(subagentsDir, profileManager);

    // Create a test profile in the temp directory
    await fs.mkdir(profilesDir, { recursive: true });
    const testProfile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };
    await profileManager.saveProfile('testprofile', testProfile);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('saveSubagent @requirement:REQ-002 @plan:PLAN-20250117-SUBAGENTCONFIG.P04', () => {
    it('should create new subagent file with correct structure', async () => {
      const name = 'testagent';
      const profile = 'testprofile';
      const systemPrompt = 'You are a test agent';

      await subagentManager.saveSubagent(name, profile, systemPrompt);

      // Verify file was created
      const filePath = path.join(subagentsDir, `${name}.json`);
      const fileExists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
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
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update subagent
      await subagentManager.saveSubagent(name, profile, systemPrompt2);
      const updated = await subagentManager.loadSubagent(name);

      // Verify createdAt preserved, updatedAt changed
      expect(updated.createdAt).toBe(originalCreatedAt);
      expect(updated.updatedAt).not.toBe(original.updatedAt);
      expect(updated.systemPrompt).toBe(systemPrompt2);
    });

    it('should create subagents directory if not exists @plan:PLAN-20250117-SUBAGENTCONFIG.P04', async () => {
      // Remove the subagents directory
      await fs.rm(subagentsDir, { recursive: true, force: true });

      // Save should create directory
      await subagentManager.saveSubagent(
        'testagent',
        'testprofile',
        'Test prompt',
      );

      // Verify directory exists
      const dirExists = await fs
        .access(subagentsDir)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);
    });

    const invalidSuffixArb = fc.constantFrom(
      ' ',
      '/',
      '\\',
      '..',
      '@',
      '#',
      '😀',
    );

    itProp(
      'rejects invalid subagent names generated randomly @plan:PLAN-20250117-SUBAGENTCONFIG.P04 @requirement:REQ-013',
      [validNameArb, invalidSuffixArb],
      async (base, suffix) => {
        const invalidName = `${base}${suffix}`;
        await expect(
          subagentManager.saveSubagent(invalidName, 'testprofile', 'Prompt'),
        ).rejects.toThrow(/invalid.*name/i);
      },
    );

    const whitespacePromptArb = fc.constantFrom(
      ' ',
      '   ',
      String.fromCharCode(9),
      String.fromCharCode(10),
      String.fromCharCode(13),
      `${String.fromCharCode(32)}${String.fromCharCode(10)}${String.fromCharCode(9)}${String.fromCharCode(32)}`,
    );

    itProp(
      'rejects prompts that resolve to empty text @plan:PLAN-20250117-SUBAGENTCONFIG.P04 @requirement:REQ-013',
      [whitespacePromptArb],
      async (emptyPrompt) => {
        await expect(
          subagentManager.saveSubagent('testagent', 'testprofile', emptyPrompt),
        ).rejects.toThrow(/prompt/i);
      },
    );

    itProp(
      'rejects non-existent profiles generated randomly @plan:PLAN-20250117-SUBAGENTCONFIG.P04 @requirement:REQ-013',
      [validNameArb],
      async (baseProfile) => {
        const unknownProfile = `${baseProfile}-alt`;
        await fs.rm(subagentsDir, { recursive: true, force: true });
        await expect(
          subagentManager.saveSubagent('testagent', unknownProfile, 'Prompt'),
        ).rejects.toThrow(/profile.*not found/i);
      },
    );
  });

  describe('loadSubagent @requirement:REQ-002 @plan:PLAN-20250117-SUBAGENTCONFIG.P04', () => {
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

    it('should throw error for non-existent subagent @requirement:REQ-013 @plan:PLAN-20250117-SUBAGENTCONFIG.P04', async () => {
      await expect(subagentManager.loadSubagent('nonexistent')).rejects.toThrow(
        /not found/i,
      );
    });

    it('should throw error for invalid JSON @requirement:REQ-013 @plan:PLAN-20250117-SUBAGENTCONFIG.P04', async () => {
      // Create invalid JSON file
      await fs.mkdir(subagentsDir, { recursive: true });
      const invalidPath = path.join(subagentsDir, 'invalid.json');
      await fs.writeFile(invalidPath, 'not valid json', 'utf-8');

      await expect(subagentManager.loadSubagent('invalid')).rejects.toThrow(
        /invalid.*json/i,
      );
    });

    it('should throw error for missing required fields @requirement:REQ-013 @plan:PLAN-20250117-SUBAGENTCONFIG.P04', async () => {
      // Create file missing systemPrompt
      await fs.mkdir(subagentsDir, { recursive: true });
      const incompletePath = path.join(subagentsDir, 'incomplete.json');
      const incomplete = {
        name: 'incomplete',
        profile: 'testprofile',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Missing systemPrompt
      };
      await fs.writeFile(incompletePath, JSON.stringify(incomplete), 'utf-8');

      await expect(subagentManager.loadSubagent('incomplete')).rejects.toThrow(
        /required field/i,
      );
    });

    const nonEmptyPromptArb = fc
      .string({ minLength: 1 })
      .filter((value) => value.trim().length > 0);

    itProp(
      'preserves saved subagent configuration for any valid prompt @plan:PLAN-20250117-SUBAGENTCONFIG.P04 @requirement:REQ-002',
      [validNameArb, nonEmptyPromptArb],
      async (name, prompt) => {
        if (typeof name !== 'string') {
          return;
        }
        const normalizedName = name;
        const normalizedPrompt =
          typeof prompt === 'string' ? prompt : String(prompt);
        await fs.rm(subagentsDir, { recursive: true, force: true });
        await subagentManager.saveSubagent(
          normalizedName,
          'testprofile',
          normalizedPrompt,
        );

        const loaded = await subagentManager.loadSubagent(normalizedName);

        expect(loaded.name).toBe(normalizedName);
        expect(loaded.profile).toBe('testprofile');
        expect(loaded.systemPrompt).toBe(normalizedPrompt);
      },
    );
  });

  describe('listSubagents @requirement:REQ-002 @plan:PLAN-20250117-SUBAGENTCONFIG.P04', () => {
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
      await fs.writeFile(
        path.join(subagentsDir, 'readme.txt'),
        'text file',
        'utf-8',
      );
      await fs.writeFile(
        path.join(subagentsDir, 'data.xml'),
        '<xml/>',
        'utf-8',
      );

      const list = await subagentManager.listSubagents();

      expect(list).toHaveLength(1);
      expect(list).toContain('agent1');
    });

    itProp(
      'lists saved subagents in sorted order for any valid set @plan:PLAN-20250117-SUBAGENTCONFIG.P04 @requirement:REQ-002',
      [fc.array(validNameArb, { minLength: 1, maxLength: 6 })],
      async (names) => {
        if (
          !Array.isArray(names) ||
          names.some((value) => typeof value !== 'string')
        ) {
          return;
        }
        // Reset directory to ensure independence between runs
        await fs.rm(subagentsDir, { recursive: true, force: true });
        const uniqueNames = Array.from(new Set(names));

        for (const name of uniqueNames) {
          await subagentManager.saveSubagent(
            name,
            'testprofile',
            `Prompt for ${name}`,
          );
        }

        const list = await subagentManager.listSubagents();
        const expected = [...uniqueNames].sort();
        expect(list).toEqual(expected);
      },
    );
  });

  describe('deleteSubagent @requirement:REQ-002 @plan:PLAN-20250117-SUBAGENTCONFIG.P04', () => {
    it('should delete existing subagent and return true', async () => {
      const name = 'testagent';
      await subagentManager.saveSubagent(name, 'testprofile', 'Test prompt');

      const deleted = await subagentManager.deleteSubagent(name);

      expect(deleted).toBe(true);

      // Verify file no longer exists
      const filePath = path.join(subagentsDir, `${name}.json`);
      const fileExists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);
    });

    it('should return false for non-existent subagent', async () => {
      const deleted = await subagentManager.deleteSubagent('nonexistent');
      expect(deleted).toBe(false);
    });

    itProp(
      'returns false for any unsaved subagent name @plan:PLAN-20250117-SUBAGENTCONFIG.P04 @requirement:REQ-002',
      [validNameArb],
      async (name) => {
        if (typeof name !== 'string') {
          return;
        }
        await fs.rm(subagentsDir, { recursive: true, force: true });
        await fs.mkdir(subagentsDir, { recursive: true });
        const deleted = await subagentManager.deleteSubagent(name);
        expect(deleted).toBe(false);
      },
    );
  });

  describe('subagentExists @requirement:REQ-002 @plan:PLAN-20250117-SUBAGENTCONFIG.P04', () => {
    it('should return true for existing subagent', async () => {
      await subagentManager.saveSubagent(
        'testagent',
        'testprofile',
        'Test prompt',
      );

      const exists = await subagentManager.subagentExists('testagent');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent subagent', async () => {
      const exists = await subagentManager.subagentExists('nonexistent');
      expect(exists).toBe(false);
    });
  });

  describe('validateProfileReference @requirement:REQ-002 @plan:PLAN-20250117-SUBAGENTCONFIG.P04', () => {
    it('should return true for existing profile', async () => {
      const isValid =
        await subagentManager.validateProfileReference('testprofile');
      expect(isValid).toBe(true);
    });

    it('should return false for non-existent profile', async () => {
      const isValid =
        await subagentManager.validateProfileReference('nonexistent');
      expect(isValid).toBe(false);
    });
  });
});
