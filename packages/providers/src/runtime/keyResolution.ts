/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260320-ISSUE1575.P03
 * Pure key-resolution helpers extracted from settingsResolver.ts so each
 * precedence step is independently testable and lint-clean.
 */

import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import type { Config } from '@vybestack/llxprt-code-core';
import { updateActiveProviderApiKey } from './providerMutations.js';
import { createProviderKeyStorage } from '../auth/index.js';

/**
 * Apply the --key override (highest precedence). Returns true when a key
 * was resolved so callers can short-circuit lower-precedence steps.
 */
export async function resolveFromKeyArg(
  keyToUse: string | undefined,
  config: Config,
): Promise<boolean> {
  if (!keyToUse) {
    return false;
  }
  const trimmed = keyToUse.trim();
  await updateActiveProviderApiKey(trimmed);
  config.setEphemeralSetting('auth-key', trimmed);
  config.setEphemeralSetting('auth-keyfile', undefined);
  return true;
}

/**
 * Apply the --key-name flag (named key from keyring).
 */
export async function resolveFromKeyName(
  keyNameToUse: string | null,
  config: Config,
): Promise<boolean> {
  if (!keyNameToUse) {
    return false;
  }
  const resolvedKey = await resolveNamedKey(keyNameToUse);
  await updateActiveProviderApiKey(resolvedKey);
  config.setEphemeralSetting('auth-key-name', keyNameToUse);
  config.setEphemeralSetting('auth-key', undefined);
  config.setEphemeralSetting('auth-keyfile', undefined);
  return true;
}

/**
 * Apply the auth-key-name from profile ephemeral settings.
 */
export async function resolveFromProfileKeyName(
  profileKeyName: string | undefined,
  config: Config,
): Promise<boolean> {
  if (!profileKeyName) {
    return false;
  }
  const resolvedKey = await resolveNamedKey(profileKeyName);
  await updateActiveProviderApiKey(resolvedKey);
  config.setEphemeralSetting('auth-key-name', profileKeyName);
  config.setEphemeralSetting('auth-key', undefined);
  config.setEphemeralSetting('auth-keyfile', undefined);
  return true;
}

/**
 * Apply the --keyfile override (lowest key precedence).
 */
export async function resolveFromKeyfile(
  keyfileToUse: string | undefined,
  config: Config,
): Promise<void> {
  if (!keyfileToUse) {
    return;
  }
  const resolvedPath = keyfileToUse.replace(/^~/, homedir());
  const keyContent = await readFile(resolvedPath, 'utf-8');
  await updateActiveProviderApiKey(keyContent.trim());
  config.setEphemeralSetting('auth-key', undefined);
  config.setEphemeralSetting('auth-keyfile', resolvedPath);
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
