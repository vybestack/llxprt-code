/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  OpenAIProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { PLACEHOLDER_MODEL } from '@vybestack/llxprt-code-agents/constants.js';
import { runNonInteractive } from '../__tests__/noninteractive-run-fixture.js';

export function makeHeadlessConfig(sessionId: string): {
  credentialAuthority: CredentialAuthority;
  config: Config;
  manager: ProviderManager;
  settingsService: SettingsService;
  settingsOwner: SessionSettingsOwner;
} {
  const settingsService = new SettingsService();
  const config = new Config({
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    sessionId,
    model: PLACEHOLDER_MODEL,
    provider: 'openai',
  });
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  settingsOwner.initializeProviderSelection('openai', PLACEHOLDER_MODEL);
  const credentialAuthority = new CredentialAuthority();
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settingsService,
    config,
    undefined,
    credentialAuthority,
    settingsOwner,
  );
  manager.registerProvider(new OpenAIProvider(undefined));
  manager.setActiveProvider('openai');
  configureProviderRuntimeFactories(config, manager);
  return {
    credentialAuthority,
    config,
    manager,
    settingsOwner,
    settingsService,
  };
}

export async function runHeadlessPolicyFixture(
  params: Parameters<typeof runNonInteractive>[0],
  runtimeSettings: NonNullable<
    Parameters<typeof runNonInteractive>[0]['runtimeSettings']
  >,
  providerManager: NonNullable<
    Parameters<typeof runNonInteractive>[0]['providerManager']
  >,
): Promise<void> {
  const policyOwner = new RuntimePolicyOwner(params.config);
  try {
    await runNonInteractive({
      ...params,
      runtimeSettings: params.runtimeSettings ?? runtimeSettings,
      providerManager,
      runtimeMessageBus: policyOwner.session.messageBus,
      policyOwner,
    });
  } finally {
    await policyOwner.dispose();
  }
}
