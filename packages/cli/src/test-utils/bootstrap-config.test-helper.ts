/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi } from 'bun:test';
import type { BootstrapProfileArgs } from '../config/profileBootstrap.js';
import type { Config } from '@vybestack/llxprt-code-core';
import type { AgentActivationOperation } from '@vybestack/llxprt-code-agents';
import type { ConfigBuildPreflight, loadCliConfig } from '../config/config.js';

/** The preflight a bootstrap path hands to `loadCliConfig`, plus the provider
 * probe the entry point calls on the same object. */
type StubbablePreflight = ConfigBuildPreflight & {
  hasActiveProvider(): boolean;
};

export function handoffCliConfig(
  config: Config,
  preflightOperation?: AgentActivationOperation['preflight'],
  hasActiveProvider?: () => boolean,
): typeof loadCliConfig {
  return async ({ preflight }) => {
    await preflight.prepareConfiguredWorkspace(config, () => {});
    if (preflightOperation !== undefined)
      vi.spyOn(preflight, 'preflight').mockImplementation(preflightOperation);
    if (hasActiveProvider !== undefined)
      vi.spyOn(
        preflight as StubbablePreflight,
        'hasActiveProvider',
      ).mockImplementation(hasActiveProvider);
    return config;
  };
}

export function makeBootstrapProfileArgs(
  overrides: Partial<BootstrapProfileArgs> = {},
): BootstrapProfileArgs {
  return {
    profileName: null,
    profileJson: null,
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    keyNameOverride: null,
    baseurlOverride: null,
    setOverrides: null,
    debug: null,
    ...overrides,
  };
}
