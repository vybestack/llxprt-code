/**
 * Behavioral tests for the settings-owned canonical profile repair API.
 *
 * Tests the {@link repairCanonicalProfiles} cohesive function directly,
 * without going through the CLI orchestrator. Uses real temp directories.
 *
 * Covers:
 * - Corrupt profile detection and repair (GENERALIZED — no hardcoded
 *   profile name/provider/model/endpoint/auth constants).
 * - Conservative corruption signature based only on the historical
 *   malformed shape: untyped standard-v1 profile whose provider is the
 *   virtual non-loadable provider 'load-balancer', with empty modelParams
 *   and empty ephemeralSettings, which parses as a standard profile.
 * - A same-name legacy replacement is eligible iff it parses as a valid
 *   standard profile, is not a genuine loadbalancer, does not itself
 *   match the corrupt structural signature, and does not have provider
 *   'load-balancer'.
 * - modelParams normalization (absent → {}) in the serialized output.
 * - Lock busy as benign deferral (no marker, no error)
 * - Backup preservation
 * - Negative tests for genuine loadbalancer, explicit type, nonempty
 *   settings/params, invalid replacement, and already-valid profiles.
 *
 * Outcome/no-candidate/I-O-error tests are in
 * canonicalProfileRepair.outcomes.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  repairCanonicalProfiles,
  isCorruptStandardProfileFromRaw,
  CORRUPT_PROVIDER,
} from '../canonicalProfileRepair.js';
import { parseProfile } from '../../settings/validation.js';
import { isLoadBalancerProfile } from '../types.js';
import { acquireProfilesLockSync } from '../profileStore.js';
import { ProfileManager } from '../ProfileManager.js';
import {
  type TestEnv,
  setupEnv,
  teardownEnv,
  writeProfile,
  corruptCanonicalProfile,
  corruptCanonicalProfileNonGeminiModel,
  corruptCanonicalProfileOmittedModelParams,
  validLegacyProfile,
  validLegacyProfileAlternative,
  genuineLbProfile,
} from './canonicalProfileRepair.testHelpers.js';

// ─── Corruption signature: conservative raw structural predicate ────────────

describe('isCorruptStandardProfileFromRaw — conservative structural signature', () => {
  it('identifies the exact historical defect: untyped + load-balancer + empty params/settings', () => {
    expect(isCorruptStandardProfileFromRaw(corruptCanonicalProfile())).toBe(
      true,
    );
  });

  it('identifies a corrupt signature with a non-Gemini fallback model', () => {
    expect(
      isCorruptStandardProfileFromRaw(corruptCanonicalProfileNonGeminiModel()),
    ).toBe(true);
  });

  it('does NOT identify a profile with type: standard as corrupt', () => {
    const standardTyped = {
      version: 1,
      type: 'standard',
      provider: 'load-balancer',
      model: 'gemini-2.5-pro',
      modelParams: {},
      ephemeralSettings: {},
    };
    expect(isCorruptStandardProfileFromRaw(standardTyped)).toBe(false);
  });

  it('does NOT identify a genuine loadbalancer profile as corrupt', () => {
    expect(isCorruptStandardProfileFromRaw(genuineLbProfile())).toBe(false);
  });

  it('does NOT identify a profile with a real provider as corrupt', () => {
    expect(
      isCorruptStandardProfileFromRaw({
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {},
      }),
    ).toBe(false);
  });

  it('does NOT identify a corrupt-provider profile with nonempty modelParams as corrupt', () => {
    expect(
      isCorruptStandardProfileFromRaw({
        version: 1,
        provider: CORRUPT_PROVIDER,
        model: 'gemini-2.5-pro',
        modelParams: { temperature: 0.5 },
        ephemeralSettings: {},
      }),
    ).toBe(false);
  });

  it('does NOT identify a corrupt-provider profile with nonempty ephemeralSettings as corrupt', () => {
    expect(
      isCorruptStandardProfileFromRaw({
        version: 1,
        provider: CORRUPT_PROVIDER,
        model: 'gemini-2.5-pro',
        modelParams: {},
        ephemeralSettings: { 'base-url': 'https://example.com' },
      }),
    ).toBe(false);
  });

  it('does NOT identify a corrupt-provider profile with absent ephemeralSettings as corrupt', () => {
    expect(
      isCorruptStandardProfileFromRaw({
        version: 1,
        provider: CORRUPT_PROVIDER,
        model: 'gemini-2.5-pro',
        modelParams: {},
      }),
    ).toBe(false);
  });

  it('does NOT identify a corrupt-provider profile with a non-v1 version as corrupt', () => {
    expect(
      isCorruptStandardProfileFromRaw({
        version: 2,
        provider: CORRUPT_PROVIDER,
        model: 'gemini-2.5-pro',
        modelParams: {},
        ephemeralSettings: {},
      }),
    ).toBe(false);
  });

  it('does NOT identify non-object values as corrupt', () => {
    expect(isCorruptStandardProfileFromRaw(null)).toBe(false);
    expect(isCorruptStandardProfileFromRaw('string')).toBe(false);
    expect(isCorruptStandardProfileFromRaw(42)).toBe(false);
    expect(isCorruptStandardProfileFromRaw([])).toBe(false);
  });
});

// ─── Repair: generalized — arbitrary names/providers/models/endpoints ───────

describe('repairCanonicalProfiles — generalized corrupt profile repair', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('repairs a corrupt canonical profile with an arbitrary name', () => {
    writeProfile(env.canonicalDir, 'mycustom.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'mycustom.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );

    expect(result.kind).toBe('repaired');
    expect(result.kind === 'repaired' ? result.profilesRepaired : 0).toBe(1);

    const repaired = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'mycustom.json'), 'utf-8'),
    );
    expect(repaired.provider).toBe('anthropic');
    expect(repaired.model).toBe('glm-5.2');
    expect(repaired.ephemeralSettings['base-url']).toBe(
      'https://api.z.ai/api/anthropic',
    );
    expect(repaired.ephemeralSettings['auth-key-name']).toBe('zai');
  });

  it('repairs a corrupt canonical profile with a non-Gemini fallback model', () => {
    writeProfile(
      env.canonicalDir,
      'broken.json',
      corruptCanonicalProfileNonGeminiModel(),
    );
    writeProfile(
      env.legacyProfilesDir,
      'broken.json',
      validLegacyProfileAlternative(),
    );

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );

    expect(result.kind).toBe('repaired');

    const repaired = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'broken.json'), 'utf-8'),
    );
    expect(repaired.provider).toBe('openai');
    expect(repaired.model).toBe('gpt-4o');
    expect(repaired.ephemeralSettings['base-url']).toBe(
      'https://api.openai.com/v1',
    );
    expect(repaired.ephemeralSettings['auth-key']).toBe('sk-test-key');
  });

  it('repairs using a legacy replacement with arbitrary provider/model/endpoint/auth', () => {
    writeProfile(env.canonicalDir, 'acme.json', corruptCanonicalProfile());
    writeProfile(
      env.legacyProfilesDir,
      'acme.json',
      validLegacyProfileAlternative(),
    );

    repairCanonicalProfiles(env.canonicalDir, env.legacyProfilesDir);

    const repaired = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'acme.json'), 'utf-8'),
    );
    expect(repaired.provider).toBe('openai');
    expect(repaired.model).toBe('gpt-4o');
    expect(repaired.modelParams).toStrictEqual({
      temperature: 0.7,
      max_tokens: 4096,
    });
    expect(repaired.ephemeralSettings['base-url']).toBe(
      'https://api.openai.com/v1',
    );
    expect(repaired.ephemeralSettings['auth-key']).toBe('sk-test-key');
    expect(repaired.ephemeralSettings['context-limit']).toBe(128000);
  });

  it('preserves the corrupt canonical file as a quarantine backup', () => {
    const corruptData = JSON.stringify(corruptCanonicalProfile());
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

    repairCanonicalProfiles(env.canonicalDir, env.legacyProfilesDir);

    const backups = fs
      .readdirSync(env.canonicalDir)
      .filter((f) => f.endsWith('.pre-repair.bak'));
    expect(backups).toStrictEqual(['zai.json.pre-repair.bak']);
    expect(
      fs.readFileSync(path.join(env.canonicalDir, backups[0]), 'utf-8'),
    ).toBe(corruptData);
  });

  it('does not modify the legacy profile file during repair', () => {
    const legacyData = JSON.stringify(validLegacyProfile());
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    fs.writeFileSync(path.join(env.legacyProfilesDir, 'zai.json'), legacyData);

    repairCanonicalProfiles(env.canonicalDir, env.legacyProfilesDir);

    expect(
      fs.readFileSync(path.join(env.legacyProfilesDir, 'zai.json'), 'utf-8'),
    ).toBe(legacyData);
  });

  it('repairs at most one candidate per call (sorted by name)', () => {
    writeProfile(env.canonicalDir, 'aaa.json', corruptCanonicalProfile());
    writeProfile(env.canonicalDir, 'zzz.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'aaa.json', validLegacyProfile());
    writeProfile(env.legacyProfilesDir, 'zzz.json', validLegacyProfile());

    const first = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(first.kind).toBe('repaired');

    // aaa repaired first (sorted), zzz still corrupt.
    expect(
      JSON.parse(
        fs.readFileSync(path.join(env.canonicalDir, 'aaa.json'), 'utf-8'),
      ).provider,
    ).toBe('anthropic');
    expect(
      JSON.parse(
        fs.readFileSync(path.join(env.canonicalDir, 'zzz.json'), 'utf-8'),
      ).provider,
    ).toBe(CORRUPT_PROVIDER);

    const second = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(second.kind).toBe('repaired');
    expect(
      JSON.parse(
        fs.readFileSync(path.join(env.canonicalDir, 'zzz.json'), 'utf-8'),
      ).provider,
    ).toBe('anthropic');

    const third = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(third.kind).toBe('none');
  });
});

// ─── modelParams normalization at parseProfile boundary ────────────────────

describe('repairCanonicalProfiles — modelParams normalization', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('repairs a legacy profile with absent modelParams (normalized to {})', () => {
    const issueLegacy = {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      // modelParams intentionally absent — parseProfile normalizes to {}
      ephemeralSettings: {
        'base-url': 'https://api.z.ai/api/anthropic',
        'auth-key-name': 'zai',
        'context-limit': 200000,
      },
    };
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    fs.writeFileSync(
      path.join(env.legacyProfilesDir, 'zai.json'),
      JSON.stringify(issueLegacy),
    );

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('repaired');

    const repaired = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'zai.json'), 'utf-8'),
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
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

    repairCanonicalProfiles(env.canonicalDir, env.legacyProfilesDir);

    const repaired = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'zai.json'), 'utf-8'),
    );
    expect(repaired.modelParams).toStrictEqual({ temperature: 1 });
  });

  it('repairs a corrupt canonical that omits modelParams entirely', () => {
    // The corrupt canonical profile omits modelParams (rather than having
    // an explicit {}). This is still the structural defect — absent
    // modelParams is treated the same as empty modelParams.
    writeProfile(
      env.canonicalDir,
      'no-params.json',
      corruptCanonicalProfileOmittedModelParams(),
    );
    writeProfile(env.legacyProfilesDir, 'no-params.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('repaired');

    const repaired = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'no-params.json'), 'utf-8'),
    );
    expect(repaired.provider).toBe('anthropic');
    expect(repaired.model).toBe('glm-5.2');
    expect(repaired.modelParams).toStrictEqual({ temperature: 1 });
  });
});

// ─── Behavioral: repaired profile loads via ProfileManager ─────────────────

describe('repairCanonicalProfiles — repaired profile loads via ProfileManager', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('repaired profile loads via ProfileManager preserving all fields', async () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

    repairCanonicalProfiles(env.canonicalDir, env.legacyProfilesDir);

    const pm = new ProfileManager(env.canonicalDir);
    const loaded = await pm.loadProfile('zai');

    expect(loaded.provider).toBe('anthropic');
    expect(loaded.model).toBe('glm-5.2');
    expect(isLoadBalancerProfile(loaded)).toBe(false);
    expect(loaded.ephemeralSettings['base-url']).toBe(
      'https://api.z.ai/api/anthropic',
    );
    expect(loaded.ephemeralSettings['auth-key-name']).toBe('zai');
    expect(loaded.ephemeralSettings['context-limit']).toBe(200000);
  });

  it('repaired profile with alternative provider loads via ProfileManager', async () => {
    writeProfile(
      env.canonicalDir,
      'alt.json',
      corruptCanonicalProfileNonGeminiModel(),
    );
    writeProfile(
      env.legacyProfilesDir,
      'alt.json',
      validLegacyProfileAlternative(),
    );

    repairCanonicalProfiles(env.canonicalDir, env.legacyProfilesDir);

    const pm = new ProfileManager(env.canonicalDir);
    const loaded = await pm.loadProfile('alt');

    expect(loaded.provider).toBe('openai');
    expect(loaded.model).toBe('gpt-4o');
    expect(isLoadBalancerProfile(loaded)).toBe(false);
    expect(loaded.modelParams.max_tokens).toBe(4096);
    expect(loaded.ephemeralSettings['base-url']).toBe(
      'https://api.openai.com/v1',
    );
  });

  /**
   * Captured settings data from the fake SettingsService boundary.
   */
  interface CapturedSettings {
    defaultProvider: string;
    providers: Record<string, Record<string, unknown>>;
    tools: { allowed: readonly string[]; disabled: readonly string[] };
    currentProfileName: string | null;
    setKeys: Record<string, unknown>;
  }

  /**
   * Minimal shape matching ProfileManager's ProfileSettingsServiceLike.
   */
  interface CapturingSettingsService {
    setCurrentProfileName(name: string | null): void;
    importFromProfile(data: unknown): Promise<void>;
    set(key: string, value: unknown): void;
  }

  function isImportData(value: unknown): value is {
    defaultProvider: string;
    providers: Record<string, Record<string, unknown>>;
    tools?: { allowed?: unknown[]; disabled?: unknown[] };
  } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }
    const entries = Object.entries(value);
    const hasDefaultProvider = entries.some(
      ([k, v]) => k === 'defaultProvider' && typeof v === 'string',
    );
    const hasProviders = entries.some(
      ([k, v]) => k === 'providers' && typeof v === 'object' && v !== null,
    );
    return hasDefaultProvider && hasProviders;
  }

  function createCapturingSettingsService(): {
    service: CapturingSettingsService;
    captured: CapturedSettings;
  } {
    const captured: CapturedSettings = {
      defaultProvider: '',
      providers: {},
      tools: { allowed: [], disabled: [] },
      currentProfileName: null,
      setKeys: {},
    };

    const service: CapturingSettingsService = {
      setCurrentProfileName(name: string | null) {
        captured.currentProfileName = name;
      },
      async importFromProfile(data: unknown) {
        if (!isImportData(data)) {
          return;
        }
        captured.defaultProvider = data.defaultProvider;
        captured.providers = data.providers;
        const allowedRaw = data.tools?.allowed;
        const disabledRaw = data.tools?.disabled;
        captured.tools = {
          allowed: Array.isArray(allowedRaw) ? allowedRaw.map(String) : [],
          disabled: Array.isArray(disabledRaw) ? disabledRaw.map(String) : [],
        };
      },
      set(key: string, value: unknown) {
        captured.setKeys[key] = value;
      },
    };
    return { service, captured };
  }

  it('repaired profile applies through ProfileManager end-to-end', async () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

    repairCanonicalProfiles(env.canonicalDir, env.legacyProfilesDir);

    const pm = new ProfileManager(env.canonicalDir);

    const { service, captured } = createCapturingSettingsService();
    await pm.load('zai', service);

    expect(captured.currentProfileName).toBe('zai');
    expect(captured.defaultProvider).toBe('anthropic');

    const providerSettings = captured.providers['anthropic'];
    expect(providerSettings).toBeDefined();
    expect(providerSettings.model).toBe('glm-5.2');
    expect(providerSettings['base-url']).toBe('https://api.z.ai/api/anthropic');

    const loaded = await pm.loadProfile('zai');
    expect(loaded.ephemeralSettings['auth-key-name']).toBe('zai');
    expect(providerSettings.enabled).toBe(true);
  });
});

// ─── Lock busy as benign deferral ──────────────────────────────────────────

describe('repairCanonicalProfiles — lock busy is benign deferral', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('returns busy (not error) when lock is held, no marker should be written', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

    // Hold the lock to simulate a concurrent process.
    const lock = acquireProfilesLockSync(env.canonicalDir);
    try {
      const result = repairCanonicalProfiles(
        env.canonicalDir,
        env.legacyProfilesDir,
      );
      expect(result.kind).toBe('busy');
    } finally {
      lock.release();
    }

    // Canonical NOT replaced.
    expect(
      JSON.parse(
        fs.readFileSync(path.join(env.canonicalDir, 'zai.json'), 'utf-8'),
      ).provider,
    ).toBe(CORRUPT_PROVIDER);
  });
});

// ─── Narrow eligibility: negative tests ────────────────────────────────────

describe('repairCanonicalProfiles — narrow eligibility negative tests', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('does NOT repair a manually-authored loadbalancer profile with provider load-balancer', () => {
    writeProfile(env.canonicalDir, 'mylb.json', genuineLbProfile());
    writeProfile(env.legacyProfilesDir, 'mylb.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');

    const after = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'mylb.json'), 'utf-8'),
    );
    expect(after.type).toBe('loadbalancer');
    expect(isLoadBalancerProfile(parseProfile(after))).toBe(true);
  });

  it('does NOT repair a valid standard profile with a real provider', () => {
    writeProfile(env.canonicalDir, 'openai.json', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    });
    writeProfile(env.legacyProfilesDir, 'openai.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');

    const after = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'openai.json'), 'utf-8'),
    );
    expect(after.provider).toBe('openai');
  });

  it('repairs the historical defect shape regardless of fallback model', () => {
    writeProfile(env.canonicalDir, 'gem.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'gem.json', validLegacyProfile());

    writeProfile(
      env.canonicalDir,
      'other.json',
      corruptCanonicalProfileNonGeminiModel(),
    );
    writeProfile(
      env.legacyProfilesDir,
      'other.json',
      validLegacyProfileAlternative(),
    );

    const first = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(first.kind).toBe('repaired');

    const second = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(second.kind).toBe('repaired');

    const third = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(third.kind).toBe('none');
  });
});
