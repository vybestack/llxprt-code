/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelsDevModel, LlxprtDefaultProfile } from './schema.js';

/**
 * Generate optimal default settings per model based on capabilities
 */
export function generateDefaultProfile(
  model: ModelsDevModel,
): LlxprtDefaultProfile | undefined {
  const profile: LlxprtDefaultProfile = {};

  // Reasoning models
  if (model.reasoning) {
    profile.thinkingEnabled = true;
    profile.thinkingBudget = 10000; // Conservative default

    // Lower temperature for reasoning models
    if (model.temperature) {
      profile.temperature = 0.7;
    }
  } else {
    // Non-reasoning models
    if (model.temperature) {
      profile.temperature = 1.0;
    }
  }

  // Top-p recommendations
  if (model.temperature) {
    profile.topP = 0.95; // Standard default
  }

  // Provider/family-specific tuning
  const family = model.family?.toLowerCase() ?? '';
  const modelId = model.id.toLowerCase();

  if (family.includes('gpt-5') || modelId.includes('gpt-5')) {
    // GPT-5 models prefer higher temperature
    profile.temperature = 1.2;
    profile.topP = 0.98;
  } else if (family.includes('claude') || modelId.includes('claude')) {
    // Claude models work well with slightly lower values
    profile.temperature = 0.8;
    profile.topP = 0.9;
  } else if (family.includes('gemini') || modelId.includes('gemini')) {
    // Gemini tuning
    profile.temperature = 1.0;
    profile.topP = 0.95;
    profile.topK = 40;
  } else if (family.includes('deepseek') || modelId.includes('deepseek')) {
    // DeepSeek models
    profile.temperature = 0.7;
    profile.topP = 0.9;
  } else if (family.includes('qwen') || modelId.includes('qwen')) {
    // Qwen models
    profile.temperature = 0.7;
    profile.topP = 0.8;
  }

  // Return undefined if no profile settings were set
  if (Object.keys(profile).length === 0) {
    return undefined;
  }

  return profile;
}

/**
 * Get recommended thinking budget based on model context window
 */
export function getRecommendedThinkingBudget(contextWindow: number): number {
  // Use ~5% of context window for thinking, capped at reasonable limits
  const budget = Math.floor(contextWindow * 0.05);
  return Math.min(Math.max(budget, 5000), 50000);
}

/**
 * Merge user profile settings with model defaults
 * User settings take precedence over defaults
 */
export function mergeProfileWithDefaults(
  userProfile: Partial<LlxprtDefaultProfile>,
  modelDefaults: LlxprtDefaultProfile | undefined,
): LlxprtDefaultProfile {
  return {
    ...modelDefaults,
    ...userProfile,
  };
}
