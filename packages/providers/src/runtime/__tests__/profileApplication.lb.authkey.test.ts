/**
 * auth-key-name resolution in LoadBalancing sub-profiles (issue #1970).
 * Split from profileApplication.lb.test.ts during #2092 lint hardening.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Profile } from '@vybestack/llxprt-code-settings';
import * as fs from 'node:fs/promises';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { GenerateChatOptions } from '../../IProvider.js';
import {
  isResolvedSubProfile,
  type ResolvedSubProfile,
} from '../../loadBalancing/loadBalancerTypes.js';
import { resolveMemberAuthentication } from '../../loadBalancing/memberAuthentication.js';
import { buildRoundRobinResolvedOptions } from '../../loadBalancing/resolvedOptionsBuilder.js';
import { createProviderKeyStorage } from '../../auth/proxy/credential-store-factory.js';
import {
  switchActiveProviderMock,
  setActiveModelMock,
  updateActiveProviderBaseUrlMock,
  updateActiveProviderApiKeyMock,
  setActiveModelParamMock,
  clearActiveModelParamMock,
  getActiveModelParamsMock,
  setEphemeralSettingMock,
  getCliRuntimeServicesMock,
  getActiveProviderOrThrowMock,
  isCliStatelessProviderModeEnabledMock,
  isCliRuntimeStatelessReadyMock,
  keyStorageStub,
  profileManagerStub,
  wrapRegisterProviderToCaptureLB,
  resetLbProfileApplicationStubs,
  makeLbProfile,
  createTempKeyfile,
  getLbSubProfiles,
} from './lbProfileApplicationTestSetup.js';

void vi.mock('../runtimeSettings.js', () => ({
  switchActiveProvider: switchActiveProviderMock,
  setActiveModel: setActiveModelMock,
  updateActiveProviderBaseUrl: updateActiveProviderBaseUrlMock,
  updateActiveProviderApiKey: updateActiveProviderApiKeyMock,
  setActiveModelParam: setActiveModelParamMock,
  clearActiveModelParam: clearActiveModelParamMock,
  getActiveModelParams: getActiveModelParamsMock,
  setEphemeralSetting: setEphemeralSettingMock,
  createProviderKeyStorage,
  getCliRuntimeServices: getCliRuntimeServicesMock,
  getActiveProviderOrThrow: getActiveProviderOrThrowMock,
  isCliStatelessProviderModeEnabled: isCliStatelessProviderModeEnabledMock,
  isCliRuntimeStatelessReady: isCliRuntimeStatelessReadyMock,
}));

const { applyProfileWithGuards } = await import('../profileApplication.js');

function getResolvedMember(
  lbProvider: Parameters<typeof getLbSubProfiles>[0],
  name: string,
): ResolvedSubProfile {
  const member = getLbSubProfiles(lbProvider).find((sp) => sp.name === name);
  if (!isResolvedSubProfile(member)) {
    throw new Error(`Expected registered member ${name}`);
  }
  return member;
}

async function buildMemberOptions(
  member: ResolvedSubProfile,
): Promise<GenerateChatOptions> {
  const logger = new DebugLogger('llxprt:test:lb-auth-key');
  return buildRoundRobinResolvedOptions(
    await resolveMemberAuthentication(member, logger),
    { contents: [] },
    {
      lbProfileEphemeralSettings: undefined,
      lbProfileModelParams: undefined,
      logger,
      providerName: 'load-balancer',
      getEffectiveContextLimit: () => undefined,
    },
  );
}

async function resolveNamedApiKey(name: string): Promise<string | null> {
  if (name === 'chutes') return 'resolved-chutes-api-key';
  if (name === 'openrouter') return 'resolved-openrouter-api-key';
  return null;
}

async function loadNamedAuthProfile(profileName: string): Promise<Profile> {
  if (profileName === 'zai') {
    return {
      version: 1,
      provider: 'Chutes.ai',
      model: 'model-zai',
      modelParams: {},
      ephemeralSettings: {
        'auth-key-name': 'chutes',
        'base-url': 'https://chutes.ai/v1',
      },
    };
  }
  return {
    version: 1,
    provider: 'OpenRouter',
    model: 'model-glm51',
    modelParams: {},
    ephemeralSettings: {
      'auth-key-name': 'openrouter',
      'base-url': 'https://openrouter.ai/v1',
    },
  };
}

describe('auth-key-name resolution in sub-profiles (issue #1970)', () => {
  let restoreStorage: (() => void) | undefined;

  beforeEach(() => {
    resetLbProfileApplicationStubs();
    if (process.env.LLXPRT_TEST_STORAGE_ISOLATED !== '1') {
      throw new Error('LB auth-key tests require isolated storage');
    }
    const getKey = vi.spyOn(createProviderKeyStorage(), 'getKey');
    restoreStorage = () => getKey.mockRestore();
    getKey.mockImplementation(keyStorageStub.getKey);
  });

  afterEach(() => {
    restoreStorage?.();
    restoreStorage = undefined;
    vi.clearAllMocks();
  });

  it('resolves each member named key into delegate options only at use time', async () => {
    keyStorageStub.getKey.mockImplementation(resolveNamedApiKey);

    const lbProfile = makeLbProfile(['zai', 'ollamaglm51']);

    const mockLoadProfile = vi.fn(loadNamedAuthProfile);
    profileManagerStub.loadProfile = mockLoadProfile;

    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    await applyProfileWithGuards(lbProfile, {
      profileName: 'glm',
    });

    const lbProvider = getLBProvider();
    expect(lbProvider).not.toBeNull();
    const zaiSub = getResolvedMember(lbProvider, 'zai');
    const ollamaSub = getResolvedMember(lbProvider, 'ollamaglm51');
    expect(zaiSub.authKeyName).toBe('chutes');
    expect(ollamaSub.authKeyName).toBe('openrouter');
    expect(zaiSub.authToken).toBeUndefined();
    expect(ollamaSub.authToken).toBeUndefined();
    expect(keyStorageStub.getKey).not.toHaveBeenCalled();

    const zaiOptions = await buildMemberOptions(zaiSub);
    expect(zaiOptions.metadata?.profileId).toBe('zai');
    expect(zaiOptions.resolved?.authToken).toBe('resolved-chutes-api-key');
    expect(keyStorageStub.getKey).toHaveBeenCalledWith('chutes');
    expect(keyStorageStub.getKey).not.toHaveBeenCalledWith('openrouter');

    const ollamaOptions = await buildMemberOptions(ollamaSub);
    expect(ollamaOptions.metadata?.profileId).toBe('ollamaglm51');
    expect(ollamaOptions.resolved?.authToken).toBe(
      'resolved-openrouter-api-key',
    );
    expect(keyStorageStub.getKey).toHaveBeenCalledWith('openrouter');
    expect(zaiSub.authToken).toBeUndefined();
    expect(ollamaSub.authToken).toBeUndefined();
  });

  it('reads a rotated named key on the next options build without caching plaintext', async () => {
    keyStorageStub.getKey.mockResolvedValue('  key-A  ');
    profileManagerStub.loadProfile = vi.fn(loadNamedAuthProfile);
    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    await applyProfileWithGuards(makeLbProfile(['zai']), {
      profileName: 'glm',
    });

    const member = getResolvedMember(getLBProvider(), 'zai');
    expect(member.authKeyName).toBe('chutes');
    expect(member.authToken).toBeUndefined();
    expect(keyStorageStub.getKey).not.toHaveBeenCalled();

    const firstOptions = await buildMemberOptions(member);
    expect(firstOptions.resolved?.authToken).toBe('key-A');
    expect(member.authToken).toBeUndefined();

    keyStorageStub.getKey.mockResolvedValue('  key-B  ');
    const secondOptions = await buildMemberOptions(member);
    expect(secondOptions.resolved?.authToken).toBe('key-B');
    expect(firstOptions.resolved?.authToken).toBe('key-A');
    expect(member.authToken).toBeUndefined();
    expect(keyStorageStub.getKey).toHaveBeenCalledTimes(2);
    expect(keyStorageStub.getKey).toHaveBeenCalledWith('chutes');
  });

  it('reads keyfile rotation between attempts without storing plaintext on the member', async () => {
    const { tempDir, keyfilePath } =
      await createTempKeyfile('  first-file-key  ');
    try {
      profileManagerStub.loadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: { 'auth-keyfile': keyfilePath },
        }),
      );
      const { getLBProvider } = wrapRegisterProviderToCaptureLB();
      await applyProfileWithGuards(makeLbProfile(['keyfile-member']), {
        profileName: 'file-lb',
      });
      const member = getResolvedMember(getLBProvider(), 'keyfile-member');
      expect(member.authToken).toStrictEqual(undefined);
      const first = await buildMemberOptions(member);
      await fs.writeFile(keyfilePath, '  second-file-key  ');
      const second = await buildMemberOptions(member);
      expect([
        first.resolved?.authToken,
        second.resolved?.authToken,
      ]).toStrictEqual(['first-file-key', 'second-file-key']);
      expect(member.authToken).toStrictEqual(undefined);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('prefers explicit auth-key over auth-key-name', async () => {
    keyStorageStub.getKey.mockResolvedValue('resolved-from-storage');

    const lbProfile = makeLbProfile(['explicitKey']);

    const mockLoadProfile = vi.fn(
      async (): Promise<Profile> => ({
        version: 1,
        provider: 'gemini',
        model: 'gemini-flash',
        modelParams: {},
        ephemeralSettings: {
          'auth-key': 'explicit-direct-key',
          'auth-key-name': 'chutes',
        },
      }),
    );
    profileManagerStub.loadProfile = mockLoadProfile;

    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    await applyProfileWithGuards(lbProfile, {
      profileName: 'myLB',
    });

    const lbProvider = getLBProvider();
    expect(lbProvider).not.toBeNull();
    const member = getResolvedMember(lbProvider, 'explicitKey');
    expect(keyStorageStub.getKey).not.toHaveBeenCalled();
    expect(member.authToken).toBe('explicit-direct-key');
    expect(member.authKeyName).toBeUndefined();

    const options = await buildMemberOptions(member);
    expect(options.resolved?.authToken).toBe('explicit-direct-key');
    expect(keyStorageStub.getKey).not.toHaveBeenCalled();
  });

  it('continues without a token when the named key is missing at use time', async () => {
    keyStorageStub.getKey.mockResolvedValue(null);

    const lbProfile = makeLbProfile(['missingKeyProfile']);

    const mockLoadProfile = vi.fn(
      async (): Promise<Profile> => ({
        version: 1,
        provider: 'gemini',
        model: 'gemini-flash',
        modelParams: {},
        ephemeralSettings: {
          'auth-key-name': 'nonexistent-key',
        },
      }),
    );
    profileManagerStub.loadProfile = mockLoadProfile;

    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    await applyProfileWithGuards(lbProfile, {
      profileName: 'myLB',
    });

    const lbProvider = getLBProvider();
    expect(lbProvider).not.toBeNull();
    const member = getResolvedMember(lbProvider, 'missingKeyProfile');
    expect(member.authKeyName).toBe('nonexistent-key');
    expect(member.authToken).toBeUndefined();
    expect(keyStorageStub.getKey).not.toHaveBeenCalled();

    const options = await buildMemberOptions(member);
    expect(options.metadata?.profileId).toBe('missingKeyProfile');
    expect(options.resolved?.authToken).toBeUndefined();
    expect(keyStorageStub.getKey).toHaveBeenCalledWith('nonexistent-key');
  });

  it('falls back to the member keyfile at use time when the named key is missing', async () => {
    keyStorageStub.getKey.mockResolvedValue(null);
    const { tempDir, keyfilePath } = await createTempKeyfile(
      'resolved-from-keyfile\n',
    );

    try {
      const lbProfile = makeLbProfile(['fallbackProfile']);

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {
            'auth-key-name': 'missing-key',
            'auth-keyfile': keyfilePath,
          },
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      const lbProvider = getLBProvider();
      expect(lbProvider).not.toBeNull();
      const member = getResolvedMember(lbProvider, 'fallbackProfile');
      expect(member.authKeyName).toBe('missing-key');
      expect(member.authKeyfile).toBe(keyfilePath);
      expect(member.authToken).toBeUndefined();
      expect(keyStorageStub.getKey).not.toHaveBeenCalled();

      await fs.writeFile(keyfilePath, '  resolved-from-keyfile-at-use-time  ');
      const options = await buildMemberOptions(member);
      expect(options.metadata?.profileId).toBe('fallbackProfile');
      expect(options.resolved?.authToken).toBe(
        'resolved-from-keyfile-at-use-time',
      );
      expect(keyStorageStub.getKey).toHaveBeenCalledWith('missing-key');
      expect(member.authToken).toBeUndefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
