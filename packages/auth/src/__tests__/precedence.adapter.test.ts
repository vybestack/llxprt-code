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
import type { IProviderRuntimeContext } from '../interfaces/runtime-context.js';

function createSettingsService(authKey: string): ISettingsService {
  return {
    get: (key) => (key === 'auth-key' ? authKey : undefined),
    getProviderSettings: (_providerName) => ({}),
    on: () => {},
    off: () => {},
  };
}

describe('AuthPrecedenceResolver migrated adapter test destination', () => {
  it('uses auth-local runtime context and settings-service shapes', () => {
    const settingsService = createSettingsService('adapter-key');
    const runtimeContext: IProviderRuntimeContext = { settingsService };
    const resolver = new AuthPrecedenceResolver(
      {},
      {
        settingsService,
        getActiveRuntimeContext: () => runtimeContext,
      },
    );

    expect(resolver).toBeInstanceOf(AuthPrecedenceResolver);
  });
});
