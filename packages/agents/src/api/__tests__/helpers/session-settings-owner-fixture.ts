/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Config and settings ownership fixtures for agents tests. Mirrors the
 * providers copy of the same name; kept here so agents tests own their
 * scaffolding instead of reaching into another package's test tree.
 */
import { afterEach } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

function installRelease(): (release: () => Promise<void>) => void {
  const releases: Array<() => Promise<void>> = [];
  afterEach(async () => {
    const settled = await Promise.allSettled(
      releases.splice(0).map((release) => release()),
    );
    const failures = settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Runtime fixture cleanup failed');
  });
  return (release) => {
    releases.push(release);
  };
}

export function installOwnedConfig(): (parameters: ConfigParameters) => Config {
  const own = installRelease();
  return (parameters) => {
    const config = new Config(parameters);
    own(() => config.dispose());
    return config;
  };
}

export function installBorrowedConfigSettings(): (
  config: Config,
  settings: SettingsService,
) => SessionSettingsOwner {
  const own = installRelease();
  return (config, settings) => {
    const owner = new SessionSettingsOwner(settings);
    own(() => owner.dispose());
    owner.bindTelemetry(config);
    return owner;
  };
}

export function installOwnedConfigSettings(): (
  label?: string,
  settings?: SettingsService,
) => SessionSettingsOwner {
  const own = installRelease();
  return (label = 'same-label', settings = new SettingsService()) => {
    const config = new Config({
      sessionId: label,
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'owner-model',
      debugMode: false,
    });
    const steps: Array<() => Promise<void>> = [() => config.dispose()];
    own(async () => {
      const failures: unknown[] = [];
      for (const close of steps) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Runtime fixture cleanup failed');
    });
    const owner = new SessionSettingsOwner(settings);
    steps.unshift(() => owner.dispose());
    owner.assertSettingsIdentity(settings);
    owner.bindTelemetry(config);
    return owner;
  };
}
