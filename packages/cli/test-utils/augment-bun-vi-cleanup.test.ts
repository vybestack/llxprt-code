/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';

const envKey = 'LLXPRT_BUN_VI_CLEANUP_TEST';
const globalKey = '__llxprtBunViCleanupTest';

describe('Bun vi stub cleanup', () => {
  it('restores environment and global stubs through explicit cleanup', () => {
    vi.stubEnv(envKey, 'stubbed');
    vi.stubGlobal(globalKey, 'stubbed');

    expect(process.env[envKey]).toBe('stubbed');
    expect((globalThis as Record<string, unknown>)[globalKey]).toBe('stubbed');

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    expect(process.env[envKey]).toBeUndefined();
    expect((globalThis as Record<string, unknown>)[globalKey]).toBeUndefined();
  });
});
