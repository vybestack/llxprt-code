/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import * as acp from '@agentclientprotocol/sdk';
import { loadProfileByName } from '@vybestack/llxprt-code-providers/runtime.js';
import { parseZedAuthMethodId } from './zed-helpers.js';

export async function initializeZedAgent(
  config: Config,
): Promise<acp.InitializeResponse> {
  const profileNames = await getAvailableProfileNames(config);
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
  config: Config,
  methodId: string,
): Promise<void> {
  const profileNames = await getAvailableProfileNames(config);
  try {
    const profileName = parseZedAuthMethodId(methodId, profileNames);
    await loadProfileByName(profileName);
  } catch (error) {
    throw new Error(
      `Failed to authenticate with profile "${methodId}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function getAvailableProfileNames(config: Config): Promise<string[]> {
  return (await config.getProfileManager()?.listProfiles()) ?? [];
}
