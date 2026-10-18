/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import * as runtimeContext from './RuntimeContext.js';

describe('runtime context authority boundary', () => {
  it('does not publish a combined runtime selector to ordinary subscribers', () => {
    expect(Object.keys(runtimeContext)).not.toContain('useRuntimeApi');
    expect(Object.keys(runtimeContext)).not.toContain('useRuntimeBridge');
    expect(Object.keys(runtimeContext)).not.toContain('createRuntimeApi');
    expect(Object.keys(runtimeContext)).not.toContain('RuntimeContextProvider');
  });
});
