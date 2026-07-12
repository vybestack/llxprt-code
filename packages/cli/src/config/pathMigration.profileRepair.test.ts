/**
 * Behavioral TDD tests for the corrupt profile repair pass (#2477).
 * Uses real temp directories and the actual filesystem — no mocking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'node:path';
import * as os from 'os';

import {
  isMigrationComplete,
  repairProfiles,
  runStartupMigrationWithPath,
  type MigrationDestinations,
} from './pathMigration.js';
import {
  parseProfile,
  isLoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';

async function makeTempDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'llxprt-repair-test-'));
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

function readProfile(
  dir: string,
  name: string,
): ReturnType<typeof parseProfile> {
  return parseProfile(
    JSON.parse(fs.readFileSync(path.join(dir, 'profiles', name), 'utf-8')),
  );
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

function genuineLbProfile(): Record<string, unknown> {
  return {
    version: 1,
    type: 'loadbalancer',
    policy: 'roundrobin',
    profiles: ['p1'],
    provider: 'load-balancer',
    model: 'default',
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

describe('repairProfiles — corrupt profile repair (#2477)', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('repairs a corrupt canonical zai profile when a valid legacy exists', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    repairProfiles(env.legacyDir, env.destinations);
    const repaired = readProfile(env.destinations.configDir, 'zai.json');
    expect(repaired.provider).toBe('anthropic');
    expect(repaired.model).toBe('glm-5.2');
    expect(repaired.ephemeralSettings['base-url']).toBe(
      'https://api.z.ai/api/anthropic',
    );
    expect(repaired.ephemeralSettings['auth-key-name']).toBe('zai');
  });

  it('repairs at most one candidate per call (sorted by name)', () => {
    writeFiles(env.destinations.configDir, {
      'profiles/aaa.json': JSON.stringify(corruptCanonicalProfile()),
      'profiles/zzz.json': JSON.stringify(corruptCanonicalProfile()),
    });
    writeFiles(env.legacyDir, {
      'profiles/aaa.json': JSON.stringify(validLegacyProfile()),
      'profiles/zzz.json': JSON.stringify(validLegacyProfile()),
      'settings.json': '{}',
    });

    const first = repairProfiles(env.legacyDir, env.destinations);
    expect(first.profilesRepaired).toBe(1);
    // aaa sorted before zzz — repaired first.
    expect(readProfile(env.destinations.configDir, 'aaa.json').provider).toBe(
      'anthropic',
    );
    expect(readProfile(env.destinations.configDir, 'zzz.json').provider).toBe(
      'load-balancer',
    );

    const second = repairProfiles(env.legacyDir, env.destinations);
    expect(second.profilesRepaired).toBe(1);
    expect(readProfile(env.destinations.configDir, 'zzz.json').provider).toBe(
      'anthropic',
    );

    const third = repairProfiles(env.legacyDir, env.destinations);
    expect(third.profilesRepaired).toBeUndefined();
  });

  it('reports profilesRepaired as undefined when no profiles are repaired', () => {
    writeFiles(env.destinations.configDir, {
      'profiles/zai.json': JSON.stringify(corruptCanonicalProfile()),
    });
    writeFiles(env.legacyDir, { 'settings.json': '{}' });
    const result = repairProfiles(env.legacyDir, env.destinations);
    expect(result.profilesRepaired).toBeUndefined();
  });

  it('does not modify the legacy profile file during repair', () => {
    const legacyData = JSON.stringify(validLegacyProfile());
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    fs.writeFileSync(path.join(env.legacyDir, 'profiles/zai.json'), legacyData);
    repairProfiles(env.legacyDir, env.destinations);
    expect(
      fs.readFileSync(path.join(env.legacyDir, 'profiles/zai.json'), 'utf-8'),
    ).toBe(legacyData);
  });

  it('preserves the corrupt canonical file as a quarantine backup', () => {
    const corruptData = JSON.stringify(corruptCanonicalProfile());
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    repairProfiles(env.legacyDir, env.destinations);
    const profilesDir = path.join(env.destinations.configDir, 'profiles');
    const backups = fs
      .readdirSync(profilesDir)
      .filter((f) => f.endsWith('.pre-repair.bak'));
    expect(backups).toStrictEqual(['zai.json.pre-repair.bak']);
    expect(fs.readFileSync(path.join(profilesDir, backups[0]), 'utf-8')).toBe(
      corruptData,
    );
  });

  it('does not overwrite an existing backup (COPYFILE_EXCL collision-safe)', () => {
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

  it('repair backup is a copy, not a rename — canonical is replaced atomically', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    repairProfiles(env.legacyDir, env.destinations);
    const profilesDir = path.join(env.destinations.configDir, 'profiles');
    const canonical = readProfile(env.destinations.configDir, 'zai.json');
    expect(canonical.provider).toBe('anthropic');
    expect(
      fs.readdirSync(profilesDir).filter((f) => f.endsWith('.pre-repair.bak')),
    ).toHaveLength(1);
    expect(
      fs.readdirSync(profilesDir).filter((f) => f.endsWith('.tmp')),
    ).toStrictEqual([]);
  });

  it('does not overwrite a valid canonical profile even if legacy is richer', () => {
    const canonicalProfile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: { 'context-limit': 100000 },
    };
    writeFiles(env.destinations.configDir, {
      'profiles/myprof.json': JSON.stringify(canonicalProfile),
    });
    writeFiles(env.legacyDir, {
      'profiles/myprof.json': JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'context-limit': 100000,
          'base-url': 'https://old.example.com',
          'auth-key-name': 'old-key',
        },
      }),
      'settings.json': '{}',
    });
    repairProfiles(env.legacyDir, env.destinations);
    const after = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/myprof.json'),
        'utf-8',
      ),
    );
    // Deep-equal the entire profile against the original canonical to verify
    // no legacy fields (base-url, auth-key-name) were merged in.
    expect(after).toStrictEqual(canonicalProfile);
    const profilesDir = path.join(env.destinations.configDir, 'profiles');
    expect(
      fs
        .readdirSync(profilesDir)
        .filter((f) => f.includes('myprof') && f.endsWith('.bak')),
    ).toHaveLength(0);
  });

  it('does not overwrite a genuine loadbalancer canonical profile', () => {
    setupRepairCase(env, genuineLbProfile(), validLegacyProfile());
    repairProfiles(env.legacyDir, env.destinations);
    expect(
      isLoadBalancerProfile(
        readProfile(env.destinations.configDir, 'zai.json'),
      ),
    ).toBe(true);
  });

  it('does not replace corrupt canonical when legacy is missing', () => {
    writeFiles(env.destinations.configDir, {
      'profiles/zai.json': JSON.stringify(corruptCanonicalProfile()),
    });
    writeFiles(env.legacyDir, { 'settings.json': '{}' });
    repairProfiles(env.legacyDir, env.destinations);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(env.destinations.configDir, 'profiles/zai.json'),
          'utf-8',
        ),
      ).provider,
    ).toBe('load-balancer');
  });

  it('does not replace corrupt canonical when legacy is malformed JSON', () => {
    writeFiles(env.destinations.configDir, {
      'profiles/zai.json': JSON.stringify(corruptCanonicalProfile()),
    });
    writeFiles(env.legacyDir, {
      'profiles/zai.json': '{ this is not valid json',
      'settings.json': '{}',
    });
    repairProfiles(env.legacyDir, env.destinations);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(env.destinations.configDir, 'profiles/zai.json'),
          'utf-8',
        ),
      ).provider,
    ).toBe('load-balancer');
  });

  it('does not replace corrupt canonical when legacy is a loadbalancer profile', () => {
    const corrupt = corruptCanonicalProfile();
    setupRepairCase(env, corrupt, genuineLbProfile());
    repairProfiles(env.legacyDir, env.destinations);
    const after = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/zai.json'),
        'utf-8',
      ),
    );
    // Deep-equal against the original corrupt canonical to verify NO fields
    // were modified — not just a single field that happens to be undefined.
    expect(after).toStrictEqual(corrupt);
  });

  it('does not replace corrupt canonical when legacy is not a valid profile', () => {
    setupRepairCase(env, corruptCanonicalProfile(), {
      random: 'data',
    });
    repairProfiles(env.legacyDir, env.destinations);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(env.destinations.configDir, 'profiles/zai.json'),
          'utf-8',
        ),
      ).provider,
    ).toBe('load-balancer');
  });

  it('repairs a corrupt profile with an arbitrary fallback model (structural signature is model-agnostic)', () => {
    // The corruption signature is structural — it does NOT depend on a
    // specific model value. Any untyped v1 profile with provider
    // 'load-balancer', empty modelParams, and empty ephemeralSettings is
    // corrupt regardless of whether the fallback model is custom.
    writeFiles(env.destinations.configDir, {
      'profiles/custom.json': JSON.stringify({
        version: 1,
        provider: 'load-balancer',
        model: 'my-custom-model',
        modelParams: {},
        ephemeralSettings: {},
      }),
    });
    writeFiles(env.legacyDir, {
      'profiles/custom.json': JSON.stringify(validLegacyProfile()),
      'settings.json': '{}',
    });
    const result = repairProfiles(env.legacyDir, env.destinations);
    expect(result.profilesRepaired).toBe(1);
    const after = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/custom.json'),
        'utf-8',
      ),
    );
    expect(after.model).toBe('glm-5.2');
    expect(after.provider).toBe('anthropic');
  });

  it('repairs a corrupt profile with a default fallback model (structural signature is model-agnostic)', () => {
    writeFiles(env.destinations.configDir, {
      'profiles/manual.json': JSON.stringify({
        version: 1,
        provider: 'load-balancer',
        model: 'default',
        modelParams: {},
        ephemeralSettings: {},
      }),
    });
    writeFiles(env.legacyDir, {
      'profiles/manual.json': JSON.stringify(validLegacyProfile()),
      'settings.json': '{}',
    });
    const result = repairProfiles(env.legacyDir, env.destinations);
    expect(result.profilesRepaired).toBe(1);
    const after = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/manual.json'),
        'utf-8',
      ),
    );
    expect(after.model).toBe('glm-5.2');
    expect(after.provider).toBe('anthropic');
  });
});

// ─── Exact issue payload (#2477: modelParams omitted) ───────────────────────

describe('repairProfiles — exact issue JSON (modelParams omitted)', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('normalizes a legacy profile with absent modelParams to modelParams: {} and repairs', () => {
    const ISSUE_LEGACY_PROFILE = {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      ephemeralSettings: {
        'base-url': 'https://api.z.ai/api/anthropic',
        'auth-key-name': 'zai',
        'context-limit': 200000,
      },
    };
    setupRepairCase(env, corruptCanonicalProfile(), ISSUE_LEGACY_PROFILE);
    repairProfiles(env.legacyDir, env.destinations);
    const repaired = JSON.parse(
      fs.readFileSync(
        path.join(env.destinations.configDir, 'profiles/zai.json'),
        'utf-8',
      ),
    );
    expect(repaired.provider).toBe('anthropic');
    expect(repaired.model).toBe('glm-5.2');
    expect(repaired.modelParams).toStrictEqual({});
    expect(repaired.ephemeralSettings['base-url']).toBe(
      'https://api.z.ai/api/anthropic',
    );
    expect(repaired.ephemeralSettings['context-limit']).toBe(200000);
  });

  it('preserves existing modelParams when present in the legacy profile', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    repairProfiles(env.legacyDir, env.destinations);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(env.destinations.configDir, 'profiles/zai.json'),
          'utf-8',
        ),
      ).modelParams,
    ).toStrictEqual({ temperature: 1 });
  });

  it('still rejects a legacy profile that is missing other core fields', () => {
    setupRepairCase(env, corruptCanonicalProfile(), {
      version: 1,
      provider: 'anthropic',
      ephemeralSettings: {},
    });
    repairProfiles(env.legacyDir, env.destinations);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(env.destinations.configDir, 'profiles/zai.json'),
          'utf-8',
        ),
      ).provider,
    ).toBe('load-balancer');
  });

  it('still rejects a legacy profile with invalid ephemeralSettings', () => {
    setupRepairCase(env, corruptCanonicalProfile(), {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      ephemeralSettings: 'not-an-object',
    });
    repairProfiles(env.legacyDir, env.destinations);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(env.destinations.configDir, 'profiles/zai.json'),
          'utf-8',
        ),
      ).provider,
    ).toBe('load-balancer');
  });
});

// ─── Startup orchestration ──────────────────────────────────────────────────

describe('runStartupMigrationWithPath — marker orchestration', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('runs repair even when path migration v1 is complete, without recopying legacy', () => {
    fs.mkdirSync(env.destinations.dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(env.destinations.dataDir, '.migration-complete.json'),
      JSON.stringify({ version: 1 }),
    );
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    expect(result.migration.migrated).toBe(false);
    expect(isMigrationComplete(env.destinations)).toBe(true);
    expect(result.repair.profilesRepaired).toBe(1);
    expect(readProfile(env.destinations.configDir, 'zai.json').provider).toBe(
      'anthropic',
    );
  });

  it('writes a separate repair marker after successful repair', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    runStartupMigrationWithPath(env.legacyDir, env.destinations);
    expect(
      fs.existsSync(
        path.join(env.destinations.dataDir, '.profile-repair-complete.json'),
      ),
    ).toBe(true);
  });

  it('does not recopy a deliberately deleted canonical legacy-backed file into a corrupt state', () => {
    writeFiles(env.destinations.configDir, {});
    writeFiles(env.legacyDir, {
      'profiles/zai.json': JSON.stringify(validLegacyProfile()),
      'settings.json': '{}',
    });
    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    expect(result.migration.error).not.toBe(true);
    expect(readProfile(env.destinations.configDir, 'zai.json').provider).toBe(
      'anthropic',
    );
    expect(result.repair.profilesRepaired).toBeUndefined();
  });

  it('second run does nothing (both markers present)', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    const first = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    expect(first.repair.profilesRepaired).toBe(1);
    const second = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    expect(second.migration.migrated).toBe(false);
    expect(second.repair.migrated).toBe(false);
    expect(second.repair.profilesRepaired).toBeUndefined();
    const profilesDir = path.join(env.destinations.configDir, 'profiles');
    expect(
      fs.readdirSync(profilesDir).filter((f) => f.endsWith('.pre-repair.bak')),
    ).toHaveLength(1);
  });

  it('on repair I/O failure, no repair marker is written', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    const profilesPath = path.join(env.destinations.configDir, 'profiles');
    fs.rmSync(profilesPath, { recursive: true, force: true });
    fs.writeFileSync(profilesPath, 'not a directory');
    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    expect(result.repair.error).toBe(true);
    expect(
      fs.existsSync(
        path.join(env.destinations.dataDir, '.profile-repair-complete.json'),
      ),
    ).toBe(false);
  });

  it('lock busy: benign deferral, no marker, no error (#3)', () => {
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    const lockPath = path.join(
      env.destinations.configDir,
      'profiles',
      '.profiles.lock',
    );
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 99999,
        token: 'busy',
        created: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );

    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    // Lock busy is NOT an error — benign deferral.
    expect(result.repair.error).not.toBe(true);
    expect(result.repair.profilesRepaired).toBeUndefined();
    // NO marker written — next startup retries.
    expect(
      fs.existsSync(
        path.join(env.destinations.dataDir, '.profile-repair-complete.json'),
      ),
    ).toBe(false);

    // Manual recovery + retry.
    fs.rmSync(lockPath, { force: true });
    const result2 = runStartupMigrationWithPath(
      env.legacyDir,
      env.destinations,
    );
    expect(result2.repair.profilesRepaired).toBe(1);
  });

  it('marker semantics: no marker when no candidates found (#4)', () => {
    // Initial: no corrupt profiles, no candidates.
    writeFiles(env.destinations.configDir, {
      'profiles/good.json': JSON.stringify(validLegacyProfile()),
    });
    writeFiles(env.legacyDir, {
      'profiles/good.json': JSON.stringify(validLegacyProfile()),
      'settings.json': '{}',
    });

    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    expect(result.repair.profilesRepaired).toBeUndefined();
    // NO marker — later appearance not suppressed.
    expect(
      fs.existsSync(
        path.join(env.destinations.dataDir, '.profile-repair-complete.json'),
      ),
    ).toBe(false);

    // Later: affected canonical + legacy appears.
    writeFiles(env.destinations.configDir, {
      'profiles/zai.json': JSON.stringify(corruptCanonicalProfile()),
    });
    writeFiles(env.legacyDir, {
      'profiles/zai.json': JSON.stringify(validLegacyProfile()),
    });

    // Next startup repairs (marker not suppressed).
    const result2 = runStartupMigrationWithPath(
      env.legacyDir,
      env.destinations,
    );
    expect(result2.repair.profilesRepaired).toBe(1);
    expect(
      fs.existsSync(
        path.join(env.destinations.dataDir, '.profile-repair-complete.json'),
      ),
    ).toBe(true);
  });

  it('normal migration marker behavior: repair marker NOT written when no repair performed (#4)', () => {
    writeFiles(env.legacyDir, { 'settings.json': '{"theme": "dark"}' });
    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    expect(result.migration.migrated).toBe(true);
    expect(isMigrationComplete(env.destinations)).toBe(true);
    // No repair marker — no actual repair happened (directive #4).
    expect(
      fs.existsSync(
        path.join(env.destinations.dataDir, '.profile-repair-complete.json'),
      ),
    ).toBe(false);
  });
});

// ─── Logging ────────────────────────────────────────────────────────────────

describe('runStartupMigrationWithPath — logging', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('logs profiles repaired count when repair-only success', () => {
    fs.mkdirSync(env.destinations.dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(env.destinations.dataDir, '.migration-complete.json'),
      JSON.stringify({ version: 1 }),
    );
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
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
    } finally {
      spy.mockRestore();
    }
    const repairLog = writes.find((w) => w.includes('Repaired'));
    expect(repairLog).toBeDefined();
    expect(repairLog).toContain('1 profile');
    expect(writes.find((w) => w.includes('files copied'))).toBeUndefined();
  });

  it('a successful repair never carries the error flag', () => {
    fs.mkdirSync(env.destinations.dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(env.destinations.dataDir, '.migration-complete.json'),
      JSON.stringify({ version: 1 }),
    );
    setupRepairCase(env, corruptCanonicalProfile(), validLegacyProfile());
    const result = runStartupMigrationWithPath(env.legacyDir, env.destinations);
    // A successful repair must be migrated:true with NO error flag — never
    // the contradictory { migrated: true, error: true } state.
    expect(result.repair.profilesRepaired).toBe(1);
    expect(result.repair.migrated).toBe(true);
    expect(result.repair.error).not.toBe(true);
  });
});

// ─── Startup orchestration with space-containing paths ─────────────────────
// Proves only that the fs orchestration handles paths with spaces correctly.
// Does NOT reproduce or claim to fix any specific shell/open-path issue.

describe('runStartupMigrationWithPath — space-containing destination paths', () => {
  let legacyDir: string;
  let testRoot: string;

  beforeEach(async () => {
    legacyDir = await makeTempDir();
    testRoot = await makeTempDir();
  });

  afterEach(async () => {
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
    await fs.promises.rm(testRoot, { recursive: true, force: true });
  });

  it('migrates files successfully when all destination paths contain spaces', () => {
    const spaceBase = path.join(
      testRoot,
      'space dir',
      'Library',
      'Application Support',
    );
    fs.mkdirSync(spaceBase, { recursive: true });
    const spaceDest: MigrationDestinations = {
      configDir: path.join(spaceBase, 'My Config'),
      dataDir: path.join(spaceBase, 'My Data'),
      cacheDir: path.join(spaceBase, 'My Cache'),
      logDir: path.join(spaceBase, 'My Logs'),
    };
    writeFiles(legacyDir, {
      'profiles/zai.json':
        '{"version":1,"provider":"anthropic","model":"m","modelParams":{},"ephemeralSettings":{}}',
      'settings.json': '{}',
    });
    const result = runStartupMigrationWithPath(legacyDir, spaceDest);
    expect(result.migration.migrated).toBe(true);
    expect(result.migration.error).not.toBe(true);
    expect(
      fs.readFileSync(
        path.join(spaceDest.configDir, 'profiles/zai.json'),
        'utf-8',
      ),
    ).toContain('anthropic');
    expect(
      fs.existsSync(path.join(spaceDest.dataDir, '.migration-complete.json')),
    ).toBe(true);
    // No repair marker — no actual repair happened (directive #4).
    expect(
      fs.existsSync(
        path.join(spaceDest.dataDir, '.profile-repair-complete.json'),
      ),
    ).toBe(false);
  });
});
