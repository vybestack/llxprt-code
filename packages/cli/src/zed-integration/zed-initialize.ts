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
        delete: {},
        close: {},
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
  await loadProfileByName(
    parseZedAuthMethodId(methodId, await getAvailableProfileNames(config)),
  );
}

async function getAvailableProfileNames(config: Config): Promise<string[]> {
  return (await config.getProfileManager()?.listProfiles()) ?? [];
}
