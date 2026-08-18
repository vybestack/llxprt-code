/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Re-export contract for the core DebugLogger shim (#3240, A1).
 *
 * The implementation lives in `@vybestack/llxprt-code-telemetry`; this core
 * module is a pure re-export, and the behavioral suite is
 * `packages/telemetry/src/debug/DebugLogger.test.ts`. The identity assertions
 * below ensure the shim can never silently drift from the canonical module
 * (for example, by re-declaring a local class instead of re-exporting).
 */
import { describe, it, expect } from 'bun:test';
import * as shim from './DebugLogger.js';
import * as canonical from '@vybestack/llxprt-code-telemetry/debug/DebugLogger.js';

describe('DebugLogger core shim re-export contract', () => {
  it('exposes exactly the canonical telemetry module export surface', () => {
    expect(Object.keys(shim).sort()).toEqual(Object.keys(canonical).sort());
  });

  it('re-exports the canonical DebugLogger symbol unchanged (===)', () => {
    expect(shim.DebugLogger).toBe(canonical.DebugLogger);
  });
});
