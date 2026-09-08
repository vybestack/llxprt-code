/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';

describe('stream runtime test fixture isolation', () => {
  it('gives each runtime its own fallback media store', () => {
    const first = createStreamRuntimeForTest();
    const second = createStreamRuntimeForTest();

    const firstStore = first.session.getLocalMediaStore();
    const secondStore = second.session.getLocalMediaStore();

    expect(firstStore).not.toBe(secondStore);
    expect(firstStore.rootDirectory).not.toBe(secondStore.rootDirectory);
  });
});
