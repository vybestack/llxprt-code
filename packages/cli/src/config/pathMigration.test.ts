/**
 * Behavioral TDD tests for the legacy → platform-standard path migration.
 *
 * Tests use real temp directories and the actual filesystem to verify
 * real copy behavior — no mocking of the module under test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'node:path';
import * as os from 'os';

import {
  shouldMigrate,
  performMigration,
  type MigrationResult,
} from './pathMigration.js';

async function makeTempDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'llxprt-migration-test-'));
}

function writeFiles(root: string, entries: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(entries)) {
    const fullPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe('shouldMigrate', () => {
  let legacyDir: string;
  let newDir: string;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    newDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  it('returns true when legacy has content and new dir is empty', async () => {
    writeFiles(legacyDir, { 'settings.json': '{}' });
    await fs.promises.rm(newDir, { recursive: true, force: true });
    fs.mkdirSync(newDir, { recursive: true });

    expect(shouldMigrate(legacyDir, newDir)).toBe(true);
  });

  it('returns true when legacy has content and new dir does not exist', async () => {
    writeFiles(legacyDir, { 'settings.json': '{}' });
    await fs.promises.rm(newDir, { recursive: true, force: true });

    expect(shouldMigrate(legacyDir, newDir)).toBe(true);
  });

  it('returns false when legacy dir does not exist (fresh install)', async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(newDir, { recursive: true, force: true });

    expect(shouldMigrate(legacyDir, newDir)).toBe(false);
  });

  it('returns false when legacy dir is empty', async () => {
    await fs.promises.rm(newDir, { recursive: true, force: true });

    expect(shouldMigrate(legacyDir, newDir)).toBe(false);
  });

  it('returns false when new dir already has content (already migrated)', async () => {
    writeFiles(legacyDir, { 'settings.json': '{}' });
    writeFiles(newDir, { 'settings.json': '{"migrated": true}' });

    expect(shouldMigrate(legacyDir, newDir)).toBe(false);
  });
});

describe('performMigration', () => {
  let legacyDir: string;
  let newDir: string;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    newDir = await makeTempDir();
    // Remove newDir so migration creates it fresh
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  it('copies files from legacy to new dir', () => {
    writeFiles(legacyDir, {
      'settings.json': '{"theme": "dark"}',
      installation_id: 'abc-123',
      'profiles/profile1.json': '{"name": "p1"}',
      'todos/todo.json': '[]',
    });

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    expect(fs.readFileSync(path.join(newDir, 'settings.json'), 'utf-8')).toBe(
      '{"theme": "dark"}',
    );
    expect(fs.readFileSync(path.join(newDir, 'installation_id'), 'utf-8')).toBe(
      'abc-123',
    );
    expect(
      fs.readFileSync(path.join(newDir, 'profiles/profile1.json'), 'utf-8'),
    ).toBe('{"name": "p1"}');
    expect(fs.readFileSync(path.join(newDir, 'todos/todo.json'), 'utf-8')).toBe(
      '[]',
    );
  });

  it('excludes the secure-store directory', () => {
    writeFiles(legacyDir, {
      'settings.json': '{}',
      'secure-store/store.json': '{"secret": true}',
      'secure-store/sub/deep.json': '{"deep": true}',
    });

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    expect(fs.existsSync(path.join(newDir, 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(newDir, 'secure-store'))).toBe(false);
  });

  it('copies nested directory structures', () => {
    writeFiles(legacyDir, {
      'prompts/tools/code.md': '# Code prompt',
      'prompts/tools/test.md': '# Test prompt',
      'subagents/researcher.json': '{"name": "researcher"}',
      'history/abc123/log.json': '[]',
    });

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(path.join(newDir, 'prompts/tools/code.md'), 'utf-8'),
    ).toBe('# Code prompt');
    expect(
      fs.readFileSync(path.join(newDir, 'subagents/researcher.json'), 'utf-8'),
    ).toBe('{"name": "researcher"}');
    expect(
      fs.readFileSync(path.join(newDir, 'history/abc123/log.json'), 'utf-8'),
    ).toBe('[]');
  });

  it('counts the number of files copied', () => {
    writeFiles(legacyDir, {
      'settings.json': '{}',
      'profiles/a.json': '{}',
      'profiles/b.json': '{}',
    });

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    expect(result.filesCopied).toBe(3);
  });

  it('does not delete the legacy directory', () => {
    writeFiles(legacyDir, { 'settings.json': '{}' });

    performMigration(legacyDir, newDir);

    expect(fs.existsSync(path.join(legacyDir, 'settings.json'))).toBe(true);
  });

  it('handles legacy dir with only secure-store (migrates nothing)', () => {
    writeFiles(legacyDir, {
      'secure-store/store.json': '{}',
    });

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(false);
    expect(result.filesCopied).toBe(0);
    expect(fs.existsSync(path.join(newDir, 'secure-store'))).toBe(false);
  });

  it('returns migrated:false when legacy dir does not exist', () => {
    const nonExistent = path.join(legacyDir, 'does-not-exist');
    const result = performMigration(nonExistent, newDir);

    expect(result.migrated).toBe(false);
    expect(result.filesCopied).toBe(0);
  });
});

describe('performMigration — edge cases', () => {
  let legacyDir: string;
  let newDir: string;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    newDir = await makeTempDir();
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  it('preserves file permissions on copied files', () => {
    const srcFile = path.join(legacyDir, 'script.sh');
    fs.writeFileSync(srcFile, '#!/bin/bash');
    fs.chmodSync(srcFile, 0o755);

    const result: MigrationResult = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    const destFile = path.join(newDir, 'script.sh');
    const stat = fs.statSync(destFile);
    // The execute bits should be preserved
    expect(stat.mode & 0o111).not.toBe(0);
  });

  it('handles empty subdirectories in legacy dir', () => {
    fs.mkdirSync(path.join(legacyDir, 'empty-dir'), { recursive: true });
    writeFiles(legacyDir, { 'settings.json': '{}' });

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    // Only the file counts; empty dirs may or may not be copied
    expect(result.filesCopied).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(newDir, 'settings.json'))).toBe(true);
  });
});

describe('performMigration — merge mode', () => {
  let legacyDir: string;
  let newDir: string;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    newDir = await makeTempDir();
    // Keep newDir intact — it already has content (simulates prior partial migration)
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  it('merges files without overwriting existing ones', () => {
    writeFiles(newDir, {
      'settings.json': '{"existing": true}',
    });
    writeFiles(legacyDir, {
      'settings.json': '{"legacy": true}',
      installation_id: 'migrated-id',
    });

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    // Existing file preserved (not overwritten)
    expect(
      fs.readFileSync(path.join(newDir, 'settings.json'), 'utf-8'),
    ).toContain('existing');
    // New file merged in
    expect(fs.readFileSync(path.join(newDir, 'installation_id'), 'utf-8')).toBe(
      'migrated-id',
    );
  });

  it('merges into nested directories without overwriting', () => {
    writeFiles(newDir, {
      'profiles/existing.json': '{"v": 1}',
    });
    writeFiles(legacyDir, {
      'profiles/existing.json': '{"v": 2}',
      'profiles/new.json': '{"v": 3}',
    });

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(path.join(newDir, 'profiles/existing.json'), 'utf-8'),
    ).toContain('"v": 1');
    expect(
      fs.readFileSync(path.join(newDir, 'profiles/new.json'), 'utf-8'),
    ).toContain('"v": 3');
  });
});

describe('performMigration — symlinks', () => {
  let legacyDir: string;
  let newDir: string;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    newDir = await makeTempDir();
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  it('copies absolute symlinks correctly', () => {
    const realTarget = path.join(legacyDir, 'real-config.json');
    fs.writeFileSync(realTarget, '{"data": true}');
    fs.symlinkSync(realTarget, path.join(legacyDir, 'link.json'));

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    const linkPath = path.join(newDir, 'link.json');
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(linkPath, 'utf-8')).toBe('{"data": true}');
  });

  it('rebases relative symlinks so they resolve from the new location', () => {
    const subDir = path.join(legacyDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'target.txt'), 'hello');
    // Relative symlink: sub/link.txt -> ./target.txt
    fs.symlinkSync('./target.txt', path.join(subDir, 'link.txt'));

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    const newLink = path.join(newDir, 'sub', 'link.txt');
    expect(fs.lstatSync(newLink).isSymbolicLink()).toBe(true);
    // The relative symlink should resolve correctly from the new location
    expect(fs.readFileSync(newLink, 'utf-8')).toBe('hello');
  });

  it('rebases parent-traversing relative symlinks (../target) correctly', () => {
    const subDir = path.join(legacyDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'shared.txt'), 'shared-data');
    fs.symlinkSync('../shared.txt', path.join(subDir, 'link.txt'));

    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    const newLink = path.join(newDir, 'sub', 'link.txt');
    expect(fs.lstatSync(newLink).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(newLink, 'utf-8')).toBe('shared-data');
  });

  it('clones directory symlinks without following them (no infinite recursion)', () => {
    const dirA = path.join(legacyDir, 'dirA');
    const dirB = path.join(legacyDir, 'dirB');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    // Create a cycle: dirA/linkB -> dirB, dirB/linkA -> dirA
    fs.symlinkSync(dirB, path.join(dirA, 'linkB'));
    fs.symlinkSync(dirA, path.join(dirB, 'linkA'));
    fs.writeFileSync(path.join(dirA, 'file.txt'), 'a');
    fs.writeFileSync(path.join(dirB, 'file.txt'), 'b');

    // Should not hang or overflow the stack — symlinks are cloned, not followed
    const result = performMigration(legacyDir, newDir);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(path.join(newDir, 'dirA', 'file.txt'), 'utf-8'),
    ).toBe('a');
    expect(
      fs.readFileSync(path.join(newDir, 'dirB', 'file.txt'), 'utf-8'),
    ).toBe('b');
  });
});

describe('performMigration — error handling', () => {
  let legacyDir: string;
  let newDir: string;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    newDir = await makeTempDir();
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(newDir, { recursive: true, force: true });
  });

  it('propagates filesystem errors and cleans up staging dir', () => {
    // Create a file where a directory is expected to force an error
    writeFiles(legacyDir, { 'settings.json': '{}' });
    // Make newDir a file instead of a directory to trigger an error
    fs.writeFileSync(newDir, 'blocker');

    expect(() => performMigration(legacyDir, newDir)).toThrow(
      /ENOTDIR|migration/i,
    );
    // newDir should still be the file (migration failed)
    expect(fs.readFileSync(newDir, 'utf-8')).toBe('blocker');
    // No orphaned staging directories should remain
    const parentDir = path.dirname(newDir);
    const leftovers = fs
      .readdirSync(parentDir)
      .filter((f) => f.startsWith('.llxprt-migration-staging-'));
    expect(leftovers).toHaveLength(0);
  });
});
