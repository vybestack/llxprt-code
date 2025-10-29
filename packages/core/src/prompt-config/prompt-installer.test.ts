/**
 * Behavioral TDD tests for PromptInstaller
 *
 * These tests verify actual behavior, not mocks. They test real file operations
 * using temporary directories to ensure the installer works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PromptInstaller, REQUIRED_DIRECTORIES } from './prompt-installer.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';

// Helper to check if we're on Windows
const isWindows = (): boolean => os.platform() === 'win32';

describe('PromptInstaller', () => {
  let installer: PromptInstaller;
  let tempDir: string;
  let testBaseDir: string;

  beforeEach(async () => {
    installer = new PromptInstaller();
    // Create a unique temp directory for each test
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'prompt-installer-test-'),
    );
    testBaseDir = path.join(tempDir, 'prompts');
  });

  afterEach(async () => {
    // Clean up temp directory after each test
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('expandPath', () => {
    it('should expand home directory ~ to actual home path', () => {
      const homePath = os.homedir();
      const result = installer.expandPath('~/test/path');
      expect(result).toBe(path.join(homePath, 'test/path'));
    });

    it('should expand environment variables in path', () => {
      process.env.TEST_VAR = '/custom/path';
      const result = installer.expandPath('$TEST_VAR/subdir');
      const expectedPath = path.normalize('/custom/path/subdir');
      expect(result).toBe(expectedPath);
      delete process.env.TEST_VAR;
    });

    it('should expand environment variables with curly braces', () => {
      process.env.TEST_VAR = '/custom/path';
      const result = installer.expandPath('${TEST_VAR}/subdir');
      const expectedPath = path.normalize('/custom/path/subdir');
      expect(result).toBe(expectedPath);
      delete process.env.TEST_VAR;
    });

    it('should handle multiple environment variables', () => {
      process.env.VAR1 = '/part1';
      process.env.VAR2 = 'part2';
      const result = installer.expandPath('$VAR1/${VAR2}/file');
      const expectedPath = path.normalize('/part1/part2/file');
      expect(result).toBe(expectedPath);
      delete process.env.VAR1;
      delete process.env.VAR2;
    });

    it('should leave unexpanded variables as-is when not found', () => {
      const result = installer.expandPath('$NONEXISTENT_VAR/path');
      expect(result).toContain('$NONEXISTENT_VAR');
    });

    it('should return empty string for null or empty input', () => {
      expect(installer.expandPath('')).toBe('');
      expect(installer.expandPath(null as unknown as string)).toBe('');
    });

    it('should resolve relative paths to absolute', () => {
      const result = installer.expandPath('relative/path');
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should normalize paths with redundant separators', () => {
      const result = installer.expandPath('/path//to///file');
      expect(result).toBe(path.normalize('/path/to/file'));
    });

    it('should resolve . and .. components', () => {
      const result = installer.expandPath('/path/to/../file/./test');
      expect(result).toBe(path.normalize('/path/file/test'));
    });
  });

  describe('install', () => {
    const defaultFiles = {
      'core.md': '# Core Prompt\nDefault content',
      'env/development.md': '# Development Environment',
      'tools/git.md': '# Git Tool Prompt',
      'providers/openai.md': '# OpenAI Provider',
    };

    it('should create all required directories', async () => {
      const result = await installer.install(testBaseDir, defaultFiles);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      // Verify all directories exist
      for (const dir of REQUIRED_DIRECTORIES) {
        const fullPath = path.join(testBaseDir, dir);
        expect(existsSync(fullPath)).toBe(true);
      }
    });

    it('should install all default files', async () => {
      const result = await installer.install(testBaseDir, defaultFiles);

      expect(result.success).toBe(true);
      expect(result.installed).toContain('core.md');
      expect(result.installed).toContain('env/development.md');
      expect(result.installed).toContain('tools/git.md');
      expect(result.installed).toContain('providers/openai.md');

      // Verify file contents
      const coreContent = await fs.readFile(
        path.join(testBaseDir, 'core.md'),
        'utf-8',
      );
      expect(coreContent).toBe('# Core Prompt\nDefault content');
    });

    it('should preserve existing user files by default', async () => {
      // Create existing file with custom content
      await fs.mkdir(testBaseDir, { recursive: true });
      const existingFile = path.join(testBaseDir, 'core.md');
      await fs.writeFile(existingFile, 'User customized content');

      const result = await installer.install(testBaseDir, defaultFiles);

      expect(result.success).toBe(true);
      expect(result.skipped).toContain('core.md');
      expect(result.installed).not.toContain('core.md');

      // Verify content was preserved
      const content = await fs.readFile(existingFile, 'utf-8');
      expect(content).toBe('User customized content');
    });

    it('should overwrite existing files when force option is true', async () => {
      // Create existing file
      await fs.mkdir(testBaseDir, { recursive: true });
      const existingFile = path.join(testBaseDir, 'core.md');
      await fs.writeFile(existingFile, 'Old content');

      const result = await installer.install(testBaseDir, defaultFiles, {
        force: true,
      });

      expect(result.success).toBe(true);
      expect(result.installed).toContain('core.md');
      expect(result.skipped).not.toContain('core.md');

      // Verify content was overwritten
      const content = await fs.readFile(existingFile, 'utf-8');
      expect(content).toBe('# Core Prompt\nDefault content');
    });

    it('should perform dry run without writing files', async () => {
      const result = await installer.install(testBaseDir, defaultFiles, {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.installed).toHaveLength(4);
      expect(result.conflicts).toHaveLength(0);

      // Verify no files were actually written
      expect(existsSync(testBaseDir)).toBe(false);
    });

    it('should handle null baseDir by using default', async () => {
      const result = await installer.install(null, defaultFiles, {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.baseDir).toContain(path.join('.llxprt', 'prompts'));
    });

    it('should reject invalid base directory paths', async () => {
      const result = await installer.install(
        '../../../etc/passwd',
        defaultFiles,
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid base directory');
    });

    it('should create timestamped review file when defaults are newer than local prompt', async () => {
      await fs.mkdir(testBaseDir, { recursive: true });
      const existingPath = path.join(testBaseDir, 'core.md');
      await fs.writeFile(existingPath, 'User customized content');
      const pastDate = new Date('2023-01-01T00:00:00.000Z');
      await fs.utimes(existingPath, pastDate, pastDate);

      const defaultDir = path.join(testBaseDir, '__defaults__');
      await fs.mkdir(defaultDir, { recursive: true });
      const defaultPath = path.join(defaultDir, 'core.md');
      const defaultContent = '# Core Prompt\nNew default content';
      await fs.writeFile(defaultPath, defaultContent);
      const defaultDate = new Date('2025-10-29T01:22:33.000Z');
      await fs.utimes(defaultPath, defaultDate, defaultDate);

      (
        installer as unknown as { defaultSourceDirs: string[] }
      ).defaultSourceDirs = [defaultDir];

      const result = await installer.install(testBaseDir, {
        'core.md': defaultContent,
      });

      expect(result.success).toBe(true);
      expect(result.installed).not.toContain('core.md');
      expect(result.skipped).toContain('core.md');
      expect(result.conflicts).toHaveLength(1);
      expect(result.notices).toEqual([
        `Warning: this version includes a newer version of ${path.join(testBaseDir, 'core.md')} which you customized. We put ${path.join(testBaseDir, 'core.md.20251029T012233')} next to it for your review.`,
      ]);

      const conflict = result.conflicts[0];
      expect(conflict.path).toBe('core.md');
      expect(conflict.action).toBe('kept');
      expect(conflict.reviewFile).toBe('core.md.20251029T012233');

      const reviewPath = path.join(testBaseDir, conflict.reviewFile!);
      expect(existsSync(reviewPath)).toBe(true);

      const reviewContent = await fs.readFile(reviewPath, 'utf-8');
      expect(reviewContent).toBe(defaultContent);

      const originalContent = await fs.readFile(existingPath, 'utf-8');
      expect(originalContent).toBe('User customized content');
    });

    it('should not recreate review file or warning when timestamped companion already exists', async () => {
      await fs.mkdir(testBaseDir, { recursive: true });
      const existingPath = path.join(testBaseDir, 'core.md');
      await fs.writeFile(existingPath, 'User customized content');

      const defaultDir = path.join(testBaseDir, '__defaults__');
      await fs.mkdir(defaultDir, { recursive: true });
      const defaultPath = path.join(defaultDir, 'core.md');
      const defaultContent = '# Core Prompt\nNew default content';
      await fs.writeFile(defaultPath, defaultContent);
      const defaultDate = new Date('2025-10-29T01:22:33.000Z');
      await fs.utimes(defaultPath, defaultDate, defaultDate);

      (
        installer as unknown as { defaultSourceDirs: string[] }
      ).defaultSourceDirs = [defaultDir];

      const firstResult = await installer.install(testBaseDir, {
        'core.md': defaultContent,
      });
      expect(firstResult.success).toBe(true);
      expect(firstResult.notices).toHaveLength(1);

      const secondResult = await installer.install(testBaseDir, {
        'core.md': defaultContent,
      });

      expect(secondResult.success).toBe(true);
      expect(secondResult.notices).toHaveLength(0);
      expect(secondResult.conflicts).toHaveLength(0);

      const files = await fs.readdir(testBaseDir);
      const reviewFiles = files.filter((file) =>
        file.startsWith('core.md.20251029T012233'),
      );
      expect(reviewFiles).toHaveLength(1);
    });

    it('should set correct file permissions', async () => {
      // Skip this test entirely on Windows
      if (isWindows()) {
        expect(true).toBe(true); // Placeholder assertion
        return;
      }

      const result = await installer.install(testBaseDir, defaultFiles);
      expect(result.success).toBe(true);

      // Check directory permissions (755)
      const dirStats = await fs.stat(testBaseDir);
      const dirMode = dirStats.mode & parseInt('777', 8);
      expect(dirMode).toBe(parseInt('755', 8));

      // Check file permissions (644)
      const fileStats = await fs.stat(path.join(testBaseDir, 'core.md'));
      const fileMode = fileStats.mode & parseInt('777', 8);
      expect(fileMode).toBe(parseInt('644', 8));
    });

    it('should handle permission errors gracefully', async () => {
      // Skip permission tests on Windows as chmod has no effect
      if (isWindows()) {
        // On Windows, create a scenario that would fail (e.g., invalid path)
        const result = await installer.install('/invalid:path', defaultFiles);
        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      } else {
        // Create directory with no write permission
        await fs.mkdir(testBaseDir, { recursive: true, mode: 0o555 });

        const result = await installer.install(testBaseDir, defaultFiles);

        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('Permission denied');
      }
    });

    it('should create parent directories for nested files', async () => {
      const nestedFiles = {
        'deeply/nested/path/file.md': 'Content',
      };

      const result = await installer.install(testBaseDir, nestedFiles);

      expect(result.success).toBe(true);
      expect(existsSync(path.join(testBaseDir, 'deeply/nested/path'))).toBe(
        true,
      );
      expect(result.installed).toContain('deeply/nested/path/file.md');
    });
  });

  describe('uninstall', () => {
    beforeEach(async () => {
      // Set up test directory with some files
      await fs.mkdir(path.join(testBaseDir, 'env'), { recursive: true });
      await fs.mkdir(path.join(testBaseDir, 'tools'), { recursive: true });
      await fs.writeFile(path.join(testBaseDir, 'core.md'), 'Core content');
      await fs.writeFile(path.join(testBaseDir, 'user-custom.md'), 'User file');
      await fs.writeFile(path.join(testBaseDir, 'env/dev.md'), 'Dev content');
    });

    it('should remove only default files by default', async () => {
      const result = await installer.uninstall(testBaseDir);

      expect(result.success).toBe(true);
      expect(result.removed).toContain('core.md');
      expect(result.removed).not.toContain('user-custom.md');

      // Verify user file still exists
      expect(existsSync(path.join(testBaseDir, 'user-custom.md'))).toBe(true);
    });

    it('should remove all files when removeUserFiles is true', async () => {
      const result = await installer.uninstall(testBaseDir, {
        removeUserFiles: true,
      });

      expect(result.success).toBe(true);
      expect(result.removed).toContain('core.md');
      expect(result.removed).toContain('user-custom.md');

      // Verify all files are gone
      expect(existsSync(path.join(testBaseDir, 'user-custom.md'))).toBe(false);
    });

    it('should remove empty directories after file removal', async () => {
      const result = await installer.uninstall(testBaseDir, {
        removeUserFiles: true,
      });

      expect(result.success).toBe(true);
      expect(existsSync(testBaseDir)).toBe(false);
    });

    it('should handle dry run without removing files', async () => {
      const result = await installer.uninstall(testBaseDir, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.removed.length).toBeGreaterThan(0);

      // Verify files still exist
      expect(existsSync(path.join(testBaseDir, 'core.md'))).toBe(true);
    });

    it('should return success when base directory does not exist', async () => {
      const result = await installer.uninstall('/nonexistent/path');

      expect(result.success).toBe(true);
      expect(result.removed).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle null baseDir by using default', async () => {
      const result = await installer.uninstall(null, { dryRun: true });

      expect(result.success).toBe(true);
    });
  });

  describe('validate', () => {
    it('should detect missing base directory', async () => {
      const result = await installer.validate(testBaseDir);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Base directory does not exist');
    });

    it('should detect missing required directories', async () => {
      await fs.mkdir(testBaseDir, { recursive: true });

      const result = await installer.validate(testBaseDir);

      expect(result.isValid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.missing).toContain('env');
      expect(result.missing).toContain('tools');
      expect(result.missing).toContain('providers');
    });

    it('should detect missing required core.md file', async () => {
      await fs.mkdir(path.join(testBaseDir, 'env'), { recursive: true });
      await fs.mkdir(path.join(testBaseDir, 'tools'), { recursive: true });
      await fs.mkdir(path.join(testBaseDir, 'providers'), { recursive: true });

      const result = await installer.validate(testBaseDir);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required core.md');
      expect(result.missing).toContain('core.md');
    });

    it('should validate successful installation', async () => {
      // Create valid structure
      await fs.mkdir(path.join(testBaseDir, 'env'), { recursive: true });
      await fs.mkdir(path.join(testBaseDir, 'tools'), { recursive: true });
      await fs.mkdir(path.join(testBaseDir, 'providers'), { recursive: true });
      await fs.writeFile(path.join(testBaseDir, 'core.md'), 'Content');

      const result = await installer.validate(testBaseDir);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.missing).toHaveLength(0);
    });

    it('should check directory permissions', async () => {
      // Skip permission tests on Windows as chmod has no effect
      if (isWindows()) {
        // On Windows, just create a directory and verify it exists
        await fs.mkdir(testBaseDir, { recursive: true });
        const result = await installer.validate(testBaseDir);
        // Windows directories are generally writable if they exist
        expect(result.warnings.length).toBeGreaterThanOrEqual(0);
      } else {
        await fs.mkdir(testBaseDir, { mode: 0o444, recursive: true });

        const result = await installer.validate(testBaseDir);

        expect(result.warnings).toContain('Cannot write to directory');
      }
    });

    it('should detect empty files that should have content', async () => {
      await fs.mkdir(testBaseDir, { recursive: true });
      await fs.writeFile(path.join(testBaseDir, 'core.md'), '');

      const result = await installer.validate(testBaseDir);

      expect(result.warnings).toContain('Empty file: core.md');
    });

    it('should handle null baseDir by using default', async () => {
      const result = await installer.validate(null);

      expect(result.baseDir).toContain(path.join('.llxprt', 'prompts'));
    });
  });

  describe('repair', () => {
    const defaultFiles = {
      'core.md': '# Core Prompt\nDefault content',
      'env/development.md': '# Development Environment',
    };

    it('should fix missing directories', async () => {
      await fs.mkdir(testBaseDir, { recursive: true });

      const result = await installer.repair(testBaseDir, defaultFiles);

      expect(result.success).toBe(true);
      expect(result.repaired).toContain('env');
      expect(result.repaired).toContain('tools');
      expect(result.repaired).toContain('providers');

      // Verify directories were created
      expect(existsSync(path.join(testBaseDir, 'env'))).toBe(true);
      expect(existsSync(path.join(testBaseDir, 'tools'))).toBe(true);
    });

    it('should restore missing default files', async () => {
      await fs.mkdir(path.join(testBaseDir, 'env'), { recursive: true });

      const result = await installer.repair(testBaseDir, defaultFiles);

      expect(result.repaired).toContain('core.md');

      // Verify file was restored
      const content = await fs.readFile(
        path.join(testBaseDir, 'core.md'),
        'utf-8',
      );
      expect(content).toBe('# Core Prompt\nDefault content');
    });

    it('should fix file permissions', async () => {
      await fs.mkdir(testBaseDir, { recursive: true });
      await fs.writeFile(path.join(testBaseDir, 'core.md'), 'Content', {
        mode: 0o600,
      });

      const result = await installer.repair(testBaseDir, defaultFiles);

      expect(result.success).toBe(true);

      // Skip permission checks on Windows as chmod has no effect
      if (!isWindows()) {
        // Verify permissions were fixed
        const stats = await fs.stat(path.join(testBaseDir, 'core.md'));
        const mode = stats.mode & parseInt('777', 8);
        expect(mode).toBe(parseInt('644', 8));
      } else {
        // On Windows, just verify the file exists
        expect(existsSync(path.join(testBaseDir, 'core.md'))).toBe(true);
      }
    });

    it('should return success immediately if already valid', async () => {
      // Create valid structure
      await fs.mkdir(path.join(testBaseDir, 'env'), { recursive: true });
      await fs.mkdir(path.join(testBaseDir, 'tools'), { recursive: true });
      await fs.mkdir(path.join(testBaseDir, 'providers'), { recursive: true });
      await fs.writeFile(path.join(testBaseDir, 'core.md'), 'Content');

      const result = await installer.repair(testBaseDir, defaultFiles);

      expect(result.success).toBe(true);
      expect(result.repaired).toHaveLength(0);
    });

    it('should report errors that could not be repaired', async () => {
      // Skip permission tests on Windows as chmod has no effect
      if (isWindows()) {
        // On Windows, try to create in an invalid location
        const result = await installer.repair('/invalid:path', defaultFiles);
        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      } else {
        // Create directory with no write permission
        await fs.mkdir(testBaseDir, { recursive: true, mode: 0o555 });

        const result = await installer.repair(testBaseDir, defaultFiles);

        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.stillInvalid.length).toBeGreaterThan(0);
      }
    });
  });

  describe('backup', () => {
    beforeEach(async () => {
      // Create test structure to backup
      await fs.mkdir(path.join(testBaseDir, 'env'), { recursive: true });
      await fs.writeFile(path.join(testBaseDir, 'core.md'), 'Core content');
      await fs.writeFile(path.join(testBaseDir, 'env/dev.md'), 'Dev content');
    });

    it('should create timestamped backup directory', async () => {
      const backupPath = path.join(tempDir, 'backups');
      const result = await installer.backup(testBaseDir, backupPath);

      expect(result.success).toBe(true);
      expect(result.backupPath).toMatch(/prompt-backup-\d{8}_\d{6}/);
      expect(existsSync(result.backupPath!)).toBe(true);
    });

    it('should copy all files to backup', async () => {
      const backupPath = path.join(tempDir, 'backups');
      const result = await installer.backup(testBaseDir, backupPath);

      expect(result.success).toBe(true);
      expect(result.fileCount).toBe(2);

      // Verify files were copied
      const backupCore = path.join(result.backupPath!, 'core.md');
      const backupEnv = path.join(result.backupPath!, 'env/dev.md');
      expect(existsSync(backupCore)).toBe(true);
      expect(existsSync(backupEnv)).toBe(true);

      // Verify content matches
      const content = await fs.readFile(backupCore, 'utf-8');
      expect(content).toBe('Core content');
    });

    it('should create manifest file with backup details', async () => {
      const backupPath = path.join(tempDir, 'backups');
      const result = await installer.backup(testBaseDir, backupPath);

      const manifestPath = path.join(
        result.backupPath!,
        'backup-manifest.json',
      );
      expect(existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
      expect(manifest.sourcePath).toBe(testBaseDir);
      expect(manifest.fileCount).toBe(2);
      expect(manifest.backupDate).toBeDefined();
    });

    it('should handle non-existent source directory', async () => {
      const result = await installer.backup('/nonexistent/path', tempDir);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Nothing to backup');
    });

    it('should handle invalid backup path', async () => {
      const result = await installer.backup(testBaseDir, '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid backup path');
    });

    it('should calculate total backup size', async () => {
      const backupPath = path.join(tempDir, 'backups');
      const result = await installer.backup(testBaseDir, backupPath);

      expect(result.success).toBe(true);
      expect(result.totalSize).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle symbolic links in base directory', async () => {
      const realDir = path.join(tempDir, 'real-prompts');
      const symlinkDir = path.join(tempDir, 'symlink-prompts');

      await fs.mkdir(realDir, { recursive: true });
      await fs.symlink(realDir, symlinkDir);

      const result = await installer.install(symlinkDir, {
        'test.md': 'content',
      });

      expect(result.success).toBe(true);
      // File should be in the real directory
      expect(existsSync(path.join(realDir, 'test.md'))).toBe(true);
    });

    it('should handle race conditions with idempotent operations', async () => {
      const files = { 'test.md': 'content' };

      // Run multiple installs concurrently
      const results = await Promise.all([
        installer.install(testBaseDir, files),
        installer.install(testBaseDir, files),
        installer.install(testBaseDir, files),
      ]);

      // All should succeed
      results.forEach((result) => {
        expect(result.success).toBe(true);
      });

      // File should exist only once
      const dirContents = await fs.readdir(testBaseDir);
      expect(dirContents.filter((f) => f === 'test.md')).toHaveLength(1);
    });

    it('should handle case-sensitive filesystem issues', async () => {
      const files = {
        'Core.md': 'uppercase content',
        'core.md': 'lowercase content',
      };

      const result = await installer.install(testBaseDir, files);

      // On case-insensitive systems, one will be skipped
      expect(result.success).toBe(true);
      expect(result.installed.length + result.skipped.length).toBe(2);
    });

    it('should clean up temp files on write failure', async () => {
      // Make directory read-only after creation
      await fs.mkdir(testBaseDir, { recursive: true });

      // Attempt to write a file that will fail
      const files = { 'test.md': 'content' };

      // Skip permission tests on Windows as chmod has no effect
      if (isWindows()) {
        // On Windows, simulate a failure by using an invalid path
        const result = await installer.install('/invalid:path', files);
        expect(result.success).toBe(false);
        return; // Skip temp file check on Windows
      }

      // Make directory read-only
      await fs.chmod(testBaseDir, 0o555);

      const result = await installer.install(testBaseDir, files);

      expect(result.success).toBe(false);

      // Reset permissions to check for temp files
      await fs.chmod(testBaseDir, 0o755);

      // No temp files should remain
      const contents = await fs.readdir(testBaseDir);
      const tempFiles = contents.filter((f) => f.includes('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });
  });
});
