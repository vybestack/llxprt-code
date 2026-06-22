/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260320-ISSUE1575.P03
 * Settings resolver module - extracted from runtimeSettings.ts
 * Handles CLI argument resolution into runtime overrides.
 */

import type { Config } from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { applyCliSetArguments } from './cliEphemeralSettings.js';
import { getCliRuntimeServices } from './runtimeAccessors.js';
import { updateActiveProviderBaseUrl } from './providerMutations.js';
import {
  resolveFromKeyArg,
  resolveFromKeyName,
  resolveFromProfileKeyName,
  resolveFromKeyfile,
} from './keyResolution.js';

export { resolveNamedKey } from './keyResolution.js';

/**
 * Apply CLI argument overrides to configuration.
 * Must be called AFTER provider manager creation but BEFORE provider switching.
 *
 * Precedence order (highest first):
 * 1. --key (overrides profile auth-key)
 * 2. --key-name (named key from keyring)
 * 3. auth-key-name from profile ephemeral settings
 * 4. --keyfile (overrides profile auth-keyfile)
 * 5. --set arguments (overrides profile ephemerals)
 * 6. --baseurl (overrides profile base-url)
 *
 * @param argv - CLI arguments
 * @param bootstrapArgs - Bootstrap parsed arguments
 */
export async function applyCliArgumentOverrides(
  argv: {
    key?: string;
    keyfile?: string;
    baseurl?: string;
    set?: string[];
  },
  bootstrapArgs?: {
    keyOverride?: string | null;
    keyNameOverride?: string | null;
    keyfileOverride?: string | null;
    baseurlOverride?: string | null;
    setOverrides?: string[] | null;
  },
): Promise<void> {
  const { config, settingsService } = getCliRuntimeServices();

  // Resolve and apply API key (4-step precedence chain)
  await resolveAndApplyApiKey(argv, bootstrapArgs, config, settingsService);

  // Apply --set arguments
  const setArgsToUse = bootstrapArgs?.setOverrides ?? argv.set;
  if (setArgsToUse && Array.isArray(setArgsToUse) && setArgsToUse.length > 0) {
    applyCliSetArguments(config, setArgsToUse);
  }

  // Apply --baseurl
  const baseurlToUse = bootstrapArgs?.baseurlOverride ?? argv.baseurl;
  if (baseurlToUse) {
    await applyBaseUrlOverride(baseurlToUse, config);
  }
}

/**
 * Resolve and apply API key following the 4-step precedence chain.
 */
async function resolveAndApplyApiKey(
  argv: { key?: string; keyfile?: string },
  bootstrapArgs:
    | {
        keyOverride?: string | null;
        keyNameOverride?: string | null;
        keyfileOverride?: string | null;
      }
    | undefined,
  config: Config,
  settingsService: SettingsService,
): Promise<void> {
  const providerName =
    (settingsService.get('activeProvider') as string | undefined) ??
    config.getProvider();
  if (!providerName) {
    return;
  }

  // 1. --key (bootstrap override takes precedence, then argv)
  const keyToUse = bootstrapArgs?.keyOverride ?? argv.key;
  if (await resolveFromKeyArg(keyToUse, config)) {
    return;
  }

  // 2. --key-name (CLI flag, named key from keyring)
  const keyNameToUse = bootstrapArgs?.keyNameOverride ?? null;
  if (await resolveFromKeyName(keyNameToUse, config)) {
    return;
  }

  // 3. auth-key-name from profile ephemeral settings
  const profileKeyName = config.getEphemeralSetting('auth-key-name') as
    | string
    | undefined;
  if (await resolveFromProfileKeyName(profileKeyName, config)) {
    return;
  }

  // 4. --keyfile (only if no higher-precedence key resolved)
  const keyfileToUse = bootstrapArgs?.keyfileOverride ?? argv.keyfile;
  await resolveFromKeyfile(keyfileToUse, config);
}

/**
 * Apply base URL override to the active provider.
 */
async function applyBaseUrlOverride(
  baseurl: string,
  config: Config,
): Promise<void> {
  const trimmed = baseurl.trim();
  if (!trimmed) {
    return;
  }

  await updateActiveProviderBaseUrl(trimmed);
  config.setEphemeralSetting('base-url', trimmed);
}
