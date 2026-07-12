import { beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  setProviderApiKey,
  setProviderBaseUrl,
  type ProviderConfigDependencies,
} from './providerConfigUtils.js';

describe('providerConfigUtils runtime wrappers', () => {
  let dependencies: ProviderConfigDependencies;
  let sanitizeApiKey: ReturnType<typeof vi.fn>;
  let updateApiKey: ReturnType<typeof vi.fn>;
  let updateBaseUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sanitizeApiKey = vi.fn((value: string) => `sanitized-${value}`);
    updateApiKey = vi.fn(async () => ({
      changed: true,
      providerName: 'openai',
      message: 'API key set',
      isPaidMode: false,
    }));
    updateBaseUrl = vi.fn(async () => ({
      changed: true,
      providerName: 'openai',
      message: 'Base URL set',
    }));
    dependencies = { sanitizeApiKey, updateApiKey, updateBaseUrl };
  });

  it('sanitizes API keys before delegating to runtime helper', async () => {
    const result = await setProviderApiKey('  api-key  ', dependencies);

    expect(updateApiKey).toHaveBeenCalledTimes(1);
    expect(updateApiKey).toHaveBeenCalledWith('sanitized-api-key');
    expect(result).toStrictEqual({
      success: true,
      message: 'API key set',
      isPaidMode: false,
    });
  });

  it('passes null to runtime helper when removing API key', async () => {
    await setProviderApiKey('none', dependencies);

    expect(updateApiKey).toHaveBeenCalledWith(null);
  });

  it('propagates helper errors when API key update fails', async () => {
    updateApiKey.mockRejectedValueOnce(new Error('boom'));

    const result = await setProviderApiKey('bad-key', dependencies);
    expect(result.success).toBe(false);
    expect(result.message).toContain('boom');
  });

  it('normalizes base URL inputs before delegating', async () => {
    await setProviderBaseUrl(' https://example.com ', dependencies);

    expect(updateBaseUrl).toHaveBeenCalledWith('https://example.com');
  });

  it('converts "none" base URL to null', async () => {
    await setProviderBaseUrl('none', dependencies);

    expect(updateBaseUrl).toHaveBeenCalledWith(null);
  });

  it('propagates helper errors when base URL update fails', async () => {
    updateBaseUrl.mockRejectedValueOnce(new Error('invalid url'));

    const result = await setProviderBaseUrl('https://bad', dependencies);
    expect(result.success).toBe(false);
    expect(result.message).toContain('invalid url');
  });
});
