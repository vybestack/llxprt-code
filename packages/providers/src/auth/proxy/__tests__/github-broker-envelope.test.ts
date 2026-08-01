/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Response-envelope invariant for every registered broker operation.
 *
 * isProxyResponseFrame() in proxy-socket-client.ts rejects a frame whose
 * `data` is an array:
 *
 *     Array.isArray(frame.data) -> invalid frame
 *
 * An op whose shape() returns a bare array therefore produces a response the
 * client silently refuses, and the failure surfaces far from its cause. This
 * suite pins the invariant across the whole registry so a newly added op
 * cannot reintroduce it.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 124b-124k
 */

import { describe, it, expect } from 'vitest';
import { OP_REGISTRY } from '../github-broker-ops.js';

/**
 * Raw payloads wide enough to drive each op's shape() without network access.
 * An empty array satisfies the collection ops; an empty object satisfies the
 * record ops; a string satisfies the text ops such as pr.diff.
 */
function rawSamplesFor(opName: string): unknown[] {
  if (opName === 'pr.diff') return ['', 'diff --git a/x b/x\n'];
  if (opName === 'pr.reviews') {
    return [{ data: { repository: { pullRequest: { reviewThreads: {} } } } }];
  }
  return [[], {}];
}

describe('broker response envelope', () => {
  it('registers at least the P08 and P10 read operations', () => {
    expect(Object.keys(OP_REGISTRY).length).toBeGreaterThanOrEqual(11);
  });

  for (const [name, descriptor] of Object.entries(OP_REGISTRY)) {
    /**
     * @plan PLAN-20260731-GHBROKER.P10
     * @requirement REQ-013
     */
    it(`${name}: shape() returns a non-array object`, () => {
      let produced = false;

      for (const raw of rawSamplesFor(name)) {
        let shaped: unknown;
        try {
          shaped = descriptor.shape(raw, {});
        } catch {
          // This sample is not valid input for this op; try the next one.
          // At least one sample must succeed, asserted after the loop.
          continue;
        }
        produced = true;

        expect(
          Array.isArray(shaped),
          `${name} shape() returned an array; the proxy client rejects array data`,
        ).toBe(false);
        expect(typeof shaped, `${name} shape() must return an object`).toBe(
          'object',
        );
        expect(shaped, `${name} shape() must not return null`).not.toBeNull();
      }

      expect(
        produced,
        `${name}: no sample raw payload produced a shaped result`,
      ).toBe(true);
    });
  }
});
