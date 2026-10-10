/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  assembleCliProviderRuntime,
  createIsolatedRuntimeContext,
  type IsolatedRuntimeContextOptions,
  type IsolatedRuntimeContextHandle,
  type AssembledCliProviderRuntime,
} from '../index.js';
import { MemoryTokenStore } from '../../auth/__tests__/behavioral/test-utils.js';

interface RuntimeTestRoot {
  readonly config: Config;
  readonly settingsService: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
}
export interface RuntimeTestOwners {
  config(label?: string, settingsService?: SettingsService): RuntimeTestRoot;
  adopt(config: Config, settingsService: SettingsService): RuntimeTestRoot;
  isolated(
    options?: Omit<IsolatedRuntimeContextOptions, 'config'> & {
      settingsService?: SettingsService;
    },
  ): IsolatedRuntimeContextHandle;
  foreground(label?: string): AssembledCliProviderRuntime & RuntimeTestRoot;
}
export function useRuntimeTestOwners(): RuntimeTestOwners {
  const roots: RuntimeTestRoot[] = [];
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    const retiring = cleanups.splice(0).reverse();
    const configs = roots.splice(0);
    const results = await Promise.allSettled(
      retiring.map(async (cleanup) => cleanup()),
    );
    const releases = await Promise.allSettled(
      configs.map(async (root) => {
        await root.settingsOwner.dispose();
        await root.config.dispose();
      }),
    );
    const failures = [...results, ...releases].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Runtime fixture cleanup failed');
  });
  const createRoot = (
    label = 'same-label',
    settingsService = new SettingsService(),
    suppliedOwner?: SessionSettingsOwner,
  ): RuntimeTestRoot => {
    const config = new Config({
      sessionId: label,
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'owner-model',
      debugMode: false,
    });
    const owner = suppliedOwner ?? new SessionSettingsOwner(settingsService);
    owner.assertSettingsIdentity(settingsService);
    owner.bindTelemetry(config);
    const root = { config, settingsService, settingsOwner: owner };
    roots.push(root);
    return root;
  };
  return {
    config: createRoot,
    adopt: (config, settingsService) => {
      const settingsOwner = new SessionSettingsOwner(settingsService);
      settingsOwner.bindTelemetry(config);
      cleanups.push(() => settingsOwner.dispose());
      return { config, settingsService, settingsOwner };
    },
    isolated: (options = {}) => {
      const { settingsService, ...context } = options;
      const root = createRoot(
        undefined,
        settingsService,
        options.settingsOwner,
      );
      const handle = createIsolatedRuntimeContext(
        {
          config: root.config,
          settingsOwner: root.settingsOwner,
          tokenStore: new MemoryTokenStore(),
          ...context,
        },
        root.settingsService,
      );
      cleanups.push(() => handle.cleanup());
      return handle;
    },
    foreground: (label = 'same-label') => {
      const root = createRoot(label);
      const bundle = assembleCliProviderRuntime({
        settingsService: root.settingsService,
        config: root.config,
        settingsOwner: root.settingsOwner,
        runtimeId: label,
      });
      cleanups.push(() => bundle.registration.dispose());
      return { ...bundle, ...root };
    },
  };
}
