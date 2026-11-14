/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isLoadBalancerProfile,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import type { RuntimeProfileResolution } from './subagentProfileResolution.js';
import type {
  ModelConfig,
  PromptConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';

export const LOAD_BALANCER_PROVIDER_NAME = 'load-balancer';

export function buildSubagentPromptConfig(
  basePrompt: string,
  additions?: string[],
): PromptConfig {
  const trimmedBase = basePrompt.trim();
  const trimmedAdditions = (additions ?? [])
    .map((part) => part.trim())
    .filter((part): part is string => part.length > 0);

  const promptSections: string[] = [];

  if (trimmedBase) {
    promptSections.push(trimmedBase);
  }

  if (trimmedAdditions.length > 0) {
    const numberedInstructions = trimmedAdditions
      .map((instruction, index) => `(${index + 1}) ${instruction}`)
      .join('\n');
    promptSections.push(
      [
        '--- CURRENT TASK DIRECTIVES ---',
        'Follow these instructions precisely for this run. They take precedence over any default behaviours.',
        numberedInstructions,
      ].join('\n'),
    );
  }

  const merged = promptSections.join('\n\n');

  return {
    systemPrompt: merged,
  };
}

export function buildSubagentModelConfig(profile: Profile): ModelConfig {
  return {
    model: profile.model,
    temp: profile.modelParams.temperature ?? 0.7,
    top_p: profile.modelParams.top_p ?? 1,
  };
}

export function getActivationProfile(
  runtimeProfile: RuntimeProfileResolution,
): Profile {
  return isLoadBalancerProfile(runtimeProfile.effectiveProfile)
    ? runtimeProfile.effectiveProfile
    : runtimeProfile.primaryProfile;
}

export function getRuntimeStateProfile(
  runtimeProfile: RuntimeProfileResolution,
): Profile {
  if (!isLoadBalancerProfile(runtimeProfile.effectiveProfile)) {
    return runtimeProfile.primaryProfile;
  }
  // Keep load-balancer profile metadata/settings while stamping runtime
  // provider/model to the registered load-balancer provider identity.
  return {
    ...runtimeProfile.effectiveProfile,
    ephemeralSettings: {
      ...runtimeProfile.effectiveProfile.ephemeralSettings,
    },
    modelParams: { ...runtimeProfile.effectiveProfile.modelParams },
    provider: LOAD_BALANCER_PROVIDER_NAME,
    model: LOAD_BALANCER_PROVIDER_NAME,
  };
}
