/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
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

describe('prompts', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;
  const baseOptions: CoreSystemPromptOptions = {
    provider: 'gemini',
    model: 'gemini-1.5-pro',
  };

  const callPrompt = (
    overrides: Partial<CoreSystemPromptOptions> = {},
  ): Promise<string> => {
    const options = { ...baseOptions, ...overrides };
    return getCoreSystemPromptAsync(options);
  };

  // Use a single temp directory for all tests to avoid singleton issues
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-test-'));
    process.env.LLXPRT_PROMPTS_DIR = tempDir;
    await initializePromptSystem();
  });

  afterAll(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getCoreSystemPromptAsync', () => {
    it('should return a valid prompt string', async () => {
      const prompt = await callPrompt();
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should include user memory when provided', async () => {
      const userMemory = 'Remember: The user prefers concise responses.';
      const prompt = await callPrompt({ userMemory });
      expect(prompt).toContain(userMemory);
    });

    it('should handle different models', async () => {
      const prompt = await callPrompt({ model: 'gemini-1.5-flash' });
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
    });

    it('should handle custom tools list', async () => {
      const tools = ['read_file', 'write_file', 'list_directory'];
      const prompt = await callPrompt({ tools });
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
    });
  });

  describe('initializePromptSystem', () => {
    it('should initialize without errors', async () => {
      await expect(initializePromptSystem()).resolves.not.toThrow();
    });

    it('should allow multiple initializations', async () => {
      await expect(initializePromptSystem()).resolves.not.toThrow();
      await expect(initializePromptSystem()).resolves.not.toThrow();
    });
  });
});
