/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy CLI boundary retained while larger decomposition continues. */

/**
 * @plan:PLAN-20260320-ISSUE1575.P03
 * Settings resolver module - extracted from runtimeSettings.ts
 * Handles CLI argument resolution into runtime overrides.
 */

import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import type { Config, SettingsService } from '@vybestack/llxprt-code-core';
import { applyCliSetArguments } from '../config/cliEphemeralSettings.js';
import { getCliRuntimeServices } from './runtimeAccessors.js';
import {
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
} from './providerMutations.js';
import { createProviderKeyStorage } from '../auth/proxy/credential-store-factory.js';

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

  let keyResolved = false;

  // 1. --key (bootstrap override takes precedence, then argv)
  const keyToUse = bootstrapArgs?.keyOverride ?? argv.key;
  if (keyToUse) {
    await updateActiveProviderApiKey(keyToUse.trim());
    config.setEphemeralSetting('auth-key', keyToUse.trim());
    config.setEphemeralSetting('auth-keyfile', undefined);
    keyResolved = true;
  }

  // 2. --key-name (CLI flag, named key from keyring)
  if (!keyResolved) {
    const keyNameToUse = bootstrapArgs?.keyNameOverride ?? null;
    if (keyNameToUse) {
      const resolvedKey = await resolveNamedKey(keyNameToUse);
      await updateActiveProviderApiKey(resolvedKey);
      config.setEphemeralSetting('auth-key-name', keyNameToUse);
      config.setEphemeralSetting('auth-key', undefined);
      config.setEphemeralSetting('auth-keyfile', undefined);
      keyResolved = true;
    }
  }

  // 3. auth-key-name from profile ephemeral settings
  if (!keyResolved) {
    const profileKeyName = config.getEphemeralSetting('auth-key-name') as
      | string
      | undefined;
    if (profileKeyName) {
      const resolvedKey = await resolveNamedKey(profileKeyName);
      await updateActiveProviderApiKey(resolvedKey);
      config.setEphemeralSetting('auth-key-name', profileKeyName);
      config.setEphemeralSetting('auth-key', undefined);
      config.setEphemeralSetting('auth-keyfile', undefined);
      keyResolved = true;
    }
  }

  // 4. --keyfile (only if no higher-precedence key resolved)
  const keyfileToUse = bootstrapArgs?.keyfileOverride ?? argv.keyfile;
  if (!keyResolved && keyfileToUse) {
    const resolvedPath = keyfileToUse.replace(/^~/, homedir());
    const keyContent = await readFile(resolvedPath, 'utf-8');
    await updateActiveProviderApiKey(keyContent.trim());
    config.setEphemeralSetting('auth-key', undefined);
    config.setEphemeralSetting('auth-keyfile', resolvedPath);
  }
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

/**
 * Resolve a named key from the credential store.
 *
 * @param name - The key name to resolve
 * @returns The resolved key
 * @throws Error if key not found or invalid
 */
export async function resolveNamedKey(name: string): Promise<string> {
  const storage = createProviderKeyStorage();

  let key: string | null;
  try {
    key = await storage.getKey(name);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isValidation = msg.includes('is invalid');
    const prefix = isValidation
      ? `Invalid key name '${name}'`
      : `Failed to access keyring while resolving named key '${name}'`;
    throw new Error(
      `${prefix}: ${msg}. Use '/key save ${name} <key>' to store it, or use --key to provide the key directly.`,
    );
  }

  if (key === null) {
    throw new Error(
      `Named key '${name}' not found. Use '/key save ${name} <key>' to store it.`,
    );
  }

  return key;
}
