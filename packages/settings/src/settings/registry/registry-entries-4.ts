/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingSpec, ValidationResult } from './registry-types.js';
import { deepFreezeTable } from '../immutableTable.js';

/** Largest number of identical retries a refusal may be given (issue #4036). */
export const REFUSAL_RETRIES_MAX = 10;
/** Largest number of review and rewrite rounds per logical request. */
export const REFUSAL_REWRITES_MAX = 3;

function validateBoundedInteger(
  key: string,
  value: unknown,
  min: number,
  max: number,
): ValidationResult {
  const isWholeNumber = Number.isInteger(value);
  if (
    typeof value === 'number' &&
    isWholeNumber &&
    value >= min &&
    value <= max
  ) {
    return { success: true, value };
  }
  return {
    success: false,
    message: `${key} must be an integer from ${min} to ${max}`,
  };
}

function validateNonNegativeInteger(
  key: string,
  value: unknown,
): ValidationResult {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return { success: true, value };
  }
  return {
    success: false,
    message: `${key} must be a non-negative integer number of milliseconds`,
  };
}

function validateProfileName(key: string, value: unknown): ValidationResult {
  if (typeof value === 'string' && value.trim().length > 0) {
    return { success: true, value: value.trim() };
  }
  return {
    success: false,
    message: `${key} must be a non-empty profile name (use /set unset ${key} to clear it)`,
  };
}

/**
 * Refusal recovery policy (issue #4036). The agent reads these at the moment a
 * request is admitted, so changing one affects the next request.
 */
export const REGISTRY_ENTRIES_PART_4: readonly SettingSpec[] = deepFreezeTable<
  readonly SettingSpec[]
>([
  {
    key: 'refusal.retries',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: `Identical retries after the model refuses a request, before review (integer 0 to ${REFUSAL_RETRIES_MAX}, default: 2)`,
    type: 'number',
    default: 2,
    persistToProfile: true,
    validate: (value: unknown): ValidationResult =>
      validateBoundedInteger('refusal.retries', value, 0, REFUSAL_RETRIES_MAX),
  },
  {
    key: 'refusal.backoff-ms',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description:
      'Base wait in milliseconds before the first refusal retry. Retry n waits min(base * 4^(n-1), 180000). 0 retries immediately (default: 15000)',
    type: 'number',
    default: 15000,
    persistToProfile: true,
    validate: (value: unknown): ValidationResult =>
      validateNonNegativeInteger('refusal.backoff-ms', value),
  },
  {
    key: 'refusal.rewrite',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description:
      'Let a review model check and rewrite the recent context when refusal retries are exhausted (default: true)',
    type: 'boolean',
    default: true,
    persistToProfile: true,
  },
  {
    key: 'refusal.review-profile',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description:
      'Saved profile used by the refusal review model. Unset falls back to compression.profile, then to the current model',
    type: 'string',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult =>
      validateProfileName('refusal.review-profile', value),
  },
  {
    key: 'refusal.max-rewrites',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: `Review and rewrite rounds allowed per request (integer 0 to ${REFUSAL_REWRITES_MAX}, default: 1)`,
    type: 'number',
    default: 1,
    persistToProfile: true,
    validate: (value: unknown): ValidationResult =>
      validateBoundedInteger(
        'refusal.max-rewrites',
        value,
        0,
        REFUSAL_REWRITES_MAX,
      ),
  },
]);
