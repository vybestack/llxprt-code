/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  ProfileManager,
  type SettingsService,
} from '@vybestack/llxprt-code-settings';
import type { Agent } from '../../agent.js';
import { openRouteAAgent } from './route-a-agent.js';

export const SAME_LABEL_SESSION_ID = 'same-profile-owner-label';

/** One root of a same-session-label pair, built through `fromConfig` (Route A). */
export interface SameLabelProfileRoot {
  readonly agent: Agent;
  readonly config: Config;
  readonly settings: SettingsService;
  readonly close: () => Promise<void>;
}

/**
 * Opens a root whose working directory and durable profile directory are
 * private to `label`, with the session id every root of the pair shares. The
 * root starts on the fake provider with model `<label>-initial`, a
 * `context-limit` of `contextLimit`, a prior profile name and a default
 * profile name, and has saved its own `selected` profile snapshot.
 */
export async function openSameLabelProfileRoot(
  baseDirectory: string,
  label: string,
  contextLimit: number,
  authority: CredentialAuthority,
): Promise<SameLabelProfileRoot> {
  const workingDir = join(baseDirectory, label);
  await mkdir(workingDir, { recursive: true });
  const profileDirectory = join(workingDir, 'durable-profiles');
  const model = `${label}-initial`;
  const opened = await openRouteAAgent({
    config: {
      model,
      workingDir,
      sessionId: SAME_LABEL_SESSION_ID,
      settings: { profileDirectory },
    },
    intent: {
      sessionId: SAME_LABEL_SESSION_ID,
      activation: { provider: 'fake', model },
    },
    authority,
  });
  const { agent, config, settings, close } = opened;
  try {
    agent.setEphemeralSetting('context-limit', contextLimit);
    settings.setCurrentProfileName(`${label}-prior`);
    agent.setDefaultProfileName(`${label}-default`);
    await new ProfileManager(profileDirectory).saveProfile(
      'selected',
      agent.captureProfile(),
    );
  } catch (primary) {
    await close();
    throw primary;
  }
  return { agent, config, settings, close };
}

/**
 * Everything a root exposes that the other root's profile operations must not
 * move, read through the `Agent` and the `Config` and `SettingsService` the
 * root was built over. The owner's default-ownership classification has no
 * Agent read; `session-settings-owner.test.ts` covers it across two owners.
 */
export function observeSameLabelProfileRoot(
  root: SameLabelProfileRoot,
): object {
  const { agent, config, settings } = root;
  return {
    provider: agent.getProvider(),
    model: agent.getModel(),
    status: agent.getProviderStatus(),
    profile: agent.getActiveProfileName(),
    snapshot: agent.captureProfile(),
    configProvider: config.getProvider(),
    configModel: config.getModel(),
    managerProvider: agent.providerReads.getActiveProviderName(),
    settings: settings.exportForStateSnapshot(),
    ephemerals: agent.getEphemeralSettings(),
  };
}
