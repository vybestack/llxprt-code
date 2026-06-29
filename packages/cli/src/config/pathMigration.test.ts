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
  isMigrationComplete,
  markMigrationComplete,
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

  // Regression for #2237: the config dir is populated independently of the
  // migration (PromptService installs prompts, ProfileManager saves profiles,
  // oauth/settings writers, etc.). Content in the config dir must NOT be
  // treated as "migration already done", otherwise read-only categories like
  // subagents/ are never copied.
  it('returns true when config dir has content but no completion marker (pre-seeded by app)', async () => {
    writeFiles(legacyDir, {
      'settings.json': '{}',
      'subagents/researcher.json': '{"name": "researcher"}',
    });
    // Simulate the app having seeded prompts/profiles before migration ran.
    writeFiles(destinations.configDir, {
      'prompts/core.md': '# seeded by PromptService',
      'profiles/p.json': '{"seeded": true}',
    });

    expect(shouldMigrate(legacyDir, destinations)).toBe(true);
  });

  it('returns false once the migration-completion marker is present', async () => {
    writeFiles(legacyDir, { 'settings.json': '{}' });
    markMigrationComplete(destinations);

    expect(shouldMigrate(legacyDir, destinations)).toBe(false);
  });
});

describe('migration-completion marker (#2237)', () => {
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

  it('isMigrationComplete is false before any migration', () => {
    expect(isMigrationComplete(destinations)).toBe(false);
  });

  it('markMigrationComplete makes isMigrationComplete return true', () => {
    markMigrationComplete(destinations);
    expect(isMigrationComplete(destinations)).toBe(true);
  });

  it('marker survives unrelated config-dir content (independent of config dir)', () => {
    markMigrationComplete(destinations);
    writeFiles(destinations.configDir, { 'prompts/core.md': '# seeded' });
    expect(isMigrationComplete(destinations)).toBe(true);
  });

  it('markMigrationComplete creates the data dir if it does not exist', () => {
    expect(fs.existsSync(destinations.dataDir)).toBe(false);
    markMigrationComplete(destinations);
    expect(isMigrationComplete(destinations)).toBe(true);
  });

  // The marker constant is intentionally not exported; tests reference the
  // documented on-disk filename directly.
  const MARKER_FILE = '.migration-complete.json';

  function writeMarker(content: string): void {
    fs.mkdirSync(destinations.dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(destinations.dataDir, MARKER_FILE),
      content,
      'utf-8',
    );
  }

  it('treats a corrupt marker as NOT complete so migration re-runs (self-heal #2237)', () => {
    writeMarker('{ this is not valid json');
    expect(isMigrationComplete(destinations)).toBe(false);
  });

  it('treats a marker with no numeric version as NOT complete', () => {
    writeMarker(JSON.stringify({ completedAt: '2025-01-01T00:00:00.000Z' }));
    expect(isMigrationComplete(destinations)).toBe(false);
  });

  it('treats a marker with an older scheme version as NOT complete', () => {
    writeMarker(JSON.stringify({ version: 0 }));
    expect(isMigrationComplete(destinations)).toBe(false);
  });

  it('treats a marker with a newer scheme version as complete', () => {
    writeMarker(JSON.stringify({ version: 999 }));
    expect(isMigrationComplete(destinations)).toBe(true);
  });

  it('does not leave a temp file behind after writing the marker', () => {
    markMigrationComplete(destinations);
    const leftovers = fs
      .readdirSync(destinations.dataDir)
      .filter((name) => name.includes('.tmp'));
    expect(leftovers).toStrictEqual([]);
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
    expect(result.filesCopied).toBe(1);
    expect(
      fs.existsSync(path.join(destinations.configDir, 'settings.json')),
    ).toBe(true);
  });

  // Partial-failure semantics (#2237): if ANY entry cannot be copied the pass
  // must report error:true so runStartupMigration does not stamp the marker —
  // otherwise the failed categories would be permanently stranded. root can
  // read 0o000 dirs, so skip when running as root.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports error:true when an entry cannot be read (does not silently succeed)',
    () => {
      // A readable entry that should still be copied...
      writeFiles(legacyDir, { 'settings.json': '{}' });
      // ...and an unreadable subagents/ dir that will fail to copy.
      const unreadable = path.join(legacyDir, 'subagents');
      fs.mkdirSync(unreadable, { recursive: true });
      fs.writeFileSync(path.join(unreadable, 'a.json'), '{}');
      fs.chmodSync(unreadable, 0o000);

      try {
        const result = performMigration(legacyDir, destinations);

        expect(result.error).toBe(true);
        // A partial failure must NOT be reported as a completed migration,
        // otherwise logMigrationStatus prints success and cli.tsx skips the
        // legacy-dir fallback for the stranded categories.
        expect(result.migrated).toBe(false);
        // The readable entry was still migrated (best-effort copy continues).
        expect(result.filesCopied).toBeGreaterThanOrEqual(1);
        expect(
          fs.existsSync(path.join(destinations.configDir, 'settings.json')),
        ).toBe(true);
      } finally {
        // Restore perms so afterEach cleanup can remove the tree.
        fs.chmodSync(unreadable, 0o755);
      }
    },
  );
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

describe('performMigration — #2237 pre-seeded config dir backfill', () => {
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

  it('backfills subagents/ (and other read-only categories) into a config dir already seeded by the app', () => {
    // App already seeded prompts + profiles into the config dir before
    // migration ran (the exact #2237 trigger).
    writeFiles(destinations.configDir, {
      'prompts/core.md': '# seeded',
      'profiles/seeded.json': '{"seeded": true}',
    });
    // Legacy still holds the read-only categories the app never self-creates.
    writeFiles(legacyDir, {
      'subagents/researcher.json': '{"name": "researcher"}',
      'commands/oc.toml': 'cmd = true',
      'policies/auto.toml': 'policy = true',
      'LLXPRT.md': '# memory',
    });

    const result = performMigration(legacyDir, destinations);

    expect(result.migrated).toBe(true);
    // Backfilled entries now present.
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'subagents/researcher.json'),
        'utf-8',
      ),
    ).toContain('researcher');
    expect(
      fs.existsSync(path.join(destinations.configDir, 'commands/oc.toml')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(destinations.configDir, 'policies/auto.toml')),
    ).toBe(true);
    expect(fs.existsSync(path.join(destinations.configDir, 'LLXPRT.md'))).toBe(
      true,
    );
    // Pre-seeded files left untouched.
    expect(
      fs.readFileSync(
        path.join(destinations.configDir, 'profiles/seeded.json'),
        'utf-8',
      ),
    ).toContain('seeded');
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
      expect(
        fs
          .lstatSync(path.join(destinations.dataDir, 'dirA', 'linkB'))
          .isSymbolicLink(),
      ).toBe(true);
      expect(
        fs
          .lstatSync(path.join(destinations.dataDir, 'dirB', 'linkA'))
          .isSymbolicLink(),
      ).toBe(true);
    });
  },
);
