/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Config,
  type ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';

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
    initialSettings: options?.ephemeralSettings,
  };

  const config = new Config(params);

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
