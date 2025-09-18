/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, ConfigParameters } from '../config/config.js';

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

  return config;
}
