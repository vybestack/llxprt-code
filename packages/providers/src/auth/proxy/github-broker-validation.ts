/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generic parameter validation for the GitHub broker op registry.
 *
 * Extracted from github-broker-ops.ts so that per-op modules can share
 * validation without bloating any single file past the 800-line lint cap.
 *
 * Rules (pseudocode lines 13-31):
 * - unknown params are rejected (not ignored)
 * - string params beginning with `-` are rejected (flag injection defense)
 * - each param kind has its own validation
 * - limit kind: positive integer 1..100
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */

import type { ParamKind, ValidationError } from './github-broker-types.js';

/**
 * Regex for the repo parameter: `owner/name` where owner and name each
 * match `[A-Za-z0-9._-]+`.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-009
 * @pseudocode 003-github-broker.md line 17
 */
const REPO_REGEX = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Hard maximum for list/search `limit` params. Anything above this is
 * rejected with INVALID_PARAM to avoid exceeding the frame budget with
 * a large list of bodies.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export const MAX_LIMIT = 100;

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
 * - string params beginning with `-` are rejected (flag injection defense)
 * - each param kind has its own validation
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateParams(
  spec: Readonly<Record<string, ParamKind>>,
  params: Record<string, unknown>,
): ValidationError | null {
  for (const key of Object.keys(params)) {
    if (!(key in spec)) {
      return {
        code: 'INVALID_PARAM',
        message: `Unknown parameter: ${key}`,
      };
    }
  }
  for (const [key, kind] of Object.entries(spec)) {
    const value = params[key];
    if (value === undefined) continue;
    const err = validateParamValue(key, value, kind);
    if (err) return err;
  }
  return null;
}

/**
 * Validates a single parameter value against its declared kind.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 16-31
 */
function validateParamValue(
  key: string,
  value: unknown,
  kind: ParamKind,
): ValidationError | null {
  if (typeof value === 'string' && value.startsWith('-')) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must not begin with '-'`,
    };
  }
  return validateByKind(key, value, kind);
}

/**
 * Validates a value against its kind, dispatching to the right validator.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 16-31
 */
function validateByKind(
  key: string,
  value: unknown,
  kind: ParamKind,
): ValidationError | null {
  switch (kind) {
    case 'repo':
      return validateRepoParam(key, value);
    case 'number':
      return validateNumberParam(key, value);
    case 'boolean':
      return validateBooleanParam(key, value);
    case 'state':
      return validateStateParam(key, value, [
        'open',
        'closed',
        'merged',
        'all',
      ]);
    case 'stateIssue':
      return validateStateParam(key, value, ['open', 'closed', 'all']);
    case 'label':
      return validateLabelParam(key, value);
    case 'threadId':
      return validateThreadIdParam(key, value);
    case 'limit':
      return validateLimitParam(key, value);
    case 'closeReason':
      return validateCloseReasonParam(key, value);
    case 'color':
      return validateColorParam(key, value);
    case 'assignee':
      return validateAssigneeParam(key, value);
    case 'milestone':
    case 'project':
    case 'branch':
      return validateStringParam(key, value);
    case 'body':
    case 'freetext':
      return validateStringParam(key, value);
    default:
      return null;
  }
}

/**
 * Validates a repo parameter: must be "owner/name" matching the regex.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-009
 * @pseudocode 003-github-broker.md line 17
 */
function validateRepoParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'string' || !REPO_REGEX.test(value)) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be "owner/name"`,
    };
  }
  return null;
}

/**
 * Validates a number parameter: must be a positive integer.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md line 18
 */
function validateNumberParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a positive integer`,
    };
  }
  return null;
}

/**
 * Validates a boolean parameter.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
function validateBooleanParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'boolean') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a boolean`,
    };
  }
  return null;
}

/**
 * Validates a state parameter against an allowed-values list.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md line 19
 */
function validateStateParam(
  key: string,
  value: unknown,
  allowed: readonly string[],
): ValidationError | null {
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a string`,
    };
  }
  if (!allowed.includes(value)) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be one of: ${allowed.join(', ')}`,
    };
  }
  return null;
}

/**
 * Validates a label parameter: string or array of strings.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md line 20
 */
function validateLabelParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (Array.isArray(value)) {
    return validateLabelArray(key, value);
  }
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a string or array of strings`,
    };
  }
  return null;
}

/**
 * Validates that every element of a label array is a string.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
function validateLabelArray(
  key: string,
  value: unknown[],
): ValidationError | null {
  for (const el of value) {
    if (typeof el !== 'string') {
      return {
        code: 'INVALID_PARAM',
        message: `Parameter ${key} must be an array of strings`,
      };
    }
  }
  return null;
}

/**
 * Validates a threadId parameter: must match /^[A-Za-z0-9_=-]+$/.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md line 21
 */
function validateThreadIdParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_=-]+$/.test(value)) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} contains invalid characters`,
    };
  }
  return null;
}

/**
 * Validates a generic string parameter (body, freetext).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 22-24
 */
function validateStringParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a string`,
    };
  }
  return null;
}

/**
 * Validates a limit parameter: must be a positive integer between 1 and
 * MAX_LIMIT (100). Values above MAX_LIMIT are rejected with INVALID_PARAM
 * rather than silently clamped, so the caller learns the cap.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
function validateLimitParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a positive integer`,
    };
  }
  if (value > MAX_LIMIT) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must not exceed ${MAX_LIMIT}`,
    };
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
    return limit;
  }
  return DEFAULT_LIMIT;
}

/**
 * Allowed close-reason values for `gh issue close`.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
const CLOSE_REASONS = ['completed', 'not planned'] as const;

/**
 * Validates a closeReason parameter: must be one of the allowed values.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
function validateCloseReasonParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a string`,
    };
  }
  if (!CLOSE_REASONS.includes(value as (typeof CLOSE_REASONS)[number])) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be one of: ${CLOSE_REASONS.join(', ')}`,
    };
  }
  return null;
}

/**
 * Validates a color parameter: must be a hex color like `#RRGGBB` or `RRGGBB`.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
function validateColorParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a string`,
    };
  }
  if (!/^#?[0-9A-Fa-f]{6}$/.test(value)) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a hex color like #RRGGBB`,
    };
  }
  return null;
}

/**
 * Validates an assignee parameter: must be a string or array of strings.
 * Same validation as label, but semantically different.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
function validateAssigneeParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (Array.isArray(value)) {
    for (const el of value) {
      if (typeof el !== 'string') {
        return {
          code: 'INVALID_PARAM',
          message: `Parameter ${key} must be a string or array of strings`,
        };
      }
    }
    return null;
  }
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a string or array of strings`,
    };
  }
  return null;
}
