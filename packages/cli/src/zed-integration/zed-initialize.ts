/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileManager } from '@vybestack/llxprt-code-settings';

interface ProfileManagerSource {
  getProfileManager(): ProfileManager | undefined;
}
import * as acp from '@agentclientprotocol/sdk';
import { loadProfileByName } from '@vybestack/llxprt-code-providers/runtime.js';
import { parseZedAuthMethodId } from './zed-helpers.js';

export async function initializeZedAgent(
  config: ProfileManagerSource,
): Promise<acp.InitializeResponse> {
  let profileNames: string[];
  try {
    profileNames = await getAvailableProfileNames(config);
  } catch (error) {
    throw new Error(
      `Failed to initialize Zed agent: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return {
    protocolVersion: acp.PROTOCOL_VERSION,
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
  config: ProfileManagerSource,
  methodId: string,
): Promise<void> {
  try {
    const profileNames = await getAvailableProfileNames(config);
    const profileName = parseZedAuthMethodId(methodId, profileNames);
    await loadProfileByName(profileName);
  } catch (error) {
    throw new Error(
      `Failed to authenticate with profile "${methodId}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function getAvailableProfileNames(
  config: ProfileManagerSource,
): Promise<string[]> {
  return (await config.getProfileManager()?.listProfiles()) ?? [];
}
