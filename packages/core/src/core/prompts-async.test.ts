/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test-first implementation for issue #1019: Subagent Delegation Block
 *
 * These tests verify that:
 * 1. Subagent Delegation block is present when it should be present
 * 2. Subagent Delegation block is absent when it should be absent
 * 3. Delegation markers are stripped from final prompts
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  vi,
} from 'vitest';
import {
  getCoreSystemPromptAsync,
  initializePromptSystem,
  type CoreSystemPromptOptions,
} from './prompts.js';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as folderStructureModule from '../utils/getFolderStructure.js';
import * as settingsServiceInstance from '../settings/settingsServiceInstance.js';

describe('prompts async integration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;
  const baseOptions: CoreSystemPromptOptions = {
    provider: 'gemini',
    model: 'gemini-1.5-pro',
  };

  beforeAll(async () => {
    // Create a temporary directory for test prompts
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-test-'));
    process.env.LLXPRT_PROMPTS_DIR = tempDir;

    // Initialize the prompt system once for all tests
    await initializePromptSystem();
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.LLXPRT_PROMPTS_DIR = tempDir;
  });

  const callPrompt = (
    overrides: Partial<CoreSystemPromptOptions> = {},
  ): Promise<string> => {
    const options = { ...baseOptions, ...overrides };
    return getCoreSystemPromptAsync(options);
  };

  const buildLargeFolderStructure = (entryCount: number): string => {
    const header = [
      'Showing up to 100 items (files + folders).',
      '',
      '/tmp/workspace/',
    ];
    const entries = Array.from({ length: entryCount }, (_, index) => {
      const connector = index === entryCount - 1 ? '└───' : '├───';
      return `${connector}folder-${index}/`;
    });
    return [...header, ...entries].join('\n');
  };

  afterEach(() => {
    // Restore original environment
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  describe('getCoreSystemPromptAsync', () => {
    it('should return a valid prompt string', async () => {
      const prompt = await callPrompt();
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
      // Should contain some key content from core.md
      expect(prompt).toContain('interactive CLI agent');
      expect(prompt).toContain('Core Mandates');
    });

    it('should include user memory when provided', async () => {
      const userMemory = 'Remember: The user prefers concise responses.';
      const prompt = await callPrompt({ userMemory });

      expect(prompt).toContain(userMemory);
      // Should have both core content and user memory
      expect(prompt).toContain('interactive CLI agent');
      expect(prompt).toContain(userMemory);
    });

    it.skip('should handle different models', async () => {
      const prompt = await callPrompt({ model: 'gemini-2.5-flash' });
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');

      // Flash models should have additional tool instructions
      expect(prompt).toContain(
        'IMPORTANT: You MUST use the provided tools when appropriate',
      );
    });

    it('should handle custom tools list', async () => {
      const tools = ['read_file', 'write_file', 'list_directory'];
      const prompt = await callPrompt({ tools });
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      // Should still contain core content
      expect(prompt).toContain('interactive CLI agent');
    });

    it('should handle git repository environment', async () => {
      // Mock isGitRepository to return true
      process.env.GIT_DIR = '.git';
      const prompt = await callPrompt();
      expect(prompt).toBeTruthy();
      // Note: The git detection in buildPromptContext uses isGitRepository
      // which checks the actual file system, not env vars
    });

    it('should handle sandbox environment', async () => {
      process.env.SANDBOX = 'true';
      const prompt = await callPrompt();
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Sandbox');
    });

    it('should handle different environments based on initial setup', async () => {
      // This test just verifies the prompt system works
      // We can't test environment changes without reset functionality
      const prompt = await callPrompt();
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    });
  });

  describe('prompt content validation', () => {
    it('should include all required tool references', async () => {
      const prompt = await callPrompt();

      // Check for tool references that are substituted in core.md template
      // core.md only mentions: ${GrepTool.Name}, ${GlobTool.Name}, ${ReadFileTool.Name}, ${ReadManyFilesTool.Name}
      expect(prompt).toContain('Glob');
      expect(prompt).toContain('Grep');
      expect(prompt).toContain('ReadFile');
      expect(prompt).toContain('ReadManyFiles');
    });

    it('should properly format user memory with separator', async () => {
      const userMemory = 'Custom user preferences here';
      const prompt = await callPrompt({ userMemory });

      // Should have the separator before user memory
      expect(prompt).toMatch(/---\s*Custom user preferences here/);
    });

    it.skip('truncates oversized folder structure payloads for provider safety', async () => {
      // TODO: Skipped as part of #680 - include-folder-structure defaults to false for cache optimization
      // This test needs to be updated to properly re-initialize the prompt system with the mocked setting
      // include-folder-structure defaults to false for better cache hit rates,
      // so we need to mock the settings service to return true for this test
      const mockSettingsService = {
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'include-folder-structure') return true;
          return undefined;
        }),
      };
      const settingsSpy = vi
        .spyOn(settingsServiceInstance, 'getSettingsService')
        .mockReturnValue(
          mockSettingsService as unknown as ReturnType<
            typeof settingsServiceInstance.getSettingsService
          >,
        );

      const longStructure = buildLargeFolderStructure(80);
      const folderSpy = vi
        .spyOn(folderStructureModule, 'getFolderStructure')
        .mockResolvedValue(longStructure);
      try {
        const prompt = await callPrompt({
          tools: ['read_file', 'web_fetch'],
        });
        expect(folderSpy).toHaveBeenCalled();
        expect(prompt).toContain(
          'folder structure truncated for provider limits',
        );
        expect(prompt).toContain('├───folder-0/');
        expect(prompt).toContain('├───folder-19/');
        expect(prompt).not.toContain('├───folder-40/');
      } finally {
        folderSpy.mockRestore();
        settingsSpy.mockRestore();
      }
    });
  });

  describe('subagent delegation block (issue #1019)', () => {
    it('should contain Subagent Delegation block when includeSubagentDelegation is true and tools include both task and list_subagents', async () => {
      const tools = ['read_file', 'list_subagents', 'task'];
      const prompt = await getCoreSystemPromptAsync({
        ...baseOptions,
        tools,
        includeSubagentDelegation: true,
      });

      expect(prompt).toContain('# Subagent Delegation');
      expect(prompt).toContain('Requests that involve whole-codebase analysis');
      expect(prompt).toContain(
        'Call `list_subagents` if you need to confirm the available helpers',
      );
    });

    it('should replace SUBAGENT_DELEGATION placeholder with empty when includeSubagentDelegation is false', async () => {
      const tools = ['read_file', 'list_subagents', 'task'];
      const prompt = await getCoreSystemPromptAsync({
        ...baseOptions,
        tools,
        includeSubagentDelegation: false,
      });

      expect(prompt).not.toContain('Subagent Delegation');
      expect(prompt).not.toContain(
        'Requests that involve whole-codebase analysis',
      );
      expect(prompt).not.toContain(
        'Call `list_subagents` if you need to confirm the available helpers',
      );
    });

    it('should replace SUBAGENT_DELEGATION placeholder with empty when tools do not include ListSubagents', async () => {
      const tools = ['read_file', 'task'];
      const prompt = await getCoreSystemPromptAsync({
        ...baseOptions,
        tools,
        includeSubagentDelegation: true,
      });

      expect(prompt).not.toContain('Subagent Delegation');
      expect(prompt).not.toContain(
        'Requests that involve whole-codebase analysis',
      );
    });

    it('should replace SUBAGENT_DELEGATION placeholder with empty when tools do not include Task', async () => {
      const tools = ['read_file', 'list_subagents'];
      const prompt = await getCoreSystemPromptAsync({
        ...baseOptions,
        tools,
        includeSubagentDelegation: true,
      });

      expect(prompt).not.toContain('Subagent Delegation');
      expect(prompt).not.toContain(
        'Requests that involve whole-codebase analysis',
      );
    });

    it('should replace SUBAGENT_DELEGATION placeholder with empty when includeSubagentDelegation is undefined', async () => {
      const tools = ['read_file', 'list_subagents', 'task'];
      const prompt = await getCoreSystemPromptAsync({
        ...baseOptions,
        tools,
      });

      expect(prompt).not.toContain('Subagent Delegation');
      expect(prompt).not.toContain(
        'Requests that involve whole-codebase analysis',
      );
    });

    it('should not contain placeholder markers like {{SUBAGENT_DELEGATION}} in final output', async () => {
      const tools = ['read_file', 'list_subagents', 'task'];
      const prompt = await getCoreSystemPromptAsync({
        ...baseOptions,
        tools,
        includeSubagentDelegation: false,
      });

      expect(prompt).not.toContain('{{SUBAGENT_DELEGATION}}');
    });
  });
});
