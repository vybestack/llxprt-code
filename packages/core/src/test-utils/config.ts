/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, type ConfigParameters } from '../config/config.js';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import type { MessageBus as MessageBusType } from '../confirmation-bus/message-bus.js';

/**
 * Per-config cache so repeated calls for the same config instance return the same bus.
 * This preserves the original invariant that callers sharing a config also share a bus.
 */
const testBusCache = new WeakMap<Config, MessageBusType>();

/**
 * Test-only helper that returns a session-scoped MessageBus for the given Config.
 *
 * Under the new explicit-DI architecture Config no longer owns a MessageBus, so
 * this helper lazily creates one (per Config instance) for test convenience.
 */
export function getTestRuntimeMessageBus(config: Config): MessageBusType {
  let bus = testBusCache.get(config);
  if (!bus) {
    bus = new MessageBus(config.getPolicyEngine(), config.getDebugMode());
    testBusCache.set(config, bus);
  }
  return bus;
}

/**
 * Test-only helper that initializes Config with an explicit session MessageBus,
 * mirroring the production composition-root DI path.
 */
export async function initializeTestConfig(config: Config): Promise<void> {
  const sessionMessageBus = new MessageBus(
    config.getPolicyEngine(),
    config.getDebugMode(),
  );
  await (
    config as Config & {
      initialize(dependencies?: { messageBus?: MessageBusType }): Promise<void>;
    }
  ).initialize({ messageBus: sessionMessageBus });
}

/**
 * Creates a fake config instance for testing
 */
export function makeFakeConfig(options?: {
  ephemeralSettings?: Record<string, unknown>;
}): Config {
  // Create a minimal config for testing purposes
  const params: ConfigParameters = {
    sessionId: 'test-session',
    targetDir: '/tmp/test',
    debugMode: false,
    cwd: '/tmp/test',
    model: 'gemini-2.0-flash-exp',
  };

  const config = new Config(params);

  // Set some reasonable defaults for testing
  config.setModel('gemini-2.0-flash-exp');

  // Set ephemeral settings if provided
  if (options?.ephemeralSettings) {
    for (const [key, value] of Object.entries(options.ephemeralSettings)) {
      config.setEphemeralSetting(key, value);
    }
  }

  // Set up a minimal contentGeneratorConfig for tests
  // This is normally done via refreshAuth() but we can set it directly for synchronous test setup
  const mockContentGeneratorConfig: ContentGeneratorConfig = {
    model: 'gemini-2.0-flash-exp',
    apiKey: 'test-api-key',
  };

  // Use reflection to bypass readonly restrictions for test setup
  Object.defineProperty(config, 'contentGeneratorConfig', {
    value: mockContentGeneratorConfig,
    writable: true,
    configurable: true,
  });

  return config;
}
