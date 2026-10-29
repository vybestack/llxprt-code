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
  readModel: Parameters<typeof bindProviderCommandOperations>[1],
  switchProvider: Parameters<typeof bindProviderCommandOperations>[3],
  resolveAlias: Parameters<typeof bindProviderCommandOperations>[2],
  refreshProviderAliases: () => Promise<void>,
  recordProviderSwitch: (provider: string, model: string) => Promise<void>,
): SlashCommand {
  return useMemo(
    () =>
      createProviderCommand(
        bindProviderCommandOperations(
          readProvider,
          readModel,
          resolveAlias,
          switchProvider,
          refreshProviderAliases,
          recordProviderSwitch,
        ),
      ),
    [
      readProvider,
      readModel,
      resolveAlias,
      switchProvider,
      refreshProviderAliases,
      recordProviderSwitch,
    ],
  );
}
