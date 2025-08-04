/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCoreSystemPrompt, getCoreSystemPromptAsync, initializePromptSystem, resetPromptService } from './prompts.js';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('prompts', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    // Create a temporary directory for test prompts
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-test-'));
    process.env.LLXPRT_PROMPTS_DIR = tempDir;
    
    // Reset the prompt service before each test
    resetPromptService();
    
    // Initialize the prompt system for each test
    await initializePromptSystem();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getCoreSystemPrompt', () => {
    it('should return a valid prompt string', async () => {
      const prompt = await getCoreSystemPromptAsync();
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should include user memory when provided', async () => {
      const userMemory = 'Remember: The user prefers concise responses.';
      const prompt = await getCoreSystemPromptAsync(userMemory);
      expect(prompt).toContain(userMemory);
    });

    it('should handle different models', async () => {
      const prompt = await getCoreSystemPromptAsync(undefined, 'gemini-1.5-flash');
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
    });

    it('should handle custom tools list', async () => {
      const tools = ['read_file', 'write_file', 'list_directory'];
      const prompt = await getCoreSystemPromptAsync(undefined, undefined, tools);
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

  describe('getCoreSystemPrompt (sync version)', () => {
    it('should return functional fallback prompt', () => {
      // The sync version is deprecated but provides a functional fallback
      const syncPrompt = getCoreSystemPrompt();
      
      expect(syncPrompt).toContain('You are an interactive CLI agent');
      expect(syncPrompt).toContain('Core Mandates');
    });
  });
});