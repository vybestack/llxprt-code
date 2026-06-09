/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P09
 * @requirement REQ-AUTH-001.1
 */

import { describe, expect, it } from 'vitest';
import { AuthPrecedenceResolver } from '../auth-precedence-resolver.js';
import type { ISettingsService } from '../interfaces/settings-service.js';

function createSettingsService(): ISettingsService {
  const values = new Map<string, unknown>();
  return {
    get: (key) => values.get(key),
    getProviderSettings: (_providerName) => ({}),
    on: () => {},
    off: () => {},
  };
}

describe('AuthPrecedenceResolver migrated unit test destination', () => {
  it('constructs with auth-local settings-service DI shape', () => {
    const resolver = new AuthPrecedenceResolver(
      {},
      { settingsService: createSettingsService() },
    );

    expect(resolver).toBeInstanceOf(AuthPrecedenceResolver);
  });
});
