/**
 * @plan PLAN-20260608-ISSUE1588.P04
 * @requirement REQ-PROF-001
 *
 * Behavioral TDD tests for ProfileManager.
 *
 * These tests verify real temp filesystem JSON and path behavior.
 * They use actual temp directories and verify file content.
 * Tests fail against stubs because methods throw instead of performing
 * real filesystem operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ProfileManager } from '../ProfileManager.js';
import { parseProfile } from '../../settings/validation.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-profile-test-'));
}

describe('ProfileManager — saveProfile and loadProfile', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('saves a profile as JSON to the profiles directory', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: { temperature: 0.7 },
      ephemeralSettings: {},
    };
    await pm.saveProfile('test-profile', profile);

    const filePath = path.join(tempDir, 'test-profile.json');
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.provider).toBe('openai');
    expect(parsed.model).toBe('gpt-4');
    expect(parsed.version).toBe(1);
  });

  it('loads a previously saved profile', async () => {
    const profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-3',
      modelParams: { temperature: 0.5 },
      ephemeralSettings: { 'base-url': 'https://api.anthropic.com' },
    };
    await pm.saveProfile('my-profile', profile);

    const loaded = await pm.loadProfile('my-profile');
    expect(loaded.provider).toBe('anthropic');
    expect(loaded.model).toBe('claude-3');
    expect(loaded.version).toBe(1);
  });

  it('creates the profiles directory if it does not exist', async () => {
    const nestedDir = path.join(tempDir, 'nested', 'profiles');
    const nestedPm = new ProfileManager(nestedDir);
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };
    await nestedPm.saveProfile('test', profile);

    const stat = await fs.stat(nestedDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('throws when loading a nonexistent profile', async () => {
    await expect(pm.loadProfile('nonexistent')).rejects.toThrow('not found');
  });

  it('persists JSON with pretty-printed formatting', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };
    await pm.saveProfile('pretty', profile);

    const filePath = path.join(tempDir, 'pretty.json');
    const content = await fs.readFile(filePath, 'utf8');
    // Pretty-printed JSON has newlines and indentation
    expect(content).toContain('\n');
    expect(content).toContain('  ');
  });
});

describe('ProfileManager — listProfiles', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns empty array when no profiles exist', async () => {
    const profiles = await pm.listProfiles();
    expect(profiles).toStrictEqual([]);
  });

  it('lists saved profile names without .json extension', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };
    await pm.saveProfile('alpha', profile);
    await pm.saveProfile('beta', profile);

    const profiles = await pm.listProfiles();
    expect(profiles).toContain('alpha');
    expect(profiles).toContain('beta');
  });

  it('does not include non-JSON files', async () => {
    await fs.writeFile(path.join(tempDir, 'readme.txt'), 'hello', 'utf8');
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };
    await pm.saveProfile('real-profile', profile);

    const profiles = await pm.listProfiles();
    expect(profiles).toContain('real-profile');
    expect(profiles).not.toContain('readme');
  });
});

describe('ProfileManager — deleteProfile', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('deletes an existing profile', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };
    await pm.saveProfile('to-delete', profile);
    await pm.deleteProfile('to-delete');

    const filePath = path.join(tempDir, 'to-delete.json');
    await expect(fs.access(filePath)).rejects.toThrow('ENOENT');
  });

  it('throws when deleting a nonexistent profile', async () => {
    await expect(pm.deleteProfile('nonexistent')).rejects.toThrow('not found');
  });
});

describe('ProfileManager — profileExists', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns true for an existing profile', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };
    await pm.saveProfile('exists', profile);
    expect(await pm.profileExists('exists')).toBe(true);
  });

  it('returns false for a nonexistent profile', async () => {
    expect(await pm.profileExists('nonexistent')).toBe(false);
  });
});

describe('ProfileManager — save and load with SettingsService', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('save persists profile data from a settings-like object', async () => {
    // Minimal mock that satisfies the save() contract
    const mockSettingsService = {
      exportForProfile: async () => ({
        defaultProvider: 'openai',
        providers: {
          openai: { model: 'gpt-4', temperature: 0.7 },
        },
        tools: { allowed: [], disabled: [] },
      }),
      setCurrentProfileName: (_name: string | null) => {},
    };

    await pm.save('round-trip', mockSettingsService);

    // Verify file was created with correct content
    const filePath = path.join(tempDir, 'round-trip.json');
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.provider).toBe('openai');
    expect(parsed.model).toBe('gpt-4');
  });

  it('load reads a profile file from disk', async () => {
    // First manually save a profile
    const profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-3',
      modelParams: { temperature: 0.5 },
      ephemeralSettings: {},
    };
    await pm.saveProfile('load-target', profile);

    // Then load it through the load() method
    const appliedData: Record<string, unknown> = {};
    const mockSettingsService = {
      setCurrentProfileName: (name: string | null) => {
        appliedData['currentProfile'] = name;
      },
      importFromProfile: async (data: unknown) => {
        appliedData['imported'] = data;
      },
      set: (key: string, value: unknown) => {
        appliedData[key] = value;
      },
    };

    await pm.load('load-target', mockSettingsService);
    expect(appliedData['currentProfile']).toBe('load-target');
  });

  it('load normalizes tool array entries before applying settings', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {
        'tools.allowed': [1, 'read_file', false],
        'tools.disabled': [2, 'shell'],
      },
    };
    await pm.saveProfile('tool-normalization', profile);

    const appliedData: Record<string, unknown> = {};
    const mockSettingsService = {
      setCurrentProfileName: () => {},
      importFromProfile: async () => {},
      set: (key: string, value: unknown) => {
        appliedData[key] = value;
      },
    };

    await pm.load('tool-normalization', mockSettingsService);

    expect(appliedData['tools.allowed']).toStrictEqual([
      '1',
      'read_file',
      'false',
    ]);
    expect(appliedData['tools.disabled']).toStrictEqual(['2', 'shell']);
    expect(appliedData['disabled-tools']).toStrictEqual(['2', 'shell']);
  });

  it('load normalizes legacy disabled-tools entries before applying settings', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {
        'disabled-tools': [3, 'read_many_files'],
      },
    };
    await pm.saveProfile('legacy-tool-normalization', profile);

    const appliedData: Record<string, unknown> = {};
    const mockSettingsService = {
      setCurrentProfileName: () => {},
      importFromProfile: async () => {},
      set: (key: string, value: unknown) => {
        appliedData[key] = value;
      },
    };

    await pm.load('legacy-tool-normalization', mockSettingsService);

    expect(appliedData['tools.disabled']).toStrictEqual([
      '3',
      'read_many_files',
    ]);
    expect(appliedData['disabled-tools']).toStrictEqual([
      '3',
      'read_many_files',
    ]);
  });

  it('save persists auth-keyfile in ephemeralSettings', async () => {
    const mockSettingsService = {
      exportForProfile: async () => ({
        defaultProvider: 'openai',
        providers: {
          openai: {
            model: 'gpt-4',
            'auth-key': 'sk-secret',
            'auth-keyfile': '/path/to/keyfile',
          },
        },
        tools: { allowed: [], disabled: [] },
      }),
      setCurrentProfileName: (_name: string | null) => {},
    };

    await pm.save('authfile-profile', mockSettingsService);

    const filePath = path.join(tempDir, 'authfile-profile.json');
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.ephemeralSettings['auth-key']).toBe('sk-secret');
    expect(parsed.ephemeralSettings['auth-keyfile']).toBe('/path/to/keyfile');
  });

  it('load round-trips auth-keyfile back to settings', async () => {
    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'sk-roundtrip',
        'auth-keyfile': '/roundtrip/keyfile',
      },
    };
    await pm.saveProfile('rt-keyfile', profile);

    let importedData: Record<string, unknown> | undefined;
    const mockSettingsService = {
      setCurrentProfileName: () => {},
      importFromProfile: async (data: unknown) => {
        importedData = data as Record<string, unknown>;
      },
      set: () => {},
    };

    await pm.load('rt-keyfile', mockSettingsService);

    expect(importedData).toBeDefined();
    const imported = importedData as Record<string, unknown>;
    const providers = imported.providers as Record<
      string,
      Record<string, unknown>
    >;
    expect(providers.openai['auth-key']).toBe('sk-roundtrip');
    expect(providers.openai['auth-keyfile']).toBe('/roundtrip/keyfile');
  });
});

describe('ProfileManager — corrupted and malformed profile JSON', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('maps JSON null to invalid missing required fields (not raw TypeError)', async () => {
    const filePath = path.join(tempDir, 'null-profile.json');
    await fs.writeFile(filePath, 'null', 'utf8');

    await expect(pm.loadProfile('null-profile')).rejects.toThrow(
      "Profile 'null-profile' is invalid: missing required fields",
    );
  });

  it('maps a JSON array to invalid missing required fields', async () => {
    const filePath = path.join(tempDir, 'array-profile.json');
    await fs.writeFile(filePath, '[1, 2, 3]', 'utf8');

    await expect(pm.loadProfile('array-profile')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('maps a JSON number to invalid missing required fields', async () => {
    const filePath = path.join(tempDir, 'number-profile.json');
    await fs.writeFile(filePath, '42', 'utf8');

    await expect(pm.loadProfile('number-profile')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('maps an empty JSON object to invalid missing required fields', async () => {
    const filePath = path.join(tempDir, 'empty-profile.json');
    await fs.writeFile(filePath, '{}', 'utf8');

    await expect(pm.loadProfile('empty-profile')).rejects.toThrow(
      'missing required fields',
    );
  });
});

describe('ProfileManager — malformed loadbalancer profile shapes', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('reports unsupported version for a loadbalancer with version 2 and no profiles', async () => {
    const filePath = path.join(tempDir, 'lb-v2.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({ type: 'loadbalancer', version: 2 }),
      'utf8',
    );

    await expect(pm.loadProfile('lb-v2')).rejects.toThrow(
      'unsupported profile version',
    );
  });

  it('reports unsupported version for a loadbalancer with version 2 and valid profiles', async () => {
    const filePath = path.join(tempDir, 'lb-v2-profiles.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        type: 'loadbalancer',
        version: 2,
        profiles: ['p1'],
      }),
      'utf8',
    );

    await expect(pm.loadProfile('lb-v2-profiles')).rejects.toThrow(
      'unsupported profile version',
    );
  });

  it('reports missing profiles for a version-1 loadbalancer without profiles', async () => {
    const filePath = path.join(tempDir, 'lb-no-profiles.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({ type: 'loadbalancer', version: 1 }),
      'utf8',
    );

    await expect(pm.loadProfile('lb-no-profiles')).rejects.toThrow(
      /must reference at least one profile/,
    );
  });

  it('reports missing profiles for a version-1 loadbalancer with empty profiles array', async () => {
    const filePath = path.join(tempDir, 'lb-empty-profiles.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        type: 'loadbalancer',
        version: 1,
        profiles: [],
      }),
      'utf8',
    );

    await expect(pm.loadProfile('lb-empty-profiles')).rejects.toThrow(
      /must reference at least one profile/,
    );
  });

  it('reports unsupported version (not missing profiles) when version is 2 and profiles is missing', async () => {
    const filePath = path.join(tempDir, 'lb-v2-missing-profiles.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({ type: 'loadbalancer', version: 2 }),
      'utf8',
    );

    await expect(pm.loadProfile('lb-v2-missing-profiles')).rejects.toThrow(
      'unsupported profile version',
    );
  });
});

describe('ProfileManager — malformed standard profile modelParams/ephemeralSettings', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects a standard profile with primitive modelParams', async () => {
    const filePath = path.join(tempDir, 'primitive-modelparams.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: 'not-an-object',
        ephemeralSettings: {},
      }),
      'utf8',
    );

    await expect(pm.loadProfile('primitive-modelparams')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('rejects a standard profile with array modelParams', async () => {
    const filePath = path.join(tempDir, 'array-modelparams.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: [],
        ephemeralSettings: {},
      }),
      'utf8',
    );

    await expect(pm.loadProfile('array-modelparams')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('rejects a standard profile with null modelParams', async () => {
    const filePath = path.join(tempDir, 'null-modelparams.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: null,
        ephemeralSettings: {},
      }),
      'utf8',
    );

    await expect(pm.loadProfile('null-modelparams')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('rejects a standard profile with primitive ephemeralSettings', async () => {
    const filePath = path.join(tempDir, 'primitive-ephemeral.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: 42,
      }),
      'utf8',
    );

    await expect(pm.loadProfile('primitive-ephemeral')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('rejects a standard profile with array ephemeralSettings', async () => {
    const filePath = path.join(tempDir, 'array-ephemeral.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: ['not', 'an', 'object'],
      }),
      'utf8',
    );

    await expect(pm.loadProfile('array-ephemeral')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('rejects a standard profile with null ephemeralSettings', async () => {
    const filePath = path.join(tempDir, 'null-ephemeral.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: null,
      }),
      'utf8',
    );

    await expect(pm.loadProfile('null-ephemeral')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('rejects standard profile fields with custom prototypes', () => {
    const customPrototype = { inherited: true };
    const modelParams: Record<string, unknown> = Object.create(customPrototype);
    modelParams.temperature = 0.7;

    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams,
      ephemeralSettings: {},
    };

    expect(() => parseProfile(profile)).toThrow('missing required fields');
  });

  it('accepts a well-formed standard profile with object modelParams and ephemeralSettings', async () => {
    const filePath = path.join(tempDir, 'valid-profile.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: { temperature: 0.7 },
        ephemeralSettings: { 'base-url': 'https://api.openai.com' },
      }),
      'utf8',
    );

    const loaded = await pm.loadProfile('valid-profile');
    expect(loaded.provider).toBe('openai');
    expect(loaded.model).toBe('gpt-4');
  });
});

describe('ProfileManager — parse boundary rejects unsafe object shapes', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects prototype-pollution keys in standard profile modelParams', async () => {
    const filePath = path.join(tempDir, 'polluted-modelparams.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: { constructor: { prototype: { polluted: true } } },
        ephemeralSettings: {},
      }),
      'utf8',
    );

    await expect(pm.loadProfile('polluted-modelparams')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('rejects prototype-pollution keys in standard profile ephemeralSettings', async () => {
    const filePath = path.join(tempDir, 'polluted-ephemeral.json');
    await fs.writeFile(
      filePath,
      '{"version":1,"provider":"openai","model":"gpt-4","modelParams":{},"ephemeralSettings":{"__proto__":{"polluted":true}}}',
      'utf8',
    );

    await expect(pm.loadProfile('polluted-ephemeral')).rejects.toThrow(
      'missing required fields',
    );
  });
});

describe('ProfileManager — saveLoadBalancerProfile type discriminant validation', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects a runtime-shaped value with missing type', async () => {
    const profile = {
      version: 1,
      policy: 'roundrobin',
      profiles: ['p1'],
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };

    await expect(pm.saveLoadBalancerProfile('bad', profile)).rejects.toThrow(
      /must reference at least one profile/,
    );
  });

  it('rejects a runtime-shaped value with wrong type', async () => {
    const profile = {
      version: 1,
      type: 'standard',
      policy: 'roundrobin',
      profiles: ['p1'],
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };

    await expect(pm.saveLoadBalancerProfile('bad', profile)).rejects.toThrow(
      /must reference at least one profile/,
    );
  });

  it('does not write a file when the type discriminant is missing', async () => {
    const profile = {
      version: 1,
      policy: 'roundrobin',
      profiles: ['p1'],
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };

    await expect(
      pm.saveLoadBalancerProfile('no-write', profile),
    ).rejects.toThrow('must reference at least one profile');

    const filePath = path.join(tempDir, 'no-write.json');
    await expect(fs.access(filePath)).rejects.toThrow('ENOENT');
  });
});

describe('ProfileManager — loadbalancer profile entry validation', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects loadbalancer profiles with non-string profile entries', async () => {
    const filePath = path.join(tempDir, 'lb-non-string-profile.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        type: 'loadbalancer',
        version: 1,
        profiles: ['p1', 2],
        policy: 'roundrobin',
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      }),
      'utf8',
    );

    await expect(pm.loadProfile('lb-non-string-profile')).rejects.toThrow(
      /must reference at least one profile/,
    );
  });

  it('rejects loadbalancer profiles with empty profile names', async () => {
    const filePath = path.join(tempDir, 'lb-empty-profile-name.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        type: 'loadbalancer',
        version: 1,
        profiles: [''],
        policy: 'roundrobin',
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      }),
      'utf8',
    );

    await expect(pm.loadProfile('lb-empty-profile-name')).rejects.toThrow(
      /must reference at least one profile/,
    );
  });
});
