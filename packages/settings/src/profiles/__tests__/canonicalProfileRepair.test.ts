/**
 * Behavioral tests for the settings-owned canonical profile repair API.
 *
 * Tests the {@link repairCanonicalProfiles} cohesive function directly,
 * without going through the CLI orchestrator. Uses real temp directories.
 *
 * Covers:
 * - Corrupt profile detection and repair
 * - Narrow eligibility (only known historical defect signature)
 * - Marker semantics (none/repaired/busy/error outcomes)
 * - modelParams normalization at the parseProfile boundary
 * - Lock busy as benign deferral (no marker, no error)
 * - Backup preservation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  repairCanonicalProfiles,
  isCorruptStandardProfile,
  isCorruptStandardProfileFromRaw,
  CORRUPT_PROVIDER,
} from '../canonicalProfileRepair.js';
import { parseProfile } from '../../settings/validation.js';
import { isLoadBalancerProfile } from '../types.js';
import { acquireProfilesLockSync } from '../profileStore.js';
import { ProfileManager } from '../ProfileManager.js';

async function makeTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'llxprt-canonical-repair-test-'));
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
    provider: CORRUPT_PROVIDER,
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

interface TestEnv {
  canonicalDir: string;
  legacyDir: string;
  legacyProfilesDir: string;
}

async function setupEnv(): Promise<TestEnv> {
  const canonicalDir = await makeTempDir();
  const legacyDir = await makeTempDir();
  const legacyProfilesDir = path.join(legacyDir, 'profiles');
  fs.mkdirSync(legacyProfilesDir, { recursive: true });
  return { canonicalDir, legacyDir, legacyProfilesDir };
}

async function teardownEnv(env: TestEnv): Promise<void> {
  await fsp.rm(env.canonicalDir, { recursive: true, force: true });
  await fsp.rm(env.legacyDir, { recursive: true, force: true });
}

function writeProfile(
  dir: string,
  name: string,
  data: Record<string, unknown>,
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}

describe('isCorruptStandardProfile — narrow eligibility', () => {
  it('identifies a standard profile with provider load-balancer + gemini-2.5-pro as corrupt', () => {
    const profile = parseProfile(corruptCanonicalProfile());
    expect(isCorruptStandardProfile(profile)).toBe(true);
  });

  it('does NOT identify a genuine loadbalancer profile as corrupt', () => {
    const profile = parseProfile(genuineLbProfile());
    expect(isCorruptStandardProfile(profile)).toBe(false);
  });

  it('does NOT identify a valid standard profile as corrupt', () => {
    const profile = parseProfile(validLegacyProfile());
    expect(isCorruptStandardProfile(profile)).toBe(false);
  });

  it('does NOT identify a standard profile with load-balancer provider but a CUSTOM model as corrupt (#4)', () => {
    // A manually-authored profile with the load-balancer provider but a
    // custom model is NOT the reported defect signature. Skip it.
    const customModelProfile = {
      version: 1,
      provider: 'load-balancer',
      model: 'my-custom-model',
      modelParams: {},
      ephemeralSettings: {},
    };
    const profile = parseProfile(customModelProfile);
    expect(isCorruptStandardProfile(profile)).toBe(false);
  });

  it('does NOT identify a standard profile with load-balancer provider but a manual/default model as corrupt (#4)', () => {
    const manualModelProfile = {
      version: 1,
      provider: 'load-balancer',
      model: 'default',
      modelParams: {},
      ephemeralSettings: {},
    };
    const profile = parseProfile(manualModelProfile);
    expect(isCorruptStandardProfile(profile)).toBe(false);
  });
});

describe('isCorruptStandardProfileFromRaw — raw object eligibility (#3)', () => {
  it('identifies the exact defect signature: no type, load-balancer, gemini-2.5-pro', () => {
    expect(isCorruptStandardProfileFromRaw(corruptCanonicalProfile())).toBe(
      true,
    );
  });

  it('does NOT identify a profile with type: standard as corrupt (#3 negative)', () => {
    // A profile with explicit type:'standard' is NOT the corrupt shape —
    // the corrupt signature never carried a type field.
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

  it('does NOT identify a profile with type: loadbalancer as corrupt', () => {
    expect(isCorruptStandardProfileFromRaw(genuineLbProfile())).toBe(false);
  });

  it('does NOT identify a profile with a custom model as corrupt', () => {
    expect(
      isCorruptStandardProfileFromRaw({
        version: 1,
        provider: 'load-balancer',
        model: 'my-custom-model',
        modelParams: {},
        ephemeralSettings: {},
      }),
    ).toBe(false);
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

  it('does NOT identify non-object values as corrupt', () => {
    expect(isCorruptStandardProfileFromRaw(null)).toBe(false);
    expect(isCorruptStandardProfileFromRaw('string')).toBe(false);
    expect(isCorruptStandardProfileFromRaw(42)).toBe(false);
    expect(isCorruptStandardProfileFromRaw([])).toBe(false);
  });
});

describe('repairCanonicalProfiles — corrupt profile repair', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('repairs a corrupt canonical zai profile when a valid legacy exists', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );

    expect(result.kind).toBe('repaired');
    expect(result.kind === 'repaired' ? result.profilesRepaired : 0).toBe(1);

    const repaired = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'zai.json'), 'utf-8'),
    );
    expect(repaired.provider).toBe('anthropic');
    expect(repaired.model).toBe('glm-5.2');
    expect(repaired.ephemeralSettings['base-url']).toBe(
      'https://api.z.ai/api/anthropic',
    );
    expect(repaired.ephemeralSettings['auth-key-name']).toBe('zai');
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

  it('does not repair an unrelated same-name-independent profile', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.canonicalDir, 'other.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());
    writeProfile(env.legacyProfilesDir, 'other.json', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    });

    const first = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(first.kind).toBe('repaired');
    expect(first.kind === 'repaired' ? first.profilesRepaired : 0).toBe(1);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(env.canonicalDir, 'zai.json'), 'utf-8'),
      ).provider,
    ).toBe('anthropic');
    expect(
      JSON.parse(
        fs.readFileSync(path.join(env.canonicalDir, 'other.json'), 'utf-8'),
      ).provider,
    ).toBe(CORRUPT_PROVIDER);

    const second = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(second.kind).toBe('none');
  });
});

describe('repairCanonicalProfiles — no candidates / none outcome', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('returns none when canonical profiles dir does not exist', () => {
    const result = repairCanonicalProfiles(
      path.join(env.canonicalDir, 'nonexistent'),
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when no corrupt profiles exist', () => {
    writeProfile(env.canonicalDir, 'good.json', validLegacyProfile());
    writeProfile(env.legacyProfilesDir, 'good.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when corrupt canonical has no valid legacy replacement', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    // No legacy file at all.

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when legacy is a loadbalancer (not a valid standard replacement)', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', genuineLbProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');

    // Canonical NOT replaced.
    expect(
      JSON.parse(
        fs.readFileSync(path.join(env.canonicalDir, 'zai.json'), 'utf-8'),
      ).provider,
    ).toBe(CORRUPT_PROVIDER);
  });

  it('returns none when canonical is a genuine loadbalancer', () => {
    writeProfile(env.canonicalDir, 'lb.json', genuineLbProfile());
    writeProfile(env.legacyProfilesDir, 'lb.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');

    // LB profile untouched.
    const after = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'lb.json'), 'utf-8'),
    );
    expect(after.type).toBe('loadbalancer');
  });

  it('returns none when legacy replacement is also corrupt', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', corruptCanonicalProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });
});

// ─── Marker semantics: no stamp when no repair performed ────────────────────

describe('repairCanonicalProfiles — marker semantics (#4)', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('initial: no candidate / no canonical dir → none (no marker)', () => {
    const result = repairCanonicalProfiles(
      path.join(env.canonicalDir, 'no-such-dir'),
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('later: affected canonical+legacy appears → repaired on next startup', () => {
    // First run: empty canonical dir, nothing to repair.
    const first = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(first.kind).toBe('none');

    // Later: affected files appear.
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

    // Next startup repairs.
    const second = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(second.kind).toBe('repaired');
    expect(second.kind === 'repaired' ? second.profilesRepaired : 0).toBe(1);
  });
});

// ─── modelParams normalization at parseProfile boundary (#6) ────────────────

describe('repairCanonicalProfiles — modelParams normalization (#6)', () => {
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
});

// ─── Behavioral: repaired zai profile loads via ProfileManager (#9) ─────────

describe('repairCanonicalProfiles — repaired zai loads/preparation (#9)', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('repaired zai profile loads via ProfileManager preserving anthropic/glm-5.2/base-url/auth-key-name', async () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

    repairCanonicalProfiles(env.canonicalDir, env.legacyProfilesDir);

    // Load the repaired profile through the real ProfileManager (no
    // network, no mock theater) to verify it preserves the expected fields.
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

  // ─── Exact end-to-end zai application through ProfileManager (#5) ───────────

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
   * Minimal shape matching ProfileManager's ProfileSettingsServiceLike for
   * testing applyLoadedProfile without network/mock theater.
   */
  interface CapturingSettingsService {
    setCurrentProfileName(name: string | null): void;
    importFromProfile(data: unknown): Promise<void>;
    set(key: string, value: unknown): void;
  }

  /**
   * Type guard for the profile import data shape (narrowing unknown without
   * a type assertion).
   */
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

  describe('repairCanonicalProfiles — exact zai end-to-end application (#5)', () => {
    let env: TestEnv;

    beforeEach(async () => {
      env = await setupEnv();
    });
    afterEach(async () => {
      await teardownEnv(env);
    });

    it('repaired zai profile applies through ProfileManager with anthropic/glm-5.2/z.ai base URL/auth-key-name together', async () => {
      writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
      writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

      repairCanonicalProfiles(env.canonicalDir, env.legacyProfilesDir);

      // Load the repaired profile via ProfileManager (real file I/O).
      const pm = new ProfileManager(env.canonicalDir);

      // Apply through the real applyLoadedProfile seam with a capturing fake
      // at the SettingsService boundary (no network, no mock theater).
      // pm.load() internally calls loadProfile + applyLoadedProfile, handling
      // the LB check. Since this is a standard profile, load succeeds.
      const { service, captured } = createCapturingSettingsService();
      await pm.load('zai', service);

      // Assert all zai fields resolve together through the application path.
      expect(captured.currentProfileName).toBe('zai');
      expect(captured.defaultProvider).toBe('anthropic');

      const providerSettings = captured.providers['anthropic'];
      expect(providerSettings).toBeDefined();
      expect(providerSettings.model).toBe('glm-5.2');
      expect(providerSettings['base-url']).toBe(
        'https://api.z.ai/api/anthropic',
      );

      // auth-key-name is an ephemeral setting preserved in the profile and
      // resolved through the settings data — the key name 'zai' enables
      // secure-store key resolution at the provider boundary. Verify by
      // loading the raw repaired file.
      const loaded = await pm.loadProfile('zai');
      expect(loaded.ephemeralSettings['auth-key-name']).toBe('zai');
      expect(providerSettings.enabled).toBe(true);
    });
  });
});

// ─── Lock busy as benign deferral (#3) ──────────────────────────────────────

describe('repairCanonicalProfiles — lock busy is benign deferral (#3)', () => {
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

// ─── Narrow eligibility: negative tests for manually-authored LB (#5) ───────

describe('repairCanonicalProfiles — narrow eligibility negative tests (#5)', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('does NOT repair a manually-authored loadbalancer profile with provider load-balancer', () => {
    // A genuine LB profile has type:'loadbalancer' — it is never corrupt
    // even if its provider field is 'load-balancer'.
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

  it('does NOT repair a standard profile with load-balancer provider but a CUSTOM model (#4)', () => {
    // The reported defect signature requires model gemini-2.5-pro. A
    // manually-authored profile with a custom model must NOT be touched.
    const customModel = {
      version: 1,
      provider: 'load-balancer',
      model: 'my-custom-model',
      modelParams: {},
      ephemeralSettings: {},
    };
    writeProfile(env.canonicalDir, 'custom.json', customModel);
    writeProfile(env.legacyProfilesDir, 'custom.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');

    const after = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'custom.json'), 'utf-8'),
    );
    expect(after.model).toBe('my-custom-model');
    expect(after.provider).toBe('load-balancer');
  });

  it('does NOT repair a standard profile with load-balancer provider but a manual/default model (#4)', () => {
    const manualModel = {
      version: 1,
      provider: 'load-balancer',
      model: 'default',
      modelParams: {},
      ephemeralSettings: {},
    };
    writeProfile(env.canonicalDir, 'manual.json', manualModel);
    writeProfile(env.legacyProfilesDir, 'manual.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');

    const after = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'manual.json'), 'utf-8'),
    );
    expect(after.model).toBe('default');
  });

  it('repairs the EXACT reported defect: load-balancer + gemini-2.5-pro (#4 positive)', () => {
    // The exact issue payload from #2479/#2477: standard v1, provider
    // load-balancer, model gemini-2.5-pro (the fallback model).
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

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
  });
});

// ─── I/O error outcomes ─────────────────────────────────────────────────────

describe('repairCanonicalProfiles — I/O error outcomes', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('returns error when canonical profiles path is a file, not a directory', () => {
    fs.mkdirSync(env.canonicalDir, { recursive: true });
    // Replace the canonicalDir with a file.
    fs.rmSync(env.canonicalDir, { recursive: true, force: true });
    fs.writeFileSync(env.canonicalDir, 'not a directory');

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('error');
  });
});
