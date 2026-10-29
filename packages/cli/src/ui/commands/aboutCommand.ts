/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { getCliVersion } from '../../utils/version.js';
import { CommandKind, type SlashCommand } from './types.js';
import { MessageType, type HistoryItemAbout } from '../types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
export type AboutDetails = Pick<
  HistoryItemAbout,
  'modelVersion' | 'provider' | 'baseURL' | 'ideClient' | 'keyfile'
>;

function getSandboxEnv(): string {
  if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
    return process.env.SANDBOX;
  }

  if (process.env.SANDBOX === 'sandbox-exec') {
    return `sandbox-exec (${process.env.SEATBELT_PROFILE ?? 'unknown'})`;
  }

  return 'no sandbox';
}

export function createAboutCommand(
  readDetails: () => Promise<AboutDetails>,
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return {
    name: 'about',
    description: 'show version info',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async () => {
      const osVersion = process.platform;
      const sandboxEnv = getSandboxEnv();
      const details = await readDetails();
      const cliVersion = await getCliVersion();
      const item: Omit<HistoryItemAbout, 'id'> = {
        type: MessageType.ABOUT,
        cliVersion,
        osVersion,
        sandboxEnv,
        ...details,
        key: '',
      };
      addItem(item);
    },
  };
}
