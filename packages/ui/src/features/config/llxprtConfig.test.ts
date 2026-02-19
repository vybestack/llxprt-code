import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyConfigCommand,
  validateSessionConfig,
  profileToConfigOptions,
} from './llxprtConfig';
import type { SessionConfig } from './llxprtAdapter';
import type { ProfileData } from './llxprtConfig';
import type { Profile } from '@vybestack/llxprt-code-core';

const BASE_CONFIG: SessionConfig = { provider: 'openai' };

describe('applyConfigCommand', () => {
  it('sets provider when valid', async () => {
    const result = await applyConfigCommand('/provider gemini', BASE_CONFIG);
    expect(result.handled).toBe(true);
    expect(result.nextConfig.provider).toBe('gemini');
    expect(result.messages[0]).toContain('Provider set to gemini');
  });

  it('defers empty provider to caller', async () => {
    const result = await applyConfigCommand('/provider', BASE_CONFIG);
    expect(result.handled).toBe(false);
    expect(result.nextConfig).toStrictEqual(BASE_CONFIG);
  });

  it('rejects unknown provider', async () => {
    const result = await applyConfigCommand('/provider something', BASE_CONFIG);
    expect(result.handled).toBe(true);
    expect(result.nextConfig.provider).toBe('openai');
    expect(result.messages[0]).toContain('Unknown provider');
  });

  it('sets base url and accepts alias', async () => {
    const result = await applyConfigCommand(
      '/basurl https://example.test/api',
      BASE_CONFIG,
    );
    expect(result.handled).toBe(true);
    expect(result.nextConfig['base-url']).toBe('https://example.test/api');
  });

  it('sets key and clears keyfile', async () => {
    const result = await applyConfigCommand('/key secret', {
      ...BASE_CONFIG,
      keyFilePath: path.join(os.tmpdir(), 'nui-test-key'),
    });
    expect(result.nextConfig.apiKey).toBe('secret');
    expect(result.nextConfig.keyFilePath).toBeUndefined();
  });

  it('sets keyfile and clears key', async () => {
    const testKeyPath = path.join(os.tmpdir(), 'nui-test-keyfile');
    const result = await applyConfigCommand(`/keyfile ${testKeyPath}`, {
      ...BASE_CONFIG,
      apiKey: 'old',
    });
    expect(result.nextConfig.keyFilePath).toBe(testKeyPath);
    expect(result.nextConfig.apiKey).toBeUndefined();
  });

  it('sets model', async () => {
    const result = await applyConfigCommand('/model hf:test', BASE_CONFIG);
    expect(result.nextConfig.model).toBe('hf:test');
  });

  it('defers empty model to caller', async () => {
    const result = await applyConfigCommand('/model', BASE_CONFIG);
    expect(result.handled).toBe(false);
    expect(result.nextConfig).toStrictEqual(BASE_CONFIG);
  });

  it('ignores unknown command', async () => {
    const result = await applyConfigCommand('/unknown foo', BASE_CONFIG);
    expect(result.handled).toBe(false);
    expect(result.nextConfig).toStrictEqual(BASE_CONFIG);
  });

  it('loads profile when complete with load action', async () => {
    const manager = new FakeProfileManager({
      synthetic: {
        version: 1,
        provider: 'openai',
        model: 'hf:zai-org/GLM-4.6',
        modelParams: { temperature: 0.7 },
        ephemeralSettings: {
          'base-url': 'https://api.synthetic.new/openai/v1',
          'auth-keyfile': '/Users/example/.synthetic_key',
        },
      },
    });

    const result = await applyConfigCommand(
      '/profile load synthetic',
      BASE_CONFIG,
      { profileManager: manager },
    );
    expect(result.messages[0]).toContain('Loaded profile: synthetic');
    expect(result.nextConfig.provider).toBe('openai');
    expect(result.nextConfig.model).toBe('hf:zai-org/GLM-4.6');
    expect(result.nextConfig['base-url']).toBe(
      'https://api.synthetic.new/openai/v1',
    );
    expect(result.nextConfig.keyFilePath).toBe('/Users/example/.synthetic_key');
  });

  it('reports error for incomplete profile', async () => {
    const manager = new FakeProfileManager({
      synthetic: {
        version: 1,
        provider: 'openai',
      },
    });

    const result = await applyConfigCommand(
      '/profile load synthetic',
      BASE_CONFIG,
      { profileManager: manager },
    );
    expect(result.messages[0]).toContain('incomplete');
    expect(result.nextConfig).toStrictEqual(BASE_CONFIG);
  });

  it('validates missing pieces', () => {
    const messages = validateSessionConfig({ provider: 'openai' });
    expect(messages.some((m) => m.toLowerCase().includes('base url'))).toBe(
      true,
    );
    expect(messages.some((m) => m.toLowerCase().includes('model'))).toBe(true);
    expect(messages.some((m) => m.toLowerCase().includes('key'))).toBe(true);
  });

  it('can skip model requirement', () => {
    const messages = validateSessionConfig(
      { provider: 'openai' },
      { requireModel: false },
    );
    expect(messages.some((m) => m.toLowerCase().includes('model'))).toBe(false);
    expect(messages.some((m) => m.toLowerCase().includes('base url'))).toBe(
      true,
    );
  });
});

class FakeProfileManager {
  private readonly profiles: Record<string, unknown>;

  constructor(profiles: Record<string, unknown>) {
    this.profiles = profiles;
  }

  loadProfile(name: string): Promise<Profile> {
    const profile = this.profiles[name];
    if (profile === undefined) {
      return Promise.reject(new Error(`Profile '${name}' not found`));
    }
    return Promise.resolve(profile as Profile);
  }

  listProfiles(): Promise<string[]> {
    return Promise.resolve(Object.keys(this.profiles));
  }
}

describe('profileToConfigOptions', () => {
  it('should convert ProfileData to ConfigSessionOptions', () => {
    const profile: ProfileData = {
      provider: 'openai',
      model: 'gpt-4',
      authKeyfile: '/path/to/key',
      ephemeralSettings: {
        'base-url': 'https://api.example.com',
        streaming: 'disabled',
      },
    };

    const options = profileToConfigOptions(profile, '/work/dir');

    expect(options.model).toBe('gpt-4');
    expect(options.provider).toBe('openai');
    expect(options['base-url']).toBe('https://api.example.com');
    expect(options.authKeyfile).toBe('/path/to/key');
    expect(options.workingDir).toBe('/work/dir');
  });

  it('should use base-url from ephemeral settings', () => {
    const profile: ProfileData = {
      provider: 'openai',
      model: 'gpt-4',
      ephemeralSettings: { 'base-url': 'https://override.api.com' },
    };

    const options = profileToConfigOptions(profile, '/work');

    expect(options['base-url']).toBe('https://override.api.com');
  });

  it('should handle ephemeral settings override for model', () => {
    const profile: ProfileData = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      ephemeralSettings: { model: 'gemini-2.5-pro' },
    };

    const options = profileToConfigOptions(profile, '/work');

    expect(options.model).toBe('gemini-2.5-pro');
  });

  it('should handle ephemeral settings override for authKeyfile', () => {
    const profile: ProfileData = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      authKeyfile: '/default/key',
      ephemeralSettings: { 'auth-keyfile': '/override/key' },
    };

    const options = profileToConfigOptions(profile, '/work');

    expect(options.authKeyfile).toBe('/override/key');
  });

  it('should handle missing optional fields', () => {
    const profile: ProfileData = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    };

    const options = profileToConfigOptions(profile, '/work');

    expect(options.model).toBe('gemini-2.5-flash');
    expect(options.provider).toBe('gemini');
    expect(options['base-url']).toBeUndefined();
    expect(options.authKeyfile).toBeUndefined();
  });

  it('should handle apiKey from ephemeral settings', () => {
    const profile: ProfileData = {
      provider: 'openai',
      model: 'gpt-4',
      ephemeralSettings: { 'auth-key': 'sk-test-key-12345' },
    };

    const options = profileToConfigOptions(profile, '/work');

    expect(options.apiKey).toBe('sk-test-key-12345');
  });

  it('should use authKeyfile from profile when not in ephemeral settings', () => {
    const profile: ProfileData = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      authKeyfile: '/profile/key',
    };

    const options = profileToConfigOptions(profile, '/work');

    expect(options.authKeyfile).toBe('/profile/key');
  });
});
