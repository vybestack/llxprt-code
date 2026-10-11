/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { formatMissingRuntimeMessage } from './messages.js';
import {
  getCliStatelessHardeningPreference,
  isCliStatelessProviderModeEnabled,
  isStatelessProviderIntegrationEnabled,
  resolveStatelessHardeningPreference,
} from './statelessHardening.js';

describe('statelessHardening', () => {
  it('resolves strict and legacy from independent owner metadata', () => {
    const strictOwner = { statelessHardening: 'strict' };
    const legacyOwner = { statelessHardening: 'legacy' };

    expect([
      isStatelessProviderIntegrationEnabled(strictOwner),
      isStatelessProviderIntegrationEnabled(legacyOwner),
      isStatelessProviderIntegrationEnabled(strictOwner),
    ]).toStrictEqual([true, false, true]);
    expect(isCliStatelessProviderModeEnabled(strictOwner)).toBe(true);
    expect(isCliStatelessProviderModeEnabled(legacyOwner)).toBe(false);
    expect(getCliStatelessHardeningPreference(strictOwner)).toBe('strict');
    expect(getCliStatelessHardeningPreference(legacyOwner)).toBe('legacy');
  });

  it('normalizes supported owner metadata aliases', () => {
    expect(resolveStatelessHardeningPreference({ statelessMode: 'on' })).toBe(
      'strict',
    );
    expect(
      resolveStatelessHardeningPreference({ statelessGuards: false }),
    ).toBe('legacy');
    expect(
      resolveStatelessHardeningPreference({ statelessProviderMode: 'enabled' }),
    ).toBe('strict');
  });

  it('respects the first valid owner preference when metadata has aliases', () => {
    expect(
      resolveStatelessHardeningPreference({
        statelessHardening: 'legacy',
        statelessMode: 'strict',
      }),
    ).toBe('legacy');
  });

  it('rejects missing or unsupported owner preference instead of choosing a process default', () => {
    expect(() => resolveStatelessHardeningPreference({})).toThrow(
      /statelessHardening.*metadata/i,
    );
    expect(() =>
      resolveStatelessHardeningPreference({ statelessHardening: 'unknown' }),
    ).toThrow(/statelessHardening.*metadata/i);
  });

  it('directs missing runtime users to an explicit owner instead of a process setter', () => {
    const message = formatMissingRuntimeMessage({ runtimeId: 'unowned' });
    expect(message).toContain('Pass the owning Config');
    expect(message).not.toContain('configureCliStatelessHardening');
  });
});
