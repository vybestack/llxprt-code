/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Load-balancer configuration validation. Extracted from
 * LoadBalancingProvider.validateConfig to keep the main file under the lint
 * budget. Pure logic: depends only on the supplied config.
 * @plan PLAN-20251211issue486c - Updated to handle ResolvedSubProfile
 */

import {
  isResolvedSubProfile,
  validateLoadBalancingStrategy,
  type LoadBalancerSubProfile,
  type LoadBalancingProviderConfig,
  type ResolvedSubProfile,
} from './loadBalancerTypes.js';

function validateSubProfileIdentity(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
): void {
  if (!subProfile.name || typeof subProfile.name !== 'string') {
    throw new Error(
      'Each sub-profile must have a valid "name" field (non-empty string)',
    );
  }

  if (!subProfile.providerName || typeof subProfile.providerName !== 'string') {
    throw new Error(
      `Sub-profile "${subProfile.name}" must have a valid "providerName" field (non-empty string)`,
    );
  }
}

function validateResolvedSubProfile(subProfile: ResolvedSubProfile): void {
  if (
    typeof subProfile.model !== 'string' ||
    subProfile.model.trim().length === 0
  ) {
    throw new Error(
      `ResolvedSubProfile "${subProfile.name}" must have a valid "model" field (non-empty string)`,
    );
  }

  // Runtime-widened locals reject null AND arrays explicitly, matching the
  // isRecord() guard in loadBalancerTypes.ts (typeof null === 'object' and
  // typeof [] === 'object' would otherwise slip through).
  const ephemeralSettingsRuntime: unknown = subProfile.ephemeralSettings;
  if (
    typeof ephemeralSettingsRuntime !== 'object' ||
    ephemeralSettingsRuntime === null ||
    Array.isArray(ephemeralSettingsRuntime)
  ) {
    throw new Error(
      `ResolvedSubProfile "${subProfile.name}" must have a valid "ephemeralSettings" field (object)`,
    );
  }

  const modelParamsRuntime: unknown = subProfile.modelParams;
  if (
    typeof modelParamsRuntime !== 'object' ||
    modelParamsRuntime === null ||
    Array.isArray(modelParamsRuntime)
  ) {
    throw new Error(
      `ResolvedSubProfile "${subProfile.name}" must have a valid "modelParams" field (object)`,
    );
  }
}

/**
 * Validate the load balancing configuration. Throws on the first violation.
 */
export function validateLoadBalancerConfig(
  config: LoadBalancingProviderConfig,
): void {
  // Check for empty subProfiles array
  if (config.subProfiles.length === 0) {
    throw new Error(
      'LoadBalancingProvider requires at least one sub-profile in configuration',
    );
  }

  validateLoadBalancingStrategy(config.strategy);

  // Failover strategy requires at least 2 sub-profiles
  if (config.strategy === 'failover' && config.subProfiles.length < 2) {
    throw new Error(
      'Failover strategy requires at least 2 sub-profiles (minimum 2 backends for failover)',
    );
  }

  // Validate each sub-profile
  for (const subProfile of config.subProfiles) {
    validateSubProfileIdentity(subProfile);

    // Additional validation for ResolvedSubProfile
    if (isResolvedSubProfile(subProfile)) {
      validateResolvedSubProfile(subProfile);
    }
  }
}
