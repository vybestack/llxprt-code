/**
 * Behavioral tests for PromptLoader
 * These tests verify actual file I/O, compression, and environment detection behavior
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PromptLoader } from './prompt-loader.js';

// Helper to check if we're on Windows
const isWindows = (): boolean => os.platform() === 'win32';

describe('PromptLoader', () => {
  let tempDir: string;
  let loader: PromptLoader;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-loader-test-'));
    loader = new PromptLoader(tempDir);
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('loadFile', () => {
    it('should successfully load a UTF-8 text file', async () => {
      const filePath = path.join(tempDir, 'test.md');
      const content = '# Test File\n\nThis is a test file.';
      await fs.writeFile(filePath, content, 'utf8');

      const result = await loader.loadFile(filePath, false);

      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
      expect(result.error).toBeNull();
    });

    it('should return error for non-existent file', async () => {
      const filePath = path.join(tempDir, 'non-existent.md');

      const result = await loader.loadFile(filePath, false);

      expect(result.success).toBe(false);
      expect(result.content).toBe('');
      expect(result.error).toBe('File not found');
    });

    it('should reject files with path traversal attempts', async () => {
      const maliciousPath = path.join(tempDir, '../../../etc/passwd');

      const result = await loader.loadFile(maliciousPath, false);

      expect(result.success).toBe(false);
      expect(result.content).toBe('');
      expect(result.error).toBe('Path traversal detected');
    });

    it('should reject files larger than 10MB', async () => {
      const filePath = path.join(tempDir, 'large.md');
      // Create a file larger than 10MB
      const largeContent = 'x'.repeat(10 * 1024 * 1024 + 1);
      await fs.writeFile(filePath, largeContent, 'utf8');

      const result = await loader.loadFile(filePath, false);

      expect(result.success).toBe(false);
      expect(result.content).toBe('');
      expect(result.error).toBe('File too large');
    });

    it('should handle empty files', async () => {
      const filePath = path.join(tempDir, 'empty.md');
      await fs.writeFile(filePath, '', 'utf8');

      const result = await loader.loadFile(filePath, false);

      expect(result.success).toBe(true);
      expect(result.content).toBe('');
      expect(result.error).toBeNull();
    });

    it('should reject directories', async () => {
      const dirPath = path.join(tempDir, 'subdir');
      await fs.mkdir(dirPath);

      const result = await loader.loadFile(dirPath, false);

      expect(result.success).toBe(false);
      expect(result.content).toBe('');
      expect(result.error).toBe('Not a regular file');
    });

    it('should reject symbolic links', async () => {
      const targetPath = path.join(tempDir, 'target.md');
      const linkPath = path.join(tempDir, 'link.md');
      await fs.writeFile(targetPath, 'content', 'utf8');
      await fs.symlink(targetPath, linkPath);

      const result = await loader.loadFile(linkPath, false);

      expect(result.success).toBe(false);
      expect(result.content).toBe('');
      expect(result.error).toBe('Not a regular file');
    });

    it('should handle files with invalid UTF-8', async () => {
      const filePath = path.join(tempDir, 'invalid.md');
      // Write invalid UTF-8 sequence
      await fs.writeFile(filePath, Buffer.from([0xff, 0xfe, 0xfd]));

      const result = await loader.loadFile(filePath, false);

      expect(result.success).toBe(false);
      expect(result.content).toBe('');
      expect(result.error).toBe('Invalid UTF-8 encoding');
    });

    it.skipIf(isWindows())(
      'should handle permission errors gracefully on Unix',
      async () => {
        const filePath = path.join(tempDir, 'no-read.md');
        await fs.writeFile(filePath, 'content', 'utf8');
        await fs.chmod(filePath, 0o000); // Remove all permissions

        const result = await loader.loadFile(filePath, false);

        expect(result.success).toBe(false);
        expect(result.content).toBe('');
        expect(result.error).toContain('Failed to read file');

        // Restore permissions for cleanup
        await fs.chmod(filePath, 0o644);
      },
    );

    it.skipIf(!isWindows())('should handle files on Windows', async () => {
      const filePath = path.join(tempDir, 'no-read.md');
      await fs.writeFile(filePath, 'content', 'utf8');

      // On Windows, test with a file that's locked by another process
      // Since we can't easily simulate this, just test the file exists and can be read
      const result = await loader.loadFile(filePath, false);
      expect(result.success).toBe(true);
      expect(result.content).toBe('content');
    });

    it('should return error for null or undefined file path', async () => {
      const resultNull = await loader.loadFile(
        null as unknown as string,
        false,
      );
      expect(resultNull.success).toBe(false);
      expect(resultNull.error).toBe('Invalid file path');

      const resultUndefined = await loader.loadFile(
        undefined as unknown as string,
        false,
      );
      expect(resultUndefined.success).toBe(false);
      expect(resultUndefined.error).toBe('Invalid file path');
    });

    it('should apply compression when requested', async () => {
      const filePath = path.join(tempDir, 'compress.md');
      const content = '## Header\n\n\n\nMultiple blank lines';
      await fs.writeFile(filePath, content, 'utf8');

      const result = await loader.loadFile(filePath, true);

      expect(result.success).toBe(true);
      expect(result.content).not.toBe(content); // Content should be different after compression
      expect(result.error).toBeNull();
    });
  });

  describe('compressContent', () => {
    it('should preserve code blocks unchanged', () => {
      const content =
        '# Title\n\n```typescript\nconst x = 1;\n  const y = 2;\n```\n\nText after';

      const compressed = loader.compressContent(content);

      expect(compressed).toContain(
        '```typescript\nconst x = 1;\n  const y = 2;\n```',
      );
    });

    it('should handle nested code block markers', () => {
      const content = '```markdown\nExample:\n```\ncode here\n```\n```';

      const compressed = loader.compressContent(content);

      expect(compressed).toBe(content); // Should remain unchanged
    });

    it('should handle unclosed code blocks', () => {
      const content =
        'Text before\n```python\ndef func():\n    pass\n# No closing backticks';

      const compressed = loader.compressContent(content);

      expect(compressed).toContain(
        '```python\ndef func():\n    pass\n# No closing backticks',
      );
    });

    it('should compress multiple blank lines to single blank line', () => {
      const content = 'Line 1\n\n\n\nLine 2\n\n\nLine 3';

      const compressed = loader.compressContent(content);

      expect(compressed).toBe('Line 1\n\nLine 2\n\nLine 3');
    });

    it('should simplify headers beyond level 1', () => {
      const content = '## Level 2\n### Level 3\n#### Level 4';

      const compressed = loader.compressContent(content);

      expect(compressed).toBe('# Level 2\n# Level 3\n# Level 4');
    });

    it('should simplify bold list items', () => {
      const content = '- **Item 1**: Description\n  - **Nested**: Value';

      const compressed = loader.compressContent(content);

      expect(compressed).toBe('- Item 1: Description\n  - Nested: Value');
    });

    it('should handle empty content', () => {
      expect(loader.compressContent('')).toBe('');
      expect(loader.compressContent(null as unknown as string)).toBe('');
    });

    it('should remove excessive whitespace', () => {
      const content = '  Text with    multiple   spaces  ';

      const compressed = loader.compressContent(content);

      expect(compressed).toBe('Text with multiple spaces');
    });

    it('should handle mixed line endings', () => {
      const content = 'Line 1\r\nLine 2\nLine 3\r\n';

      const compressed = loader.compressContent(content);

      expect(compressed).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should preserve code blocks with language identifiers', () => {
      const content =
        '```javascript\nfunction test() {}\n```\n\n```python\ndef test():\n    pass\n```';

      const compressed = loader.compressContent(content);

      expect(compressed).toContain('```javascript\nfunction test() {}\n```');
      expect(compressed).toContain('```python\ndef test():\n    pass\n```');
    });
  });

  describe('loadAllFiles', () => {
    it('should load multiple files and return a map', async () => {
      const file1 = 'dir1/file1.md';
      const file2 = 'dir2/file2.md';
      const content1 = 'Content 1';
      const content2 = 'Content 2';

      await fs.mkdir(path.join(tempDir, 'dir1'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'dir2'), { recursive: true });
      await fs.writeFile(path.join(tempDir, file1), content1, 'utf8');
      await fs.writeFile(path.join(tempDir, file2), content2, 'utf8');

      const result = await loader.loadAllFiles(tempDir, [file1, file2], false);

      expect(result.size).toBe(2);
      expect(result.get(file1)).toBe(content1);
      expect(result.get(file2)).toBe(content2);
    });

    it('should continue loading even if some files fail', async () => {
      const file1 = 'exists.md';
      const file2 = 'missing.md';
      const content1 = 'Content exists';

      await fs.writeFile(path.join(tempDir, file1), content1, 'utf8');

      const result = await loader.loadAllFiles(tempDir, [file1, file2], false);

      expect(result.size).toBe(1);
      expect(result.get(file1)).toBe(content1);
      expect(result.has(file2)).toBe(false);
    });

    it('should return empty map for null or empty inputs', async () => {
      const resultNull = await loader.loadAllFiles(
        null as unknown as string,
        ['file.md'],
        false,
      );
      expect(resultNull.size).toBe(0);

      const resultEmpty = await loader.loadAllFiles(tempDir, [], false);
      expect(resultEmpty.size).toBe(0);

      const resultNullFiles = await loader.loadAllFiles(
        tempDir,
        null as unknown as string[],
        false,
      );
      expect(resultNullFiles.size).toBe(0);
    });

    it('should apply compression when requested', async () => {
      const file = 'compress.md';
      const content = '## Header\n\n\n\nExtra spaces';
      await fs.writeFile(path.join(tempDir, file), content, 'utf8');

      const result = await loader.loadAllFiles(tempDir, [file], true);

      expect(result.size).toBe(1);
      const compressed = result.get(file);
      expect(compressed).not.toBe(content);
      expect(compressed).toBe('# Header\n\nExtra spaces');
    });
  });

  describe('detectEnvironment', () => {
    it('should detect git repository', async () => {
      // Create a mock .git directory
      const gitDir = path.join(tempDir, '.git');
      await fs.mkdir(gitDir);

      const env = loader.detectEnvironment(tempDir);

      expect(env.isGitRepository).toBe(true);
    });

    it('should detect when not in git repository', () => {
      const env = loader.detectEnvironment(tempDir);

      expect(env.isGitRepository).toBe(false);
    });

    it('should detect git repository in parent directory', async () => {
      const parentGit = path.join(tempDir, '.git');
      const subDir = path.join(tempDir, 'subdir', 'nested');

      await fs.mkdir(parentGit);
      await fs.mkdir(subDir, { recursive: true });

      const env = loader.detectEnvironment(subDir);

      expect(env.isGitRepository).toBe(true);
    });

    it('should detect sandbox environment from environment variables', () => {
      const originalSandbox = process.env.SANDBOX;
      process.env.SANDBOX = '1';

      const env = loader.detectEnvironment(tempDir);

      expect(env.isSandboxed).toBe(true);

      // Restore original value
      if (originalSandbox === undefined) {
        delete process.env.SANDBOX;
      } else {
        process.env.SANDBOX = originalSandbox;
      }
    });

    it('should detect container environment', () => {
      const originalContainer = process.env.CONTAINER;
      process.env.CONTAINER = 'true';

      const env = loader.detectEnvironment(tempDir);

      expect(env.isSandboxed).toBe(true);

      // Restore original value
      if (originalContainer === undefined) {
        delete process.env.CONTAINER;
      } else {
        process.env.CONTAINER = originalContainer;
      }
    });

    it('should detect IDE companion from environment', () => {
      const originalIDE = process.env.IDE_COMPANION;
      process.env.IDE_COMPANION = '1';

      const env = loader.detectEnvironment(tempDir);

      expect(env.hasIdeCompanion).toBe(true);

      // Restore original value
      if (originalIDE === undefined) {
        delete process.env.IDE_COMPANION;
      } else {
        process.env.IDE_COMPANION = originalIDE;
      }
    });

    it('should detect IDE companion from .vscode directory', async () => {
      const vscodeDir = path.join(tempDir, '.vscode');
      await fs.mkdir(vscodeDir);

      const env = loader.detectEnvironment(tempDir);

      expect(env.hasIdeCompanion).toBe(true);
    });

    it('should detect IDE companion from .idea directory', async () => {
      const ideaDir = path.join(tempDir, '.idea');
      await fs.mkdir(ideaDir);

      const env = loader.detectEnvironment(tempDir);

      expect(env.hasIdeCompanion).toBe(true);
    });

    it('should handle permission errors gracefully', () => {
      // Even with an invalid path, should not throw
      const invalidPath = isWindows()
        ? 'C:\\System Volume Information'
        : '/root/no-access';
      const env = loader.detectEnvironment(invalidPath);

      expect(env.isGitRepository).toBe(false);
      expect(env.isSandboxed).toBe(false);
      expect(env.hasIdeCompanion).toBe(false);
    });
  });

  describe('watchFiles', () => {
    it('should return null for non-existent directory', () => {
      const watcher = loader.watchFiles('/non/existent/path', () => {});

      expect(watcher).toBeNull();
    });

    it('should return null for invalid callback', () => {
      const watcher = loader.watchFiles(
        tempDir,
        null as unknown as (_eventType: string, _path: string) => void,
      );

      expect(watcher).toBeNull();
    });

    it('should create watcher for valid directory', () => {
      const callback = (_eventType: string, _path: string) => {};
      const watcher = loader.watchFiles(tempDir, callback);

      expect(watcher).not.toBeNull();
      expect(watcher).toHaveProperty('stop');
      expect(typeof watcher?.stop).toBe('function');

      // Clean up
      watcher?.stop();
    });

    it('should notify on file changes', async () => {
      const events: Array<{ type: string; path: string }> = [];
      const callback = (eventType: string, relativePath: string) => {
        events.push({ type: eventType, path: relativePath });
      };

      const watcher = loader.watchFiles(tempDir, callback);
      expect(watcher).not.toBeNull();

      // Create a markdown file
      const testFile = 'test.md';
      await fs.writeFile(
        path.join(tempDir, testFile),
        'initial content',
        'utf8',
      );

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Modify the file
      await fs.writeFile(
        path.join(tempDir, testFile),
        'modified content',
        'utf8',
      );

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should have received at least one event
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.path === testFile)).toBe(true);

      // Clean up
      watcher?.stop();
    });

    it('should filter non-markdown files', async () => {
      const events: Array<{ type: string; path: string }> = [];
      const callback = (eventType: string, relativePath: string) => {
        events.push({ type: eventType, path: relativePath });
      };

      const watcher = loader.watchFiles(tempDir, callback);
      expect(watcher).not.toBeNull();

      // Create a non-markdown file
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'content', 'utf8');

      // Wait for potential event
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should not receive events for non-markdown files
      expect(events.length).toBe(0);

      // Clean up
      watcher?.stop();
    });

    it('should stop watching when stop is called', async () => {
      const events: string[] = [];
      const callback = (_eventType: string, relativePath: string) => {
        events.push(relativePath);
      };

      const watcher = loader.watchFiles(tempDir, callback);
      expect(watcher).not.toBeNull();

      // Stop watching
      watcher?.stop();

      // Create a file after stopping
      await fs.writeFile(
        path.join(tempDir, 'after-stop.md'),
        'content',
        'utf8',
      );

      // Wait to ensure no events are received
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(events.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle file approaching 10MB limit with warning', async () => {
      const filePath = path.join(tempDir, 'large-but-ok.md');
      // Create a 9.9MB file
      const content = 'x'.repeat(9.9 * 1024 * 1024);
      await fs.writeFile(filePath, content, 'utf8');

      const result = await loader.loadFile(filePath, false);

      expect(result.success).toBe(true);
      expect(result.content.length).toBe(content.length);
      expect(result.error).toBeNull();
    });

    it('should handle file deleted between stat and read', async () => {
      // This is a race condition test - we'll simulate by testing with a non-existent file
      const filePath = path.join(tempDir, 'race-condition.md');

      const result = await loader.loadFile(filePath, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should normalize mixed line endings in compression', () => {
      const content = 'Line 1\r\n\r\n\r\nLine 2\n\n\nLine 3';

      const compressed = loader.compressContent(content);

      expect(compressed).toBe('Line 1\n\nLine 2\n\nLine 3');
    });

    it('should handle very long lines without truncation', () => {
      const longLine = 'x'.repeat(5000);
      const content = `Short line\n${longLine}\nAnother short line`;

      const compressed = loader.compressContent(content);

      expect(compressed).toContain(longLine);
    });
  });
});
