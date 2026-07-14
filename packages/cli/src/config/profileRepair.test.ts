/**
 * Behavioral tests for the CLI profileRepair thin orchestrator.
 *
 * Uses real temp directories and the actual filesystem — no mocking.
 * Verifies the translation layer from CanonicalRepairOutcome to
 * MigrationResult, including error-message sanitization (#1).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { repairProfiles } from './profileRepair.js';
import type { MigrationDestinations } from './migrationTypes.js';
import { CORRUPT_PROVIDER } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-core';

async function makeTempDir(): Promise<string> {
  return fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'llxprt-profile-repair-cli-test-'),
  );
}

function makeDestinations(base: string): MigrationDestinations {
  return {
    configDir: path.join(base, 'config'),
    dataDir: path.join(base, 'data'),
    cacheDir: path.join(base, 'cache'),
    logDir: path.join(base, 'log'),
  };
}

function writeProfile(dir: string, name: string, data: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}

function corruptCanonicalProfile(): Record<string, unknown> {
  return {
    version: 1,
    provider: CORRUPT_PROVIDER,
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

describe('repairProfiles — outcome translation', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('translates a successful repair to migrated:true with profilesRepaired', () => {
    const canonicalDir = path.join(env.destinations.configDir, 'profiles');
    writeProfile(canonicalDir, 'zai.json', corruptCanonicalProfile());
    fs.mkdirSync(path.join(env.legacyDir, 'profiles'), { recursive: true });
    writeProfile(
      path.join(env.legacyDir, 'profiles'),
      'zai.json',
      validLegacyProfile(),
    );

    const result = repairProfiles(env.legacyDir, env.destinations);
    expect(result.migrated).toBe(true);
    expect(result.profilesRepaired).toBe(1);
    expect(result.error).not.toBe(true);
  });

  it('translates no-candidate to migrated:false without error', () => {
    const result = repairProfiles(env.legacyDir, env.destinations);
    expect(result.migrated).toBe(false);
    expect(result.error).not.toBe(true);
    expect(result.profilesRepaired).toBeUndefined();
  });
});

describe('repairProfiles — error message sanitization (#1)', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('returns a stable generic reason when repair throws, not the raw error message', () => {
    const canonicalDir = path.join(env.destinations.configDir, 'profiles');
    // Replace canonical profiles dir with a file to cause a scan error.
    fs.mkdirSync(env.destinations.configDir, { recursive: true });
    fs.writeFileSync(canonicalDir, 'not a directory');

    fs.mkdirSync(path.join(env.legacyDir, 'profiles'), { recursive: true });

    const result = repairProfiles(env.legacyDir, env.destinations);
    expect(result.error).toBe(true);
    // Sentinel: the reason must be a stable generic string — it must NOT
    // contain the raw filesystem error message or path details.
    expect(result.reason).toBe('profile repair encountered an internal error');
  });

  it('sentinel: reason does not leak raw error text from the underlying failure', () => {
    const canonicalDir = path.join(env.destinations.configDir, 'profiles');
    fs.mkdirSync(env.destinations.configDir, { recursive: true });
    fs.writeFileSync(canonicalDir, 'not a directory');

    const result = repairProfiles(env.legacyDir, env.destinations);
    expect(result.reason).not.toContain('EISDIR');
    expect(result.reason).not.toContain('ENOTDIR');
    expect(result.reason).not.toContain(canonicalDir);
    expect(result.reason).not.toContain('Error');
  });
});

describe('repairProfiles — debug diagnostics without public leak (#2)', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('debug-logs structured outcome.errors but keeps public reason generic', () => {
    const canonicalDir = path.join(env.destinations.configDir, 'profiles');
    // Replace canonical profiles dir with a file to cause a scan error
    // that produces outcome.kind === 'error' with structured errors.
    fs.mkdirSync(env.destinations.configDir, { recursive: true });
    fs.writeFileSync(canonicalDir, 'not a directory');
    fs.mkdirSync(path.join(env.legacyDir, 'profiles'), { recursive: true });

    const debugSpy = vi
      .spyOn(DebugLogger.prototype, 'debug')
      .mockImplementation(() => {});

    try {
      const result = repairProfiles(env.legacyDir, env.destinations);
      expect(result.error).toBe(true);
      // Public reason must be generic — no structured errors leaked.
      expect(result.reason).toBe(
        'profile repair encountered an internal error',
      );

      // The debug log must have been called with structured outcome.errors
      // so diagnostics are available without leaking into the public result.
      const errorLogCall = debugSpy.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('Profile repair errors'),
      );
      expect(errorLogCall).toBeDefined();
      expect(errorLogCall?.[1]).toStrictEqual(
        expect.arrayContaining([expect.stringContaining(canonicalDir)]),
      );
    } finally {
      debugSpy.mockRestore();
    }
  });
});
