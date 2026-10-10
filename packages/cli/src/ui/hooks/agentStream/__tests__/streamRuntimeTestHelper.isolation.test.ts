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

    const firstStore = first.agentClientSource.getAgentClient().mediaStore;
    const secondStore = second.agentClientSource.getAgentClient().mediaStore;

    if (firstStore === undefined || secondStore === undefined)
      throw new Error('Missing explicit fixture stores');
    expect(firstStore).not.toBe(secondStore);
    expect(firstStore.rootDirectory).not.toBe(secondStore.rootDirectory);
  });
});
