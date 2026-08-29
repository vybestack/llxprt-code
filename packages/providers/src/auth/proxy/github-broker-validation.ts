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
  githubParamRedirectText,
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
  opName?: string,
): ValidationError | null {
  for (const key of Object.keys(params)) {
    // `in` walks the prototype chain, so `{ constructor: 'x' }`,
    // `{ toString: 'x' }` and an own `__proto__` key would all pass an
    // unknown-key check here and then never reach the per-kind loop (which
    // iterates the spec's own entries). `hasOwnProperty` restricts the check
    // to the spec's own declared parameters, so prototype names are rejected
    // like any other unknown parameter instead of being silently ignored.
    if (!Object.prototype.hasOwnProperty.call(spec, key)) {
      return {
        code: 'INVALID_PARAM',
        message: unknownParamMessage(key, spec, required, opName),
      };
    }
  }
  for (const key of required ?? []) {
    if (params[key] === undefined) {
      return {
        code: 'INVALID_PARAM',
        message: missingParamMessage(key, spec, required),
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
 * Builds the self-correcting message for an unknown parameter.
 *
 * Names the offending parameter, the parameters the operation DOES accept
 * (in the descriptor's declaration order, i.e. `Object.keys` of the spec),
 * and — only when a non-empty `required` list was supplied — the required
 * ones. The old `Unknown parameter: <key>` message named only what was
 * wrong, leaving a caller no recovery path; for `pr.resolve-thread` called
 * with only `number` it also hid the missing required `threadId`.
 *
 * Unknown parameters are still REJECTED, never accepted or ignored: the
 * accepted-parameter text describes how to retry correctly, it does not
 * broaden what the op accepts.
 *
 * @plan issue-3019-github-unknown-parameter
 * @requirement AB1
 * @issue 3019
 */
function unknownParamMessage(
  key: string,
  spec: Readonly<Record<string, ParamKind>>,
  required: readonly string[] | undefined,
  opName?: string,
): string {
  return withParamCatalogue(
    `Unknown parameter: ${key}.`,
    spec,
    required,
    opName,
    key,
  );
}

/**
 * Builds the self-correcting message for a missing required parameter.
 *
 * `Missing required parameter: body` named the gap but not the shape of a
 * correct call, so a caller that guessed wrong once had nothing new to go
 * on. It carries the same accepted/required catalogue as the unknown-
 * parameter message, for the same reason.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 * @issue 3030
 */
function missingParamMessage(
  key: string,
  spec: Readonly<Record<string, ParamKind>>,
  required: readonly string[] | undefined,
): string {
  return withParamCatalogue(
    `Missing required parameter: ${key}.`,
    spec,
    required,
  );
}

/**
 * Appends the operation's accepted parameters (in declaration order) and,
 * when it declares any, its required ones to a rejection message.
 *
 * Value-level rejections deliberately do NOT get this: the caller already
 * knows the parameter is accepted, so the catalogue would be noise.
 *
 * @plan issue-3019-github-unknown-parameter
 * @requirement AB1
 */
function withParamCatalogue(
  base: string,
  spec: Readonly<Record<string, ParamKind>>,
  required: readonly string[] | undefined,
  opName?: string,
  unknownKey?: string,
): string {
  const accepted = Object.keys(spec).join(', ');
  const withAccepted = `${base} Accepted parameters: ${accepted}.`;
  const withRequired =
    required !== undefined && required.length > 0
      ? ` Required: ${required.join(', ')}.`
      : '';
  // githubParamRedirectText returns '' when no other op accepts the
  // parameter, so the separating space is only added when there is text to
  // separate; otherwise the message would end in a stray trailing space.
  const redirectText =
    opName !== undefined && unknownKey !== undefined
      ? githubParamRedirectText(opName, unknownKey)
      : '';
  const redirect = redirectText !== '' ? ` ${redirectText}` : '';
  return `${withAccepted}${withRequired}${redirect}`;
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
