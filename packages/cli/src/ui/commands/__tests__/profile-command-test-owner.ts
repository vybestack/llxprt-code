/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../../__tests__/mockCommandContext.js';
import { SettingScope } from '../../../config/settings.js';
import {
  agentActiveProviderStatus,
  recordActiveProviderSwitch,
} from '../../utils/recordActiveProviderSwitch.js';

import { bindProfileCommandOperations } from '../profileCommandHost.js';
import { createProfileCommand } from '../profileCommand.js';
import type { SlashCommand } from '../types.js';

export function createProfileCommandForTest(
  context: CommandOwnerFixture,
  recordProviderSwitch: (
    provider: string,
    model: string,
  ) => void | Promise<void> = async () => {},
): SlashCommand {
  const { agent, settings } = context.services;
  const { runtimeApi: api, oauthControl } = context;
  return createProfileCommand(
    bindProfileCommandOperations(
      () =>
        agent === null
          ? api.listSavedProfiles()
          : agent.workspace.profileDefinitions.listProfiles(),
      () => agent?.getProvider() ?? api.providerStatus().providerName,
      oauthControl.listBuckets.bind(oauthControl),
      () => settings.merged.enableFuzzyFiltering ?? true,
      agent === null
        ? api.saveProfileSnapshot.bind(api)
        : agent.saveProfileSnapshot.bind(agent),
      api.listSavedProfiles.bind(api),
      api.getEphemeralSettings.bind(api),
      api.saveLoadBalancerProfile.bind(api),
      async (name) => {
        if (agent === null)
          throw new Error(
            'Agent unavailable. Restart before loading a profile.',
          );
        return agent.profiles.load(name);
      },
      async () => {
        if (agent !== null) await agent.mcp.refresh();
      },
      (result, loaded, reportFailure) => {
        if (agent === null) throw new Error('Session agent is unavailable');
        return recordActiveProviderSwitch(
          { recordProviderSwitch },
          agentActiveProviderStatus(
            agent.getProvider.bind(agent),
            agent.getModel.bind(agent),
          ),
          reportFailure,
          { providerName: result.providerName, modelName: loaded.modelName },
        );
      },
      async (name) => {
        if (agent === null) await api.deleteProfileByName(name);
        else await agent.deleteProfileByName(name);
      },
      async (name) => {
        if (agent === null) api.setDefaultProfileName(name);
        else agent.setDefaultProfileName(name);
        settings.setValue(
          SettingScope.User,
          'defaultProfile',
          name ?? undefined,
        );
      },
    ),
  );
}
