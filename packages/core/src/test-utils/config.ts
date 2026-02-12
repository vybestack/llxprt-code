/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, type ConfigParameters } from '../config/config.js';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';

/**
 * Creates a fake config instance for testing
 */
export function makeFakeConfig(): Config {
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
