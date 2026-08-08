/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { RuntimeMutations } from './runtimeMutations.js';
import { runtimeMutationsFromConfig } from './runtimeMutations.js';
import type { Config } from './config.js';

/**
 * Compile-time assertion: the adapter return type is exactly RuntimeMutations.
 */
type _AdapterReturn = ReturnType<typeof runtimeMutationsFromConfig>;
type _Assert = _AdapterReturn extends RuntimeMutations ? true : never;

/**
 * Compile-time assertion: Config structurally satisfies RuntimeMutations.
 */
type _ConfigSatisfies = Config extends RuntimeMutations ? true : never;

const EXPECTED_SETTERS = [
  'setProviderManager',
  'setRuntimeMessageBus',
  'setRuntimeOAuthManager',
  'setImageBackendResolver',
  'setRunImageOperation',
  'setBucketFailoverHandler',
  'setProfileManager',
  'setSubagentManager',
  'setToolSchedulerFactory',
  'setAgentClientFactory',
] as const;

/**
 * Minimal fake whose setters record invocations. Cast to Config because the
 * adapter signature requires Config — the test exercises the real adapter code
 * path (structural pass-through), not a mock of it.
 */
function createFakeConfigWithTrackedSetters(): {
  config: Config;
  calls: Map<string, unknown[]>;
} {
  const calls = new Map<string, unknown[]>();
  const config = {
    setProviderManager(pm: unknown) {
      calls.set('setProviderManager', [pm]);
    },
    setRuntimeMessageBus(bus: unknown) {
      calls.set('setRuntimeMessageBus', [bus]);
    },
    setRuntimeOAuthManager(mgr: unknown) {
      calls.set('setRuntimeOAuthManager', [mgr]);
    },
    setImageBackendResolver(res: unknown) {
      calls.set('setImageBackendResolver', [res]);
    },
    setRunImageOperation(runner: unknown) {
      calls.set('setRunImageOperation', [runner]);
    },
    setBucketFailoverHandler(handler: unknown) {
      calls.set('setBucketFailoverHandler', [handler]);
    },
    setProfileManager(mgr: unknown) {
      calls.set('setProfileManager', [mgr]);
    },
    setSubagentManager(mgr: unknown) {
      calls.set('setSubagentManager', [mgr]);
    },
    setToolSchedulerFactory(factory: unknown) {
      calls.set('setToolSchedulerFactory', [factory]);
    },
    setAgentClientFactory(factory: unknown) {
      calls.set('setAgentClientFactory', [factory]);
    },
  } as unknown as Config;
  return { config, calls };
}

describe('RuntimeMutations (issue #2615, P06b Gap 1)', () => {
  it('adapter result exposes every expected setter', () => {
    const { config } = createFakeConfigWithTrackedSetters();
    const mutations = runtimeMutationsFromConfig(config);
    for (const setter of EXPECTED_SETTERS) {
      expect(
        typeof mutations[setter],
        `RuntimeMutations must expose '${setter}'`,
      ).toBe('function');
    }
  });

  it('calling a setter on the adapter result delegates to the config', () => {
    const { config, calls } = createFakeConfigWithTrackedSetters();
    const mutations = runtimeMutationsFromConfig(config);
    const sentinel = Symbol('test');
    mutations.setProviderManager(sentinel as never);
    expect(calls.get('setProviderManager')).toEqual([sentinel]);
  });

  it('calling setRuntimeMessageBus delegates to the config', () => {
    const { config, calls } = createFakeConfigWithTrackedSetters();
    const mutations = runtimeMutationsFromConfig(config);
    const sentinel = Symbol('bus');
    mutations.setRuntimeMessageBus(sentinel as never);
    expect(calls.get('setRuntimeMessageBus')).toEqual([sentinel]);
  });

  it('exposes the adapter as a function', () => {
    expect(typeof runtimeMutationsFromConfig).toBe('function');
  });
});
