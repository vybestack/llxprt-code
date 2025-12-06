/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSystemSettingsPath } from './settings.js';

describe('Settings configuration with LLXPRT_CODE environment variables', () => {
  beforeEach(() => {
    // Clear any existing environment variables
    delete process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
    delete process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
  });

  afterEach(() => {
    // Clean up environment variables after each test
    delete process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
    delete process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
  });

  it('should prioritize LLXPRT_CODE_SYSTEM_SETTINGS_PATH over LLXPRT_CLI_SYSTEM_SETTINGS_PATH', () => {
    process.env.LLXPRT_CLI_SYSTEM_SETTINGS_PATH = '/old/path/settings.json';
    process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH = '/new/path/settings.json';

    const systemSettingsPath = getSystemSettingsPath();

    expect(systemSettingsPath).toBe('/new/path/settings.json');
  });

  it.skipIf(process.platform !== 'darwin')(
    'should return darwin path when neither environment variable is set',
    () => {
      expect(getSystemSettingsPath()).toBe(
        '/Library/Application Support/LLxprt-Code/settings.json',
      );
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'should return windows path when neither environment variable is set',
    () => {
      expect(getSystemSettingsPath()).toBe(
        'C:\\ProgramData\\llxprt-code\\settings.json',
      );
    },
  );

  it.skipIf(process.platform === 'darwin' || process.platform === 'win32')(
    'should return linux path when neither environment variable is set',
    () => {
      expect(getSystemSettingsPath()).toBe('/etc/llxprt-code/settings.json');
    },
  );
});
