/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for Core (System) Memory feature (Issue #1247)
 *
 * Verifies that:
 * 1. loadCoreMemoryContent reads .LLXPRT_SYSTEM files from global and project dirs
 * 2. getCoreSystemPromptAsync incorporates core memory into the system prompt
 * 3. model.allMemoriesAreCore merges user memory into core memory
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import {
  getCoreSystemPromptAsync,
  loadCoreMemoryContent,
  initializePromptSystem,
  type CoreSystemPromptOptions,
} from './prompts.js';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      ),
  };
});

const mockSettingsService = {
  get: vi.fn().mockReturnValue(undefined),
  set: vi.fn(),
};
vi.mock('../settings/settingsServiceInstance.js', () => ({
  getSettingsService: () => mockSettingsService,
}));

describe('Core (System) Memory', () => {
  let tempDir: string;
  let fsPromises: typeof import('node:fs/promises');
  const baseOptions: CoreSystemPromptOptions = {
    provider: 'gemini',
    model: 'gemini-1.5-pro',
  };

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-core-memory-test-'),
    );
    process.env.LLXPRT_PROMPTS_DIR = tempDir;
    await initializePromptSystem();
    fsPromises = await import('node:fs/promises');
  });

  beforeEach(() => {
    vi.mocked(fsPromises.readFile).mockReset();
    vi.mocked(fsPromises.readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    mockSettingsService.get.mockReturnValue(undefined);
  });

  describe('loadCoreMemoryContent', () => {
    it('should return empty string when no .LLXPRT_SYSTEM files exist', async () => {
      const result = await loadCoreMemoryContent('/some/project');
      expect(result).toBe('');
    });

    it('should load global .LLXPRT_SYSTEM content', async () => {
      vi.mocked(fsPromises.readFile).mockImplementation(
        async (filePath: Parameters<typeof fsPromises.readFile>[0]) => {
          const pathStr =
            typeof filePath === 'string' ? filePath : filePath.toString();
          if (
            pathStr.includes('.LLXPRT_SYSTEM') &&
            pathStr.includes(os.homedir())
          ) {
            return 'Always use TypeScript strict mode';
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      );

      const result = await loadCoreMemoryContent('/some/project');
      expect(result).toContain('Always use TypeScript strict mode');
      expect(result).toContain('Core System Memory');
    });

    it('should load project .LLXPRT_SYSTEM content', async () => {
      vi.mocked(fsPromises.readFile).mockImplementation(
        async (filePath: Parameters<typeof fsPromises.readFile>[0]) => {
          const pathStr =
            typeof filePath === 'string' ? filePath : filePath.toString();
          if (
            pathStr.includes('.LLXPRT_SYSTEM') &&
            pathStr.includes('/my/project')
          ) {
            return 'Use pnpm for this project';
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      );

      const result = await loadCoreMemoryContent('/my/project');
      expect(result).toContain('Use pnpm for this project');
    });

    it('should concatenate both global and project content', async () => {
      vi.mocked(fsPromises.readFile).mockImplementation(
        async (filePath: Parameters<typeof fsPromises.readFile>[0]) => {
          const pathStr =
            typeof filePath === 'string' ? filePath : filePath.toString();
          if (
            pathStr.includes('.LLXPRT_SYSTEM') &&
            pathStr.includes(os.homedir())
          ) {
            return 'Global directive';
          }
          if (
            pathStr.includes('.LLXPRT_SYSTEM') &&
            pathStr.includes('/my/project')
          ) {
            return 'Project directive';
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      );

      const result = await loadCoreMemoryContent('/my/project');
      expect(result).toContain('Global directive');
      expect(result).toContain('Project directive');
    });

    it('should skip empty .LLXPRT_SYSTEM files', async () => {
      vi.mocked(fsPromises.readFile).mockImplementation(
        async (filePath: Parameters<typeof fsPromises.readFile>[0]) => {
          const pathStr =
            typeof filePath === 'string' ? filePath : filePath.toString();
          if (
            pathStr.includes('.LLXPRT_SYSTEM') &&
            pathStr.includes(os.homedir())
          ) {
            return '   \n  ';
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      );

      const result = await loadCoreMemoryContent('/my/project');
      expect(result).toBe('');
    });
  });

  describe('getCoreSystemPromptAsync with core memory', () => {
    it('should include core memory in the assembled prompt', async () => {
      // Pass core memory explicitly
      const prompt = await getCoreSystemPromptAsync({
        ...baseOptions,
        coreMemory: 'Always prefer functional programming',
      });

      expect(prompt).toContain('Always prefer functional programming');
    });

    it('should not throw with no core or user memory', async () => {
      const prompt = await getCoreSystemPromptAsync(baseOptions);
      expect(typeof prompt).toBe('string');
    });
  });

  describe('model.allMemoriesAreCore', () => {
    it('should merge user memory into core memory when enabled', async () => {
      mockSettingsService.get.mockImplementation((key: string) => {
        if (key === 'model.allMemoriesAreCore') return true;
        return undefined;
      });

      const prompt = await getCoreSystemPromptAsync({
        ...baseOptions,
        userMemory: 'My LLXPRT.md content here',
        coreMemory: '',
      });

      // The user memory should appear in the prompt (now treated as core)
      expect(prompt).toContain('My LLXPRT.md content here');
    });
  });
});
