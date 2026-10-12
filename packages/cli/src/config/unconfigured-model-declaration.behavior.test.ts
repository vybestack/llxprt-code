/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { AgentActivationOperation } from '@vybestack/llxprt-code-agents';
import { loadCliConfig } from './config.js';
import { parseArguments } from './cliArgParser.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

describe('unconfigured CLI model declaration', () => {
  it('retains a CLI model declaration without creating a configured session provider', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cli-model-declaration-'));
    const previousArgv = process.argv;
    const previousEnv = { ...process.env };
    const store = new SettingsService();
    const owner = new SessionSettingsOwner(store);
    let operation: AgentActivationOperation | undefined;
    let config: Awaited<ReturnType<typeof loadCliConfig>> | undefined;
    let cleanupFailures: readonly unknown[] = [];
    try {
      process.env.LLXPRT_CONFIG_HOME = directory;
      delete process.env.LLXPRT_DEFAULT_PROVIDER;
      delete process.env.LLXPRT_DEFAULT_MODEL;
      process.argv = ['bun', 'cli', '--model', 'declared-only-model'];
      const argv = await parseArguments({});
      config = await loadCliConfig(
        {},
        [],
        new ExtensionEnablementManager(join(directory, 'extensions'), []),
        'unconfigured-model',
        argv,
        directory,
        {
          settingsService: store,
          sessionSettingsOwner: owner,
          onActivationBootstrapReady: (value) => {
            operation = value;
            value.takeSettingsOwner(store);
          },
        },
      );
      expect(config.getModel()).toBe('declared-only-model');
      expect(owner.readSelectedProvider()).toBeUndefined();
      expect(owner.readSelectedModel()).toBeUndefined();
    } finally {
      const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => operation?.dispose()),
        Promise.resolve().then(() => config?.dispose()),
      ]);
      await owner.dispose();
      process.argv = previousArgv;
      process.env = previousEnv;
      await rm(directory, { recursive: true, force: true });
      cleanupFailures = outcomes.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
    }
    if (cleanupFailures.length > 0)
      throw new AggregateError(
        cleanupFailures,
        'Model declaration fixture cleanup failed',
      );
  });
});
