/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentProfileApplication } from '@vybestack/llxprt-code-agents';

import type { ProfileDefinitionReads } from '@vybestack/llxprt-code-core';
import * as acp from '@agentclientprotocol/sdk';
import { getCliVersion } from './utils/version.js';
import { parseZedAuthMethodId } from './zed-helpers.js';

export function requireZedProfileDefinitions(
  profiles: Pick<ProfileDefinitionReads, 'listProfiles'> | undefined,
): Pick<ProfileDefinitionReads, 'listProfiles'> {
  if (profiles === undefined)
    throw new Error('ACP requires explicit workspace profile definitions');
  return profiles;
}

export async function initializeZedAgent(
  profiles: Pick<ProfileDefinitionReads, 'listProfiles'> | undefined,
): Promise<acp.InitializeResponse> {
  let profileNames: string[];
  try {
    profileNames = await getAvailableProfileNames(
      requireZedProfileDefinitions(profiles),
    );
  } catch (error) {
    throw new Error(
      `Failed to initialize Zed agent: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return {
    protocolVersion: acp.PROTOCOL_VERSION,
    agentInfo: {
      name: 'llxprt-code',
      version: await getCliVersion(),
    },
    authMethods: profileNames.map((name) => ({
      id: name,
      name,
      description: null,
    })),
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: {
        list: {},
        resume: {},
      },
      promptCapabilities: {
        image: true,
        audio: true,
        embeddedContext: true,
      },
    },
  };
}

export async function authenticateZedAgent(
  profiles: Pick<ProfileDefinitionReads, 'listProfiles'> | undefined,
  methodId: string,
  profileApplication: AgentProfileApplication,
): Promise<void> {
  try {
    const profileNames = await getAvailableProfileNames(
      requireZedProfileDefinitions(profiles),
    );
    const profileName = parseZedAuthMethodId(methodId, profileNames);
    await profileApplication.load(profileName);
  } catch (error) {
    throw new Error(
      `Failed to authenticate with profile "${methodId}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function getAvailableProfileNames(
  profiles: Pick<ProfileDefinitionReads, 'listProfiles'>,
): Promise<string[]> {
  return profiles.listProfiles();
}
