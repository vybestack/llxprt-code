/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { Agent } from './agent.js';

export function assembleProviderReads(
  manager: Pick<
    RuntimeProviderManager,
    'hasActiveProvider' | 'getActiveProvider' | 'getAvailableModels'
  >,
  readProviderName: () => string,
): Pick<
  Agent,
  'hasActiveProvider' | 'getProviderContextLimit' | 'listAvailableModels'
> {
  return {
    hasActiveProvider: () => manager.hasActiveProvider(),
    getProviderContextLimit: () =>
      manager.getActiveProvider()?.getContextLimit?.(),
    listAvailableModels: (provider) =>
      manager.getAvailableModels(provider ?? readProviderName()),
  };
}
