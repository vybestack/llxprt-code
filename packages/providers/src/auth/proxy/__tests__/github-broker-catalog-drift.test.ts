/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anti-drift tests for the shared github operation catalog (issue #3030).
 *
 * The tool layer and the broker layer must not carry two hand-maintained
 * copies of the parameter tables. These tests pin the broker registry to the
 * single source of truth in `@vybestack/llxprt-code-tools`, and assert that
 * a broker validation failure names the operation and its accepted
 * parameters so a caller can fix the request without guessing.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008, REQ-012
 */

import { describe, it, expect } from 'vitest';
import { OP_REGISTRY } from '../github-broker-ops.js';
import { executeGitHubOp } from '../github-broker.js';
import { BrokerErrorException } from '../github-broker-errors.js';
import {
  GITHUB_OP_SPECS,
  describeGithubOpParams,
} from '@vybestack/llxprt-code-tools/tools/github-ops.js';

/**
 * Narrows a caught value to `BrokerErrorException` without a type assertion.
 * Extracted as a helper (outside the test body) so the conditional does not
 * trip `vitest/no-conditional-in-test`.
 */
function asBrokerError(value: unknown): BrokerErrorException {
  if (!(value instanceof BrokerErrorException)) {
    throw new Error('expected a BrokerErrorException');
  }
  return value;
}

describe('broker registry consumes the shared catalog', () => {
  /**
   * Each descriptor's `params` must be reference-equal to the catalog's
   * `params`, and `requiredParams` must match `.required`. If this fails,
   * the two layers have drifted: one was edited without the other.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('every descriptor params is reference-equal to the catalog and required matches', () => {
    for (const [name, descriptor] of Object.entries(OP_REGISTRY)) {
      const spec = GITHUB_OP_SPECS[name];
      expect(spec, `${name} must exist in the catalog`).toBeDefined();
      // Reference equality: the descriptor must source params FROM the
      // catalog, not copy them.
      expect(
        descriptor.params,
        `${name} params must reference the catalog params`,
      ).toBe(spec.params);
      expect(
        descriptor.requiredParams ?? [],
        `${name} requiredParams must match the catalog`,
      ).toStrictEqual(spec.required);
      // mutating must be sourced from the catalog, not hardcoded, so the
      // broker cannot drift from the single source of truth.
      expect(
        descriptor.mutating,
        `${name} mutating must match the catalog`,
      ).toBe(spec.mutating);
    }
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('the catalog covers every registry op and no more', () => {
    expect([...Object.keys(OP_REGISTRY)].sort()).toStrictEqual(
      [...Object.keys(GITHUB_OP_SPECS)].sort(),
    );
  });

  /**
   * A validation failure must name the operation and its accepted parameters
   * so a caller (including the model over the sandbox socket) can fix the
   * request without guessing.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('executeGitHubOp enriches a missing-required failure with the op and accepted params', async () => {
    let caught: unknown;
    try {
      await executeGitHubOp(
        'issue.comment',
        { number: 1 },
        new AbortController().signal,
      );
      caught = null;
    } catch (err) {
      caught = err;
    }
    expect(caught, 'executeGitHubOp must reject').toBeInstanceOf(
      BrokerErrorException,
    );
    const msg = asBrokerError(caught).brokerError.message;
    expect(msg).toContain('issue.comment');
    expect(msg).toContain('body');
    expect(msg).toContain('accepts');
  });

  /**
   * The enrichment line must list every accepted parameter, so a caller
   * reading the error learns the full set, not just the missing one.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('describeGithubOpParams lists every accepted param for each registry op', () => {
    for (const name of Object.keys(OP_REGISTRY)) {
      const line = describeGithubOpParams(name);
      for (const param of Object.keys(GITHUB_OP_SPECS[name].params)) {
        expect(line, `${name} must list ${param}`).toContain(param);
      }
    }
  });
});
