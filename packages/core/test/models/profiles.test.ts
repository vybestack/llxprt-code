/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  generateDefaultProfile,
  getRecommendedThinkingBudget,
  mergeProfileWithDefaults,
} from '../../src/models/profiles.js';
import type {
  ModelsDevModel,
  LlxprtDefaultProfile,
} from '../../src/models/schema.js';
import {
  minimalModel,
  reasoningModel,
  claudeModel,
  geminiModel,
  deepseekModel,
} from './__fixtures__/mock-data.js';

describe('generateDefaultProfile', () => {
  describe('reasoning models', () => {
    it('sets thinkingEnabled: true for reasoning model', () => {
      const profile = generateDefaultProfile(reasoningModel);
      expect(profile?.thinkingEnabled).toBe(true);
    });

    it('sets thinkingBudget: 10000 for reasoning model', () => {
      const profile = generateDefaultProfile(reasoningModel);
      expect(profile?.thinkingBudget).toBe(10000);
    });

    it('sets temperature: 0.7 for reasoning model with temperature support', () => {
      const profile = generateDefaultProfile(reasoningModel);
      expect(profile?.temperature).toBe(0.7);
    });
  });

  describe('non-reasoning models', () => {
    it('sets temperature: 1.0 for non-reasoning model with temperature support', () => {
      const model: ModelsDevModel = {
        ...minimalModel,
        reasoning: false,
        temperature: true,
      };
      const profile = generateDefaultProfile(model);
      expect(profile?.temperature).toBe(1.0);
    });

    it('does not set thinkingEnabled for non-reasoning model', () => {
      const model: ModelsDevModel = {
        ...minimalModel,
        reasoning: false,
        temperature: true,
      };
      const profile = generateDefaultProfile(model);
      expect(profile?.thinkingEnabled).toBeUndefined();
    });
  });

  describe('topP setting', () => {
    it('sets topP: 0.95 when temperature is supported', () => {
      const model: ModelsDevModel = {
        ...minimalModel,
        temperature: true,
      };
      const profile = generateDefaultProfile(model);
      expect(profile?.topP).toBe(0.95);
    });

    it('does not set topP when temperature not supported', () => {
      const profile = generateDefaultProfile(minimalModel);
      expect(profile?.topP).toBeUndefined();
    });
  });

  describe('family-specific tuning', () => {
    it('GPT-5 family gets temperature: 1.2, topP: 0.98', () => {
      const gpt5Model: ModelsDevModel = {
        ...minimalModel,
        family: 'gpt-5',
        temperature: true,
      };
      const profile = generateDefaultProfile(gpt5Model);
      expect(profile?.temperature).toBe(1.2);
      expect(profile?.topP).toBe(0.98);
    });

    it('GPT-5 detected by model ID', () => {
      const gpt5Model: ModelsDevModel = {
        ...minimalModel,
        id: 'gpt-5-turbo',
        temperature: true,
      };
      const profile = generateDefaultProfile(gpt5Model);
      expect(profile?.temperature).toBe(1.2);
    });

    it('Claude family gets temperature: 0.8, topP: 0.9', () => {
      const profile = generateDefaultProfile(claudeModel);
      expect(profile?.temperature).toBe(0.8);
      expect(profile?.topP).toBe(0.9);
    });

    it('Gemini family gets topK: 40', () => {
      const profile = generateDefaultProfile(geminiModel);
      expect(profile?.topK).toBe(40);
      expect(profile?.temperature).toBe(1.0);
      expect(profile?.topP).toBe(0.95);
    });

    it('DeepSeek family gets temperature: 0.7, topP: 0.9', () => {
      const profile = generateDefaultProfile(deepseekModel);
      expect(profile?.temperature).toBe(0.7);
      expect(profile?.topP).toBe(0.9);
    });

    it('Qwen family gets temperature: 0.7, topP: 0.8', () => {
      const qwenModel: ModelsDevModel = {
        ...minimalModel,
        family: 'qwen-2.5',
        temperature: true,
      };
      const profile = generateDefaultProfile(qwenModel);
      expect(profile?.temperature).toBe(0.7);
      expect(profile?.topP).toBe(0.8);
    });
  });

  describe('undefined profile', () => {
    it('returns undefined when no settings apply', () => {
      const profile = generateDefaultProfile(minimalModel);
      expect(profile).toBeUndefined();
    });

    it('returns undefined for model with no capabilities', () => {
      const bareModel: ModelsDevModel = {
        id: 'bare',
        name: 'Bare',
        limit: { context: 4000, output: 2000 },
        release_date: '2024-01-01',
        open_weights: false,
      };
      const profile = generateDefaultProfile(bareModel);
      expect(profile).toBeUndefined();
    });
  });
});

describe('getRecommendedThinkingBudget', () => {
  it('returns 5000 for small context (minimum)', () => {
    const budget = getRecommendedThinkingBudget(8000);
    expect(budget).toBe(5000);
  });

  it('returns 5% of context for medium context', () => {
    const budget = getRecommendedThinkingBudget(128000);
    expect(budget).toBe(6400); // 128000 * 0.05 = 6400
  });

  it('caps at 50000 for very large context', () => {
    const budget = getRecommendedThinkingBudget(2000000);
    expect(budget).toBe(50000);
  });

  it('calculates correctly for 1M context', () => {
    const budget = getRecommendedThinkingBudget(1000000);
    expect(budget).toBe(50000); // 1M * 0.05 = 50K, capped at 50K
  });

  it('floors the result', () => {
    // 100001 * 0.05 = 5000.05, should floor to 5000
    const budget = getRecommendedThinkingBudget(100001);
    expect(budget).toBe(5000);
  });
});

describe('mergeProfileWithDefaults', () => {
  it('user settings override defaults', () => {
    const defaults: LlxprtDefaultProfile = {
      temperature: 1.0,
      topP: 0.95,
    };
    const userProfile: Partial<LlxprtDefaultProfile> = {
      temperature: 0.5,
    };
    const merged = mergeProfileWithDefaults(userProfile, defaults);
    expect(merged.temperature).toBe(0.5);
    expect(merged.topP).toBe(0.95);
  });

  it('preserves defaults when user setting missing', () => {
    const defaults: LlxprtDefaultProfile = {
      temperature: 1.0,
      topP: 0.95,
      topK: 40,
    };
    const userProfile: Partial<LlxprtDefaultProfile> = {};
    const merged = mergeProfileWithDefaults(userProfile, defaults);
    expect(merged.temperature).toBe(1.0);
    expect(merged.topP).toBe(0.95);
    expect(merged.topK).toBe(40);
  });

  it('handles undefined defaults gracefully', () => {
    const userProfile: Partial<LlxprtDefaultProfile> = {
      temperature: 0.7,
    };
    const merged = mergeProfileWithDefaults(userProfile, undefined);
    expect(merged.temperature).toBe(0.7);
  });

  it('returns empty object when both are empty', () => {
    const merged = mergeProfileWithDefaults({}, undefined);
    expect(merged).toEqual({});
  });

  it('user can override thinking settings', () => {
    const defaults: LlxprtDefaultProfile = {
      thinkingEnabled: true,
      thinkingBudget: 10000,
    };
    const userProfile: Partial<LlxprtDefaultProfile> = {
      thinkingBudget: 20000,
    };
    const merged = mergeProfileWithDefaults(userProfile, defaults);
    expect(merged.thinkingEnabled).toBe(true);
    expect(merged.thinkingBudget).toBe(20000);
  });
});
