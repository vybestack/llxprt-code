/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LoadBalancerSubProfile,
  ResolvedSubProfile,
} from './loadBalancerTypes.js';

export function getTargetContextLimit(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  sharedLimit: number | undefined,
): number | undefined {
  if (
    !('contextWindow' in subProfile) ||
    subProfile.contextWindow === undefined
  ) {
    return sharedLimit;
  }
  return sharedLimit === undefined
    ? subProfile.contextWindow
    : Math.min(sharedLimit, subProfile.contextWindow);
}
