/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: the refusal recovery policy is five profile-persistable
 * ephemeral settings. `/set` reaches them through
 * `parseEphemeralSettingValue`, so the tests drive that entry point with the
 * raw text a user types.
 */

import { describe, expect, it } from 'bun:test';
import { parseEphemeralSettingValue } from '../settings/ephemeral-settings.js';
import {
  getProfilePersistableKeys,
  getSettingSpec,
  separateSettings,
} from '../settings/settingsRegistry.js';

const REFUSAL_KEYS = [
  'refusal.retries',
  'refusal.backoff-ms',
  'refusal.rewrite',
  'refusal.review-profile',
  'refusal.max-rewrites',
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

describe('refusal settings registration (issue #4036)', () => {
  it('registers all five keys as CLI behavior that persists into profiles', () => {
    for (const key of REFUSAL_KEYS) {
      const spec = getSettingSpec(key);
      expect(spec?.category).toBe('cli-behavior');
      expect(spec?.persistToProfile).toBe(true);
      expect(getProfilePersistableKeys()).toContain(key);
    }
  });

  it('declares the documented defaults and no default review profile', () => {
    expect(getSettingSpec('refusal.retries')?.default).toBe(2);
    expect(getSettingSpec('refusal.backoff-ms')?.default).toBe(15000);
    expect(getSettingSpec('refusal.rewrite')?.default).toBe(true);
    expect(getSettingSpec('refusal.max-rewrites')?.default).toBe(1);
    expect(getSettingSpec('refusal.review-profile')?.default).toBeUndefined();
  });

  it('keeps the values out of model parameters', () => {
    const separated = separateSettings({
      'refusal.retries': 3,
      'refusal.backoff-ms': 1000,
      'refusal.rewrite': false,
      'refusal.review-profile': 'reviewer',
      'refusal.max-rewrites': 2,
    });

    expect(separated.modelParams).toStrictEqual({});
    expect(separated.cliSettings).toMatchObject({
      'refusal.retries': 3,
      'refusal.review-profile': 'reviewer',
    });
  });
});

describe('refusal.retries validation', () => {
  it('accepts the whole range 0 to 10', () => {
    expect(accepted('refusal.retries', '0')).toBe(0);
    expect(accepted('refusal.retries', '10')).toBe(10);
  });

  it.each([
    ['negative', '-1'],
    ['above the maximum', '11'],
    ['fractional', '1.5'],
    ['text', 'many'],
    ['infinite', '1e400'],
  ])('rejects a %s value with a range message', (_name, raw) => {
    expect(rejection('refusal.retries', raw)).toContain(
      'refusal.retries must be an integer from 0 to 10',
    );
  });
});

describe('refusal.backoff-ms validation', () => {
  it('accepts zero and large whole numbers', () => {
    expect(accepted('refusal.backoff-ms', '0')).toBe(0);
    expect(accepted('refusal.backoff-ms', '45000')).toBe(45000);
  });

  it.each([
    ['negative', '-5'],
    ['fractional', '0.5'],
    ['text', 'soon'],
  ])('rejects a %s value', (_name, raw) => {
    expect(rejection('refusal.backoff-ms', raw)).toContain(
      'refusal.backoff-ms must be a non-negative integer',
    );
  });
});

describe('refusal.rewrite validation', () => {
  it('accepts true and false and rejects other text', () => {
    expect(accepted('refusal.rewrite', 'false')).toBe(false);
    expect(accepted('refusal.rewrite', 'true')).toBe(true);
    expect(rejection('refusal.rewrite', 'maybe')).toContain('refusal.rewrite');
  });
});

describe('refusal.max-rewrites validation', () => {
  it('accepts 0 to 3 and rejects values outside the range', () => {
    expect(accepted('refusal.max-rewrites', '3')).toBe(3);
    expect(rejection('refusal.max-rewrites', '4')).toContain(
      'refusal.max-rewrites must be an integer from 0 to 3',
    );
    expect(rejection('refusal.max-rewrites', '-1')).toContain(
      'refusal.max-rewrites must be an integer from 0 to 3',
    );
  });
});

describe('refusal.review-profile validation', () => {
  it('accepts a profile name', () => {
    expect(accepted('refusal.review-profile', 'sonnet-reviewer')).toBe(
      'sonnet-reviewer',
    );
  });

  it('rejects an empty or blank profile name', () => {
    expect(rejection('refusal.review-profile', '')).toContain(
      'refusal.review-profile must be a non-empty profile name',
    );
    expect(rejection('refusal.review-profile', '   ')).toContain(
      'refusal.review-profile must be a non-empty profile name',
    );
  });
});
