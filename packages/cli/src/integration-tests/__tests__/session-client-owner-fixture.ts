/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import {
  assembleAgentActivationBootstrap,
  type AgentActivationOperation,
} from '@vybestack/llxprt-code-agents';
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
  if (borrowedSettingsOwner !== undefined)
    owner.takeSettingsOwner(settingsService);
  owners.push(owner);
  return owner;
}

export async function createProviderSessionCapabilities(
  config: Config,
  manager: RuntimeProviderManager,
  store: Parameters<typeof createProviderSessionOwner>[2],
  owner: Parameters<typeof createProviderSessionOwner>[3],
): Promise<
  Pick<
    AgentActivationOperation,
    | 'providerFileLifecycle'
    | 'messageBus'
    | 'workspaceDefinitions'
    | 'workspaceTrust'
    | 'trustCleanup'
    | 'workspaceMemory'
    | 'workspaceFilesystem'
    | 'sessionClient'
    | 'takeMediaOwner'
    | 'settingsOwnerOwnership'
    | 'takeSettingsOwner'
    | 'takeSessionClient'
  >
> {
  const operation = await createProviderSessionOwner(
    config,
    manager,
    store,
    owner,
  );
  return {
    providerFileLifecycle: operation.providerFileLifecycle,
    messageBus: operation.messageBus,
    workspaceDefinitions: operation.workspaceDefinitions,
    workspaceTrust: operation.workspaceTrust,
    trustCleanup: operation.trustCleanup,
    workspaceMemory: operation.workspaceMemory,
    workspaceFilesystem: operation.workspaceFilesystem,
    sessionClient: operation.sessionClient,
    takeMediaOwner: operation.takeMediaOwner.bind(operation),
    settingsOwnerOwnership: operation.settingsOwnerOwnership,
    takeSettingsOwner: operation.takeSettingsOwner.bind(operation),
    takeSessionClient: operation.takeSessionClient.bind(operation),
  };
}
