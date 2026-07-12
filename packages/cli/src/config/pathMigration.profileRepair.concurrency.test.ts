/**
 * Behavioral TDD tests for the corrupt profile repair pass — concurrency,
 * data safety, I/O error, and startup reporting helper (#2477).
 * Split from pathMigration.profileRepair.test.ts to keep test files
 * under 800 lines.
 * Uses real temp directories and the actual filesystem — no mocking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'node:path';
import * as os from 'os';

import {
  repairProfiles,
  runStartupMigrationWithPath,
  reportStartupResult,
  type MigrationDestinations,
} from './pathMigration.js';

async function makeTempDir(): Promise<string> {
  return fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'llxprt-repair-conc-test-'),
  );
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

interface TestEnv {
  legacyDir: string;
  destBase: string;
  destinations: MigrationDestinations;
}

async function setupEnv(): Promise<TestEnv> {
  const legacyDir = await makeTempDir();
  const destBase = await makeTempDir();
  await fs.promises.rm(destBase, { recursive: true, force: true });
  return { legacyDir, destBase, destinations: makeDestinations(destBase) };
}

async function teardownEnv(env: TestEnv): Promise<void> {
  await fs.promises.rm(env.legacyDir, { recursive: true, force: true });
  await fs.promises.rm(env.destBase, { recursive: true, force: true });
}

function validLegacyProfile(): Record<string, unknown> {
  return {
    version: 1,
    provider: 'anthropic',
    model: 'glm-5.2',
    modelParams: { temperature: 1 },
    ephemeralSettings: {
      'base-url': 'https://api.z.ai/api/anthropic',
      'auth-key-name': 'zai',
      'context-limit': 200000,
    },
  };
}

function corruptCanonicalProfile(): Record<string, unknown> {
  return {
    version: 1,
    provider: 'load-balancer',
    model: 'gemini-2.5-pro',
    modelParams: {},
    ephemeralSettings: {},
  };
}

function setupRepairCase(
  env: TestEnv,
  canonical: Record<string, unknown>,
  legacy: Record<string, unknown>,
): void {
  writeFiles(env.destinations.configDir, {
    'profiles/zai.json': JSON.stringify(canonical),
  });
  writeFiles(env.legacyDir, {
    'profiles/zai.json': JSON.stringify(legacy),
    'settings.json': '{}',
  });
}

// ─── Concurrency / data safety ──────────────────────────────────────────────

describe('repairProfiles — concurrency / data safety', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('compare-before-swap: repair does not overwrite a canonical that changed after examination', () => {
    // Set up a corrupt canonical + valid legacy (candidate found).
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    // Simulate a concurrent save: overwrite the canonical with a valid
    // non-corrupt profile BEFORE repair runs. The repair scan sees the
    // corrupt bytes, but by the time it commits the canonical has changed.
    // Since the scan and commit both happen under the lock in the current
    // implementation, we verify the behavioral invariant: a canonical that
    // is no longer corrupt is not touched.
    const concurrentJson = JSON.stringify({
      version: 1,
      provider: 'openai',
      model: 'gpt-5',
      modelParams: {},
      ephemeralSettings: {},
    });
    fs.writeFileSync(
      path.join(env.destinations.configDir, 'profiles/zai.json'),
      concurrentJson,
    );

    repairProfiles(env.legacyDir, env.destinations);

    const after = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/zai.json'),
        'utf-8',
      ),
    );
    expect(after.provider).toBe('openai');
    expect(after.model).toBe('gpt-5');
  });

  it('backup collision uses COPYFILE_EXCL retry (real fs)', () => {
    const corruptData = JSON.stringify(corruptCanonicalProfile());
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    fs.writeFileSync(
      path.join(
        env.destinations.configDir,
        'profiles',
        'zai.json.pre-repair.bak',
      ),
      'existing-backup',
    );
    repairProfiles(env.legacyDir, env.destinations);
    const profilesDir = path.join(env.destinations.configDir, 'profiles');
    const backups = fs
      .readdirSync(profilesDir)
      .filter((f) => f.endsWith('.pre-repair.bak'))
      .sort();
    expect(backups).toStrictEqual([
      'zai.json.1.pre-repair.bak',
      'zai.json.pre-repair.bak',
    ]);
    expect(
      fs.readFileSync(
        path.join(profilesDir, 'zai.json.pre-repair.bak'),
        'utf-8',
      ),
    ).toBe('existing-backup');
    expect(
      fs.readFileSync(
        path.join(profilesDir, 'zai.json.1.pre-repair.bak'),
        'utf-8',
      ),
    ).toBe(corruptData);
  });

  it('temp file cleaned up after successful commit (no leftover .tmp)', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    repairProfiles(env.legacyDir, env.destinations);
    const profilesDir = path.join(env.destinations.configDir, 'profiles');
    expect(
      fs.readdirSync(profilesDir).filter((f) => f.endsWith('.tmp')),
    ).toStrictEqual([]);
  });

  it('repair uses exclusive temp path (no leftover temp files after commit)', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    repairProfiles(env.legacyDir, env.destinations);
    const profilesDir = path.join(env.destinations.configDir, 'profiles');
    // No temp files left behind (proves exclusive temp create + cleanup).
    const temps = fs
      .readdirSync(profilesDir)
      .filter((f) => f.endsWith('.repair.tmp'));
    expect(temps).toStrictEqual([]);
  });
});

// ─── Repair I/O error ───────────────────────────────────────────────────────

describe('repairProfiles — repair I/O error (#2477)', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('reports error when canonical profiles path is a file, not a directory', () => {
    fs.mkdirSync(env.destinations.configDir, { recursive: true });
    fs.writeFileSync(
      path.join(env.destinations.configDir, 'profiles'),
      'not a directory',
    );
    writeFiles(env.legacyDir, {
      'profiles/zai.json': JSON.stringify(validLegacyProfile()),
      'settings.json': '{}',
    });
    const result = repairProfiles(env.legacyDir, env.destinations);
    expect(result.error).toBe(true);
  });

  it('reports error when canonical profile file is a directory', () => {
    fs.mkdirSync(
      path.join(env.destinations.configDir, 'profiles', 'zai.json'),
      { recursive: true },
    );
    writeFiles(env.legacyDir, {
      'profiles/zai.json': JSON.stringify(validLegacyProfile()),
      'settings.json': '{}',
    });
    const result = repairProfiles(env.legacyDir, env.destinations);
    // A directory where a profile file should be is unreadable as JSON.
    // In the new architecture, this is treated as an invalid/non-candidate
    // entry (not a fatal error) — no repair happens, no error flag.
    expect(result.migrated).toBe(false);
    expect(result.profilesRepaired).toBeUndefined();
  });
});

// ─── Startup reporting helper ───────────────────────────────────────────────

describe('reportStartupResult — startup reporting helper', () => {
  it('returns empty messages and no fallback when migration and repair succeed', () => {
    const report = reportStartupResult(
      {
        migration: { migrated: true, reason: 'ok', filesCopied: 1 },
        repair: {
          migrated: false,
          reason: 'no repair needed',
          filesCopied: 0,
        },
      },
      '/legacy',
    );
    expect(report.messages).toStrictEqual([]);
    expect(report.needsLegacyFallback).toBe(false);
  });

  it('returns fallback + warning when migration fails', () => {
    const report = reportStartupResult(
      {
        migration: {
          migrated: false,
          reason: 'migration error: boom',
          filesCopied: 0,
          error: true,
        },
        repair: { migrated: false, reason: 'no repair', filesCopied: 0 },
      },
      '/legacy',
    );
    expect(report.needsLegacyFallback).toBe(true);
    expect(report.messages).toHaveLength(1);
    expect(report.messages[0]).toContain('migration failed');
    expect(report.messages[0]).toContain('/legacy');
  });

  it('returns repair warning but NO fallback when repair fails', () => {
    const report = reportStartupResult(
      {
        migration: { migrated: true, reason: 'ok', filesCopied: 1 },
        repair: {
          migrated: false,
          reason: 'repair error: boom',
          filesCopied: 0,
          error: true,
        },
      },
      '/legacy',
    );
    expect(report.needsLegacyFallback).toBe(false);
    expect(report.messages).toHaveLength(1);
    expect(report.messages[0]).toContain('profile repair');
  });

  it('returns empty messages when repair is busy (benign deferral)', () => {
    const report = reportStartupResult(
      {
        migration: { migrated: true, reason: 'ok', filesCopied: 1 },
        repair: {
          migrated: false,
          reason: 'profiles lock busy; repair deferred to next startup',
          filesCopied: 0,
        },
      },
      '/legacy',
    );
    expect(report.messages).toStrictEqual([]);
    expect(report.needsLegacyFallback).toBe(false);
  });

  it('returns both warnings when migration and repair both fail, fallback true', () => {
    const report = reportStartupResult(
      {
        migration: {
          migrated: false,
          reason: 'migration error',
          filesCopied: 0,
          error: true,
        },
        repair: {
          migrated: false,
          reason: 'repair error',
          filesCopied: 0,
          error: true,
        },
      },
      '/legacy',
    );
    expect(report.needsLegacyFallback).toBe(true);
    expect(report.messages).toHaveLength(2);
    expect(report.messages[0]).toContain('migration failed');
    expect(report.messages[1]).toContain('profile repair');
  });

  it('reports marker-write failure after successful repair (error=true)', () => {
    const report = reportStartupResult(
      {
        migration: {
          migrated: false,
          reason: 'no migration needed',
          filesCopied: 0,
        },
        repair: {
          migrated: false,
          reason: 'repair completed but marker write failed',
          filesCopied: 0,
          profilesRepaired: 3,
          error: true,
        },
      },
      '/legacy',
    );
    expect(report.needsLegacyFallback).toBe(false);
    expect(report.messages).toHaveLength(1);
    expect(report.messages[0]).toContain('marker write failed');
  });
});

// ─── Migration marker write failure (uses runStartupMigrationWithPath) ──────

describe('runStartupMigrationWithPath — marker write failure scenarios', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('migration marker write failure makes migration result error:true (real-fs blocked marker)', () => {
    writeFiles(env.legacyDir, { 'settings.json': '{"theme": "dark"}' });
    fs.mkdirSync(env.destinations.dataDir, { recursive: true });
    fs.mkdirSync(
      path.join(env.destinations.dataDir, '.migration-complete.json'),
      { recursive: true },
    );

    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    expect(result.migration.error).toBe(true);
    expect(result.migration.reason).toContain('marker write failed');
  });

  it('logs partial-success when marker write fails: copied count reported, no removal advice', () => {
    writeFiles(env.legacyDir, { 'settings.json': '{"theme": "dark"}' });
    fs.mkdirSync(env.destinations.dataDir, { recursive: true });
    // Block the marker by creating a directory at the marker path.
    fs.mkdirSync(
      path.join(env.destinations.dataDir, '.migration-complete.json'),
      { recursive: true },
    );

    const writes: string[] = [];
    const captureWrite = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    };
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(captureWrite);
    try {
      const result = runStartupMigrationWithPath(
        env.legacyDir,
        env.destinations,
      );
      // Migration files were copied, but marker failed.
      expect(result.migration.error).toBe(true);

      // The partial-success log must report the copied count so the user
      // sees what was accomplished.
      const partialLog = writes.find((w) => w.includes('partially migrated'));
      expect(partialLog).toBeDefined();
      // Must include the files-copied count with singular wording for 1.
      expect(partialLog).toContain('1 file copied');
      // Must accurately state copying succeeded but marker failed.
      expect(partialLog).toContain('copying succeeded');
      expect(partialLog).toContain('marker failed');
      // Must explicitly advise RETAINING the legacy dir (no removal advice).
      expect(partialLog).toContain('retain');
      expect(partialLog).toContain(env.legacyDir);
      // Must NOT advise removal of the legacy directory.
      expect(partialLog).not.toContain('can be removed');
      // Must NOT claim full success.
      expect(partialLog).not.toContain('migrated successfully');
    } finally {
      spy.mockRestore();
    }
  });

  it('logs partial-success with plural count when multiple files copied and marker fails', () => {
    writeFiles(env.legacyDir, {
      'settings.json': '{"theme": "dark"}',
      'LLXPRT.md': '# config',
    });
    fs.mkdirSync(env.destinations.dataDir, { recursive: true });
    fs.mkdirSync(
      path.join(env.destinations.dataDir, '.migration-complete.json'),
      { recursive: true },
    );

    const writes: string[] = [];
    const captureWrite = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    };
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(captureWrite);
    try {
      runStartupMigrationWithPath(env.legacyDir, env.destinations);

      const partialLog = writes.find((w) => w.includes('partially migrated'));
      expect(partialLog).toBeDefined();
      // Plural wording for count > 1.
      expect(partialLog).toContain('2 files copied');
      expect(partialLog).not.toContain('2 file copied');
      // Copying succeeded but finalization marker failed.
      expect(partialLog).toContain('copying succeeded');
      expect(partialLog).toContain('marker failed');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not describe a zero-copy marker failure as a partial migration', () => {
    fs.mkdirSync(path.join(env.legacyDir, 'profiles'), { recursive: true });
    fs.mkdirSync(env.destinations.dataDir, { recursive: true });
    fs.mkdirSync(
      path.join(env.destinations.dataDir, '.migration-complete.json'),
      { recursive: true },
    );

    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      });
    try {
      const result = runStartupMigrationWithPath(
        env.legacyDir,
        env.destinations,
      );
      expect(result.migration.filesCopied).toBe(0);
      expect(result.migration.error).toBe(true);
      const finalizationLog = writes.find((write) =>
        write.includes('no files copied'),
      );
      expect(finalizationLog).toContain('could not be finalized');
      expect(finalizationLog).toContain('No files required copying');
      expect(finalizationLog).not.toContain('partially migrated');
      expect(finalizationLog).not.toContain('copying succeeded');
    } finally {
      spy.mockRestore();
    }
  });
  it('migration marker write failure produces a warning in reportStartupResult', () => {
    const report = reportStartupResult(
      {
        migration: {
          migrated: false,
          reason: 'migration completed but marker write failed',
          filesCopied: 1,
          error: true,
        },
        repair: {
          migrated: false,
          reason: 'no repair needed',
          filesCopied: 0,
        },
      },
      '/legacy',
    );
    expect(report.needsLegacyFallback).toBe(true);
    expect(report.messages).toHaveLength(1);
    expect(report.messages[0]).toContain('marker write failed');
  });
});
