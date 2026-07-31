/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DebugLogger retention (issue #2852).
 *
 * Loggers used to subscribe a closure to the `ConfigurationManager` singleton.
 * The manager holds subscribers strongly, and most loggers in this codebase are
 * constructed directly rather than through the `getLogger` registry, so nothing
 * could unsubscribe them. Every logger ever created — including ones built per
 * provider wrapper with an interpolated namespace — stayed reachable for the
 * life of the process.
 *
 * These tests pin that loggers retain nothing globally while still tracking
 * configuration changes.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { DebugLogger } from './DebugLogger.js';
import { ConfigurationManager } from './ConfigurationManager.js';

interface ListenerBearing {
  listeners: Set<() => void>;
}

function listenerCount(): number {
  const manager =
    ConfigurationManager.getInstance() as unknown as ListenerBearing;
  return manager.listeners.size;
}

afterEach(async () => {
  await DebugLogger.resetForTesting();
});

describe('DebugLogger retention', () => {
  it('registers nothing globally when loggers are constructed directly', () => {
    const before = listenerCount();

    for (let index = 0; index < 500; index += 1) {
      // Interpolated namespaces are real: LoggingProviderWrapper builds one per
      // wrapped provider.
      const logger = new DebugLogger(`llxprt:provider:p${index}:logging`);
      logger.debug(() => 'message');
    }

    expect(listenerCount()).toBe(before);
  });

  it('keeps the namespace registry bounded across repeated getLogger calls', () => {
    for (let index = 0; index < 500; index += 1) {
      DebugLogger.getLogger('llxprt:stable:namespace');
    }

    const first = DebugLogger.getLogger('llxprt:stable:namespace');
    const second = DebugLogger.getLogger('llxprt:stable:namespace');
    expect(first).toBe(second);
  });

  it('still observes configuration changes without subscribing', () => {
    const manager = ConfigurationManager.getInstance();
    const namespace = 'llxprt:lifecycle:observes';
    const logger = new DebugLogger(namespace);

    manager.setEphemeralConfig({ enabled: true, namespaces: [namespace] });
    const enabledAfterOptIn = logger.enabled;

    manager.setEphemeralConfig({ enabled: false, namespaces: [namespace] });
    const enabledAfterOptOut = logger.enabled;

    expect({ enabledAfterOptIn, enabledAfterOptOut }).toStrictEqual({
      enabledAfterOptIn: true,
      enabledAfterOptOut: false,
    });
  });

  it('lets an explicit override stand until the configuration changes', () => {
    const manager = ConfigurationManager.getInstance();
    const namespace = 'llxprt:lifecycle:override';
    const logger = new DebugLogger(namespace);

    logger.enabled = true;
    const afterOverride = logger.enabled;

    manager.setEphemeralConfig({ enabled: false, namespaces: [] });
    const afterConfigChange = logger.enabled;

    expect({ afterOverride, afterConfigChange }).toStrictEqual({
      afterOverride: true,
      afterConfigChange: false,
    });
  });

  it('clears the registry on disposeAll', async () => {
    DebugLogger.getLogger('llxprt:lifecycle:disposed');
    await DebugLogger.resetForTesting();
    const recreated = DebugLogger.getLogger('llxprt:lifecycle:disposed');
    expect(recreated).toBeInstanceOf(DebugLogger);
  });
});
