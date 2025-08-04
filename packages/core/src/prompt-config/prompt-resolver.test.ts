import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PromptResolver } from './prompt-resolver.js';
import type { PromptContext } from './types.js';

describe('PromptResolver', () => {
  let tempDir: string;
  let resolver: PromptResolver;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-resolver-test-'));
    resolver = new PromptResolver();
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('resolveFile', () => {
    it('should return not found when file does not exist', () => {
      const context: Partial<PromptContext> = {
        provider: 'openai',
        model: 'gpt-4'
      };

      const result = resolver.resolveFile(tempDir, 'core.md', context);
      
      expect(result.found).toBe(false);
      expect(result.path).toBeNull();
      expect(result.source).toBeNull();
    });

    it('should find file at base level when no provider/model specified', async () => {
      // Create test file structure
      await fs.writeFile(path.join(tempDir, 'core.md'), 'base content');

      const context: Partial<PromptContext> = {};

      const result = resolver.resolveFile(tempDir, 'core.md', context);
      
      expect(result.found).toBe(true);
      expect(result.path).toBe(path.join(tempDir, 'core.md'));
      expect(result.source).toBe('base');
    });

    it('should find provider-specific file over base file', async () => {
      // Create test file structure
      await fs.writeFile(path.join(tempDir, 'core.md'), 'base content');
      await fs.mkdir(path.join(tempDir, 'providers'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'providers', 'openai'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'providers', 'openai', 'core.md'), 'provider content');

      const context: Partial<PromptContext> = {
        provider: 'openai'
      };

      const result = resolver.resolveFile(tempDir, 'core.md', context);
      
      expect(result.found).toBe(true);
      expect(result.path).toBe(path.join(tempDir, 'providers', 'openai', 'core.md'));
      expect(result.source).toBe('provider');
    });

    it('should find model-specific file over provider and base files', async () => {
      // Create test file structure
      await fs.writeFile(path.join(tempDir, 'core.md'), 'base content');
      await fs.mkdir(path.join(tempDir, 'providers', 'openai', 'models', 'gpt-4'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'providers', 'openai', 'core.md'), 'provider content');
      await fs.writeFile(path.join(tempDir, 'providers', 'openai', 'models', 'gpt-4', 'core.md'), 'model content');

      const context: Partial<PromptContext> = {
        provider: 'openai',
        model: 'gpt-4'
      };

      const result = resolver.resolveFile(tempDir, 'core.md', context);
      
      expect(result.found).toBe(true);
      expect(result.path).toBe(path.join(tempDir, 'providers', 'openai', 'models', 'gpt-4', 'core.md'));
      expect(result.source).toBe('model');
    });

    it('should handle nested relative paths correctly', async () => {
      // Create test file structure
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'tools', 'read-file.md'), 'base tool content');

      const context: Partial<PromptContext> = {};

      const result = resolver.resolveFile(tempDir, 'tools/read-file.md', context);
      
      expect(result.found).toBe(true);
      expect(result.path).toBe(path.join(tempDir, 'tools', 'read-file.md'));
      expect(result.source).toBe('base');
    });

    it('should reject paths with directory traversal attempts', () => {
      const context: Partial<PromptContext> = {};

      const result = resolver.resolveFile(tempDir, '../../../etc/passwd', context);
      
      expect(result.found).toBe(false);
      expect(result.path).toBeNull();
      expect(result.source).toBeNull();
    });

    it('should handle provider names with special characters', async () => {
      // Create test file structure with sanitized provider name
      await fs.mkdir(path.join(tempDir, 'providers', 'anthropic-claude'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'providers', 'anthropic-claude', 'core.md'), 'provider content');

      const context: Partial<PromptContext> = {
        provider: 'anthropic/claude'
      };

      const result = resolver.resolveFile(tempDir, 'core.md', context);
      
      expect(result.found).toBe(true);
      expect(result.path).toBe(path.join(tempDir, 'providers', 'anthropic-claude', 'core.md'));
      expect(result.source).toBe('provider');
    });

    it('should handle very long model names by truncating', async () => {
      const longModelName = 'a'.repeat(300);
      const truncatedModelName = 'a'.repeat(255);

      // Create test file structure with truncated model name
      await fs.mkdir(path.join(tempDir, 'providers', 'openai', 'models', truncatedModelName), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'providers', 'openai', 'models', truncatedModelName, 'core.md'), 'model content');

      const context: Partial<PromptContext> = {
        provider: 'openai',
        model: longModelName
      };

      const result = resolver.resolveFile(tempDir, 'core.md', context);
      
      expect(result.found).toBe(true);
      expect(result.path).toBe(path.join(tempDir, 'providers', 'openai', 'models', truncatedModelName, 'core.md'));
      expect(result.source).toBe('model');
    });

    it('should handle case insensitive provider names', async () => {
      // Create test file structure with lowercase provider name
      await fs.mkdir(path.join(tempDir, 'providers', 'openai'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'providers', 'openai', 'core.md'), 'provider content');

      const context: Partial<PromptContext> = {
        provider: 'OpenAI'
      };

      const result = resolver.resolveFile(tempDir, 'core.md', context);
      
      expect(result.found).toBe(true);
      expect(result.path).toBe(path.join(tempDir, 'providers', 'openai', 'core.md'));
      expect(result.source).toBe('provider');
    });

    it('should return not found for non-existent base directory', () => {
      const context: Partial<PromptContext> = {};

      const result = resolver.resolveFile('/non/existent/path', 'core.md', context);
      
      expect(result.found).toBe(false);
      expect(result.path).toBeNull();
      expect(result.source).toBeNull();
    });

    it('should return not found for empty relative path', () => {
      const context: Partial<PromptContext> = {};

      const result = resolver.resolveFile(tempDir, '', context);
      
      expect(result.found).toBe(false);
      expect(result.path).toBeNull();
      expect(result.source).toBeNull();
    });

    it('should handle null context gracefully', async () => {
      await fs.writeFile(path.join(tempDir, 'core.md'), 'base content');

      const result = resolver.resolveFile(tempDir, 'core.md', null as unknown as Partial<PromptContext>);
      
      expect(result.found).toBe(true);
      expect(result.path).toBe(path.join(tempDir, 'core.md'));
      expect(result.source).toBe('base');
    });
  });

  describe('resolveAllFiles', () => {
    it('should return empty array when no files exist', () => {
      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['ReadFile', 'WriteFile'],
        environment: {
          isGitRepository: true,
          isSandboxed: false,
          hasIdeCompanion: false
        }
      };

      const result = resolver.resolveAllFiles(tempDir, context);
      
      expect(result).toEqual([]);
    });

    it('should resolve core.md file', async () => {
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');

      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: [],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false
        }
      };

      const result = resolver.resolveAllFiles(tempDir, context);
      
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('core');
      expect(result[0].path).toBe(path.join(tempDir, 'core.md'));
      expect(result[0].source).toBe('base');
    });

    it('should resolve environment prompts based on context', async () => {
      // Create environment prompt files
      await fs.mkdir(path.join(tempDir, 'env'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'env', 'git-repository.md'), 'git content');
      await fs.writeFile(path.join(tempDir, 'env', 'sandbox.md'), 'sandbox content');
      await fs.writeFile(path.join(tempDir, 'env', 'ide-mode.md'), 'ide content');

      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: [],
        environment: {
          isGitRepository: true,
          isSandboxed: true,
          hasIdeCompanion: true
        }
      };

      const result = resolver.resolveAllFiles(tempDir, context);
      
      expect(result).toHaveLength(3);
      expect(result.map(f => f.path)).toContain(path.join(tempDir, 'env', 'git-repository.md'));
      expect(result.map(f => f.path)).toContain(path.join(tempDir, 'env', 'sandbox.md'));
      expect(result.map(f => f.path)).toContain(path.join(tempDir, 'env', 'ide-mode.md'));
    });

    it('should resolve tool prompts with kebab-case conversion', async () => {
      // Create tool prompt files
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'tools', 'read-file.md'), 'read file content');
      await fs.writeFile(path.join(tempDir, 'tools', 'write-file.md'), 'write file content');

      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['ReadFile', 'WriteFile'],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false
        }
      };

      const result = resolver.resolveAllFiles(tempDir, context);
      
      expect(result).toHaveLength(2);
      const toolPaths = result.filter(f => f.type === 'tool').map(f => f.path);
      expect(toolPaths).toContain(path.join(tempDir, 'tools', 'read-file.md'));
      expect(toolPaths).toContain(path.join(tempDir, 'tools', 'write-file.md'));
    });

    it('should use hierarchical resolution for all file types', async () => {
      // Create base and provider-specific files
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'providers', 'openai', 'tools'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'core.md'), 'base core');
      await fs.writeFile(path.join(tempDir, 'providers', 'openai', 'core.md'), 'provider core');
      await fs.writeFile(path.join(tempDir, 'tools', 'read-file.md'), 'base tool');
      await fs.writeFile(path.join(tempDir, 'providers', 'openai', 'tools', 'read-file.md'), 'provider tool');

      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['ReadFile'],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false
        }
      };

      const result = resolver.resolveAllFiles(tempDir, context);
      
      expect(result).toHaveLength(2); // core.md and read-file.md
      expect(result[0].type).toBe('core');
      expect(result[0].path).toBe(path.join(tempDir, 'providers', 'openai', 'core.md'));
      expect(result[0].source).toBe('provider');
      expect(result[1].type).toBe('tool');
      expect(result[1].path).toBe(path.join(tempDir, 'providers', 'openai', 'tools', 'read-file.md'));
      expect(result[1].source).toBe('provider');
    });

    it('should handle missing tool prompts gracefully', async () => {
      // Only create core.md, no tool files
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');

      const context: PromptContext = {
        provider: 'openai',
        model: 'gpt-4',
        enabledTools: ['NonExistentTool'],
        environment: {
          isGitRepository: false,
          isSandboxed: false,
          hasIdeCompanion: false
        }
      };

      const result = resolver.resolveAllFiles(tempDir, context);
      
      expect(result).toHaveLength(1); // Only core.md
      expect(result[0].type).toBe('core');
      expect(result[0].path).toBe(path.join(tempDir, 'core.md'));
    });

    it('should handle null inputs gracefully', () => {
      const result = resolver.resolveAllFiles(null as unknown as string, null as unknown as PromptContext);
      
      expect(result).toEqual([]);
    });
  });

  describe('sanitizePathComponent', () => {
    it('should return component unchanged if already valid', () => {
      expect(resolver.sanitizePathComponent('openai')).toBe('openai');
    });

    it('should convert to lowercase', () => {
      expect(resolver.sanitizePathComponent('OpenAI')).toBe('openai');
    });

    it('should replace special characters with hyphens', () => {
      expect(resolver.sanitizePathComponent('anthropic/claude')).toBe('anthropic-claude');
    });

    it('should collapse multiple special characters to single hyphen', () => {
      expect(resolver.sanitizePathComponent('model@#$%name')).toBe('model-name');
    });

    it('should remove leading and trailing hyphens', () => {
      expect(resolver.sanitizePathComponent('-leading-trailing-')).toBe('leading-trailing');
    });

    it('should truncate to 255 characters', () => {
      const longName = 'a'.repeat(300);
      expect(resolver.sanitizePathComponent(longName)).toBe('a'.repeat(255));
    });

    it('should handle reserved names', () => {
      expect(resolver.sanitizePathComponent('con')).toBe('reserved-con');
      expect(resolver.sanitizePathComponent('prn')).toBe('reserved-prn');
      expect(resolver.sanitizePathComponent('aux')).toBe('reserved-aux');
      expect(resolver.sanitizePathComponent('nul')).toBe('reserved-nul');
      expect(resolver.sanitizePathComponent('.')).toBe('reserved-.');
      expect(resolver.sanitizePathComponent('..')).toBe('reserved-..');
    });

    it('should return "unknown" for empty result after sanitization', () => {
      expect(resolver.sanitizePathComponent('!!!')).toBe('unknown');
    });

    it('should handle null and empty inputs', () => {
      expect(resolver.sanitizePathComponent(null as unknown as string)).toBe('');
      expect(resolver.sanitizePathComponent('')).toBe('');
    });
  });

  describe('convertToKebabCase', () => {
    it('should convert PascalCase to kebab-case', () => {
      expect(resolver.convertToKebabCase('ReadFile')).toBe('read-file');
    });

    it('should convert PascalCase variants to kebab-case', () => {
      expect(resolver.convertToKebabCase('ReadFile')).toBe('read-file');
      expect(resolver.convertToKebabCase('WriteFile')).toBe('write-file');
      expect(resolver.convertToKebabCase('TodoWrite')).toBe('todo-write');
    });

    it('should convert camelCase to kebab-case', () => {
      expect(resolver.convertToKebabCase('readFile')).toBe('read-file');
      expect(resolver.convertToKebabCase('parseJSON')).toBe('parse-json');
    });

    it('should handle all uppercase specially', () => {
      expect(resolver.convertToKebabCase('HTTP')).toBe('http');
      expect(resolver.convertToKebabCase('API')).toBe('api');
    });

    it('should handle mixed case with acronyms', () => {
      expect(resolver.convertToKebabCase('HTTPRequest')).toBe('http-request');
      expect(resolver.convertToKebabCase('XMLParser')).toBe('xml-parser');
    });

    it('should handle single letter words', () => {
      expect(resolver.convertToKebabCase('S3')).toBe('s-3');
      expect(resolver.convertToKebabCase('io')).toBe('io');
    });

    it('should handle numbers in names', () => {
      expect(resolver.convertToKebabCase('Base64Encode')).toBe('base-64-encode');
      expect(resolver.convertToKebabCase('SHA256')).toBe('sha-256');
    });

    it('should skip non-alphanumeric characters', () => {
      expect(resolver.convertToKebabCase('Read_File')).toBe('read-file');
      expect(resolver.convertToKebabCase('Read.File')).toBe('read-file');
    });

    it('should clean up multiple consecutive hyphens', () => {
      expect(resolver.convertToKebabCase('Read__File')).toBe('read-file');
    });

    it('should handle null and empty inputs', () => {
      expect(resolver.convertToKebabCase(null as unknown as string)).toBe('');
      expect(resolver.convertToKebabCase('')).toBe('');
    });
  });

  describe('listAvailableFiles', () => {
    it('should return empty array for empty directory', () => {
      const result = resolver.listAvailableFiles(tempDir, 'all');
      expect(result).toEqual([]);
    });

    it('should list all files when type is "all"', async () => {
      // Create test file structure
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');
      await fs.mkdir(path.join(tempDir, 'env'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'env', 'git-repository.md'), 'git content');
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'tools', 'read-file.md'), 'tool content');

      const result = resolver.listAvailableFiles(tempDir, 'all');
      
      expect(result).toHaveLength(3);
      expect(result.map(f => f.path)).toContain('core.md');
      expect(result.map(f => f.path)).toContain('env/git-repository.md');
      expect(result.map(f => f.path)).toContain('tools/read-file.md');
    });

    it('should filter by file type', async () => {
      // Create test file structure
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');
      await fs.mkdir(path.join(tempDir, 'env'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'env', 'git-repository.md'), 'git content');
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'tools', 'read-file.md'), 'tool content');

      const coreResult = resolver.listAvailableFiles(tempDir, 'core');
      expect(coreResult).toHaveLength(1);
      expect(coreResult[0].path).toBe('core.md');
      
      const envResult = resolver.listAvailableFiles(tempDir, 'env');
      expect(envResult).toHaveLength(1);
      expect(envResult[0].path).toBe('env/git-repository.md');
      
      const toolResult = resolver.listAvailableFiles(tempDir, 'tool');
      expect(toolResult).toHaveLength(1);
      expect(toolResult[0].path).toBe('tools/read-file.md');
    });

    it('should include provider overrides', async () => {
      // Create test file structure with provider overrides
      await fs.writeFile(path.join(tempDir, 'core.md'), 'base core');
      await fs.mkdir(path.join(tempDir, 'providers', 'openai'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'providers', 'openai', 'core.md'), 'provider core');

      const result = resolver.listAvailableFiles(tempDir, 'all');
      
      expect(result).toHaveLength(2);
      expect(result.find(f => f.path === 'core.md' && f.source === 'base')).toBeTruthy();
      expect(result.find(f => f.path === 'providers/openai/core.md' && f.source === 'provider')).toBeTruthy();
    });

    it('should handle invalid file type by defaulting to "all"', async () => {
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');

      const result = resolver.listAvailableFiles(tempDir, 'invalid' as 'core' | 'env' | 'tool' | 'all');
      
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('core.md');
    });

    it('should skip non-markdown files', async () => {
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');
      await fs.writeFile(path.join(tempDir, 'readme.txt'), 'text content');
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'tools', 'config.json'), 'json content');

      const result = resolver.listAvailableFiles(tempDir, 'all');
      
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('core.md');
      expect(result.find(f => f.path.includes('readme.txt'))).toBeUndefined();
      expect(result.find(f => f.path.includes('config.json'))).toBeUndefined();
    });

    it('should handle non-existent base directory', () => {
      const result = resolver.listAvailableFiles('/non/existent/path', 'all');
      
      expect(result).toEqual([]);
    });

    it('should handle permission errors gracefully', async () => {
      // Create a directory with restricted permissions
      const restrictedDir = path.join(tempDir, 'restricted');
      await fs.mkdir(restrictedDir, { mode: 0o000 });

      const result = resolver.listAvailableFiles(tempDir, 'all');
      
      // Should still return results from accessible directories
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      // Cleanup
      await fs.chmod(restrictedDir, 0o755);
    });
  });

  describe('validateFileStructure', () => {
    it('should report missing core.md as error', () => {
      const result = resolver.validateFileStructure(tempDir);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required core.md file');
    });

    it('should validate a correct file structure', async () => {
      // Create valid file structure
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');
      await fs.mkdir(path.join(tempDir, 'env'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });

      const result = resolver.validateFileStructure(tempDir);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should report error for missing base directory', () => {
      const result = resolver.validateFileStructure('/non/existent/path');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Base directory does not exist');
    });

    it('should report error when base path is not a directory', async () => {
      const filePath = path.join(tempDir, 'not-a-directory');
      await fs.writeFile(filePath, 'file content');

      const result = resolver.validateFileStructure(filePath);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Base path is not a directory');
    });

    it('should report error for missing core.md', async () => {
      await fs.mkdir(path.join(tempDir, 'env'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });

      const result = resolver.validateFileStructure(tempDir);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required core.md file');
    });

    it('should report warnings for missing directories', async () => {
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');
      // Don't create env or tools directories

      const result = resolver.validateFileStructure(tempDir);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toContain('Missing directory: env');
      expect(result.warnings).toContain('Missing directory: tools');
    });

    it('should report warnings for non-markdown files', async () => {
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');
      await fs.writeFile(path.join(tempDir, 'readme.txt'), 'text content');
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'tools', 'config.json'), 'json content');

      const result = resolver.validateFileStructure(tempDir);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('Non-markdown file found'))).toBe(true);
      expect(result.warnings.some(w => w.includes('readme.txt'))).toBe(true);
      expect(result.warnings.some(w => w.includes('config.json'))).toBe(true);
    });

    it('should report warnings for large files', async () => {
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');
      
      // Create a large file (>10MB)
      const largeContent = 'x'.repeat(11 * 1024 * 1024);
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'tools', 'large.md'), largeContent);

      const result = resolver.validateFileStructure(tempDir);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('Large file found') && w.includes('large.md'))).toBe(true);
    });

    it('should report warnings for invalid filenames', async () => {
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');
      await fs.mkdir(path.join(tempDir, 'tools'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'tools', 'file@#$.md'), 'content');

      const result = resolver.validateFileStructure(tempDir);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('Invalid filename') && w.includes('file@#$.md'))).toBe(true);
    });

    it('should check read permissions on core.md', async () => {
      await fs.writeFile(path.join(tempDir, 'core.md'), 'core content');
      await fs.chmod(path.join(tempDir, 'core.md'), 0o000);

      const result = resolver.validateFileStructure(tempDir);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Cannot read core.md - check permissions');

      // Cleanup
      await fs.chmod(path.join(tempDir, 'core.md'), 0o644);
    });
  });
});