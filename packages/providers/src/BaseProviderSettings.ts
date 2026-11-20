/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import type { ProviderOwner } from './providerOwner.js';
import { extractModelParams } from './providerModelParams.js';
import type { ProviderSettings } from './BaseProvider.js';

/**
 * Reads and writes of a provider's persisted settings through its owner.
 * Settings storage is best-effort: a failed read yields the fallback and a
 * failed write is dropped, with the failure logged only under DEBUG.
 */

/** A falsy-like stored value (nullish, false, '', 0, NaN) selects the fallback. */
function isFalsyLikeValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (value === false || value === '' || value === 0) return true;
  return typeof value === 'number' && Number.isNaN(value);
}

function logSettingsFailure(message: string, error: unknown): void {
  if (process.env.DEBUG) {
    debugLogger.error(message, error);
  }
}

export async function readProviderSetting<T>(
  owner: ProviderOwner,
  providerName: string,
  key: keyof ProviderSettings,
  fallback?: T,
): Promise<T | undefined> {
  try {
    const settings = await owner.readProviderData();
    const value = settings[key];
    return isFalsyLikeValue(value) ? fallback : (value as T);
  } catch (error) {
    logSettingsFailure(
      `Failed to get ${key} from SettingsService for ${providerName}:`,
      error,
    );
    return fallback;
  }
}

export async function writeProviderSetting<T>(
  owner: ProviderOwner,
  providerName: string,
  key: keyof ProviderSettings,
  value: T,
): Promise<void> {
  try {
    await owner.writeProviderData({ [key]: value });
  } catch (error) {
    logSettingsFailure(
      `Failed to set ${key} in SettingsService for ${providerName}:`,
      error,
    );
  }
}

export async function readProviderModelParams(
  owner: ProviderOwner,
  providerName: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return extractModelParams(await owner.readProviderData());
  } catch (error) {
    logSettingsFailure(
      `Failed to get model params from SettingsService for ${providerName}:`,
      error,
    );
    return undefined;
  }
}

export async function writeProviderModelParams(
  owner: ProviderOwner,
  params: Record<string, unknown> | undefined,
): Promise<void> {
  if (params === undefined) {
    await owner.writeProviderData({
      temperature: undefined,
      max_tokens: undefined,
    });
    return;
  }
  await owner.writeProviderData(params);
}
