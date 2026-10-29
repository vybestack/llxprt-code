/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ConfigurationManager } from '@vybestack/llxprt-code-telemetry';
import type { DebugCommandOperations } from './debugCommands.js';
export function bindDebugCommand(
  owner: ConfigurationManager,
): DebugCommandOperations {
  return {
    readConfig: () => owner.getEffectiveConfig(),
    writeConfig: (value) => owner.setEphemeralConfig(value),
    readOutput: () => owner.getOutputTarget(),
    hasChanges: () => owner.hasEphemeralConfig(),
    persist: () => owner.persistEphemeralConfig(),
  };
}
