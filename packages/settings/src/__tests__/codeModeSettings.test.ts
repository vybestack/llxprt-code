/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: the five code mode settings are profile-persistable
 * application settings. `/set` and `--set` reach them through
 * `parseEphemeralSettingValue` (and `applyCliSetArguments`), so the tests drive
 * those entry points with the raw text a user types.
 */

import { describe, expect, it } from 'bun:test';
import { parseEphemeralSettingValue } from '../settings/ephemeral-settings.js';
import { applyCliSetArguments } from '../settings/cli-ephemeral-settings.js';
import {
  getProfilePersistableKeys,
  getSettingSpec,
  separateSettings,
} from '../settings/settingsRegistry.js';

const CODE_MODE_KEYS = [
  'code-mode',
  'code-mode-tool-surface',
  'code-mode-max-calls',
  'code-mode-wall-timeout-ms',
  'code-mode-max-result-bytes',
] as const;

function rejection(key: string, raw: string): string | undefined {
  const result = parseEphemeralSettingValue(key, raw);
  return result.success ? undefined : result.message;
}

function accepted(key: string, raw: string): unknown {
  const result = parseEphemeralSettingValue(key, raw);
  if (!result.success)
    throw new Error(`unexpected rejection: ${result.message}`);
  return result.value;
}

describe('code mode settings registration (issue #4084)', () => {
  it('registers all five keys as application behavior that persists into profiles', () => {
    for (const key of CODE_MODE_KEYS) {
      const spec = getSettingSpec(key);
      expect(spec?.category).toBe('cli-behavior');
      expect(spec?.persistToProfile).toBe(true);
      expect(getProfilePersistableKeys()).toContain(key);
    }
  });

  it('declares the documented defaults', () => {
    expect(getSettingSpec('code-mode')?.default).toBe('off');
    expect(getSettingSpec('code-mode-tool-surface')?.default).toBe('alongside');
    expect(getSettingSpec('code-mode-max-calls')?.default).toBe(64);
    expect(getSettingSpec('code-mode-wall-timeout-ms')?.default).toBe(300000);
    expect(getSettingSpec('code-mode-max-result-bytes')?.default).toBe(16384);
  });

  it('keeps the values out of model parameters', () => {
    const separated = separateSettings({
      'code-mode': 'on',
      'code-mode-tool-surface': 'compact',
      'code-mode-max-calls': 10,
      'code-mode-wall-timeout-ms': 1000,
      'code-mode-max-result-bytes': 2048,
    });

    expect(separated.modelParams).toStrictEqual({});
    expect(separated.cliSettings).toStrictEqual({
      'code-mode': 'on',
      'code-mode-tool-surface': 'compact',
      'code-mode-max-calls': 10,
      'code-mode-wall-timeout-ms': 1000,
      'code-mode-max-result-bytes': 2048,
    });
  });
});

describe('code-mode and code-mode-tool-surface validation', () => {
  it('accepts exactly off and on', () => {
    expect(accepted('code-mode', 'on')).toBe('on');
    expect(accepted('code-mode', 'off')).toBe('off');
  });

  it.each([['true'], ['yes'], ['read-only'], ['ON']])(
    'rejects code-mode %s with the allowed values',
    (raw) => {
      expect(rejection('code-mode', raw)).toBe(
        "code-mode must be exactly 'off' or 'on'",
      );
    },
  );

  it('accepts alongside and compact and rejects anything else', () => {
    expect(accepted('code-mode-tool-surface', 'compact')).toBe('compact');
    expect(accepted('code-mode-tool-surface', 'alongside')).toBe('alongside');
    expect(rejection('code-mode-tool-surface', 'minimal')).toBe(
      "code-mode-tool-surface must be exactly 'alongside' or 'compact'",
    );
  });
});

describe('code mode limit validation', () => {
  it('accepts whole numbers inside each range', () => {
    expect(accepted('code-mode-max-calls', '1')).toBe(1);
    expect(accepted('code-mode-max-calls', '10000')).toBe(10000);
    expect(accepted('code-mode-wall-timeout-ms', '3600000')).toBe(3600000);
    expect(accepted('code-mode-max-result-bytes', '1048576')).toBe(1048576);
  });

  it.each([
    ['code-mode-max-calls', '0', 'calls from 1 to 10000'],
    ['code-mode-max-calls', '-3', 'calls from 1 to 10000'],
    ['code-mode-max-calls', '2.5', 'calls from 1 to 10000'],
    ['code-mode-max-calls', 'lots', 'calls from 1 to 10000'],
    ['code-mode-wall-timeout-ms', '0', 'milliseconds from 1 to 3600000'],
    ['code-mode-wall-timeout-ms', '3600001', 'milliseconds from 1 to 3600000'],
    ['code-mode-max-result-bytes', '1048577', 'bytes from 1 to 1048576'],
    ['code-mode-max-result-bytes', '1e400', 'bytes from 1 to 1048576'],
  ])('rejects %s=%s with its range', (key, raw, range) => {
    expect(rejection(key, raw)).toBe(
      `${key} must be a whole number of ${range}`,
    );
  });
});

describe('--set on the command line', () => {
  it('stores valid code mode values as ephemeral settings, not model parameters', () => {
    const stored: Record<string, unknown> = {};
    const result = applyCliSetArguments(
      {
        setEphemeralSetting: (key, value) => {
          stored[key] = value;
        },
      },
      ['code-mode=on', 'code-mode-max-calls=12'],
    );

    expect(stored).toStrictEqual({
      'code-mode': 'on',
      'code-mode-max-calls': 12,
    });
    expect(result.modelParams).toStrictEqual({});
  });

  it('fails with the validation message for an invalid value', () => {
    expect(() =>
      applyCliSetArguments({ setEphemeralSetting: () => undefined }, [
        'code-mode=maybe',
      ]),
    ).toThrow("code-mode must be exactly 'off' or 'on'");
  });
});
