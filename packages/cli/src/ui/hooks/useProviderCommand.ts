/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { SlashCommand } from '../commands/types.js';
import { createProviderCommand } from '../commands/providerCommand.js';
import { bindProviderCommandOperations } from '../commands/providerCommandHost.js';

export function useProviderCommand(
  readProvider: Parameters<typeof bindProviderCommandOperations>[0],
  readStatus: Parameters<typeof bindProviderCommandOperations>[1],
  readModel: Parameters<typeof bindProviderCommandOperations>[2],
  switchProvider: Parameters<typeof bindProviderCommandOperations>[4],
  resolveAlias: Parameters<typeof bindProviderCommandOperations>[3],
  refreshProviderAliases: () => Promise<void>,
  recordProviderSwitch: (provider: string, model: string) => Promise<void>,
): SlashCommand {
  return useMemo(
    () =>
      createProviderCommand(
        bindProviderCommandOperations(
          readProvider,
          readStatus,
          readModel,
          resolveAlias,
          switchProvider,
          refreshProviderAliases,
          recordProviderSwitch,
        ),
      ),
    [
      readProvider,
      readStatus,
      readModel,
      resolveAlias,
      switchProvider,
      refreshProviderAliases,
      recordProviderSwitch,
    ],
  );
}
