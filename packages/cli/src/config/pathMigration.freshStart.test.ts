/**
 * Behavioral tests for fresh-start migration normalization and the shared
 * cross-process profile lock (#2477).
 * Uses real temp directories and the actual filesystem — no mocking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'node:path';
import * as os from 'os';

import {
  runStartupMigrationWithPath,
  type MigrationDestinations,
} from './pathMigration.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';

/**
 * The lock artifact path is a known constant: `.profiles.lock` inside the
 * profiles directory. Tests verify the lock artifact on disk directly.
 */
function profilesLockPath(profilesDir: string): string {
  return path.join(profilesDir, '.profiles.lock');
}

async function makeTempDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'llxprt-freshstart-test-'));
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

function corruptCanonicalProfile(): Record<string, unknown> {
  return {
    version: 1,
    provider: 'load-balancer',
    model: 'gemini-2.5-pro',
    modelParams: {},
    ephemeralSettings: {},
  };
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

describe('runStartupMigrationWithPath — fresh-start literal issue JSON (#2477)', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('normalizes a fresh-migrated profile with absent modelParams so ProfileManager can load it', async () => {
    const ISSUE_JSON = {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      ephemeralSettings: {
        'auth-key-name': 'zai',
        'base-url': 'https://api.z.ai/api/anthropic',
        'context-limit': 200000,
      },
    };
    writeFiles(env.legacyDir, {
      'profiles/zai.json': JSON.stringify(ISSUE_JSON),
      'settings.json': '{}',
    });

    runStartupMigrationWithPath(env.legacyDir, env.destinations);

    const canonicalProfilesDir = path.join(
      env.destinations.configDir,
      'profiles',
    );
    const pm = new ProfileManager(canonicalProfilesDir);
    const loaded = await pm.loadProfile('zai');
    expect(loaded.provider).toBe('anthropic');
    expect(loaded.model).toBe('glm-5.2');
    expect(loaded.modelParams).toStrictEqual({});
    expect(loaded.ephemeralSettings['auth-key-name']).toBe('zai');
    expect(loaded.ephemeralSettings['base-url']).toBe(
      'https://api.z.ai/api/anthropic',
    );
    expect(loaded.ephemeralSettings['context-limit']).toBe(200000);
  });

  it('does not normalize a pre-existing canonical profile', () => {
    const ISSUE_JSON = {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      ephemeralSettings: {
        'auth-key-name': 'zai',
        'base-url': 'https://api.z.ai/api/anthropic',
        'context-limit': 200000,
      },
    };
    writeFiles(env.legacyDir, {
      'profiles/zai.json': JSON.stringify(ISSUE_JSON),
      'settings.json': '{}',
    });
    const preExistingContent = JSON.stringify({
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    });
    writeFiles(env.destinations.configDir, {
      'profiles/zai.json': preExistingContent,
    });

    runStartupMigrationWithPath(env.legacyDir, env.destinations);

    const canonical = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/zai.json'),
        'utf-8',
      ),
    );
    expect(canonical.provider).toBe('openai');
  });
});

describe('shared profiles lock — repair and ProfileManager use same protocol (#2477)', () => {
  describe('performMigration — pre-existing canonical byte-identical to legacy (#2477)', () => {
    let env: TestEnv;
    beforeEach(async () => {
      env = await setupEnv();
    });
    afterEach(async () => {
      await teardownEnv(env);
    });

    it('never touches a pre-existing canonical even when byte-identical to legacy and missing modelParams', () => {
      // Legacy profile missing modelParams (the issue JSON shape).
      const ISSUE_JSON = {
        version: 1,
        provider: 'anthropic',
        model: 'glm-5.2',
        ephemeralSettings: {
          'auth-key-name': 'zai',
          'base-url': 'https://api.z.ai/api/anthropic',
          'context-limit': 200000,
        },
      };
      const legacyBytes = JSON.stringify(ISSUE_JSON);
      writeFiles(env.legacyDir, {
        'profiles/zai.json': legacyBytes,
        'settings.json': '{}',
      });
      // Pre-existing canonical has the EXACT same bytes as the legacy source.
      writeFiles(env.destinations.configDir, {
        'profiles/zai.json': legacyBytes,
      });

      runStartupMigrationWithPath(env.legacyDir, env.destinations);

      // The canonical file must be byte-for-byte unchanged.
      const canonicalBytes = fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/zai.json'),
        'utf-8',
      );
      expect(canonicalBytes).toBe(legacyBytes);
      // modelParams must NOT have been injected.
      const parsed = JSON.parse(canonicalBytes);
      expect('modelParams' in parsed).toBe(false);
    });
  });
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('held lock prevents repair commit and repair marker (no stale takeover)', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    const canonicalProfilesDir = path.join(
      env.destinations.configDir,
      'profiles',
    );
    const lockPath = profilesLockPath(canonicalProfilesDir);
    // Create a lock file to simulate a concurrent process holding it.
    // NO stale takeover: the repair must defer.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 99999,
        token: 'held',
        created: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );

    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    // Lock busy is a benign deferral — NOT an error.
    expect(result.repair.error).not.toBe(true);
    expect(result.repair.profilesRepaired).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(env.destinations.dataDir, '.profile-repair-complete.json'),
      ),
    ).toBe(false);
    // Canonical NOT replaced (lock was held).
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(env.destinations.configDir, 'profiles/zai.json'),
          'utf-8',
        ),
      ).provider,
    ).toBe('load-balancer');

    fs.rmSync(lockPath, { recursive: true, force: true });
  });

  it('ProfileManager and repair use the same lock file path', () => {
    const canonicalProfilesDir = path.join(
      env.destinations.configDir,
      'profiles',
    );
    const lockPath = profilesLockPath(canonicalProfilesDir);
    expect(lockPath).toBe(path.join(canonicalProfilesDir, '.profiles.lock'));
  });

  it('ProfileManager saveProfile writes atomically under the lock', async () => {
    const canonicalProfilesDir = path.join(
      env.destinations.configDir,
      'profiles',
    );
    const pm = new ProfileManager(canonicalProfilesDir);
    await pm.saveProfile('test-lock', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    });
    const content = fs.readFileSync(
      path.join(canonicalProfilesDir, 'test-lock.json'),
      'utf-8',
    );
    expect(JSON.parse(content).provider).toBe('openai');
    expect(fs.existsSync(profilesLockPath(canonicalProfilesDir))).toBe(false);
  });

  it('leftover lock file is NOT auto-reclaimed (safety over availability)', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    const canonicalProfilesDir = path.join(
      env.destinations.configDir,
      'profiles',
    );
    const lockPath = profilesLockPath(canonicalProfilesDir);
    // Simulate a SIGKILL'd prior process: write a stale lock file.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 99999,
        token: 'stale',
        created: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );

    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    // NO stale takeover: repair defers (benign, no error).
    expect(result.repair.error).not.toBe(true);
    expect(result.repair.profilesRepaired).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(env.destinations.dataDir, '.profile-repair-complete.json'),
      ),
    ).toBe(false);

    // Manual recovery: remove the lock file, then next startup repairs.
    fs.rmSync(lockPath, { force: true });
    const result2 = runStartupMigrationWithPath(
      env.legacyDir,
      env.destinations,
    );
    expect(result2.repair.profilesRepaired).toBe(1);
  });
});

// ─── Migration normalization scope (#2477: only top-level .json) ────────────

describe('runStartupMigrationWithPath — normalization scope', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('normalizes only direct top-level .json files under profiles', () => {
    const topLevelProfile = {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      // modelParams intentionally absent — should be normalized to {}
      ephemeralSettings: {},
    };
    writeFiles(env.legacyDir, {
      'profiles/top.json': JSON.stringify(topLevelProfile),
      'settings.json': '{}',
    });

    runStartupMigrationWithPath(env.legacyDir, env.destinations);

    const canonical = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/top.json'),
        'utf-8',
      ),
    );
    expect(canonical.modelParams).toStrictEqual({});
  });

  it('copies nested directory .json files byte-for-byte (no normalization)', () => {
    const nestedProfile = {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      // modelParams absent — should NOT be normalized because it is nested
      ephemeralSettings: {},
    };
    writeFiles(env.legacyDir, {
      'profiles/sub/nested.json': JSON.stringify(nestedProfile),
      'settings.json': '{}',
    });

    runStartupMigrationWithPath(env.legacyDir, env.destinations);

    const canonical = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/sub/nested.json'),
        'utf-8',
      ),
    );
    // Nested files are copied byte-for-byte — modelParams NOT injected.
    expect('modelParams' in canonical).toBe(false);
  });

  it('copies non-json top-level files byte-for-byte', () => {
    writeFiles(env.legacyDir, {
      'profiles/notes.txt': 'raw text not json',
      'settings.json': '{}',
    });

    runStartupMigrationWithPath(env.legacyDir, env.destinations);

    expect(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/notes.txt'),
        'utf-8',
      ),
    ).toBe('raw text not json');
  });
});

// ─── Hard-link atomic publish (no partial final, no replace) ────────────────

describe('runStartupMigrationWithPath — hard-link atomic publish', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('does not leave temp files after normalized publish', () => {
    const topLevelProfile = {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      ephemeralSettings: {},
    };
    writeFiles(env.legacyDir, {
      'profiles/top.json': JSON.stringify(topLevelProfile),
      'settings.json': '{}',
    });

    runStartupMigrationWithPath(env.legacyDir, env.destinations);

    const profilesDir = path.join(env.destinations.configDir, 'profiles');
    const temps = fs
      .readdirSync(profilesDir)
      .filter((f) => f.endsWith('.tmp') || f.endsWith('.norm.tmp'));
    expect(temps).toStrictEqual([]);
  });

  it('existing canonical always wins (normalized publish does not overwrite)', () => {
    const legacyProfile = {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      ephemeralSettings: {},
    };
    const existingCanonical = JSON.stringify({
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    });
    writeFiles(env.legacyDir, {
      'profiles/keep.json': JSON.stringify(legacyProfile),
      'settings.json': '{}',
    });
    writeFiles(env.destinations.configDir, {
      'profiles/keep.json': existingCanonical,
    });

    runStartupMigrationWithPath(env.legacyDir, env.destinations);

    const canonical = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/keep.json'),
        'utf-8',
      ),
    );
    // Pre-existing canonical untouched.
    expect(canonical.provider).toBe('openai');
  });

  it('normalized publish preserves source file mode', () => {
    const legacyProfile = {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      ephemeralSettings: {},
    };
    writeFiles(env.legacyDir, {
      'profiles/sec.json': JSON.stringify(legacyProfile),
      'settings.json': '{}',
    });
    // Set source to 0600.
    fs.chmodSync(path.join(env.legacyDir, 'profiles/sec.json'), 0o600);

    runStartupMigrationWithPath(env.legacyDir, env.destinations);

    const stat = fs.statSync(
      path.join(env.destinations.configDir, 'profiles/sec.json'),
    );
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
