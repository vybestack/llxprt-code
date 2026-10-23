import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { useOwnedCredentials as installOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from '../../../agents/src/api/preferred-provider-acquisition.js';
const credentials = installOwnedCredentials();
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createProviderSessionOwner } from './__tests__/session-client-owner-fixture.js';

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

import { switchActiveProvider } from '@vybestack/llxprt-code-agents';
import { Config, MessageBus } from '@vybestack/llxprt-code-core';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import { type Profile } from '@vybestack/llxprt-code-settings';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  cleanupTempDirectory,
  createTempDirectory,
  createTempProfile,
} from './test-utils.js';

interface RuntimeData {
  runtimeId: string;
  profileName: string;
  providerName: string;
  model: string;
  baseUrl: string;
}
const releases: Array<() => Promise<void>> = [];
describe('provider multi-runtime guardrails', () => {
  afterEach(async () => {
    for (const close of releases.splice(0).reverse()) await close();
  });
  it('restores runtime-scoped provider manager isolation @plan:PLAN-20251018-STATELESSPROVIDER2.P02 @requirement:REQ-SP2-002', async () => {
    await openFirst({
      runtimeId: 'runtime-a',
      profileName: 'zai',
      providerName: 'zai',
      model: 'zai-ultra',
      baseUrl: 'https://api.zai.example/v1',
    });
    await openSecond({
      runtimeId: 'runtime-b',
      profileName: 'cerebrasqwen3',
      providerName: 'cerebrasqwen3',
      model: 'cerebras-sonnet',
      baseUrl: 'https://api.cerebras.ai/v1',
    });

    await activateFirst();
    await activateSecond();

    // Step 6 (multi-runtime-baseline.md line 7) ensures re-activation resets CLI bindings before runtimeA takes control again.
    await activateFirst({
      metadata: { source: 'multi-runtime-guardrail:runtime-a' },
    });

    const managerForRuntimeA = firstManager;
    expect(managerForRuntimeA).toBeDefined();

    // Guardrail: runtime A should surface its own provider manager reference.
    expect(managerForRuntimeA.getActiveProviderName()).toBe(
      firstProfile.provider,
    );
  });

  it('keeps provider mutations scoped to active runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P02 @requirement:REQ-SP2-002', async () => {
    await openFirst({
      runtimeId: 'runtime-a',
      profileName: 'zai',
      providerName: 'zai',
      model: 'zai-ultra',
      baseUrl: 'https://api.zai.example/v1',
    });
    await openSecond({
      runtimeId: 'runtime-b',
      profileName: 'cerebrasqwen3',
      providerName: 'cerebrasqwen3',
      model: 'cerebras-sonnet',
      baseUrl: 'https://api.cerebras.ai/v1',
    });

    await activateFirst();
    await activateSecond();

    // Switching back to runtime A should allow provider operations to stay scoped to runtime A.
    await activateFirst({
      metadata: {
        source: 'multi-runtime-guardrail:runtime-a:provider-switch',
      },
    });

    // Guardrail: switching providers should succeed for runtime A without touching runtime B.
    await expect(
      switchActiveProvider(
        firstProfile.provider,
        {},
        firstConfig,
        firstSettings,
        firstManager,
        firstOAuth,
        undefined,
        () => firstClient.refreshAuth(),
        firstOwner,
      ),
    ).resolves.toMatchObject({ nextProvider: firstProfile.provider });
  });
});

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P02
 * @requirement REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 2-5
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

let firstData: RuntimeData;
let firstProfile: Profile;
let firstConfig: Config;
let firstSettings: SettingsService;
let firstOwner: SessionSettingsOwner;
let firstManager: ProviderManager;
let firstOAuth: OAuthManager;
let firstClient: Awaited<
  ReturnType<typeof createProviderSessionOwner>
>['sessionClient'];
let firstRelease: AcquisitionRelease;
async function openFirst(data: RuntimeData): Promise<void> {
  firstData = data;
  const directory = await createTempDirectory();
  firstProfile = {
    version: 1,
    provider: data.providerName,
    model: data.model,
    modelParams: { temperature: data.providerName === 'zai' ? 0.15 : 0.3 },
    ephemeralSettings: {
      'base-url': data.baseUrl,
      'auth-key': `${data.providerName}-api-key`,
    },
  };
  await createTempProfile(directory, data.profileName, firstProfile);
  firstConfig = new Config({
    sessionId: data.runtimeId,
    targetDir: directory,
    cwd: directory,
    model: data.model,
    debugMode: false,
  });
  firstSettings = new SettingsService();
  firstOwner = new SessionSettingsOwner(firstSettings);
  firstOwner.bindTelemetry(firstConfig);
  firstRelease = new AcquisitionRelease();
  releases.push(async () => {
    await firstRelease.close();
    await firstConfig.dispose();
    await cleanupTempDirectory(directory);
  });
  firstRelease.acquire('settings', () => firstOwner.dispose());
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  firstManager = acquirePreferredProviderManager(
    firstConfig,
    firstSettings,
    firstOwner,
    files,
    data.runtimeId,
    credentials().authority,
    firstRelease,
  );
  firstManager.registerProvider(
    createStubProvider(data.providerName, data.model),
  );
  const bus = new MessageBus();
  firstRelease.acquire('bus', () => bus.cancelPendingConfirmations());
  firstOAuth = acquirePreferredOAuth(
    undefined,
    bus,
    firstConfig,
    firstSettings,
    firstManager,
    data.runtimeId,
    undefined,
    credentials().authority,
    firstRelease,
    undefined,
  );
  await activateFirst();
  firstClient = (
    await createProviderSessionOwner(
      firstConfig,
      firstManager,
      firstSettings,
      firstOwner,
    )
  ).sessionClient;
}
async function activateFirst(
  input: { runtimeId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  firstManager.setRuntimeContext(
    {
      runtimeId: input.runtimeId ?? firstData.runtimeId,
      runtimeKind: 'cli-interactive',
      metadata: {
        profileName: firstData.profileName,
        runtimeId: firstData.runtimeId,
        ...input.metadata,
      },
    },
    firstOwner,
    firstSettings,
    firstConfig,
  );
  selectProfile(firstProfile, firstSettings, firstOwner, firstManager);
}

let secondData: RuntimeData;
let secondProfile: Profile;
let secondConfig: Config;
let secondSettings: SettingsService;
let secondOwner: SessionSettingsOwner;
let secondManager: ProviderManager;
let secondRelease: AcquisitionRelease;
async function openSecond(data: RuntimeData): Promise<void> {
  secondData = data;
  const directory = await createTempDirectory();
  secondProfile = {
    version: 1,
    provider: data.providerName,
    model: data.model,
    modelParams: { temperature: data.providerName === 'zai' ? 0.15 : 0.3 },
    ephemeralSettings: {
      'base-url': data.baseUrl,
      'auth-key': `${data.providerName}-api-key`,
    },
  };
  await createTempProfile(directory, data.profileName, secondProfile);
  secondConfig = new Config({
    sessionId: data.runtimeId,
    targetDir: directory,
    cwd: directory,
    model: data.model,
    debugMode: false,
  });
  secondSettings = new SettingsService();
  secondOwner = new SessionSettingsOwner(secondSettings);
  secondOwner.bindTelemetry(secondConfig);
  secondRelease = new AcquisitionRelease();
  releases.push(async () => {
    await secondRelease.close();
    await secondConfig.dispose();
    await cleanupTempDirectory(directory);
  });
  secondRelease.acquire('settings', () => secondOwner.dispose());
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  secondManager = acquirePreferredProviderManager(
    secondConfig,
    secondSettings,
    secondOwner,
    files,
    data.runtimeId,
    credentials().authority,
    secondRelease,
  );
  secondManager.registerProvider(
    createStubProvider(data.providerName, data.model),
  );
  const bus = new MessageBus();
  secondRelease.acquire('bus', () => bus.cancelPendingConfirmations());
  acquirePreferredOAuth(
    undefined,
    bus,
    secondConfig,
    secondSettings,
    secondManager,
    data.runtimeId,
    undefined,
    credentials().authority,
    secondRelease,
    undefined,
  );
  await activateSecond();
  await createProviderSessionOwner(
    secondConfig,
    secondManager,
    secondSettings,
    secondOwner,
  );
}
async function activateSecond(
  input: { runtimeId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  secondManager.setRuntimeContext(
    {
      runtimeId: input.runtimeId ?? secondData.runtimeId,
      runtimeKind: 'cli-interactive',
      metadata: {
        profileName: secondData.profileName,
        runtimeId: secondData.runtimeId,
        ...input.metadata,
      },
    },
    secondOwner,
    secondSettings,
    secondConfig,
  );
  selectProfile(secondProfile, secondSettings, secondOwner, secondManager);
}

function selectProfile(
  profile: Profile,
  settings: SettingsService,
  owner: SessionSettingsOwner,
  manager: ProviderManager,
): void {
  manager.setActiveProvider(profile.provider);
  settings.set('activeProvider', profile.provider);
  settings.setProviderSetting(profile.provider, 'model', profile.model);
  const baseUrl = profile.ephemeralSettings['base-url'];
  settings.setProviderSetting(profile.provider, 'base-url', baseUrl);
  owner.writeUserParameter('base-url', baseUrl === '' ? undefined : baseUrl);
}
