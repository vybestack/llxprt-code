/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseZedAuthMethodId } from './zedIntegration.js';

// Mock runtimeSettings to test credential cache clearing logic
const mockGetActiveProfileName = vi.fn<() => string | null>();
const mockLoadProfileByName = vi.fn<(name: string) => Promise<void>>();
vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  clearActiveModelParam: vi.fn(),
  getActiveModelParams: vi.fn(),
  getActiveProfileName: (...args: unknown[]) =>
    mockGetActiveProfileName(...(args as [])),
  loadProfileByName: (...args: unknown[]) =>
    mockLoadProfileByName(...(args as [string])),
}));

const mockClearCachedCredentialFile = vi.fn<() => Promise<void>>();
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    clearCachedCredentialFile: (...args: unknown[]) =>
      mockClearCachedCredentialFile(...(args as [])),
  };
});

describe('zedIntegration auth method validation', () => {
  it('accepts known profile names', () => {
    expect(parseZedAuthMethodId('alpha', ['alpha', 'beta'])).toBe('alpha');
    expect(parseZedAuthMethodId('beta', ['alpha', 'beta'])).toBe('beta');
  });

  it('rejects unknown profile names', () => {
    expect(() => parseZedAuthMethodId('gamma', ['alpha', 'beta'])).toThrow(
      /Invalid enum value/,
    );
  });

  it('rejects selection when no profiles exist', () => {
    expect(() => parseZedAuthMethodId('alpha', [])).toThrow(
      /No profiles available for selection/,
    );
  });
});

describe('GeminiAgent.authenticate credential cache', () => {
  // Import dynamically after mocks are set up
  let GeminiAgent: typeof import('./zedIntegration.js').GeminiAgent;

  beforeAll(async () => {
    const mod = await import('./zedIntegration.js');
    GeminiAgent = mod.GeminiAgent;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadProfileByName.mockResolvedValue(undefined);
  });

  function createAgent(): InstanceType<typeof GeminiAgent> {
    const mockConfig = {
      getProfileManager: () => ({
        listProfiles: async () => ['alpha', 'beta'],
      }),
      getEphemeralSetting: () => undefined,
    };
    const agent = new GeminiAgent(
      mockConfig as never,
      { debug: () => {} } as never,
      undefined as never,
    );
    // Stub applyRuntimeProviderOverrides to avoid config dependencies
    vi.spyOn(agent as never, 'applyRuntimeProviderOverrides').mockResolvedValue(
      undefined,
    );
    return agent;
  }

  it('clears credential cache when switching to a different profile', async () => {
    mockGetActiveProfileName.mockReturnValue('alpha');
    mockClearCachedCredentialFile.mockResolvedValue(undefined);

    const agent = createAgent();
    await agent.authenticate({ methodId: 'beta' });

    expect(mockClearCachedCredentialFile).toHaveBeenCalledOnce();
    expect(mockLoadProfileByName).toHaveBeenCalledWith('beta');
  });

  it('does NOT clear credential cache when re-authenticating same profile', async () => {
    mockGetActiveProfileName.mockReturnValue('alpha');
    mockClearCachedCredentialFile.mockResolvedValue(undefined);

    const agent = createAgent();
    await agent.authenticate({ methodId: 'alpha' });

    expect(mockClearCachedCredentialFile).not.toHaveBeenCalled();
    expect(mockLoadProfileByName).toHaveBeenCalledWith('alpha');
  });

  it('clears credential cache when no active profile exists', async () => {
    mockGetActiveProfileName.mockReturnValue(null);
    mockClearCachedCredentialFile.mockResolvedValue(undefined);

    const agent = createAgent();
    await agent.authenticate({ methodId: 'alpha' });

    expect(mockClearCachedCredentialFile).toHaveBeenCalledOnce();
    expect(mockLoadProfileByName).toHaveBeenCalledWith('alpha');
  });
});
