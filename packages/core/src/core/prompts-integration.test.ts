/**
 * Integration tests for migrating getCoreSystemPrompt to use PromptService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCoreSystemPrompt } from './prompts.js';
import { PromptService } from '../prompt-config/prompt-service.js';
import type { PromptContext } from '../prompt-config/types.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { isGitRepository } from '../utils/gitUtils.js';

// Mock dependencies
vi.mock('../utils/gitUtils.js');

describe('getCoreSystemPrompt Integration with PromptService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Setup mocks
    vi.mocked(isGitRepository).mockReturnValue(false);
    
    // Clear environment variables
    delete process.env.GEMINI_SYSTEM_MD;
    delete process.env.SANDBOX;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Backward Compatibility', () => {
    it('should produce same output with no parameters', async () => {
      // Get old system output
      const oldOutput = getCoreSystemPrompt();
      
      // Create PromptService and get new output
      const service = new PromptService({
        baseDir: path.join(os.tmpdir(), 'test-prompts'),
      });
      await service.initialize();
      
      const context: PromptContext = {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        enabledTools: [],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };
      
      const newOutput = await service.getPrompt(context);
      
      // Core content should be present in both
      expect(oldOutput).toContain('You are an interactive CLI agent');
      expect(newOutput).toContain('You are an interactive CLI agent');
    });

    it('should handle user memory correctly', async () => {
      const userMemory = 'Remember to be extra polite';
      
      // Get old system output with memory
      const oldOutput = getCoreSystemPrompt(userMemory);
      
      // Create PromptService and get new output
      const service = new PromptService({
        baseDir: path.join(os.tmpdir(), 'test-prompts-memory'),
      });
      await service.initialize();
      
      const context: PromptContext = {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        enabledTools: [],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };
      
      const newOutput = await service.getPrompt(context, userMemory);
      
      // Both should contain the user memory
      expect(oldOutput).toContain(userMemory);
      expect(newOutput).toContain(userMemory);
    });

    it('should handle flash model instructions', async () => {
      const model = 'gemini-2.5-flash';
      
      // Get old system output with flash model
      const oldOutput = getCoreSystemPrompt(undefined, model);
      
      // Create PromptService and get new output
      const service = new PromptService({
        baseDir: path.join(os.tmpdir(), 'test-prompts-flash'),
      });
      await service.initialize();
      
      const context: PromptContext = {
        provider: 'gemini',
        model,
        enabledTools: [],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };
      
      const newOutput = await service.getPrompt(context);
      
      // Flash models should have tool usage instructions
      expect(oldOutput).toContain('IMPORTANT: You MUST use the provided tools');
      expect(newOutput).toContain('IMPORTANT: You MUST use the provided tools');
    });

    it('should handle sandbox environment', async () => {
      process.env.SANDBOX = 'true';
      
      // Get old system output
      const oldOutput = getCoreSystemPrompt();
      
      // Create PromptService and get new output
      const service = new PromptService({
        baseDir: path.join(os.tmpdir(), 'test-prompts-sandbox'),
      });
      await service.initialize();
      
      const context: PromptContext = {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        enabledTools: [],
        environment: {
          isGitRepository: false,
          isSandboxed: true,
          hasIdeCompanion: false,
          sandboxType: 'generic',
        },
      };
      
      const newOutput = await service.getPrompt(context);
      
      // Both should contain sandbox instructions
      expect(oldOutput).toContain('# Sandbox');
      expect(newOutput).toContain('# Sandbox');
    });

    it('should handle git repository environment', async () => {
      vi.mocked(isGitRepository).mockReturnValue(true);
      
      // Get old system output
      const oldOutput = getCoreSystemPrompt();
      
      // Create PromptService and get new output
      const service = new PromptService({
        baseDir: path.join(os.tmpdir(), 'test-prompts-git'),
      });
      await service.initialize();
      
      const context: PromptContext = {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        enabledTools: [],
        environment: {
          isGitRepository: true,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };
      
      const newOutput = await service.getPrompt(context);
      
      // Both should contain git instructions
      expect(oldOutput).toContain('# Git Repository');
      expect(newOutput).toContain('# Git Repository');
    });

    it('should handle macos seatbelt environment', async () => {
      process.env.SANDBOX = 'sandbox-exec';
      
      // Get old system output
      const oldOutput = getCoreSystemPrompt();
      
      // Create PromptService and get new output
      const service = new PromptService({
        baseDir: path.join(os.tmpdir(), 'test-prompts-seatbelt'),
      });
      await service.initialize();
      
      const context: PromptContext = {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        enabledTools: [],
        environment: {
          isGitRepository: false,
          isSandboxed: true,
          hasIdeCompanion: false,
          sandboxType: 'macos-seatbelt',
        },
      };
      
      const newOutput = await service.getPrompt(context);
      
      // Both should contain macOS Seatbelt instructions
      expect(oldOutput).toContain('# macOS Seatbelt');
      expect(newOutput).toContain('# macOS Seatbelt');
    });
  });

  describe('Tool Integration', () => {
    it('should include enabled tools in the prompt', async () => {
      const service = new PromptService({
        baseDir: path.join(os.tmpdir(), 'test-prompts-tools'),
      });
      await service.initialize();
      
      const context: PromptContext = {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        enabledTools: ['ReadFile', 'WriteFile', 'Shell'],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false,
        },
      };
      
      const output = await service.getPrompt(context);
      
      // Should contain tool references
      expect(output).toContain('ReadFileTool');
      expect(output).toContain('WriteFileTool');
      expect(output).toContain('ShellTool');
    });
  });
});