/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getCliVersion } from '../../utils/version.js';
import { CommandKind, SlashCommand } from './types.js';
import process from 'node:process';
import { MessageType, type HistoryItemAbout } from '../types.js';
import {
  getActiveProviderStatus,
  getEphemeralSetting,
} from '../../runtime/runtimeSettings.js';

export const aboutCommand: SlashCommand = {
  name: 'about',
  description: 'show version info',
  kind: CommandKind.BUILT_IN,
  action: async (context) => {
    const osVersion = process.platform;
    let sandboxEnv = 'no sandbox';
    if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
      sandboxEnv = process.env.SANDBOX;
    } else if (process.env.SANDBOX === 'sandbox-exec') {
      sandboxEnv = `sandbox-exec (${
        process.env.SEATBELT_PROFILE || 'unknown'
      })`;
    }
    // Determine the currently selected model. Prefer the active provider's
    // model as the source of truth because it is guaranteed to be up-to-date
    // when users switch models via the /model or /provider commands.
    const providerStatus = getActiveProviderStatus();
    const modelVersion = providerStatus.providerName
      ? `${providerStatus.providerName}:${providerStatus.modelName ?? 'Unknown'}`
      : (providerStatus.modelName ?? 'Unknown');

    const cliVersion = await getCliVersion();
    const selectedAuthType =
      context.services.settings.merged.selectedAuthType || '';
    const gcpProject = process.env.GOOGLE_CLOUD_PROJECT || '';
    const ideClient =
      (context.services.config?.getIdeMode() &&
        context.services.config?.getIdeClient()?.getDetectedIdeDisplayName()) ||
      '';

    // Determine keyfile path and key status for the active provider (if any)
    const keyfilePath = (getEphemeralSetting('auth-keyfile') as string) || '';
    const keyStatus = '';

    const aboutItem: Omit<HistoryItemAbout, 'id'> = {
      type: MessageType.ABOUT,
      cliVersion,
      osVersion,
      sandboxEnv,
      modelVersion,
      selectedAuthType,
      gcpProject,
      keyfile: keyfilePath,
      key: keyStatus,
      ideClient,
    };

    context.ui.addItem(aboutItem, Date.now());
  },
};
