/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving the foreground session's live `dumpcontext` mode is
 * inherited by isolated subagent runtime settings services (Issue #3151).
 *
 * Most exercise the real `SubagentOrchestrator` assembly boundary: real
 * `createIsolatedRuntimeContext`, real settings population, and a stubbed
 * runtime loader/scope factory so the populated settings service can be
 * inspected without a full agent runtime. The load-balancer test spies on the
 * runtime activation seams to keep LB provider activation deterministic.
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import * as runtimeModule from '@vybestack/llxprt-code-providers/runtime.js';
import * as profileApplicationModule from '@vybestack/llxprt-code-providers/runtime/profileApplication.js';
import type { SubAgentScope } from '../subagent.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { createRuntimeBundle } from './subagentOrchestrator-test-helpers.js';

// handle.activate() uses a persistent enterWith that leaks the AsyncLocalStorage
// store across tests; reset between every test so each launch starts from a
// clean runtime identity.

const subagentConfig: SubagentConfig = {
  name: 'helper',
  profile: 'helper-profile',
  systemPrompt: 'You are a helpful assistant.',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const baseProfile: Profile = {
  version: 1,
  provider: 'gemini',
  model: 'gemini-1.5-flash',
  modelParams: { temperature: 0.3, top_p: 0.95 },
  ephemeralSettings: { 'auth-key': 'subagent-key' },
};

function makeConfigWithSettings(settings: SettingsService): Config {
  return {
    getSessionId: () => 'primary-session',
    getProvider: () => 'gemini',
    getContentGeneratorConfig: () => undefined,
    getModel: () => 'gemini-1.5-flash',
    getToolRegistry: () => undefined,
    getSettingsService: () => settings,
    getEphemeralSetting: (key: string) => settings.get(key),
    setEphemeralSetting: (key: string, value: unknown) =>
      settings.set(key, value),
  } as unknown as Config;
}

async function launchSubagent(
  foregroundSettings: SettingsService,
  profile: Profile = baseProfile,
): Promise<{
  isolatedSettings: SettingsService;
  dispose: () => Promise<void>;
}> {
  const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
  const loadProfile = vi.fn().mockResolvedValue(profile);
  const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle('sess'));
  const scope = {
    runtimeContext: createRuntimeBundle('sess').runtimeContext,
    getAgentId: () => 'helper-1',
  } as unknown as SubAgentScope;
  const scopeFactory = vi
    .fn<typeof SubAgentScope.create>()
    .mockResolvedValue(scope);

  const orchestrator = new SubagentOrchestrator({
    subagentManager: { loadSubagent } as unknown as SubagentManager,
    profileManager: { loadProfile } as unknown as ProfileManager,
    foregroundConfig: makeConfigWithSettings(foregroundSettings),
    scopeFactory,
    runtimeLoader,
    messageBus: new MessageBus(),
  });

  const result = await orchestrator.launch({ name: subagentConfig.name });
  const isolatedSettings = runtimeLoader.mock.calls[0][0].profile
    .providerRuntime.settingsService as SettingsService;

  return { isolatedSettings, dispose: result.dispose };
}

describe('SubagentOrchestrator — session dumpcontext inheritance (#3151)', () => {
  afterEach(() => {
    runtimeModule.resetRuntimeScopeForTesting();
    runtimeModule.resetCliRuntimeRegistryForTesting();
  });

  it('inherits the foreground on mode in the isolated settings service', async () => {
    const foreground = new SettingsService();
    foreground.setSessionScoped('dumpcontext', 'on');

    const { isolatedSettings, dispose } = await launchSubagent(foreground);

    expect(isolatedSettings.get('dumpcontext')).toBe('on');
    expect(isolatedSettings.getAllGlobalSettings().dumpcontext).toBe('on');

    await dispose();
  });

  it('inherits the foreground error mode', async () => {
    const foreground = new SettingsService();
    foreground.setSessionScoped('dumpcontext', 'error');

    const { isolatedSettings, dispose } = await launchSubagent(foreground);

    expect(isolatedSettings.get('dumpcontext')).toBe('error');
    expect(isolatedSettings.getAllGlobalSettings().dumpcontext).toBe('error');

    await dispose();
  });

  it('inherits the foreground off mode, overriding a profile-local on value', async () => {
    const foreground = new SettingsService();
    foreground.setSessionScoped('dumpcontext', 'off');

    const profileWithDumpOn: Profile = {
      ...baseProfile,
      ephemeralSettings: {
        ...baseProfile.ephemeralSettings,
        dumpcontext: 'on',
      },
    };

    const { isolatedSettings, dispose } = await launchSubagent(
      foreground,
      profileWithDumpOn,
    );

    expect(isolatedSettings.get('dumpcontext')).toBe('off');
    expect(isolatedSettings.getAllGlobalSettings().dumpcontext).toBe('off');

    await dispose();
  });

  it('observes live foreground on -> off -> error changes on later reads', async () => {
    const foreground = new SettingsService();
    foreground.setSessionScoped('dumpcontext', 'on');

    const { isolatedSettings, dispose } = await launchSubagent(foreground);

    expect(isolatedSettings.get('dumpcontext')).toBe('on');

    foreground.setSessionScoped('dumpcontext', 'off');
    expect(isolatedSettings.get('dumpcontext')).toBe('off');
    expect(isolatedSettings.getAllGlobalSettings().dumpcontext).toBe('off');

    foreground.setSessionScoped('dumpcontext', 'error');
    expect(isolatedSettings.get('dumpcontext')).toBe('error');
    expect(isolatedSettings.getAllGlobalSettings().dumpcontext).toBe('error');

    await dispose();
  });

  it('leaves a previously returned snapshot unchanged after later foreground edits', async () => {
    const foreground = new SettingsService();
    foreground.setSessionScoped('dumpcontext', 'on');

    const { isolatedSettings, dispose } = await launchSubagent(foreground);

    const snapshotBefore = isolatedSettings.getAllGlobalSettings();
    expect(snapshotBefore.dumpcontext).toBe('on');

    foreground.setSessionScoped('dumpcontext', 'off');

    expect(snapshotBefore.dumpcontext).toBe('on');
    expect(isolatedSettings.getAllGlobalSettings().dumpcontext).toBe('off');

    await dispose();
  });

  it('falls back to the profile-local dumpcontext when the foreground has no value', async () => {
    const foreground = new SettingsService();

    const profileWithDumpOn: Profile = {
      ...baseProfile,
      ephemeralSettings: {
        ...baseProfile.ephemeralSettings,
        dumpcontext: 'on',
      },
    };

    const { isolatedSettings, dispose } = await launchSubagent(
      foreground,
      profileWithDumpOn,
    );

    expect(isolatedSettings.get('dumpcontext')).toBe('on');

    await dispose();
  });

  it('does not inherit unrelated foreground ephemerals into the isolated service', async () => {
    const foreground = new SettingsService();
    foreground.setSessionScoped('dumpcontext', 'on');
    foreground.set('temperature', 0.9);
    foreground.set('auth-key', 'sk-foreground-secret');
    foreground.setProviderSetting('gemini', 'model', 'foreground-model');

    const { isolatedSettings, dispose } = await launchSubagent(foreground);

    expect(isolatedSettings.get('dumpcontext')).toBe('on');
    expect(isolatedSettings.get('temperature')).toBeUndefined();
    expect(isolatedSettings.get('auth-key')).toBe('subagent-key');
    expect(isolatedSettings.getProviderSettings('gemini').model).toBe(
      'gemini-1.5-flash',
    );

    await dispose();
  });

  it('a new independent subagent does not leak a prior session dumpcontext', async () => {
    const foregroundA = new SettingsService();
    foregroundA.setSessionScoped('dumpcontext', 'on');
    const { dispose: disposeA } = await launchSubagent(foregroundA);

    const foregroundB = new SettingsService();
    const { isolatedSettings, dispose } = await launchSubagent(foregroundB);

    expect(isolatedSettings.get('dumpcontext')).toBeUndefined();
    expect(isolatedSettings.getAllGlobalSettings().dumpcontext).toBeUndefined();

    await disposeA();
    await dispose();
  });

  it('inherits the foreground dumpcontext for a load-balancer subagent', async () => {
    // Launch a genuine load-balancer profile through SubagentOrchestrator.launch
    // so the private createRuntimeBundle load-balancer branch is exercised end
    // to end. The real LB provider/client activation (which intermittently
    // hangs on agent client initialisation) is avoided deterministically by
    // spying on the createIsolatedRuntimeContext and applyProfileWithGuards
    // seams. The mocked isolated handle retains the production settingsService
    // passed by the orchestrator, so the runtime loader receives and exposes
    // the service constructed by production code.
    const loadBalancerProfile: Profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['lb-member'],
      provider: 'load-balancer',
      model: 'load-balancer',
      modelParams: {},
      ephemeralSettings: {},
    };
    const memberProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: { 'auth-key': 'member-key' },
    };

    const foreground = new SettingsService();
    foreground.setSessionScoped('dumpcontext', 'on');

    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn(async (profileName: string) => {
      if (profileName === subagentConfig.profile) {
        return loadBalancerProfile;
      }
      if (profileName === 'lb-member') {
        return memberProfile;
      }
      throw new Error(`unexpected profile ${profileName}`);
    });
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle('lb'));
    const lbScope = {
      runtimeContext: createRuntimeBundle('lb').runtimeContext,
      getAgentId: () => 'lb-helper-1',
    } as unknown as SubAgentScope;
    const scopeFactory = vi
      .fn<typeof SubAgentScope.create>()
      .mockResolvedValue(lbScope);

    let capturedSettings: SettingsService | undefined;
    const isolatedSpy = vi
      .spyOn(runtimeModule, 'createIsolatedRuntimeContext')
      .mockImplementation(
        (
          options: Parameters<
            typeof runtimeModule.createIsolatedRuntimeContext
          >[0],
        ) => {
          const settingsService = options.settingsService ?? foreground;
          capturedSettings = settingsService;
          return {
            runtimeId: options.runtimeId ?? 'lb-isolated',
            metadata: options.metadata ?? { source: 'test' },
            settingsService,
            config: makeConfigWithSettings(settingsService),
            providerManager: {},
            oauthManager: {},
            activate: vi.fn().mockResolvedValue(undefined),
            cleanup: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<
            typeof runtimeModule.createIsolatedRuntimeContext
          >;
        },
      );
    const applyProfileSpy = vi
      .spyOn(profileApplicationModule, 'applyProfileWithGuards')
      .mockResolvedValue({
        providerName: 'load-balancer',
        modelName: 'load-balancer',
        infoMessages: [],
        warnings: [],
        providerChanged: true,
        didFallback: false,
        requestedProvider: 'load-balancer',
      });

    try {
      const orchestrator = new SubagentOrchestrator({
        subagentManager: { loadSubagent } as unknown as SubagentManager,
        profileManager: { loadProfile } as unknown as ProfileManager,
        foregroundConfig: makeConfigWithSettings(foreground),
        scopeFactory,
        runtimeLoader,
        messageBus: new MessageBus(),
      });

      const result = await orchestrator.launch({
        name: subagentConfig.name,
      });

      // The LB activation seam was selected/called (applyProfileWithGuards)
      // rather than the ordinary executeProviderActivation path.
      expect(applyProfileSpy).toHaveBeenCalledTimes(1);
      expect(applyProfileSpy.mock.calls[0][0]).toBe(loadBalancerProfile);

      // The runtime loader receives the foreground on mode through the
      // production-constructed isolated settings service.
      const isolatedSettings = runtimeLoader.mock.calls[0][0].profile
        .providerRuntime.settingsService as SettingsService;
      expect(isolatedSettings).toBe(capturedSettings);
      expect(isolatedSettings).not.toBe(foreground);
      expect(isolatedSettings.get('dumpcontext')).toBe('on');
      expect(isolatedSettings.getAllGlobalSettings().dumpcontext).toBe('on');

      // The same already-created isolated service observes later live
      // foreground changes through the shared session overlay.
      foreground.setSessionScoped('dumpcontext', 'error');
      expect(isolatedSettings.get('dumpcontext')).toBe('error');

      foreground.setSessionScoped('dumpcontext', 'off');
      expect(isolatedSettings.get('dumpcontext')).toBe('off');
      expect(isolatedSettings.getAllGlobalSettings().dumpcontext).toBe('off');

      await result.dispose();
    } finally {
      isolatedSpy.mockRestore();
      applyProfileSpy.mockRestore();
    }
  });
});
