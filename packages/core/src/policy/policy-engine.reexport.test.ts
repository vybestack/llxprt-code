/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Re-export contract for the core PolicyEngine shim (#3240, A2).
 *
 * The implementation lives in `@vybestack/llxprt-code-policy` as the public
 * entry point; this core module is a backward-compatible re-export shim, and
 * the behavioral suite is `packages/policy/src/policy-engine.test.ts` (a
 * strict superset of the suite this file replaces). The identity assertions
 * below ensure the shim can never silently drift from the canonical package
 * (for example, by re-declaring a local class instead of re-exporting).
 */
import { describe, it, expect } from 'bun:test';
import * as shim from './policy-engine.js';
import * as canonical from '@vybestack/llxprt-code-policy';

describe('PolicyEngine core shim re-export contract', () => {
  it('exposes exactly the intended shim export surface', () => {
    expect(Object.keys(shim).sort()).toEqual(['PolicyEngine']);
  });

  it('re-exports the canonical policy package PolicyEngine symbol unchanged (===)', () => {
    expect(shim.PolicyEngine).toBe(canonical.PolicyEngine);
  });
});
