import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PromptResolver } from './prompt-resolver.js';
import { PromptContext } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
        sandboxType: null,
        hasIdeCompanion: false,
      },
      enabledTools: ['delete_line_range', 'insert_at_line', 'read_line_range'],
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

      // Mock console.warn to verify it's not called
      const consoleSpy = vi.spyOn(console, 'warn');

      const resolvedFiles = resolver.resolveAllFiles(tempDir, mockContext);

      // Should not have any warnings (console.warn should not be called)
      expect(consoleSpy).not.toHaveBeenCalled();

      const toolFiles = resolvedFiles.filter((f) => f.type === 'tool');
      expect(toolFiles).toHaveLength(3);

      const toolNames = toolFiles.map((f) => f.toolName);
      expect(toolNames).toContain('delete_line_range');
      expect(toolNames).toContain('insert_at_line');
      expect(toolNames).toContain('read_line_range');

      consoleSpy.mockRestore();
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
});
