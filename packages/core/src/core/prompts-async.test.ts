/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { getCoreSystemPromptAsync, initializePromptSystem, resetPromptService } from './prompts.js';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('prompts async integration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;

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

  afterEach(() => {
    // Restore original environment
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  describe('getCoreSystemPromptAsync', () => {
    it('should return a valid prompt string', async () => {
      const prompt = await getCoreSystemPromptAsync();
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
      // Should contain some key content from core.md
      expect(prompt).toContain('interactive CLI agent');
      expect(prompt).toContain('Core Mandates');
    });

    it('should include user memory when provided', async () => {
      const userMemory = 'Remember: The user prefers concise responses.';
      const prompt = await getCoreSystemPromptAsync(userMemory);
      
      // Debug: log what we actually get
      if (!prompt.includes(userMemory)) {
        console.error('Prompt does not contain user memory. Last 500 chars:', prompt.slice(-500));
      }
      
      expect(prompt).toContain(userMemory);
      // Should have both core content and user memory
      expect(prompt).toContain('interactive CLI agent');
      expect(prompt).toContain(userMemory);
    });

    it('should handle different models', async () => {
      const prompt = await getCoreSystemPromptAsync(undefined, 'gemini-1.5-flash');
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      // Flash models should have additional tool instructions
      expect(prompt).toContain('IMPORTANT: You MUST use the provided tools when appropriate');
    });

    it('should handle custom tools list', async () => {
      const tools = ['read_file', 'write_file', 'list_directory'];
      const prompt = await getCoreSystemPromptAsync(undefined, undefined, tools);
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      // Should still contain core content
      expect(prompt).toContain('interactive CLI agent');
    });

    it('should handle git repository environment', async () => {
      // Mock isGitRepository to return true
      process.env.GIT_DIR = '.git';
      const prompt = await getCoreSystemPromptAsync();
      expect(prompt).toBeTruthy();
      // Note: The git detection in buildPromptContext uses isGitRepository 
      // which checks the actual file system, not env vars
    });

    it('should handle sandbox environment', async () => {
      process.env.SANDBOX = 'true';
      const prompt = await getCoreSystemPromptAsync();
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Sandbox');
    });

    it('should handle macOS seatbelt environment', async () => {
      // Clear any existing env first
      delete process.env.SANDBOX;
      
      // Reset the prompt service to clear cache
      resetPromptService();
      await initializePromptSystem();
      
      // Set to sandbox-exec
      process.env.SANDBOX = 'sandbox-exec';
      const prompt = await getCoreSystemPromptAsync();
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('macOS Seatbelt');
    });
  });

  describe('prompt content validation', () => {
    it('should include all required tool references', async () => {
      const prompt = await getCoreSystemPromptAsync();
      
      // Check for tool references (they should be replaced with actual tool names)
      expect(prompt).toContain('Ls');
      expect(prompt).toContain('Edit');
      expect(prompt).toContain('Glob');
      expect(prompt).toContain('Grep');
      expect(prompt).toContain('ReadFile');
      expect(prompt).toContain('WriteFile');
      expect(prompt).toContain('Shell');
    });

    it('should properly format user memory with separator', async () => {
      const userMemory = 'Custom user preferences here';
      const prompt = await getCoreSystemPromptAsync(userMemory);
      
      // Should have the separator before user memory
      expect(prompt).toMatch(/---\s*Custom user preferences here/);
    });
  });
});