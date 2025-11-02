import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  sanitizeForByteStringMock,
  needsSanitizationMock,
  updateActiveProviderApiKeyMock,
  updateActiveProviderBaseUrlMock,
} = vi.hoisted(() => ({
  sanitizeForByteStringMock: vi.fn((value: string) => `sanitized-${value}`),
  needsSanitizationMock: vi.fn(() => false),
  updateActiveProviderApiKeyMock: vi.fn(async () => ({
    message: 'API key set',
    isPaidMode: true,
  })),
  updateActiveProviderBaseUrlMock: vi.fn(async () => ({
    message: 'Base URL set',
  })),
}));

vi.mock('@vybestack/llxprt-code-core', () => ({
  sanitizeForByteString: sanitizeForByteStringMock,
  needsSanitization: needsSanitizationMock,
}));

vi.mock('../runtime/runtimeSettings.js', () => ({
  updateActiveProviderApiKey: updateActiveProviderApiKeyMock,
  updateActiveProviderBaseUrl: updateActiveProviderBaseUrlMock,
}));

import {
  setProviderApiKey,
  setProviderBaseUrl,
} from '../providers/providerConfigUtils.js';

describe('providerConfigUtils runtime wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateActiveProviderApiKeyMock.mockResolvedValue({
      message: 'API key set',
      isPaidMode: false,
    });
    updateActiveProviderBaseUrlMock.mockResolvedValue({
      message: 'Base URL set',
    });
  });

  it('sanitizes API keys before delegating to runtime helper', async () => {
    const result = await setProviderApiKey('  api-key  ');

    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledTimes(1);
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(
      'sanitized-api-key',
    );
    expect(result).toEqual({
      success: true,
      message: 'API key set',
      isPaidMode: false,
    });
  });

  it('passes null to runtime helper when removing API key', async () => {
    await setProviderApiKey('none');

    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(null);
  });

  it('propagates helper errors when API key update fails', async () => {
    updateActiveProviderApiKeyMock.mockRejectedValueOnce(new Error('boom'));

    const result = await setProviderApiKey('bad-key');
    expect(result.success).toBe(false);
    expect(result.message).toContain('boom');
  });

  it('normalizes base URL inputs before delegating', async () => {
    await setProviderBaseUrl(' https://example.com ');

    expect(updateActiveProviderBaseUrlMock).toHaveBeenCalledWith(
      'https://example.com',
    );
  });

  it('converts "none" base URL to null', async () => {
    await setProviderBaseUrl('none');

    expect(updateActiveProviderBaseUrlMock).toHaveBeenCalledWith(null);
  });

  it('propagates helper errors when base URL update fails', async () => {
    updateActiveProviderBaseUrlMock.mockRejectedValueOnce(
      new Error('invalid url'),
    );

    const result = await setProviderBaseUrl('https://bad');
    expect(result.success).toBe(false);
    expect(result.message).toContain('invalid url');
  });
});
