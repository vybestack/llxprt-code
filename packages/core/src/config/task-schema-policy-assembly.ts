/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildToolGovernance,
  type RegistryPolicy,
} from '@vybestack/llxprt-code-tools';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

export function assembleTaskSchemaPolicy(
  settings: Pick<SettingsService, 'get' | 'getAllGlobalSettings'>,
  excludedTools: readonly string[] = [],
): () => RegistryPolicy {
  return () => {
    const values = settings.getAllGlobalSettings();
    const subagents = values.subagents;
    const globalDisabled =
      typeof subagents === 'object' &&
      subagents !== null &&
      'asyncEnabled' in subagents &&
      subagents.asyncEnabled === false;
    const eager = settings.get('mcp.eagerServers');
    return Object.freeze({
      lazyMcp: settings.get('mcp.lazy') === true,
      eagerServers:
        Array.isArray(eager) &&
        eager.every((value): value is string => typeof value === 'string')
          ? [...eager]
          : [],
      governance: buildToolGovernance({
        getEphemeralSettings: () => ({
          'tools.allowed': values['tools.allowed'],
          'tools.disabled': values['tools.disabled'],
        }),
        getExcludeTools: () => [...excludedTools],
      }),
      hideTaskAsync:
        globalDisabled || settings.get('subagents.async.enabled') === false,
    });
  };
}
