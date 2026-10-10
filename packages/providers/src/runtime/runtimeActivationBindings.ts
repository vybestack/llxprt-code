/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createIsolatedRuntimeContext as createIsolatedRuntimeContextInternal,
  type IsolatedRuntimeContextOptions as FactoryRuntimeOptions,
  type IsolatedRuntimeContextHandle,
  type RuntimeActivationBindings,
} from './runtimeContextFactory.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { configureProviderRuntimeFactories } from '../composition/index.js';

export function createRuntimeActivationBindings(): RuntimeActivationBindings {
  return {
    resetInfrastructure: () => {},
    setRuntimeContext: () => {},
    registerInfrastructure: (manager, _oauthManager, { config }) => {
      if (!config) {
        throw new Error(
          'Isolated runtime activation requires its owner Config',
        );
      }
      configureProviderRuntimeFactories(config, manager);
      manager.setConfig(config);
    },
    linkProviderManager: () => {},
    disposeRuntime: () => {},
  };
}

export type IsolatedRuntimeContextOptions = Omit<
  FactoryRuntimeOptions,
  'activationBindings'
> & { activationBindings?: RuntimeActivationBindings };

export function createIsolatedRuntimeContext(
  options: IsolatedRuntimeContextOptions,
  settingsService: SettingsService,
): IsolatedRuntimeContextHandle {
  return createIsolatedRuntimeContextInternal(
    {
      ...options,
      activationBindings:
        options.activationBindings ?? createRuntimeActivationBindings(),
    },
    settingsService,
  );
}

export type {
  IsolatedRuntimeActivationOptions,
  IsolatedRuntimeContextHandle,
  RuntimeActivationBindings,
  AgentRuntimeFactoryBindings,
} from './runtimeContextFactory.js';
