import {
  captureActivationAcquisition as assembleAgentActivationBootstrap,
  capturedActivation,
} from '../../../../agents/src/api/__tests__/helpers/activation-acquisition-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { type AgentActivationOperation } from '@vybestack/llxprt-code-agents';
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
let owners: AgentActivationOperation[] = [];
afterEach(async () => {
  const pending = owners;
  owners = [];
  await Promise.all(pending.map((owner) => owner.dispose()));
});
export async function createProviderSessionOwner(
  config: Config,
  manager: RuntimeProviderManager,
  settingsService: SettingsService,
  borrowedSettingsOwner?: SessionSettingsOwner,
): Promise<AgentActivationOperation> {
  const settingsOwner =
    borrowedSettingsOwner ?? new SessionSettingsOwner(settingsService);
  const owner = await assembleAgentActivationBootstrap(
    config,
    settingsService,
    manager,
    null,
    () => undefined,
    'borrowed',
    undefined,
    undefined,
    undefined,
    undefined,
    settingsOwner,
  );
  owners.push(owner);
  return owner;
}

export async function createProviderSessionCapabilities(
  config: Config,
  manager: RuntimeProviderManager,
  store: Parameters<typeof createProviderSessionOwner>[2],
  owner: Parameters<typeof createProviderSessionOwner>[3],
) {
  const operation = await createProviderSessionOwner(
    config,
    manager,
    store,
    owner,
  );
  return {
    providerFileLifecycle: capturedActivation(operation).providerFileLifecycle,
    messageBus: capturedActivation(operation).messageBus,
    workspaceDefinitions: capturedActivation(operation).workspaceDefinitions,
    workspaceTrust: capturedActivation(operation).workspaceTrust,
    trustCleanup: capturedActivation(operation).trustCleanup,
    workspaceMemory: capturedActivation(operation).workspaceMemory,
    workspaceFilesystem: capturedActivation(operation).workspaceFilesystem,
    sessionClient: operation.sessionClient,
    settingsOwnerOwnership:
      capturedActivation(operation).settingsOwnerOwnership,
  };
}
