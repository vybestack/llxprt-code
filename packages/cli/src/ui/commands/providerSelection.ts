/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadProviderAliasEntries } from '@vybestack/llxprt-code-providers/composition.js';
import { ImageProviderAliasError } from '@vybestack/llxprt-code-providers';
import { SettingScope, type LoadedSettings } from '../../config/settings.js';
import type { getRuntimeApi } from '../contexts/RuntimeContext.js';

type Runtime = ReturnType<typeof getRuntimeApi>;

export function listTextProviders(
  runtime: Pick<Runtime, 'listProviders'>,
): string[] {
  return runtime.listProviders();
}

export function listImageProviders(): string[] {
  return loadProviderAliasEntries().map((entry) => entry.alias);
}

export function pinImageProvider(
  settings: LoadedSettings,
  runtime: Pick<Runtime, 'getCliRuntimeServices'>,
  alias: string,
): void {
  const aliases = listImageProviders();
  if (!aliases.includes(alias))
    throw new ImageProviderAliasError(alias, aliases);
  settings.setValue(SettingScope.User, 'imageProvider', alias);
  runtime
    .getCliRuntimeServices()
    .settingsService.set('imageProvider', settings.merged.imageProvider);
}
