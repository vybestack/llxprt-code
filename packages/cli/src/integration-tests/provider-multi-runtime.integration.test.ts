/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P01
 * @requirement:REQ-SP2-002
 * @plan PLAN-20251018-STATELESSPROVIDER2.P01
 * @requirement REQ-SP2-002
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type IProvider, type Profile } from '@vybestack/llxprt-code-core';
import {
  activateIsolatedRuntimeContext,
  createIsolatedRuntimeContext,
  getCliProviderManager,
  resetCliProviderInfrastructure,
  switchActiveProvider,
  type IsolatedRuntimeActivationOptions,
  type IsolatedRuntimeContextHandle,
} from '../runtime/runtimeSettings.js';
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
  tempDir: string;
}

const runtimeFixtures: RuntimeFixture[] = [];

afterEach(async () => {
  resetCliProviderInfrastructure();
  while (runtimeFixtures.length > 0) {
    const runtime = runtimeFixtures.pop();
    if (runtime) {
      // Ensure isolated runtimes release resources even when assertions fail (Step 7, multi-runtime-baseline.md line 8).
      await runtime.handle.cleanup();
      await cleanupTempDirectory(runtime.tempDir);
    }
  }
});

describe('provider multi-runtime guardrails', () => {
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

    const managerForRuntimeA = getCliProviderManager();

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
      switchActiveProvider(runtimeA.profile.provider),
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
  const handle = createIsolatedRuntimeContext({
    runtimeId: options.runtimeId,
    workspaceDir: tempDir,
    model: options.model,
    metadata: {
      profileName: options.profileName,
      providerName: options.providerName,
    }, // Step 3 (multi-runtime-baseline.md line 4) captures fixture metadata per runtime instance.
    prepare: async ({ config, settingsService, providerManager }) => {
      if (!providersRegistered) {
        providerManager.registerProvider(
          createStubProvider(options.providerName, options.model),
        );
        providersRegistered = true;
      }

      // Step 4 (multi-runtime-baseline.md line 5) ensures the scoped ProviderManager uses fixture services.
      await providerManager.setActiveProvider(options.providerName);
      settingsService.set('activeProvider', options.providerName);
      settingsService.setProviderSetting(
        options.providerName,
        'model',
        options.model,
      );

      const baseUrl = profile.ephemeralSettings?.['base-url'];
      settingsService.setProviderSetting(
        options.providerName,
        'baseUrl',
        baseUrl,
      );
      if (baseUrl) {
        config.setEphemeralSetting('base-url', baseUrl);
      } else {
        config.setEphemeralSetting('base-url', undefined);
      }

      config.setProvider(options.providerName);
      config.setModel(options.model);
    },
    onCleanup: async () => {
      // Step 7 (multi-runtime-baseline.md line 8) handles per-runtime cleanup.
      await cleanupTempDirectory(tempDir);
    },
  });

  const runtime: RuntimeFixture = {
    runtimeId: options.runtimeId,
    profileName: options.profileName,
    profile,
    handle,
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
    getServerTools() {
      return [];
    },
    async invokeServerTool() {
      return {};
    },
    clearState() {
      // Stub provider does not persist internal state.
    },
  };
}
