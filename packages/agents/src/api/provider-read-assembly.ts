/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { Agent } from './agent.js';
import { SessionProviderReads } from './session-provider-reads.js';

export function assembleProviderReads(
  manager: Pick<
    RuntimeProviderManager,
    | 'hasActiveProvider'
    | keyof ConstructorParameters<typeof SessionProviderReads>[1]
  >,
  readProviderName: () => string,
  selection: ConstructorParameters<typeof SessionProviderReads>[0],
  readModel: () => string,
  readSettings: (provider: string) => Record<string, unknown>,
): Pick<
  Agent,
  | 'hasActiveProvider'
  | 'getProviderContextLimit'
  | 'listAvailableModels'
  | 'providerReads'
> {
  return {
    providerReads: new SessionProviderReads(
      selection,
      manager,
      readModel,
      readSettings,
    ),
    hasActiveProvider: () => manager.hasActiveProvider(),
    getProviderContextLimit: () =>
      manager.getActiveProvider()?.getContextLimit?.(),
    listAvailableModels: (provider) =>
      manager.getAvailableModels(provider ?? readProviderName()),
  };
}
