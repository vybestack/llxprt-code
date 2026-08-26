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

import { describe, it, expect } from 'bun:test';
import { OP_REGISTRY } from '../github-broker-ops.js';
import { assertNotPartialSuccess } from '../github-broker-shaping.js';

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

        expect(Array.isArray(shaped)).toBe(false);
        expect(typeof shaped).toBe('object');
        expect(shaped).not.toBeNull();
      }

      expect(produced).toBe(true);
    });
  }
});

describe('shaping robustness for external payloads', () => {
  /**
   * GitHub reports file-level review threads with line: null. Coercing
   * that to 0 reports a line number that does not exist.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-013
   */
  it('preserves a null line for file-level review threads', () => {
    const shaped = OP_REGISTRY['pr.reviews'].shape(
      {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: 'T1',
                    path: 'a.ts',
                    line: null,
                    isResolved: false,
                    isOutdated: false,
                    comments: { nodes: [] },
                  },
                ],
              },
            },
          },
        },
      },
      {},
    ) as { threads: Array<{ line: number | null }> };
    expect(shaped.threads[0].line).toBeNull();
  });

  /**
   * The errors array comes from GitHub, so a null entry must not turn a
   * reportable GraphQL error into a TypeError.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-013
   */
  it('handles a null entry in a GraphQL errors array', () => {
    expect(() => assertNotPartialSuccess({ data: {}, errors: [null] })).toThrow(
      /GraphQL error/,
    );
  });
});
