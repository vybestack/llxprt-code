/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, ConfigParameters } from '../config/config.js';
import { AuthType } from '../core/contentGenerator.js';
import type { ContentGeneratorConfig } from '../core/types.js';

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
    provider: 'gemini',
    authType: AuthType.USE_GEMINI,
    baseUrl: undefined,
    apiKey: 'test-api-key',
  };

  // Use type assertion to bypass readonly restrictions for test setup
  (
    config as { contentGeneratorConfig: ContentGeneratorConfig }
  ).contentGeneratorConfig = mockContentGeneratorConfig;

  return config;
}
