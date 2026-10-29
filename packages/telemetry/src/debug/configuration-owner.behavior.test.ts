/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { ConfigurationManager } from './ConfigurationManager.js';
import { DebugLogger } from './DebugLogger.js';

describe('owned debug configuration', () => {
  it('keeps configuration and logger enablement independent between owners', () => {
    const first = ConfigurationManager.create();
    const second = ConfigurationManager.create();
    first.setCliConfig({ enabled: false, namespaces: [] });
    second.setCliConfig({ enabled: false, namespaces: [] });
    const firstLogger = new DebugLogger('llxprt:owned-test', first);
    const secondLogger = new DebugLogger('llxprt:owned-test', second);
    first.setEphemeralConfig({
      enabled: true,
      namespaces: ['llxprt:owned-test'],
    });
    expect(firstLogger.enabled).toBe(true);
    expect(secondLogger.enabled).toBe(false);
    expect(second.getEffectiveConfig().namespaces).toStrictEqual([]);
    first.clearEphemeralConfig();
    expect(firstLogger.enabled).toBe(false);
  });
});
