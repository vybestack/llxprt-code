/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { invalidateOwnerAuthCaches } from './owner-cache-invalidation.js';

describe('owner cache invalidation', () => {
  it('clears a wrapped provider cache', () => {
    const credentials = new Map([['token', 'cached']]);
    const provider = {
      name: 'anthropic',
      clearAuthCache: () => credentials.clear(),
    };
    const wrapper = { name: provider.name, wrappedProvider: provider };

    invalidateOwnerAuthCaches(wrapper);

    expect(credentials.size).toBe(0);
  });

  it('continues provider cleanup after a provider cleanup failure', () => {
    const credentials = new Map([['token', 'cached']]);
    const sessions = new Set(['session']);
    const provider = {
      name: 'anthropic',
      clearAuthCache: () => {
        throw new Error('Provider cleanup failed');
      },
      clearAuth: () => credentials.clear(),
      clearState: () => sessions.clear(),
    };

    invalidateOwnerAuthCaches(provider);

    expect(credentials.size).toBe(0);
    expect(sessions.size).toBe(0);
  });
});
