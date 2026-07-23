/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSystemSettingsPath, getSystemDefaultsPath } from './settings.js';

/**
 * Behavioral tests proving the CLI system-settings resolution delegates to
 * the single canonical Storage authority. The canonical env var
 * `LLXPRT_SYSTEM_SETTINGS_PATH` takes precedence; the legacy alias
 * `LLXPRT_CODE_SYSTEM_SETTINGS_PATH` is honored as a bounded compatibility
 * fallback inside Storage. Both settings and policies agree because they
 * both resolve through Storage.
 */
describe('CLI system-settings resolution delegates to Storage', () => {
  const CANONICAL = 'LLXPRT_SYSTEM_SETTINGS_PATH';
  const LEGACY = 'LLXPRT_CODE_SYSTEM_SETTINGS_PATH';
  const CANONICAL_DEFAULTS = 'LLXPRT_SYSTEM_DEFAULTS_PATH';
  const LEGACY_DEFAULTS = 'LLXPRT_CODE_SYSTEM_DEFAULTS_PATH';
  let savedCanonical: string | undefined;
  let savedLegacy: string | undefined;
  let savedCanonicalDefaults: string | undefined;
  let savedLegacyDefaults: string | undefined;

  beforeEach(() => {
    savedCanonical = process.env[CANONICAL];
    savedLegacy = process.env[LEGACY];
    savedCanonicalDefaults = process.env[CANONICAL_DEFAULTS];
    savedLegacyDefaults = process.env[LEGACY_DEFAULTS];
    delete process.env[CANONICAL];
    delete process.env[LEGACY];
    delete process.env[CANONICAL_DEFAULTS];
    delete process.env[LEGACY_DEFAULTS];
  });

  afterEach(() => {
    if (savedCanonical === undefined) {
      delete process.env[CANONICAL];
    } else {
      process.env[CANONICAL] = savedCanonical;
    }
    if (savedLegacy === undefined) {
      delete process.env[LEGACY];
    } else {
      process.env[LEGACY] = savedLegacy;
    }
    if (savedCanonicalDefaults === undefined) {
      delete process.env[CANONICAL_DEFAULTS];
    } else {
      process.env[CANONICAL_DEFAULTS] = savedCanonicalDefaults;
    }
    if (savedLegacyDefaults === undefined) {
      delete process.env[LEGACY_DEFAULTS];
    } else {
      process.env[LEGACY_DEFAULTS] = savedLegacyDefaults;
    }
  });

  it('honors the canonical env var LLXPRT_SYSTEM_SETTINGS_PATH', () => {
    process.env[CANONICAL] = '/canonical/settings.json';
    expect(getSystemSettingsPath()).toBe('/canonical/settings.json');
  });

  it('honors the legacy alias LLXPRT_CODE_SYSTEM_SETTINGS_PATH when canonical is unset', () => {
    process.env[LEGACY] = '/legacy/settings.json';
    expect(getSystemSettingsPath()).toBe('/legacy/settings.json');
  });

  it('canonical takes precedence over the legacy alias when both are set', () => {
    process.env[CANONICAL] = '/canonical/settings.json';
    process.env[LEGACY] = '/legacy/settings.json';
    expect(getSystemSettingsPath()).toBe('/canonical/settings.json');
  });

  it('ignores a relative override in favor of the platform default', () => {
    process.env[CANONICAL] = 'relative/path';
    expect(getSystemSettingsPath()).toBe(expectedPlatformDefault());
  });

  it('ignores an empty override in favor of the platform default', () => {
    process.env[CANONICAL] = '';
    expect(getSystemSettingsPath()).toBe(expectedPlatformDefault());
  });

  it('returns the platform default when neither env var is set', () => {
    expect(getSystemSettingsPath()).toBe(expectedPlatformDefault());
  });

  it('settings and policies agree (both resolve through Storage)', async () => {
    const { Storage } = await import('@vybestack/llxprt-code-settings');
    expect(getSystemSettingsPath()).toBe(Storage.getSystemSettingsPath());
  });

  it('getSystemDefaultsPath derives from settings path when no defaults override', () => {
    const settingsPath = getSystemSettingsPath();
    const defaultsPath = getSystemDefaultsPath();
    const expected = settingsPath.replace(
      /settings\.json$/,
      'system-defaults.json',
    );
    expect(defaultsPath).toBe(expected);
  });

  it('getSystemDefaultsPath honors the canonical defaults env var', () => {
    process.env[CANONICAL_DEFAULTS] = '/canonical/defaults.json';
    expect(getSystemDefaultsPath()).toBe('/canonical/defaults.json');
  });

  it('getSystemDefaultsPath honors the legacy defaults alias', () => {
    process.env[LEGACY_DEFAULTS] = '/legacy/defaults.json';
    expect(getSystemDefaultsPath()).toBe('/legacy/defaults.json');
  });
});

function expectedPlatformDefault(): string {
  if (process.platform === 'darwin') {
    return '/Library/Application Support/LlxprtCode/settings.json';
  }
  if (process.platform === 'win32') {
    return 'C:\\ProgramData\\llxprt-code\\settings.json';
  }
  return '/etc/llxprt-code/settings.json';
}
