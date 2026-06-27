/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LoadBalancerSubProfile,
  ResolvedSubProfile,
} from './loadBalancerTypes.js';

function normalizePositiveFiniteLimit(
  value: number | undefined,
): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function getTargetContextLimit(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  sharedLimit: number | undefined,
): number | undefined {
  const normalizedSharedLimit = normalizePositiveFiniteLimit(sharedLimit);
  const normalizedMemberLimit =
    'contextWindow' in subProfile
      ? normalizePositiveFiniteLimit(subProfile.contextWindow)
      : undefined;

  if (normalizedMemberLimit === undefined) {
    return normalizedSharedLimit;
  }
  return normalizedSharedLimit === undefined
    ? normalizedMemberLimit
    : Math.min(normalizedSharedLimit, normalizedMemberLimit);
}
