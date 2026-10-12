/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

interface ProviderConfigFixture {
  readonly config: Config;
  readonly settingsService: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
}
let roots: readonly ProviderConfigFixture[] = [];
afterEach(async () => {
  const retiring = roots;
  roots = [];
  const outcomes = await Promise.allSettled(
    retiring.flatMap((root) => [
      Promise.resolve().then(() => root.settingsOwner.dispose()),
      Promise.resolve().then(() => root.config.dispose()),
    ]),
  );
  const failures = outcomes.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Provider configuration fixture cleanup failed',
    );
});
export function createProviderConfigFixture(
  options: ConfigParameters & { readonly settingsService?: SettingsService },
): ProviderConfigFixture {
  const { settingsService: suppliedSettings, ...parameters } = options;
  const config = new Config(parameters);
  const settingsService = suppliedSettings ?? new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  const root = { config, settingsService, settingsOwner };
  roots = [...roots, root];
  if (suppliedSettings === undefined) {
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settingsService.set(key, value);
    settingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
  }
  return root;
}
