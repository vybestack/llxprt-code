/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Config } from '@vybestack/llxprt-code-core';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
let managers: ProviderManager[] = [];
afterEach(() => {
  const pending = managers;
  managers = [];
  for (const manager of pending) manager.dispose();
});
export function createConnectionProviderManager(
  config: Config,
  settingsService: SettingsService,
): ProviderManager {
  const manager = new ProviderManager({
    config,
    settingsService,
  });
  managers.push(manager);
  return manager;
}
