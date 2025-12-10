import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PromptResolver } from './prompt-resolver.js';
import { PromptContext } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DebugLogger } from '../debug/DebugLogger.js';

describe('PromptResolver', () => {
  let resolver: PromptResolver;
  let tempDir: string;
  let mockContext: PromptContext;

  beforeEach(() => {
    resolver = new PromptResolver();

    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'));

    // Create basic directory structure
    fs.mkdirSync(path.join(tempDir, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'env'), { recursive: true });

    // Create mock context with range editor tools
    mockContext = {
      provider: 'openai',
      model: 'gpt-4',
      environment: {
        isGitRepository: true,
        isSandboxed: false,
        sandboxType: undefined,
        hasIdeCompanion: false,
      },
      enabledTools: ['delete_line_range', 'insert_at_line', 'read_line_range'],
      enableToolPrompts: true, // Explicitly enable for tests that check tool prompts
    };
  });

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('resolveAllFiles', () => {
    it('should successfully resolve tool prompts for range editor tools', () => {
      // Create the tool prompt files that match what the resolver expects
      // delete_line_range -> delete-line-range.md
      fs.writeFileSync(
        path.join(tempDir, 'tools/delete-line-range.md'),
        '- Delete tool prompt',
      );
      // insert_at_line -> insert-at-line.md
      fs.writeFileSync(
        path.join(tempDir, 'tools/insert-at-line.md'),
        '- Insert tool prompt',
      );
      // read_line_range -> read-line-range.md
      fs.writeFileSync(
        path.join(tempDir, 'tools/read-line-range.md'),
        '- Read range tool prompt',
      );

      const resolvedFiles = resolver.resolveAllFiles(tempDir, mockContext);

      const toolFiles = resolvedFiles.filter((f) => f.type === 'tool');
      expect(toolFiles).toHaveLength(3);

      const toolNames = toolFiles.map((f) => f.toolName);
      expect(toolNames).toContain('delete_line_range');
      expect(toolNames).toContain('insert_at_line');
      expect(toolNames).toContain('read_line_range');
    });
  });

  describe('convertToKebabCase', () => {
    it('should convert snake_case tools to kebab-case', () => {
      const result = resolver.convertToKebabCase('delete_line_range');
      expect(result).toBe('delete-line-range');
    });

    it('should convert camelCase tools to kebab-case', () => {
      const result = resolver.convertToKebabCase('insertAtLine');
      expect(result).toBe('insert-at-line');
    });

    it('should handle already kebab-case tools', () => {
      const result = resolver.convertToKebabCase('read-line-range');
      expect(result).toBe('read-line-range');
    });

    it('should handle mixed case tools like read_line_range', () => {
      const result = resolver.convertToKebabCase('read_line_range');
      expect(result).toBe('read-line-range');
    });

    it('should handle PascalCase tools correctly', () => {
      const result = resolver.convertToKebabCase('DeleteLineRange');
      expect(result).toBe('delete-line-range');
    });

    it('should handle other PascalCase tools correctly', () => {
      const result = resolver.convertToKebabCase('InsertAtLine');
      expect(result).toBe('insert-at-line');
    });

    it('should handle ReadLineRange PascalCase correctly', () => {
      const result = resolver.convertToKebabCase('ReadLineRange');
      expect(result).toBe('read-line-range');
    });
  });

  describe('resolveAllFiles with MCP tools', () => {
    it('should skip MCP tools when resolving tool prompts and not log warnings for them', () => {
      // Spy on the logger to verify no warnings are logged for MCP tools
      const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');

      // Create a context with both regular tools and MCP tools
      const contextWithMcpTools: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          sandboxType: undefined,
          hasIdeCompanion: false,
        },
        enabledTools: [
          'read_line_range', // regular tool
          'mcp__test-cmd__edit_file', // MCP tool
          'mcp__memory-server__add_observations', // MCP tool
          'insert_at_line', // regular tool
          'mcp__test-cmd__read_file', // MCP tool
        ],
        enableToolPrompts: true,
      };

      // Create prompt files ONLY for regular tools
      fs.writeFileSync(
        path.join(tempDir, 'tools/read-line-range.md'),
        '- Read range tool prompt',
      );
      fs.writeFileSync(
        path.join(tempDir, 'tools/insert-at-line.md'),
        '- Insert tool prompt',
      );

      // Note: We intentionally do NOT create prompt files for MCP tools

      const resolvedFiles = resolver.resolveAllFiles(
        tempDir,
        contextWithMcpTools,
      );

      // Should only resolve the regular tools, not MCP tools
      const toolFiles = resolvedFiles.filter((f) => f.type === 'tool');
      expect(toolFiles).toHaveLength(2);

      const toolNames = toolFiles.map((f) => f.toolName);
      expect(toolNames).toContain('read_line_range');
      expect(toolNames).toContain('insert_at_line');

      // MCP tools should NOT be in the resolved files
      expect(toolNames).not.toContain('mcp__test-cmd__edit_file');
      expect(toolNames).not.toContain('mcp__memory-server__add_observations');
      expect(toolNames).not.toContain('mcp__test-cmd__read_file');

      // Verify no warnings were logged for MCP tools
      // The warn spy should not have been called with any MCP tool names
      const warnCalls = warnSpy.mock.calls;
      for (const call of warnCalls) {
        const warnFn = call[0] as () => string;
        const message = warnFn();
        // Ensure no warnings mention MCP tools
        expect(message).not.toContain('mcp__test-cmd__edit_file');
        expect(message).not.toContain('mcp__memory-server__add_observations');
        expect(message).not.toContain('mcp__test-cmd__read_file');
      }

      warnSpy.mockRestore();
    });

    it('should not attempt to resolve prompt files for MCP tools even when enableToolPrompts is false', () => {
      const contextWithMcpTools: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          sandboxType: undefined,
          hasIdeCompanion: false,
        },
        enabledTools: [
          'mcp__test-cmd__edit_file',
          'mcp__memory-server__add_observations',
        ],
        enableToolPrompts: false, // disabled
      };

      const resolvedFiles = resolver.resolveAllFiles(
        tempDir,
        contextWithMcpTools,
      );

      // When enableToolPrompts is false, no tool prompts should be resolved
      const toolFiles = resolvedFiles.filter((f) => f.type === 'tool');
      expect(toolFiles).toHaveLength(0);
    });
  });
});
