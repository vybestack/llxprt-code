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
