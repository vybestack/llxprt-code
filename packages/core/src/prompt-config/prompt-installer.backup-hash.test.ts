/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral TDD tests for PromptInstaller backup, hash-based modification
 * tracking, and edge cases.
 *
 * Split from prompt-installer.test.ts to keep each test file under the
 * project's max-lines budget. These tests verify real file operations using
 * temporary directories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PromptInstaller, MissingBaseDirError } from './prompt-installer.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { createHash } from 'node:crypto';

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Validates a backup path of form
 * `<dir>/prompt-backup-YYYYMMDD_HHMMSS[-<uuid-suffix>]`. The UUID suffix is
 * optional for backward compat but present in current production output.
 */
function matchesBackupPath(value: string): boolean {
  const idx = value.lastIndexOf('prompt-backup-');
  if (idx === -1) {
    return false;
  }
  const suffix = value.slice(idx + 'prompt-backup-'.length);
  // YYYYMMDD_HHMMSS = 15 chars: 8 digits, '_', 6 digits, then optional '-suffix'
  if (suffix.length < 15) {
    return false;
  }
  for (let i = 0; i < 8; i++) {
    if (!isDigit(suffix[i])) return false;
  }
  if (suffix[8] !== '_') return false;
  for (let i = 9; i < 15; i++) {
    if (!isDigit(suffix[i])) return false;
  }
  // Optional UUID suffix (current production appends '-<8hex>')
  if (suffix.length > 15 && suffix[15] !== '-') {
    return false;
  }
  return true;
}

// Helper to check if we're on Windows
const isWindows = (): boolean => os.platform() === 'win32';

/** Recursively reads and returns the utf-8 content of every file under dir. */
async function collectDirFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectDirFiles(full)));
    } else if (entry.isFile()) {
      out.push(await fs.readFile(full, 'utf-8'));
    }
  }
  return out;
}

describe('PromptInstaller backup & hash tracking', () => {
  let installer: PromptInstaller;
  let tempDir: string;
  let testBaseDir: string;

  beforeEach(async () => {
    installer = new PromptInstaller();
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'prompt-installer-test-'),
    );
    testBaseDir = path.join(tempDir, 'prompts');
    await fs.mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
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
      expect(result.backupPath).toBeTruthy();
      expect(matchesBackupPath(result.backupPath!)).toBe(true);
      expect(existsSync(result.backupPath!)).toBe(true);
      // The timestamped backup must be nested under the provided backupPath
      // so a bug creating backups elsewhere does not pass silently (#32).
      expect(result.backupPath!.startsWith(backupPath + path.sep)).toBe(true);
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

    it('should reject null baseDir instead of falling back to a default', async () => {
      await expect(installer.backup(null, tempDir)).rejects.toBeInstanceOf(
        MissingBaseDirError,
      );
    });

    it('should reject undefined baseDir instead of falling back to a default', async () => {
      await expect(installer.backup(undefined, tempDir)).rejects.toBeInstanceOf(
        MissingBaseDirError,
      );
    });

    it('should reject empty-string baseDir with a clear diagnostic', async () => {
      await expect(installer.backup('', tempDir)).rejects.toThrow(
        /backup requires a non-empty already-resolved base directory/,
      );
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

    it('publishes to a unique collision-suffixed name when the requested destination already exists, preserving the winner', async () => {
      // Same-second / concurrent collision: a winner already published a
      // completed backup at the requested destination. The loser must NOT
      // remove or overwrite it — instead it publishes to a unique suffixed
      // final name so both survive.
      const { snapshotDirectory } = await import(
        './installer/backup-operations.js'
      );
      const backupDir = path.join(tempDir, 'prompt-backup-existing');
      const winnerFile = path.join(backupDir, 'winner.json');
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(winnerFile, '{"winner":true}');

      const result = await snapshotDirectory(testBaseDir, backupDir);

      expect(result.success).toBe(true);
      // Winner's completed destination is intact and untouched.
      expect(await fs.readFile(winnerFile, 'utf-8')).toBe('{"winner":true}');
      // The loser published to a collision-suffixed name, not the winner's dir.
      expect(result.backupPath).not.toBe(backupDir);
      expect(result.backupPath.startsWith(backupDir)).toBe(true);
      expect(existsSync(result.backupPath)).toBe(true);
      // No staging residue left behind.
      expect(
        (await fs.readdir(tempDir)).some((name) => name.includes('.staging-')),
      ).toBe(false);
    });

    it('never removes an existing completed destination when publish collides (real concurrency winner survives)', async () => {
      // Direct verification of the P0 invariant: an existing completed backup
      // must survive a concurrent loser's snapshotDirectory call. The loser's
      // staging is cleaned up and the winner is byte-for-byte preserved.
      const { snapshotDirectory } = await import(
        './installer/backup-operations.js'
      );
      const backupDir = path.join(tempDir, 'prompt-backup-winner');
      const winnerDir = path.join(backupDir, 'sub');
      await fs.mkdir(winnerDir, { recursive: true });
      const winnerKeep = path.join(backupDir, 'keep.md');
      await fs.writeFile(winnerKeep, 'winner-content');
      await fs.writeFile(path.join(winnerDir, 'nested.md'), 'nested-winner');

      const result = await snapshotDirectory(testBaseDir, backupDir);

      expect(result.success).toBe(true);
      // Winner fully preserved.
      expect(await fs.readFile(winnerKeep, 'utf-8')).toBe('winner-content');
      expect(
        await fs.readFile(path.join(winnerDir, 'nested.md'), 'utf-8'),
      ).toBe('nested-winner');
      // No staging residue.
      expect(
        (await fs.readdir(tempDir)).some((name) => name.includes('.staging-')),
      ).toBe(false);
    });

    it('same-second concurrent backups both survive via collision-resistant publish', async () => {
      // Two snapshotDirectory calls racing for the same timestamped final name
      // (the real-world same-second collision scenario). Both completed
      // backups must survive, neither overwriting the other, with no staging
      // residue.
      const { snapshotDirectory } = await import(
        './installer/backup-operations.js'
      );
      const sameTarget = path.join(tempDir, 'prompt-backup-samesame');
      const sourceA = path.join(tempDir, 'source-a');
      const sourceB = path.join(tempDir, 'source-b');
      await fs.mkdir(sourceA, { recursive: true });
      await fs.mkdir(sourceB, { recursive: true });
      await fs.writeFile(path.join(sourceA, 'a.md'), 'A-content');
      await fs.writeFile(path.join(sourceB, 'b.md'), 'B-content');

      const [resultA, resultB] = await Promise.all([
        snapshotDirectory(sourceA, sameTarget),
        snapshotDirectory(sourceB, sameTarget),
      ]);

      // Both succeeded; exactly one got the canonical name and the other a
      // collision suffix (order is nondeterministic, so assert by content).
      const paths = new Set([resultA.backupPath, resultB.backupPath]);
      expect(paths.size).toBe(2);
      for (const p of paths) {
        expect(existsSync(p)).toBe(true);
      }
      // No staging residue.
      expect(
        (await fs.readdir(tempDir)).some((name) => name.includes('.staging-')),
      ).toBe(false);
      // Exactly one backup contains A-content and exactly one contains B-content.
      const allFiles: string[] = [];
      for (const p of paths) {
        allFiles.push(...(await collectDirFiles(p)));
      }
      expect(allFiles.filter((c) => c === 'A-content')).toHaveLength(1);
      expect(allFiles.filter((c) => c === 'B-content')).toHaveLength(1);
    });
  });

  describe('hash-based modification tracking (issue #734)', () => {
    const MANIFEST_FILE = '.installed-manifest.json';

    const defaultFiles = {
      'core.md': '# Core Prompt\nDefault content',
      'env/development.md': '# Development Environment',
    };

    describe('manifest file management', () => {
      it('should create manifest file on first install', async () => {
        const result = await installer.install(testBaseDir, defaultFiles);

        expect(result.success).toBe(true);
        const manifestPath = path.join(testBaseDir, MANIFEST_FILE);
        expect(existsSync(manifestPath)).toBe(true);

        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        expect(manifest.version).toBe(1);
        expect(manifest.files['core.md']).toBeDefined();
        expect(manifest.files['core.md'].hash).toBeDefined();
        expect(manifest.files['env/development.md']).toBeDefined();
        // Assert the second file's hash is also defined, so a hashing bug that
        // skips subdirectory/empty/special-character paths is caught.
        expect(manifest.files['env/development.md'].hash).toBeDefined();
      });

      it('should update manifest when file is overwritten', async () => {
        // First install
        await installer.install(testBaseDir, defaultFiles);

        // Get original hash
        const manifestPath = path.join(testBaseDir, MANIFEST_FILE);
        const manifest1 = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        const originalHash = manifest1.files['core.md'].hash;

        // Change the default content
        const newDefaults = {
          'core.md': '# Core Prompt\nNew default content v2',
        };

        // Second install - should silently overwrite (file wasn't modified by user)
        const result = await installer.install(testBaseDir, newDefaults);

        expect(result.success).toBe(true);

        // Verify manifest was updated with new hash
        const manifest2 = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        expect(manifest2.files['core.md'].hash).not.toBe(originalHash);

        // Verify file content was updated
        const content = await fs.readFile(
          path.join(testBaseDir, 'core.md'),
          'utf-8',
        );
        expect(content).toBe('# Core Prompt\nNew default content v2');

        // Assert the new hash equals the actual SHA-256 of the installed
        // content, so a hash-algorithm or encoding regression is caught.
        const expectedHash = createHash('sha256')
          .update(content, 'utf-8')
          .digest('hex');
        expect(manifest2.files['core.md'].hash).toBe(expectedHash);
      });

      it('should handle corrupted manifest gracefully', async () => {
        await fs.mkdir(testBaseDir, { recursive: true });
        const manifestPath = path.join(testBaseDir, MANIFEST_FILE);
        await fs.writeFile(manifestPath, 'not valid json');
        await fs.writeFile(
          path.join(testBaseDir, 'core.md'),
          'User modified content',
        );

        const result = await installer.install(testBaseDir, defaultFiles);

        // Should succeed and treat file as potentially modified (conservative)
        expect(result.success).toBe(true);
        // File should be preserved (conservative when manifest is corrupt)
        expect(result.skipped).toContain('core.md');
      });
    });

    describe('user modification detection', () => {
      it('should silently overwrite file that user never modified', async () => {
        // First install
        await installer.install(testBaseDir, defaultFiles);

        // Verify file was installed
        expect(existsSync(path.join(testBaseDir, 'core.md'))).toBe(true);

        // Ship new defaults without user touching anything
        const newDefaults = {
          'core.md': '# Core Prompt\nUpdated default content',
        };

        const result = await installer.install(testBaseDir, newDefaults);

        expect(result.success).toBe(true);
        // File should be overwritten, not skipped
        expect(result.installed).toContain('core.md');
        expect(result.skipped).not.toContain('core.md');
        expect(result.conflicts).toHaveLength(0);

        // Verify content was updated
        const content = await fs.readFile(
          path.join(testBaseDir, 'core.md'),
          'utf-8',
        );
        expect(content).toBe('# Core Prompt\nUpdated default content');
      });

      it('should create review file when user actually modified the file', async () => {
        // First install
        await installer.install(testBaseDir, defaultFiles);

        // User modifies the file
        await fs.writeFile(
          path.join(testBaseDir, 'core.md'),
          '# My Custom Prompt\nI changed this!',
        );

        // Ship new defaults
        const newDefaults = {
          'core.md': '# Core Prompt\nUpdated default content',
        };

        const result = await installer.install(testBaseDir, newDefaults);

        expect(result.success).toBe(true);
        // User's file should be preserved
        expect(result.skipped).toContain('core.md');
        // Conflict should be reported
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].reason).toBe('user-modified');

        // User's content should be preserved
        const content = await fs.readFile(
          path.join(testBaseDir, 'core.md'),
          'utf-8',
        );
        expect(content).toBe('# My Custom Prompt\nI changed this!');

        // Review file should exist with new defaults
        const reviewFile = result.conflicts[0].reviewFile;
        expect(reviewFile).toBeDefined();
        expect(existsSync(path.join(testBaseDir, reviewFile!))).toBe(true);
      });

      it('should not create duplicate review files on subsequent installs', async () => {
        // First install
        await installer.install(testBaseDir, defaultFiles);

        // User modifies the file
        await fs.writeFile(
          path.join(testBaseDir, 'core.md'),
          '# My Custom Prompt\nI changed this!',
        );

        const newDefaults = {
          'core.md': '# Core Prompt\nUpdated default content',
        };

        // First install with new defaults - creates review file
        const result1 = await installer.install(testBaseDir, newDefaults);
        expect(result1.conflicts).toHaveLength(1);
        const reviewFile1 = result1.conflicts[0].reviewFile;

        // Second install with same defaults - should NOT create another review file
        const result2 = await installer.install(testBaseDir, newDefaults);
        expect(result2.conflicts).toHaveLength(0);
        expect(result2.notices).toHaveLength(0);

        // Count review files - should be just one
        const files = await fs.readdir(testBaseDir);
        const reviewFiles = files.filter((f) => f.startsWith('core.md.'));
        expect(reviewFiles).toHaveLength(1);
        expect(reviewFiles[0]).toBe(reviewFile1);
      });

      it('should treat file as potentially modified when no manifest exists', async () => {
        // Create existing file without ever running installer
        await fs.mkdir(testBaseDir, { recursive: true });
        await fs.writeFile(
          path.join(testBaseDir, 'core.md'),
          'Some existing content',
        );

        const result = await installer.install(testBaseDir, defaultFiles);

        // Should be conservative - assume user modified
        expect(result.success).toBe(true);
        expect(result.skipped).toContain('core.md');
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].reason).toBe('unknown-baseline');
      });
    });

    describe('NO OVERWRITE flag', () => {
      it('should preserve file with # NO OVERWRITE at start', async () => {
        // First install
        await installer.install(testBaseDir, defaultFiles);

        // User adds NO OVERWRITE flag (but content otherwise unchanged)
        await fs.writeFile(
          path.join(testBaseDir, 'core.md'),
          '# NO OVERWRITE\n# Core Prompt\nDefault content',
        );

        // Update manifest to mark this as unmodified (simulate clean state)
        const manifestPath = path.join(testBaseDir, MANIFEST_FILE);
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        manifest.files['core.md'].hash = installer.hashContent(
          '# NO OVERWRITE\n# Core Prompt\nDefault content',
        );
        await fs.writeFile(manifestPath, JSON.stringify(manifest));

        const newDefaults = {
          'core.md': '# Core Prompt\nUpdated default content',
        };

        const result = await installer.install(testBaseDir, newDefaults);

        expect(result.success).toBe(true);
        expect(result.skipped).toContain('core.md');
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].reason).toBe('user-protected');

        // File should NOT be overwritten
        const content = await fs.readFile(
          path.join(testBaseDir, 'core.md'),
          'utf-8',
        );
        expect(content).toContain('# NO OVERWRITE');
      });

      it('should preserve file with # LLXPRT: NO OVERWRITE', async () => {
        await installer.install(testBaseDir, defaultFiles);

        await fs.writeFile(
          path.join(testBaseDir, 'core.md'),
          '# LLXPRT: NO OVERWRITE\n# Core Prompt\nDefault content',
        );

        const manifestPath = path.join(testBaseDir, MANIFEST_FILE);
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        manifest.files['core.md'].hash = installer.hashContent(
          '# LLXPRT: NO OVERWRITE\n# Core Prompt\nDefault content',
        );
        await fs.writeFile(manifestPath, JSON.stringify(manifest));

        const newDefaults = {
          'core.md': '# Core Prompt\nUpdated default content',
        };

        const result = await installer.install(testBaseDir, newDefaults);

        expect(result.success).toBe(true);
        expect(result.conflicts[0].reason).toBe('user-protected');
      });

      it('should preserve file with <!-- NO OVERWRITE --> comment', async () => {
        await installer.install(testBaseDir, defaultFiles);

        await fs.writeFile(
          path.join(testBaseDir, 'core.md'),
          '<!-- NO OVERWRITE -->\n# Core Prompt\nDefault content',
        );

        const manifestPath = path.join(testBaseDir, MANIFEST_FILE);
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        manifest.files['core.md'].hash = installer.hashContent(
          '<!-- NO OVERWRITE -->\n# Core Prompt\nDefault content',
        );
        await fs.writeFile(manifestPath, JSON.stringify(manifest));

        const newDefaults = {
          'core.md': '# Core Prompt\nUpdated default content',
        };

        const result = await installer.install(testBaseDir, newDefaults);

        expect(result.success).toBe(true);
        expect(result.conflicts[0].reason).toBe('user-protected');
      });
    });

    describe('content hashing', () => {
      it('should produce consistent hashes for same content', () => {
        const content = '# Test content\nWith multiple lines';
        const hash1 = installer.hashContent(content);
        const hash2 = installer.hashContent(content);

        expect(hash1).toBe(hash2);
        expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 produces 64 hex chars
      });

      it('should produce different hashes for different content', () => {
        const hash1 = installer.hashContent('Content A');
        const hash2 = installer.hashContent('Content B');

        expect(hash1).not.toBe(hash2);
      });
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

      // Verify final content is intact under concurrency — interleaved or
      // lost writes would corrupt the file without this assertion (#29).
      const finalContent = await fs.readFile(
        path.join(testBaseDir, 'test.md'),
        'utf-8',
      );
      expect(finalContent).toBe('content');
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
      // On a case-sensitive filesystem both files coexist; on a
      // case-insensitive filesystem one overwrites the other. The meaningful
      // invariant is that exactly one on-disk filename is present and its
      // content is one of the two provided values (no corruption) (#31).
      const present = (['Core.md', 'core.md'] as const).filter((f) =>
        existsSync(path.join(testBaseDir, f)),
      );
      expect(present.length).toBeGreaterThanOrEqual(1);
      for (const f of present) {
        const content = await fs.readFile(path.join(testBaseDir, f), 'utf-8');
        expect(['uppercase content', 'lowercase content']).toContain(content);
      }
    });

    it('cleans up temp files when rename fails because the destination is a directory (cross-platform, no chmod)', async () => {
      // An existing destination DIRECTORY at fullPath causes rename(temp, dir)
      // to fail cross-platform AFTER the temp file has been written, exercising
      // the real cleanup path and verifying residue removal using genuine
      // filesystem behavior. Uses a directory-as-destination instead of a
      // platform-specific invalid path, avoiding chmod assumptions.
      const destAsDir = path.join(testBaseDir, 'test.md');
      await fs.mkdir(destAsDir, { recursive: true });

      const { writeInstallFile } = await import('./installer/file-writer.js');
      const result = await writeInstallFile(
        testBaseDir,
        'test.md',
        'content',
        null,
      );

      // Rename over a directory fails, so the file is not installed.
      expect(result.installed).toBe(false);

      // No temp residue files should remain in the base directory after
      // the failed rename — the file-writer must clean up its temp artifact.
      const contents = await fs.readdir(testBaseDir);
      const tempResidue = contents.filter((name) => name.includes('.tmp'));
      expect(tempResidue).toHaveLength(0);
    });

    it.skipIf(isWindows())(
      'should clean up temp files on write failure - Unix',
      async () => {
        // Make directory read-only after creation
        await fs.mkdir(testBaseDir, { recursive: true });

        const files = { 'test.md': 'content' };

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
      },
    );
  });
});
