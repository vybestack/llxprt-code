import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createProviderSessionOwner } from './__tests__/session-client-owner-fixture.js';
import { providerSwitchInputs } from '../../../providers/src/runtime/__tests__/provider-switch-inputs.js';

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P01
 * @requirement:REQ-SP2-002
 * @plan PLAN-20251018-STATELESSPROVIDER2.P01
 * @requirement REQ-SP2-002
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { type Profile } from '@vybestack/llxprt-code-settings';
import { Config } from '@vybestack/llxprt-code-core';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import {
  activateIsolatedRuntimeContext,
  createIsolatedRuntimeContext,
  switchActiveProvider,
  type IsolatedRuntimeActivationOptions,
  type IsolatedRuntimeContextHandle,
} from '@vybestack/llxprt-code-providers/runtime.js';
import {
  cleanupTempDirectory,
  createTempDirectory,
  createTempProfile,
} from './test-utils.js';

interface RuntimeFixture {
  runtimeId: string;
  profileName: string;
  profile: Profile;
  handle: IsolatedRuntimeContextHandle;
  sessionClient: ReturnType<typeof createProviderSessionOwner>['sessionClient'];
  tempDir: string;
}

const runtimeFixtures: RuntimeFixture[] = [];

describe('provider multi-runtime guardrails', () => {
  afterEach(async () => {
    while (runtimeFixtures.length > 0) {
      const runtime = runtimeFixtures.pop();
      if (runtime) {
        // Ensure isolated runtimes release resources even when assertions fail (Step 7, multi-runtime-baseline.md line 8).
        await runtime.handle.cleanup();
        await cleanupTempDirectory(runtime.tempDir);
      }
    }
  });

  it('restores runtime-scoped provider manager isolation @plan:PLAN-20251018-STATELESSPROVIDER2.P02 @requirement:REQ-SP2-002', async () => {
    const runtimeA = await bootstrapRuntimeFixture({
      runtimeId: 'runtime-a',
      profileName: 'zai',
      providerName: 'zai',
      model: 'zai-ultra',
      baseUrl: 'https://api.zai.example/v1',
    });
    const runtimeB = await bootstrapRuntimeFixture({
      runtimeId: 'runtime-b',
      profileName: 'cerebrasqwen3',
      providerName: 'cerebrasqwen3',
      model: 'cerebras-sonnet',
      baseUrl: 'https://api.cerebras.ai/v1',
    });

    await activateRuntime(runtimeA);
    await activateRuntime(runtimeB);

    // Step 6 (multi-runtime-baseline.md line 7) ensures re-activation resets CLI bindings before runtimeA takes control again.
    await activateRuntime(runtimeA, {
      metadata: { source: 'multi-runtime-guardrail:runtime-a' },
    });

    const managerForRuntimeA = runtimeA.handle.providerManager;
    expect(managerForRuntimeA).toBeDefined();

    // Guardrail: runtime A should surface its own provider manager reference.
    expect(managerForRuntimeA.getActiveProviderName()).toBe(
      runtimeA.profile.provider,
    );
  });

  it('keeps provider mutations scoped to active runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P02 @requirement:REQ-SP2-002', async () => {
    const runtimeA = await bootstrapRuntimeFixture({
      runtimeId: 'runtime-a',
      profileName: 'zai',
      providerName: 'zai',
      model: 'zai-ultra',
      baseUrl: 'https://api.zai.example/v1',
    });
    const runtimeB = await bootstrapRuntimeFixture({
      runtimeId: 'runtime-b',
      profileName: 'cerebrasqwen3',
      providerName: 'cerebrasqwen3',
      model: 'cerebras-sonnet',
      baseUrl: 'https://api.cerebras.ai/v1',
    });

    await activateRuntime(runtimeA);
    await activateRuntime(runtimeB);

    // Switching back to runtime A should allow provider operations to stay scoped to runtime A.
    await activateRuntime(runtimeA, {
      metadata: {
        source: 'multi-runtime-guardrail:runtime-a:provider-switch',
      },
    });

    // Guardrail: switching providers should succeed for runtime A without touching runtime B.
    await expect(
      switchActiveProvider(
        runtimeA.profile.provider,
        {},
        ...(await providerSwitchInputs(
          runtimeA.handle,
          runtimeA.handle.providerManager,
          () => runtimeA.sessionClient.refreshAuth(),
        )),
      ),
    ).resolves.toMatchObject({ nextProvider: runtimeA.profile.provider });
  });
});

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P02
 * @requirement REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 2-5
 */
async function bootstrapRuntimeFixture(options: {
  runtimeId: string;
  profileName: string;
  providerName: string;
  model: string;
  baseUrl: string;
}): Promise<RuntimeFixture> {
  const tempDir = await createTempDirectory();
  const profile: Profile = {
    version: 1,
    provider: options.providerName,
    model: options.model,
    modelParams: {
      temperature: options.providerName === 'zai' ? 0.15 : 0.3,
    },
    ephemeralSettings: {
      'base-url': options.baseUrl,
      'auth-key': `${options.providerName}-api-key`,
    },
  };

  await createTempProfile(tempDir, options.profileName, profile);

  let providersRegistered = false;
  const handle = (() => {
    const capturedConfig2 = new Config({
      sessionId: options.runtimeId,
      targetDir: tempDir,
      cwd: tempDir,
      model: options.model,
      debugMode: false,
    });
    const settingsService = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settingsService);
    return createIsolatedRuntimeContext(
      {
        settingsOwner,
        runtimeId: options.runtimeId,
        // The caller supplies the Config (issue #3222): providers no longer
        // constructs one for isolated runtimes.
        config: capturedConfig2,
        metadata: {
          profileName: options.profileName,
          providerName: options.providerName,
        }, // Step 3 (multi-runtime-baseline.md line 4) captures fixture metadata per runtime instance.
        prepare: async ({ settingsService, providerManager }) => {
          if (!providersRegistered) {
            providerManager.registerProvider(
              createStubProvider(options.providerName, options.model),
            );
            providersRegistered = true;
          }

          // Step 4 (multi-runtime-baseline.md line 5) ensures the scoped ProviderManager uses fixture services.
          void providerManager.setActiveProvider(options.providerName);
          settingsService.set('activeProvider', options.providerName);
          settingsService.setProviderSetting(
            options.providerName,
            'model',
            options.model,
          );

          const baseUrl = profile.ephemeralSettings['base-url'];
          settingsService.setProviderSetting(
            options.providerName,
            'base-url',
            baseUrl,
          );
          if (baseUrl) {
            settingsOwner.writeUserParameter('base-url', baseUrl);
          } else {
            settingsOwner.writeUserParameter('base-url', undefined);
          }
        },
        onCleanup: async () => {
          // Step 7 (multi-runtime-baseline.md line 8) handles per-runtime cleanup.
          await cleanupTempDirectory(tempDir);
        },
      },
      settingsService,
    );
  })();

  const runtime: RuntimeFixture = {
    runtimeId: options.runtimeId,
    profileName: options.profileName,
    profile,
    handle,
    sessionClient: createProviderSessionOwner(
      handle.config,
      handle.providerManager,
      handle.settingsService,
      handle.settingsOwner,
    ).sessionClient,
    tempDir,
  };

  runtimeFixtures.push(runtime);
  return runtime;
}

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P02
 * @requirement REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 6-7
 */
async function activateRuntime(
  runtime: RuntimeFixture,
  overrides: IsolatedRuntimeActivationOptions = {},
): Promise<void> {
  const metadata = {
    profileName: runtime.profileName,
    runtimeId: runtime.runtimeId,
    ...(overrides.metadata ?? {}),
  } as Record<string, unknown>;

  await activateIsolatedRuntimeContext(runtime.handle, {
    ...overrides,
    runtimeId: overrides.runtimeId ?? runtime.runtimeId,
    metadata,
  });
}

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P02
 * @requirement REQ-SP2-002
 */
function createStubProvider(
  name: string,
  defaultModel: string,
): IProvider & { clearState(): void } {
  return {
    name,
    async getModels() {
      return [
        {
          id: defaultModel,
          name: defaultModel,
          provider: name,
          supportedToolFormats: [],
        },
      ];
    },
    getDefaultModel() {
      return defaultModel;
    },
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: `${name}-response` }],
      };
    },
    clearState() {
      // Stub provider does not persist internal state.
    },
  };
}
