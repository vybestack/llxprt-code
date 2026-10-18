/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { CredentialCommands } from './credentialCommandTypes.js';
import { createModelCommand } from '../commands/modelCommand.js';
import { createToolFormatCommand } from '../commands/toolformatCommand.js';
import { createProviderCommand } from '../commands/providerCommand.js';
import { bindProviderCommandOperations } from '../commands/providerCommandHost.js';
import { bindProfileCommandOperations } from '../commands/profileCommandHost.js';
import { createProfileCommand } from '../commands/profileCommand.js';
import { bindQuotaCommandOperations } from '../commands/credentialCommandHost.js';
import { createQuotaCommand } from '../commands/quotaCommand.js';
import { fetchAllQuotaInfo } from '../commands/statsQuota.js';
import {
  recordActiveProviderSwitch,
  agentActiveProviderStatus,
} from '../utils/recordActiveProviderSwitch.js';

type RecordSwitch = (provider: string, model: string) => Promise<void>;
type RecordingEvent = Parameters<typeof recordSwitchFactory>[0];
export type CredentialCommandRegistration = (
  addItem: UseHistoryManagerReturn['addItem'],
  reloadCommands: () => void,
  rawRecording: RecordingIntegration | undefined,
  recordingOwner: 'agent' | 'raw' | undefined,
) => CredentialCommands;

export function recordSwitchFactory(
  record:
    | ((event: {
        type: 'provider_switch';
        provider: string;
        model: string;
      }) => Promise<void>)
    | null,
  raw: Pick<RecordingIntegration, 'recordProviderSwitch'> | undefined,
  owner: 'agent' | 'raw' | undefined,
): RecordSwitch {
  return async (provider, model) => {
    if (owner === 'agent') {
      if (record === null) throw new Error('Session agent is unavailable');
      await record({ type: 'provider_switch', provider, model });
    } else raw?.recordProviderSwitch(provider, model);
  };
}

export function createModelRegistration(
  selectModel: Parameters<typeof createModelCommand>[0],
  readFormat: Parameters<typeof createToolFormatCommand>[0],
  writeFormat: Parameters<typeof createToolFormatCommand>[1],
  readProvider: Parameters<typeof bindProviderCommandOperations>[0],
  readStatus: Parameters<typeof bindProviderCommandOperations>[1],
  readModel: Parameters<typeof bindProviderCommandOperations>[2],
  resolveAlias: Parameters<typeof bindProviderCommandOperations>[3],
  switchProvider: Parameters<typeof bindProviderCommandOperations>[4],
  refreshAliases: Parameters<typeof bindProviderCommandOperations>[5],
) {
  return (record: RecordSwitch) => ({
    modelCommand: createModelCommand(selectModel, record),
    toolFormatCommand: createToolFormatCommand(readFormat, writeFormat),
    providerCommand: createProviderCommand(
      bindProviderCommandOperations(
        readProvider,
        readStatus,
        readModel,
        resolveAlias,
        switchProvider,
        refreshAliases,
        record,
      ),
    ),
  });
}

export function createProfileRegistration(
  listProfiles: Parameters<typeof bindProfileCommandOperations>[0],
  readProvider: Parameters<typeof bindProfileCommandOperations>[1],
  listBuckets: Parameters<typeof bindProfileCommandOperations>[2],
  fuzzy: Parameters<typeof bindProfileCommandOperations>[3],
  saveSnapshot: Parameters<typeof bindProfileCommandOperations>[4],
  listSaved: Parameters<typeof bindProfileCommandOperations>[5],
  readEphemerals: Parameters<typeof bindProfileCommandOperations>[6],
  saveBalancer: Parameters<typeof bindProfileCommandOperations>[7],
  loadProfile: Parameters<typeof bindProfileCommandOperations>[8],
  publish: Parameters<typeof bindProfileCommandOperations>[9],
  readAgentProvider: () => string,
  readAgentModel: () => string,
  deleteProfile: Parameters<typeof bindProfileCommandOperations>[11],
  setDefault: Parameters<typeof bindProfileCommandOperations>[12],
) {
  return (record: RecordSwitch) =>
    createProfileCommand(
      bindProfileCommandOperations(
        listProfiles,
        readProvider,
        listBuckets,
        fuzzy,
        saveSnapshot,
        listSaved,
        readEphemerals,
        saveBalancer,
        loadProfile,
        publish,
        (result, loaded, reportFailure) =>
          recordActiveProviderSwitch(
            { recordProviderSwitch: record },
            agentActiveProviderStatus(readAgentProvider, readAgentModel),
            reportFailure,
            { providerName: result.providerName, modelName: loaded.modelName },
          ),
        deleteProfile,
        setDefault,
      ),
    );
}

export function createQuotaRegistration(
  readSetting: Parameters<typeof fetchAllQuotaInfo>[0],
  readProvider: Parameters<typeof fetchAllQuotaInfo>[1],
  detect: Parameters<typeof fetchAllQuotaInfo>[2],
  request: Parameters<typeof fetchAllQuotaInfo>[3],
  available: Parameters<typeof fetchAllQuotaInfo>[4],
  anthropic: Parameters<typeof fetchAllQuotaInfo>[5],
  codex: Parameters<typeof fetchAllQuotaInfo>[6],
  credits: Parameters<
    typeof bindQuotaCommandOperations
  >[0]['getAllCodexRateLimitResetCredits'],
  hasCodexToken: Parameters<
    typeof bindQuotaCommandOperations
  >[0]['hasCodexToken'],
  buckets: Parameters<typeof bindQuotaCommandOperations>[0]['listBuckets'],
  readCodexBucketToken: Parameters<
    typeof bindQuotaCommandOperations
  >[0]['readCodexBucketToken'],
) {
  return createQuotaCommand(
    bindQuotaCommandOperations(
      {
        isAvailable: available,
        getAllCodexRateLimitResetCredits: credits,
        hasCodexToken,
        listBuckets: buckets,
        readCodexBucketToken,
      },
      request,
      () => readSetting('base-url'),
      () =>
        fetchAllQuotaInfo(
          readSetting,
          readProvider,
          detect,
          request,
          available,
          anthropic,
          codex,
        ),
    ),
  );
}

export function createCredentialRegistration(
  models: ReturnType<typeof createModelRegistration>,
  profile: ReturnType<typeof createProfileRegistration>,
  baseurlCommand: CredentialCommands['baseurlCommand'],
  logoutCommand: CredentialCommands['logoutCommand'],
  keyfileCommand: CredentialCommands['keyfileCommand'],
  keyCommand: CredentialCommands['keyCommand'],
  authCommand: CredentialCommands['authCommand'],
  quotaCommand: CredentialCommands['quotaCommand'],
  mcp: (
    addItem: UseHistoryManagerReturn['addItem'],
    reload: () => void,
  ) => CredentialCommands['mcpCommand'],
  toolkeys: Pick<CredentialCommands, 'toolkeyCommand' | 'toolkeyfileCommand'>,
  recordEvent: RecordingEvent,
): CredentialCommandRegistration {
  return (addItem, reload, raw, owner) => {
    const record = recordSwitchFactory(recordEvent, raw, owner);
    return {
      ...models(record),
      profileCommand: profile(record),
      baseurlCommand,
      logoutCommand,
      keyfileCommand,
      keyCommand,
      authCommand,
      quotaCommand,
      mcpCommand: mcp(addItem, reload),
      ...toolkeys,
    };
  };
}
