/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';

/**
 * @plan:PLAN-20260320-ISSUE1575.P03
 * Settings resolver module - extracted from runtimeSettings.ts
 * Handles CLI argument resolution into runtime overrides.
 */

import type { EphemeralSettingTarget } from './cliEphemeralSettings.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { applyCliSetArguments } from './cliEphemeralSettings.js';
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
 * Must be called AFTER provider manager creation and AFTER provider switching
 * (#2534 review Finding 1): the overrides persist provider-scoped credentials
 * (auth-key/base-url) into the CURRENTLY active provider's scope, so the
 * switch must already have selected the target provider. This matches the CLI
 * bootstrap's postConfigRuntime step 14, which reapplies these overrides
 * after the provider switch.
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
  bootstrapArgs:
    | {
        keyOverride?: string | null;
        keyNameOverride?: string | null;
        keyfileOverride?: string | null;
        baseurlOverride?: string | null;
        setOverrides?: string[] | null;
      }
    | undefined,
  config: EphemeralSettingTarget,
  settingsService: SettingsService,
  provider: ReturnType<RuntimeProviderManager['getActiveProvider']>,
): Promise<void> {
  // Resolve and apply API key (4-step precedence chain)
  await resolveAndApplyApiKey(
    argv,
    bootstrapArgs,
    config,
    settingsService,
    provider,
  );

  // Apply --set arguments
  const setArgsToUse = bootstrapArgs?.setOverrides ?? argv.set;
  if (setArgsToUse && Array.isArray(setArgsToUse) && setArgsToUse.length > 0) {
    applyCliSetArguments(config, setArgsToUse);
  }

  // Apply --baseurl
  const baseurlToUse = bootstrapArgs?.baseurlOverride ?? argv.baseurl;
  if (baseurlToUse) {
    await applyBaseUrlOverride(baseurlToUse, config, settingsService, provider);
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
  config: EphemeralSettingTarget,
  settingsService: SettingsService,
  provider: ReturnType<RuntimeProviderManager['getActiveProvider']>,
): Promise<void> {
  const providerName = provider?.name;
  if (!providerName) {
    return;
  }

  // 1. --key (bootstrap override takes precedence, then argv)
  const keyToUse = bootstrapArgs?.keyOverride ?? argv.key;
  if (await resolveFromKeyArg(keyToUse, config, settingsService, provider)) {
    return;
  }

  // 2. --key-name (CLI flag, named key from keyring)
  const keyNameToUse = bootstrapArgs?.keyNameOverride ?? null;
  if (
    await resolveFromKeyName(keyNameToUse, config, settingsService, provider)
  ) {
    return;
  }

  // 3. auth-key-name from profile ephemeral settings
  const profileKeyName = settingsService.get('auth-key-name') as
    | string
    | undefined;
  if (
    await resolveFromProfileKeyName(
      profileKeyName,
      config,
      settingsService,
      provider,
    )
  ) {
    return;
  }

  // 4. --keyfile (only if no higher-precedence key resolved)
  const keyfileToUse = bootstrapArgs?.keyfileOverride ?? argv.keyfile;
  await resolveFromKeyfile(keyfileToUse, config, settingsService, provider);
}

/**
 * Apply base URL override to the active provider.
 */
async function applyBaseUrlOverride(
  baseurl: string,
  config: EphemeralSettingTarget,
  settingsService: SettingsService,
  provider: ReturnType<RuntimeProviderManager['getActiveProvider']>,
): Promise<void> {
  const trimmed = baseurl.trim();
  if (!trimmed) {
    return;
  }

  await updateActiveProviderBaseUrl(
    trimmed,
    config,
    settingsService,
    provider?.name,
  );
  config.setEphemeralSetting('base-url', trimmed);
}
