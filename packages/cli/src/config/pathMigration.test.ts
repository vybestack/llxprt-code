/**
 * Behavioral TDD tests for the legacy → platform-standard path migration.
 *
 * Tests use real temp directories and the actual filesystem to verify
 * real copy behavior — no mocking of the module under test.
 *
 * The migration splits legacy `~/.llxprt/` contents across four
 * category directories: config, data, cache, and log/state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'node:path';
import * as os from 'os';

import {
  shouldMigrate,
  performMigration,
  type MigrationDestinations,
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

function makeDestinations(base: string): MigrationDestinations {
  return {
    configDir: path.join(base, 'config'),
    dataDir: path.join(base, 'data'),
    cacheDir: path.join(base, 'cache'),
    logDir: path.join(base, 'log'),
  };
}

describe('shouldMigrate', () => {
  let legacyDir: string;
  let destBase: string;
  let destinations: MigrationDestinations;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    destBase = await makeTempDir();
    destinations = makeDestinations(destBase);
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(destBase, { recursive: true, force: true });
  });

  it('returns true when legacy has content and config dir is empty', async () => {
    writeFiles(legacyDir, { 'settings.json': '{}' });
    await fs.promises.rm(destBase, { recursive: true, force: true });
    fs.mkdirSync(destBase, { recursive: true });
    destinations = makeDestinations(destBase);

    expect(shouldMigrate(legacyDir, destinations)).toBe(true);
  });

  it('returns true when legacy has content and config dir does not exist', async () => {
    writeFiles(legacyDir, { 'settings.json': '{}' });
    await fs.promises.rm(destBase, { recursive: true, force: true });

    expect(shouldMigrate(legacyDir, destinations)).toBe(true);
  });

  it('returns false when legacy dir does not exist (fresh install)', async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(destBase, { recursive: true, force: true });

    expect(shouldMigrate(legacyDir, destinations)).toBe(false);
  });

  it('returns false when legacy dir is empty', async () => {
    await fs.promises.rm(destBase, { recursive: true, force: true });

    expect(shouldMigrate(legacyDir, destinations)).toBe(false);
  });

  it('returns false when config dir already has content (already migrated)', async () => {
    writeFiles(legacyDir, { 'settings.json': '{}' });
    writeFiles(destinations.configDir, {
      'settings.json': '{"migrated": true}',
    });

    expect(shouldMigrate(legacyDir, destinations)).toBe(false);
  });
});

describe('performMigration — category routing', () => {
  let legacyDir: string;
  let destBase: string;
  let destinations: MigrationDestinations;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    destBase = await makeTempDir();
    await fs.promises.rm(destBase, { recursive: true, force: true });
    destinations = makeDestinations(destBase);
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(destBase, { recursive: true, force: true });
  });

  it('routes settings.json to config dir', () => {
    writeFiles(legacyDir, { 'settings.json': '{"theme": "dark"}' });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'settings.json'),
        'utf-8',
      ),
    ).toBe('{"theme": "dark"}');
  });

  it('routes profiles/ and subagents/ to config dir', () => {
    writeFiles(legacyDir, {
      'profiles/p1.json': '{"name": "p1"}',
      'subagents/researcher.json': '{"name": "researcher"}',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'profiles/p1.json'),
        'utf-8',
      ),
    ).toBe('{"name": "p1"}');
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'subagents/researcher.json'),
        'utf-8',
      ),
    ).toBe('{"name": "researcher"}');
  });

  it('routes prompts/ to config dir', () => {
    writeFiles(legacyDir, {
      'prompts/tools/code.md': '# Code prompt',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'prompts/tools/code.md'),
        'utf-8',
      ),
    ).toBe('# Code prompt');
  });

  it('routes oauth_creds.json and installation_id to data dir', () => {
    writeFiles(legacyDir, {
      'oauth_creds.json': '{"token": "xyz"}',
      installation_id: 'abc-123',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(
        path.join(destinations.dataDir, 'oauth_creds.json'),
        'utf-8',
      ),
    ).toBe('{"token": "xyz"}');
    expect(
      fs.readFileSync(
        path.join(destinations.dataDir, 'installation_id'),
        'utf-8',
      ),
    ).toBe('abc-123');
  });

  it('routes conversations/ and todos/ to data dir', () => {
    writeFiles(legacyDir, {
      'conversations/conv1.json': '[]',
      'todos/todo.json': '[]',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.existsSync(
        path.join(destinations.dataDir, 'conversations/conv1.json'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(destinations.dataDir, 'todos/todo.json')),
    ).toBe(true);
  });

  it('routes cache/ to cache dir', () => {
    writeFiles(legacyDir, {
      'cache/model.bin': 'binary-data',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(
        path.join(destinations.cacheDir, 'cache/model.bin'),
        'utf-8',
      ),
    ).toBe('binary-data');
  });

  it('routes dumps/ to cache dir', () => {
    writeFiles(legacyDir, {
      'dumps/dump1.json': '{}',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.existsSync(path.join(destinations.cacheDir, 'dumps/dump1.json')),
    ).toBe(true);
  });

  it('routes debug/ to log dir', () => {
    writeFiles(legacyDir, {
      'debug/log.txt': 'debug info',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(path.join(destinations.logDir, 'debug/log.txt'), 'utf-8'),
    ).toBe('debug info');
  });

  it('routes tmp/ contents to log dir under tmp/', () => {
    writeFiles(legacyDir, {
      'tmp/abc123/checkpoint.json': '{}',
      'tmp/abc123/shell_history': 'cmd1',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.existsSync(
        path.join(destinations.logDir, 'tmp/abc123/checkpoint.json'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(destinations.logDir, 'tmp/abc123/shell_history')),
    ).toBe(true);
  });

  it('routes tmp/skills/ to config dir (fixing historical misplacement)', () => {
    writeFiles(legacyDir, {
      'tmp/skills/custom-skill.md': '# Custom Skill',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'skills/custom-skill.md'),
        'utf-8',
      ),
    ).toBe('# Custom Skill');
    // tmp/skills should NOT also appear under logDir/tmp/skills
    expect(fs.existsSync(path.join(destinations.logDir, 'tmp/skills'))).toBe(
      false,
    );
  });

  it('excludes the secure-store directory', () => {
    writeFiles(legacyDir, {
      'settings.json': '{}',
      'secure-store/store.json': '{"secret": true}',
      'secure-store/sub/deep.json': '{"deep": true}',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(result.filesCopied).toBe(1);
    expect(
      fs.existsSync(path.join(destinations.configDir, 'settings.json')),
    ).toBe(true);
    expect(fs.existsSync(path.join(destinations.dataDir, 'secure-store'))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(destinations.configDir, 'secure-store')),
    ).toBe(false);
  });

  it('routes unknown entries to data dir (safe default)', () => {
    writeFiles(legacyDir, {
      'unknown-file.txt': 'unknown content',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(
        path.join(destinations.dataDir, 'unknown-file.txt'),
        'utf-8',
      ),
    ).toBe('unknown content');
  });
});

describe('performMigration — file counting and legacy preservation', () => {
  let legacyDir: string;
  let destBase: string;
  let destinations: MigrationDestinations;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    destBase = await makeTempDir();
    await fs.promises.rm(destBase, { recursive: true, force: true });
    destinations = makeDestinations(destBase);
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(destBase, { recursive: true, force: true });
  });

  it('counts the number of files copied across all categories', () => {
    writeFiles(legacyDir, {
      'settings.json': '{}',
      'profiles/a.json': '{}',
      installation_id: 'id',
      'cache/model.bin': 'data',
      'debug/log.txt': 'log',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(result.filesCopied).toBe(5);
  });

  it('does not delete the legacy directory', () => {
    writeFiles(legacyDir, { 'settings.json': '{}' });

    performMigration(legacyDir, destinations);

    expect(fs.existsSync(path.join(legacyDir, 'settings.json'))).toBe(true);
  });

  it('handles legacy dir with only secure-store (migrates nothing)', () => {
    writeFiles(legacyDir, {
      'secure-store/store.json': '{}',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(false);
    expect(result.filesCopied).toBe(0);
  });

  it('returns migrated:false when legacy dir does not exist', () => {
    const nonExistent = path.join(legacyDir, 'does-not-exist');
    const result = performMigration(nonExistent, destinations);

    expect(result.migrated).toBe(false);
    expect(result.filesCopied).toBe(0);
  });
});

describe('performMigration — edge cases', () => {
  let legacyDir: string;
  let destBase: string;
  let destinations: MigrationDestinations;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    destBase = await makeTempDir();
    await fs.promises.rm(destBase, { recursive: true, force: true });
    destinations = makeDestinations(destBase);
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(destBase, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')(
    'preserves file permissions on copied files',
    () => {
      const srcFile = path.join(legacyDir, 'script.sh');
      fs.writeFileSync(srcFile, '#!/bin/bash');
      fs.chmodSync(srcFile, 0o755);

      const result: MigrationResult = performMigration(legacyDir, destinations);

      expect(result.migrated).toBe(true);
      const destFile = path.join(destinations.dataDir, 'script.sh');
      const stat = fs.statSync(destFile);
      expect(stat.mode & 0o111).not.toBe(0);
    },
  );

  it('handles empty subdirectories in legacy dir', () => {
    fs.mkdirSync(path.join(legacyDir, 'empty-dir'), { recursive: true });
    writeFiles(legacyDir, { 'settings.json': '{}' });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(result.filesCopied).toBeGreaterThanOrEqual(1);
    expect(
      fs.existsSync(path.join(destinations.configDir, 'settings.json')),
    ).toBe(true);
  });
});

describe('performMigration — merge mode', () => {
  let legacyDir: string;
  let destBase: string;
  let destinations: MigrationDestinations;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    destBase = await makeTempDir();
    destinations = makeDestinations(destBase);
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(destBase, { recursive: true, force: true });
  });

  it('merges files without overwriting existing ones', () => {
    writeFiles(destinations.configDir, {
      'settings.json': '{"existing": true}',
    });
    writeFiles(legacyDir, {
      'settings.json': '{"legacy": true}',
      installation_id: 'migrated-id',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'settings.json'),
        'utf-8',
      ),
    ).toContain('existing');
    expect(
      fs.readFileSync(
        path.join(destinations.dataDir, 'installation_id'),
        'utf-8',
      ),
    ).toBe('migrated-id');
  });

  it('merges into nested directories without overwriting', () => {
    writeFiles(destinations.configDir, {
      'profiles/existing.json': '{"v": 1}',
    });
    writeFiles(legacyDir, {
      'profiles/existing.json': '{"v": 2}',
      'profiles/new.json': '{"v": 3}',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'profiles/existing.json'),
        'utf-8',
      ),
    ).toContain('"v": 1');
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'profiles/new.json'),
        'utf-8',
      ),
    ).toContain('"v": 3');
  });
});

describe.skipIf(process.platform === 'win32')(
  'performMigration — symlinks',
  () => {
    let legacyDir: string;
    let destBase: string;
    let destinations: MigrationDestinations;

    beforeEach(async () => {
      legacyDir = await makeTempDir();
      destBase = await makeTempDir();
      await fs.promises.rm(destBase, { recursive: true, force: true });
      destinations = makeDestinations(destBase);
    });

    afterEach(async () => {
      await fs.promises.rm(legacyDir, { recursive: true, force: true });
      await fs.promises.rm(destBase, { recursive: true, force: true });
    });

    it('copies absolute symlinks correctly', () => {
      const realTarget = path.join(legacyDir, 'real-config.json');
      fs.writeFileSync(realTarget, '{"data": true}');
      fs.symlinkSync(realTarget, path.join(legacyDir, 'link.json'));

      const result = performMigration(legacyDir, destinations);

      expect(result.migrated).toBe(true);
      const linkPath = path.join(destinations.dataDir, 'link.json');
      expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(linkPath)).toBe(
        path.join(destinations.dataDir, 'real-config.json'),
      );
      expect(fs.readFileSync(linkPath, 'utf-8')).toBe('{"data": true}');
    });

    it('rebases relative symlinks so they resolve from the new location', () => {
      const subDir = path.join(legacyDir, 'sub');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'target.txt'), 'hello');
      fs.symlinkSync('./target.txt', path.join(subDir, 'link.txt'));

      const result = performMigration(legacyDir, destinations);

      expect(result.migrated).toBe(true);
      const newLink = path.join(destinations.dataDir, 'sub', 'link.txt');
      expect(fs.lstatSync(newLink).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(newLink, 'utf-8')).toBe('hello');
    });

    it('rebases parent-traversing relative symlinks correctly', () => {
      const subDir = path.join(legacyDir, 'sub');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, 'shared.txt'), 'shared-data');
      fs.symlinkSync('../shared.txt', path.join(subDir, 'link.txt'));

      const result = performMigration(legacyDir, destinations);

      expect(result.migrated).toBe(true);
      const newLink = path.join(destinations.dataDir, 'sub', 'link.txt');
      expect(fs.lstatSync(newLink).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(newLink, 'utf-8')).toBe('shared-data');
    });

    it('clones directory symlinks without following them (no infinite recursion)', () => {
      const dirA = path.join(legacyDir, 'dirA');
      const dirB = path.join(legacyDir, 'dirB');
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });
      fs.symlinkSync(dirB, path.join(dirA, 'linkB'));
      fs.symlinkSync(dirA, path.join(dirB, 'linkA'));
      fs.writeFileSync(path.join(dirA, 'file.txt'), 'a');
      fs.writeFileSync(path.join(dirB, 'file.txt'), 'b');

      const result = performMigration(legacyDir, destinations);

      expect(result.migrated).toBe(true);
      expect(
        fs.readFileSync(
          path.join(destinations.dataDir, 'dirA', 'file.txt'),
          'utf-8',
        ),
      ).toBe('a');
      expect(
        fs.readFileSync(
          path.join(destinations.dataDir, 'dirB', 'file.txt'),
          'utf-8',
        ),
      ).toBe('b');
    });
  },
);
