/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeApi } from '../ui/contexts/RuntimeContext.js';
import { createSetCommand } from '../ui/commands/setCommand.js';
import type { SlashCommand } from '../ui/commands/types.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

export function createSetCommandForTest(
  runtime: Pick<
    RuntimeApi,
    | 'getEphemeralSettings'
    | 'setEphemeralSetting'
    | 'getActiveModelParams'
    | 'setActiveModelParam'
    | 'clearActiveModelParam'
  >,
): SlashCommand {
  return createSetCommand({
    getEphemeralSettings: () => runtime.getEphemeralSettings(),
    setEphemeralSetting: (key, value) =>
      runtime.setEphemeralSetting(key, value),
    getActiveModelParams: () => runtime.getActiveModelParams(),
    setActiveModelParam: (key, value) =>
      runtime.setActiveModelParam(key, value),
    clearActiveModelParam: (key) => runtime.clearActiveModelParam(key),
    isFuzzyFilteringEnabled: () => true,
  });
}

export function createAgentSetCommand(agent: Agent): SlashCommand {
  return createSetCommand({
    getEphemeralSettings: () => agent.getEphemeralSettings(),
    setEphemeralSetting: (key, value) => agent.setEphemeralSetting(key, value),
    getActiveModelParams: () => agent.providerReads.getActiveModelParams(),
    setActiveModelParam: (key, value) => agent.modelParameters.set(key, value),
    clearActiveModelParam: (key) => agent.modelParameters.clear(key),
    isFuzzyFilteringEnabled: () => true,
  });
}
