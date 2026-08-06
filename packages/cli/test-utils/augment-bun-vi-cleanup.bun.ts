/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  restoreEnv,
  restoreGlobals,
  setEnv,
  setGlobal,
} from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it, vi } from 'bun:test';

const envKey = 'LLXPRT_BUN_VI_CLEANUP_TEST';
const globalKey = '__llxprtBunViCleanupTest';

describe('Bun vi stub cleanup', () => {
  it('restores environment and global stubs through explicit cleanup', () => {
    setEnv(envKey, 'stubbed');
    setGlobal(globalKey, 'stubbed');

    expect(process.env[envKey]).toBe('stubbed');
    expect((globalThis as Record<string, unknown>)[globalKey]).toBe('stubbed');

    restoreEnv();
    restoreGlobals();
    expect(process.env[envKey]).toBeUndefined();
    expect((globalThis as Record<string, unknown>)[globalKey]).toBeUndefined();
  });
});
