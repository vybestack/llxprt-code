/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { RuntimeDependencies } from './runtimeDependencies.js';
import type { Config } from './config.js';
import { runtimeDependenciesFromConfig } from './runtimeDependencies.js';

/**
 * Compile-time assertion: the adapter return type is exactly RuntimeDependencies.
 */
type _AdapterReturn = ReturnType<typeof runtimeDependenciesFromConfig>;
type _Assert = _AdapterReturn extends RuntimeDependencies ? true : never;

const EXPECTED_ROLE_FIELDS = [
  'session',
  'model',
  'settings',
  'paths',
  'memory',
  'tools',
  'policy',
  'mcp',
  'telemetry',
  'diagnostics',
] as const;

const EXPECTED_SERVICE_FIELDS = [
  'toolRegistry',
  'providerManager',
  'settingsService',
  'policyEngine',
  'promptRegistry',
  'resourceRegistry',
  'profileManager',
  'extensionLoader',
  'agentClient',
  'subagentManager',
  'asyncTaskManager',
  'shellJobManager',
  'fileSystemService',
  'sessionRecordingService',
  'toolSchedulerFactory',
  'agentClientFactory',
] as const;

/**
 * Recursive proxy that returns itself for any property access. Every method
 * returns undefined; every field is the proxy. This lets us call the adapter
 * without constructing a full Config.
 */
function createProxyConfig(): Config {
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      return new Proxy((() => {}) as unknown as () => void, handler);
    },
  };
  return new Proxy({}, handler) as unknown as Config;
}

describe('RuntimeDependencies (issue #2615, P06)', () => {
  it('adapter produces a record with all ten role-interface fields', () => {
    const deps = runtimeDependenciesFromConfig(createProxyConfig());
    for (const field of EXPECTED_ROLE_FIELDS) {
      expect(
        field in deps,
        `RuntimeDependencies must have field '${field}'`,
      ).toBe(true);
    }
  });

  it('adapter produces a record with all service-locator fields', () => {
    const deps = runtimeDependenciesFromConfig(createProxyConfig());
    for (const field of EXPECTED_SERVICE_FIELDS) {
      expect(
        field in deps,
        `RuntimeDependencies must have field '${field}'`,
      ).toBe(true);
    }
  });

  it('adapter produces a record with getOrCreateScheduler', () => {
    const deps = runtimeDependenciesFromConfig(createProxyConfig());
    expect('getOrCreateScheduler' in deps).toBe(true);
  });

  it('does not include service locators with zero composition-root consumers', () => {
    const deps = runtimeDependenciesFromConfig(createProxyConfig());
    const excludedLocators = [
      'getHookSystem',
      'getMcpClientManager',
      'getSkillManager',
      'getFileService',
      'getGitService',
      'getBucketFailoverHandler',
      'getRunImageOperation',
      'getTokenizerFactory',
      'getIdeClient',
      'storage',
    ];
    for (const locator of excludedLocators) {
      expect(
        locator in deps,
        `RuntimeDependencies must NOT include '${locator}'`,
      ).toBe(false);
    }
  });

  it('exposes the adapter as a function', () => {
    expect(typeof runtimeDependenciesFromConfig).toBe('function');
  });
});
