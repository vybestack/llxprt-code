/**
 * End-to-end tests for the new prompt system integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getCoreSystemPrompt, initializePromptSystem } from './prompts.js';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Prompt System E2E Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Enable new prompt system
    process.env.USE_NEW_PROMPT_SYSTEM = 'true';
    
    // Set a custom prompts directory for testing
    const testPromptsDir = path.join(os.tmpdir(), 'llxprt-prompts-e2e-test');
    process.env.LLXPRT_PROMPTS_DIR = testPromptsDir;
    
    // Initialize the system
    await initializePromptSystem();
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Basic Functionality', () => {
    it('should generate prompt with new system enabled', () => {
      const prompt = getCoreSystemPrompt();
      
      // Should contain core content
      expect(prompt).toContain('You are an interactive CLI agent');
      expect(prompt).toContain('Core Mandates');
      expect(prompt).toContain('Primary Workflows');
    });

    it('should include user memory', () => {
      const userMemory = 'Remember to be helpful and concise';
      const prompt = getCoreSystemPrompt(userMemory);
      
      expect(prompt).toContain(userMemory);
    });

    it('should handle different models', () => {
      // Test regular model
      const regularPrompt = getCoreSystemPrompt(undefined, 'gemini-1.5-pro');
      expect(regularPrompt).toContain('You are an interactive CLI agent');
      
      // Test flash model - should include tool usage instructions
      const flashPrompt = getCoreSystemPrompt(undefined, 'gemini-2.5-flash');
      expect(flashPrompt).toContain('You are an interactive CLI agent');
      // Note: Flash-specific instructions are in a separate file that gets appended
    });

    it('should handle tools parameter', () => {
      const tools = ['read_file', 'write_file', 'run_shell_command'];
      const prompt = getCoreSystemPrompt(undefined, 'gemini-1.5-pro', tools);
      
      // Should still contain core content
      expect(prompt).toContain('You are an interactive CLI agent');
    });
  });

  describe('Environment Detection', () => {
    it('should handle sandbox environment', () => {
      process.env.SANDBOX = 'true';
      const prompt = getCoreSystemPrompt();
      
      expect(prompt).toContain('# Sandbox');
      expect(prompt).toContain('sandbox container');
      
      delete process.env.SANDBOX;
    });

    it('should handle macOS seatbelt environment', () => {
      process.env.SANDBOX = 'sandbox-exec';
      const prompt = getCoreSystemPrompt();
      
      expect(prompt).toContain('# macOS Seatbelt');
      expect(prompt).toContain('macos seatbelt');
      
      delete process.env.SANDBOX;
    });

    it('should handle non-sandbox environment', () => {
      delete process.env.SANDBOX;
      const prompt = getCoreSystemPrompt();
      
      expect(prompt).toContain('# Outside of Sandbox');
      expect(prompt).toContain('running outside of a sandbox');
    });
  });

  describe('Backward Compatibility', () => {
    it('should work without initializing when new system is disabled', () => {
      // Temporarily disable new system
      process.env.USE_NEW_PROMPT_SYSTEM = 'false';
      
      const prompt = getCoreSystemPrompt();
      expect(prompt).toContain('You are an interactive CLI agent');
      
      // Re-enable for other tests
      process.env.USE_NEW_PROMPT_SYSTEM = 'true';
    });
  });
});