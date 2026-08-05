/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generic parameter validation for the GitHub broker op registry.
 *
 * The per-kind value rules live in the shared catalog
 * (`validateGithubParamValue` in `github-ops.ts`), so the tool boundary and
 * the broker reject the same invalid values with the same messages. This
 * module keeps the broker's exported surface (`validateParams`,
 * `resolveLimit`, `MAX_LIMIT`, `DEFAULT_LIMIT`) and delegates the per-kind
 * path to the shared function.
 *
 * Rules (pseudocode lines 13-31):
 * - unknown params are rejected (not ignored)
 * - required params must be present
 * - string params beginning with `-` are rejected (flag injection defense)
 * - each param kind has its own validation
 * - limit kind: positive integer 1..100
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */

import type { ParamKind, ValidationError } from './github-broker-types.js';
import {
  validateGithubParamValue,
  GITHUB_LIMIT_MAX,
} from '@vybestack/llxprt-code-tools/tools/github-ops.js';

/**
 * Hard maximum for list/search `limit` params. Anything above this is
 * rejected with INVALID_PARAM to avoid exceeding the frame budget with
 * a large list of bodies.
 *
 * Sourced from the catalog (`GITHUB_LIMIT_MAX`) so the cap is a single
 * value across both layers.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export const MAX_LIMIT = GITHUB_LIMIT_MAX;

/**
 * Default limit applied when no `limit` is provided by the caller.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export const DEFAULT_LIMIT = 30;

/**
 * Validates a params object against a param spec. Returns a ValidationError
 * or null if valid.
 *
 * Rules:
 * - unknown params are rejected (not ignored)
 * - required params must be present
 * - string params beginning with `-` are rejected (flag injection defense)
 * - each param kind has its own validation (delegated to the shared catalog)
 *
 * Required params matter because builders interpolate positionals directly:
 * without this check `issue.close` with no number produces the argv
 * `gh issue close undefined`, which is both wrong and confusing to debug.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateParams(
  spec: Readonly<Record<string, ParamKind>>,
  params: Record<string, unknown>,
  required?: readonly string[],
): ValidationError | null {
  for (const key of Object.keys(params)) {
    if (!(key in spec)) {
      return {
        code: 'INVALID_PARAM',
        message: `Unknown parameter: ${key}`,
      };
    }
  }
  for (const key of required ?? []) {
    if (params[key] === undefined) {
      return {
        code: 'INVALID_PARAM',
        message: `Missing required parameter: ${key}`,
      };
    }
  }
  for (const [key, kind] of Object.entries(spec)) {
    const value = params[key];
    if (value === undefined) continue;
    const msg = validateGithubParamValue(key, value, kind);
    if (msg !== null) {
      return { code: 'INVALID_PARAM', message: msg };
    }
  }
  return null;
}

/**
 * Resolves the effective limit value: if provided and valid, use it;
 * otherwise return DEFAULT_LIMIT.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export function resolveLimit(params: Record<string, unknown>): number {
  const limit = params.limit;
  if (typeof limit === 'number' && Number.isInteger(limit) && limit > 0) {
    // Clamp rather than trust the caller. This is exported and every call
    // site currently validates first, but a future one that does not would
    // otherwise let an unbounded page size through to gh and back into a
    // response that has to fit the frame budget.
    return Math.min(limit, MAX_LIMIT);
  }
  return DEFAULT_LIMIT;
}
