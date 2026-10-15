/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { OAuthControl } from '../contexts/OAuthControlContext.js';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import {
  agentActiveProviderStatus,
  recordActiveProviderSwitch,
} from '../utils/recordActiveProviderSwitch.js';
import {
  listProfiles as listRuntimeProfiles,
  createProfileSchemas,
} from './profileSchemas.js';
import {
  saveLoadBalancerProfile,
  saveModelProfile,
} from './profileLoadBalancer.js';
import type { ProfileCommandOperations } from './profileCommand.js';

export interface ProfileCommandHost {
  readonly agent: Agent | null;
  readonly runtimeApi: RuntimeApi;
  readonly settings: Pick<LoadedSettings, 'setValue' | 'merged'>;
  readonly oauthControl: Pick<OAuthControl, 'listBuckets'>;
  readonly recordProviderSwitch: (
    provider: string,
    model: string,
  ) => void | Promise<void>;
}

export function bindProfileCommandOperations(
  host: ProfileCommandHost,
): ProfileCommandOperations {
  const { agent, runtimeApi, settings, oauthControl } = host;
  const listProfiles = async (): Promise<readonly string[]> =>
    agent === null
      ? listRuntimeProfiles(runtimeApi)
      : agent.workspace.profileDefinitions.listProfiles();
  const schemas = createProfileSchemas(
    {
      listProfiles,
      getActiveProviderName: () =>
        agent?.getProvider() ??
        runtimeApi.providerStatus().providerName ??
        undefined,
      listBuckets: oauthControl.listBuckets,
    },
    () => settings.merged.enableFuzzyFiltering ?? true,
  );

  return {
    schemas,
    saveModelProfile: (parts) =>
      saveModelProfile(parts, runtimeApi, agent, oauthControl.listBuckets),
    saveLoadBalancerProfile: (parts) =>
      saveLoadBalancerProfile(parts, runtimeApi),
    loadProfile: async (profileName) => {
      if (agent === null)
        throw new Error('Agent unavailable. Restart before loading a profile.');
      return agent.profiles.load(profileName);
    },
    publishLoadedProfile: async () => {
      if (agent !== null) await agent.mcp.refresh();
    },
    recordProviderSwitch: (result, profileLoadResult, reportFailure) => {
      if (agent === null) throw new Error('Session agent is unavailable');
      return recordActiveProviderSwitch(
        { recordProviderSwitch: host.recordProviderSwitch },
        agentActiveProviderStatus(
          () => agent.getProvider(),
          () => agent.getModel(),
        ),
        reportFailure,
        {
          providerName: result.providerName,
          modelName: profileLoadResult.modelName,
        },
      );
    },
    deleteProfile: async (profileName) => {
      if (agent === null) await runtimeApi.deleteProfileByName(profileName);
      else await agent.deleteProfileByName(profileName);
    },
    listProfiles,
    setDefaultProfileName: async (profileName) => {
      if (agent === null) runtimeApi.setDefaultProfileName(profileName);
      else agent.setDefaultProfileName(profileName);
      settings.setValue(
        SettingScope.User,
        'defaultProfile',
        profileName ?? undefined,
      );
    },
  };
}
