/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  DEFAULT_MODELS,
  isOpus46Plus,
  isSonnet5,
  isSonnet55,
  isHaiku55,
  isFable5,
  thinkingOffRequiresEffortAtOrBelowHigh,
  supportsAdaptiveThinking,
  modelSupportsPrefill,
  getLatestClaudeModel,
  getMaxTokensForModel,
  getContextWindowForModel,
} from './AnthropicModelData.js';

describe('AnthropicModelData latest Opus models', () => {
  describe('catalog entries', () => {
    it('includes claude-opus-4-8 and claude-opus-4-7 in DEFAULT_MODELS', () => {
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-opus-4-8')).toBe(true);
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-opus-4-7')).toBe(true);
    });

    it('retains claude-opus-4-6 with 200K context / 32K output (auth default)', () => {
      const model = DEFAULT_MODELS.find((m) => m.id === 'claude-opus-4-6');
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(200000);
      expect(model?.maxOutputTokens).toBe(32000);
    });

    it('does not include retired claude-opus-4-1 entries in DEFAULT_MODELS', () => {
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-opus-4-1')).toBe(
        false,
      );
      expect(
        DEFAULT_MODELS.some((m) => m.id === 'claude-opus-4-1-20250805'),
      ).toBe(false);
    });
  });

  describe('isOpus46Plus', () => {
    it('returns true for opus 4.6, 4.7, and 4.8', () => {
      expect(isOpus46Plus('claude-opus-4-6')).toBe(true);
      expect(isOpus46Plus('claude-opus-4-7')).toBe(true);
      expect(isOpus46Plus('claude-opus-4-8')).toBe(true);
    });

    it('returns true for the claude-opus-4-latest alias (tracks newest Opus)', () => {
      expect(isOpus46Plus('claude-opus-4-latest')).toBe(true);
    });

    it('returns false for older opus and non-opus models', () => {
      expect(isOpus46Plus('claude-opus-4-1-20250805')).toBe(false);
      expect(isOpus46Plus('claude-sonnet-4-6')).toBe(false);
      expect(isOpus46Plus('gpt-5.5')).toBe(false);
    });
  });

  describe('getMaxTokensForModel', () => {
    it('returns 32000 for opus 4.6, 4.7, and 4.8', () => {
      expect(getMaxTokensForModel('claude-opus-4-8')).toBe(32000);
      expect(getMaxTokensForModel('claude-opus-4-7')).toBe(32000);
      expect(getMaxTokensForModel('claude-opus-4-6')).toBe(32000);
    });

    it('returns 32000 for the claude-opus-4-latest alias', () => {
      expect(getMaxTokensForModel('claude-opus-4-latest')).toBe(32000);
    });
  });

  describe('getContextWindowForModel', () => {
    it('returns 200000 for opus 4.6, 4.7, and 4.8', () => {
      expect(getContextWindowForModel('claude-opus-4-8')).toBe(200000);
      expect(getContextWindowForModel('claude-opus-4-7')).toBe(200000);
      expect(getContextWindowForModel('claude-opus-4-6')).toBe(200000);
    });

    it('returns 200000 for the claude-opus-4-latest alias', () => {
      expect(getContextWindowForModel('claude-opus-4-latest')).toBe(200000);
    });
  });
});

describe('AnthropicModelData Claude Sonnet 5 @issue:2289', () => {
  describe('catalog entries', () => {
    it('includes claude-sonnet-5 in DEFAULT_MODELS', () => {
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-sonnet-5')).toBe(true);
    });
  });

  describe('isSonnet5', () => {
    it('returns true for claude-sonnet-5 and dated snapshot variants', () => {
      expect(isSonnet5('claude-sonnet-5')).toBe(true);
      expect(isSonnet5('claude-sonnet-5-20260630')).toBe(true);
      expect(isSonnet5('claude-sonnet-5-latest')).toBe(true);
    });

    it('returns false for sonnet 4 and non-sonnet models', () => {
      expect(isSonnet5('claude-sonnet-4-6')).toBe(false);
      expect(isSonnet5('claude-opus-4-8')).toBe(false);
      expect(isSonnet5('gpt-5.5')).toBe(false);
    });

    it('returns false for complete-prefix near-misses like claude-sonnet-50 and claude-sonnet-5-mini', () => {
      expect(isSonnet5('claude-sonnet-50')).toBe(false);
      expect(isSonnet5('claude-sonnet-50-20260630')).toBe(false);
      expect(isSonnet5('claude-sonnet-5-mini')).toBe(false);
      expect(isSonnet5('claude-sonnet-5-extended')).toBe(false);
    });

    it('returns false for vendor-prefixed compat ids (issue #3255)', () => {
      expect(isSonnet5('vendor-claude-sonnet-5')).toBe(false);
    });

    it('is case-insensitive for accepted ids', () => {
      expect(isSonnet5('Claude-Sonnet-5')).toBe(true);
      expect(isSonnet5('Claude-Sonnet-5-Latest')).toBe(true);
      expect(isSonnet5('Claude-Sonnet-5-20260630')).toBe(true);
    });
  });

  describe('supportsAdaptiveThinking', () => {
    it('returns true for Opus 4.6+ and Sonnet 5', () => {
      expect(supportsAdaptiveThinking('claude-opus-4-6')).toBe(true);
      expect(supportsAdaptiveThinking('claude-opus-4-8')).toBe(true);
      expect(supportsAdaptiveThinking('claude-sonnet-5')).toBe(true);
      expect(supportsAdaptiveThinking('claude-sonnet-5-20260630')).toBe(true);
    });

    it('returns false for models without adaptive thinking', () => {
      expect(supportsAdaptiveThinking('claude-sonnet-4-6')).toBe(false);
      expect(supportsAdaptiveThinking('claude-opus-4-5')).toBe(false);
    });
  });

  describe('getMaxTokensForModel', () => {
    it('returns 128000 for claude-sonnet-5, the -latest alias, and dated variants', () => {
      expect(getMaxTokensForModel('claude-sonnet-5')).toBe(128000);
      expect(getMaxTokensForModel('claude-sonnet-5-latest')).toBe(128000);
      expect(getMaxTokensForModel('claude-sonnet-5-20260630')).toBe(128000);
    });

    it('is case-insensitive (routes through isSonnet5)', () => {
      expect(getMaxTokensForModel('Claude-Sonnet-5')).toBe(128000);
    });

    it('still returns 64000 for claude-sonnet-4 models', () => {
      expect(getMaxTokensForModel('claude-sonnet-4-6')).toBe(64000);
      expect(getMaxTokensForModel('claude-sonnet-4-5-20250929')).toBe(64000);
    });
  });

  describe('getContextWindowForModel', () => {
    it('returns 200000 (auth default) for claude-sonnet-5, the -latest alias, and dated variants', () => {
      expect(getContextWindowForModel('claude-sonnet-5')).toBe(200000);
      expect(getContextWindowForModel('claude-sonnet-5-latest')).toBe(200000);
      expect(getContextWindowForModel('claude-sonnet-5-20260630')).toBe(200000);
    });

    it('is case-insensitive (routes through isSonnet5)', () => {
      expect(getContextWindowForModel('Claude-Sonnet-5')).toBe(200000);
    });

    it('still returns 400000 for claude-sonnet-4 models', () => {
      expect(getContextWindowForModel('claude-sonnet-4-6')).toBe(400000);
    });
  });

  describe('getLatestClaudeModel', () => {
    it('returns the Sonnet 5 latest alias for the sonnet tier', () => {
      expect(getLatestClaudeModel('sonnet')).toBe('claude-sonnet-5-5');
    });

    it('defaults to the sonnet tier', () => {
      expect(getLatestClaudeModel()).toBe('claude-sonnet-5-5');
    });

    it('returns the Opus latest alias for the opus tier', () => {
      expect(getLatestClaudeModel('opus')).toBe('claude-opus-5-5');
    });
  });
});

describe('AnthropicModelData Claude Opus 5 @issue:2665', () => {
  describe('catalog entries', () => {
    it('includes claude-opus-5 in DEFAULT_MODELS', () => {
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-opus-5')).toBe(true);
    });
  });

  describe('isOpus46Plus', () => {
    it('returns true for claude-opus-5 and claude-opus-5-latest', () => {
      expect(isOpus46Plus('claude-opus-5')).toBe(true);
      expect(isOpus46Plus('claude-opus-5-latest')).toBe(true);
    });

    it('returns true for opus-5 dated snapshots', () => {
      expect(isOpus46Plus('claude-opus-5-20260724')).toBe(true);
    });

    it('returns true for opus 4.6/4.7/4.8 and dated snapshots', () => {
      expect(isOpus46Plus('claude-opus-4-6')).toBe(true);
      expect(isOpus46Plus('claude-opus-4-6-20260724')).toBe(true);
      expect(isOpus46Plus('claude-opus-4-7')).toBe(true);
      expect(isOpus46Plus('claude-opus-4-8')).toBe(true);
    });

    it('returns false for older opus models (4.1, 4.5, 3.x)', () => {
      expect(isOpus46Plus('claude-opus-4-1')).toBe(false);
      expect(isOpus46Plus('claude-opus-4-5')).toBe(false);
      expect(isOpus46Plus('claude-opus-4-1-20250805')).toBe(false);
      expect(isOpus46Plus('claude-3-opus-20240229')).toBe(false);
    });
  });

  describe('getMaxTokensForModel', () => {
    it('returns 32000 (auth default) for claude-opus-5 and claude-opus-5-latest', () => {
      expect(getMaxTokensForModel('claude-opus-5')).toBe(32000);
      expect(getMaxTokensForModel('claude-opus-5-latest')).toBe(32000);
      expect(getMaxTokensForModel('claude-opus-5-20260724')).toBe(32000);
    });
  });

  describe('getContextWindowForModel', () => {
    it('returns 200000 (auth default) for claude-opus-5, latest, and dated variants', () => {
      expect(getContextWindowForModel('claude-opus-5')).toBe(200000);
      expect(getContextWindowForModel('claude-opus-5-latest')).toBe(200000);
      expect(getContextWindowForModel('claude-opus-5-20260724')).toBe(200000);
    });
  });

  describe('supportsAdaptiveThinking', () => {
    it('returns true for claude-opus-5 and the latest alias', () => {
      expect(supportsAdaptiveThinking('claude-opus-5')).toBe(true);
      expect(supportsAdaptiveThinking('claude-opus-5-latest')).toBe(true);
    });

    it('the latest opus alias composes with supportsAdaptiveThinking', () => {
      expect(supportsAdaptiveThinking(getLatestClaudeModel('opus'))).toBe(true);
    });
  });

  describe('getLatestClaudeModel', () => {
    it('returns the Opus 5 latest alias for the opus tier', () => {
      expect(getLatestClaudeModel('opus')).toBe('claude-opus-5-5');
    });
  });
});

describe('modelSupportsPrefill @issue:1977', () => {
  it('returns false for Claude 5.5 ids @issue:3834', () => {
    for (const model of [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]) {
      expect(modelSupportsPrefill(model)).toBe(false);
    }
    for (const nearMiss of [
      'claude-opus-5-50',
      'claude-opus-5-5-mini',
      'claude-sonnet-5-50',
      'claude-haiku-5-50',
      'anthropic/claude-opus-5-5',
      ' claude-opus-5-5',
      'claude-opus-5-5 ',
    ]) {
      expect(modelSupportsPrefill(nearMiss)).toBe(true);
    }
  });

  it('returns false for Fable 5 ids (they reject assistant prefill)', () => {
    expect(modelSupportsPrefill('claude-fable-5')).toBe(false);
    expect(modelSupportsPrefill('claude-fable-5-latest')).toBe(false);
    expect(modelSupportsPrefill('claude-fable-5-20260701')).toBe(false);
    expect(modelSupportsPrefill('claude-fable-5-1')).toBe(false);
    expect(modelSupportsPrefill('CLAUDE-FABLE-5')).toBe(false);
  });

  it('returns true for prefill-capable Claude models', () => {
    expect(modelSupportsPrefill('claude-opus-4-8')).toBe(true);
    expect(modelSupportsPrefill('claude-opus-5')).toBe(true);
    expect(modelSupportsPrefill('claude-sonnet-5')).toBe(true);
    expect(modelSupportsPrefill('claude-haiku-4-5-20251001')).toBe(true);
  });

  it('returns true for unknown, empty, and undefined model ids', () => {
    expect(modelSupportsPrefill('some-unknown-model')).toBe(true);
    expect(modelSupportsPrefill('')).toBe(true);
    expect(modelSupportsPrefill(undefined)).toBe(true);
  });

  it('returns true for fable near-misses that are not Fable 5', () => {
    expect(modelSupportsPrefill('claude-fable-50')).toBe(true);
    expect(modelSupportsPrefill('claude-fable-5-1-mini')).toBe(true);
  });
});

describe('AnthropicModelData Claude Fable 5 @issue:2328', () => {
  describe('isFable5', () => {
    it('returns true for claude-fable-5 and dated snapshot variants', () => {
      expect(isFable5('claude-fable-5')).toBe(true);
      expect(isFable5('claude-fable-5-20260701')).toBe(true);
      expect(isFable5('claude-fable-5-latest')).toBe(true);
    });

    it('returns false for opus, sonnet, and non-claude models', () => {
      expect(isFable5('claude-opus-4-8')).toBe(false);
      expect(isFable5('claude-sonnet-5')).toBe(false);
      expect(isFable5('gpt-5.5')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isFable5('Claude-Fable-5')).toBe(true);
    });

    it('returns true for the claude-fable-5-1 point release and its variants @issue:3531', () => {
      expect(isFable5('claude-fable-5-1')).toBe(true);
      expect(isFable5('claude-fable-5-1-latest')).toBe(true);
      expect(isFable5('claude-fable-5-1-20260901')).toBe(true);
    });

    it('returns false for fable-5-1 near-misses @issue:3531', () => {
      expect(isFable5('claude-fable-5-1-mini')).toBe(false);
      expect(isFable5('claude-fable-5-11')).toBe(false);
      expect(isFable5('claude-fable-50')).toBe(false);
      expect(isFable5('claude-fable-51')).toBe(false);
    });

    it('is case-insensitive for fable-5-1 ids @issue:3531', () => {
      expect(isFable5('CLAUDE-FABLE-5-1')).toBe(true);
    });
  });

  describe('supportsAdaptiveThinking', () => {
    it('returns true for claude-fable-5 and dated variants', () => {
      expect(supportsAdaptiveThinking('claude-fable-5')).toBe(true);
      expect(supportsAdaptiveThinking('claude-fable-5-20260701')).toBe(true);
    });

    it('returns false for models without adaptive thinking', () => {
      expect(supportsAdaptiveThinking('claude-opus-4-5')).toBe(false);
      expect(supportsAdaptiveThinking('claude-haiku-4-5')).toBe(false);
    });

    it('returns true for claude-fable-5-1 @issue:3531', () => {
      expect(supportsAdaptiveThinking('claude-fable-5-1')).toBe(true);
      expect(supportsAdaptiveThinking('claude-fable-5-1-20260901')).toBe(true);
    });
  });

  describe('getMaxTokensForModel', () => {
    it('returns 40000 for claude-fable-5, the -latest alias, and dated variants', () => {
      expect(getMaxTokensForModel('claude-fable-5')).toBe(40000);
      expect(getMaxTokensForModel('claude-fable-5-latest')).toBe(40000);
      expect(getMaxTokensForModel('claude-fable-5-20260701')).toBe(40000);
    });

    it('is case-insensitive (routes through isFable5)', () => {
      expect(getMaxTokensForModel('Claude-Fable-5')).toBe(40000);
    });

    it('returns 40000 for claude-fable-5-1 variants @issue:3531', () => {
      expect(getMaxTokensForModel('claude-fable-5-1')).toBe(40000);
      expect(getMaxTokensForModel('claude-fable-5-1-latest')).toBe(40000);
      expect(getMaxTokensForModel('claude-fable-5-1-20260901')).toBe(40000);
    });
  });

  describe('getContextWindowForModel', () => {
    it('returns 200000 (auth default) for claude-fable-5, the -latest alias, and dated variants', () => {
      expect(getContextWindowForModel('claude-fable-5')).toBe(200000);
      expect(getContextWindowForModel('claude-fable-5-latest')).toBe(200000);
      expect(getContextWindowForModel('claude-fable-5-20260701')).toBe(200000);
    });

    it('is case-insensitive (routes through isFable5)', () => {
      expect(getContextWindowForModel('Claude-Fable-5')).toBe(200000);
    });

    it('returns 200000 (auth default) for claude-fable-5-1 variants @issue:3531', () => {
      expect(getContextWindowForModel('claude-fable-5-1')).toBe(200000);
      expect(getContextWindowForModel('claude-fable-5-1-latest')).toBe(200000);
      expect(getContextWindowForModel('claude-fable-5-1-20260901')).toBe(
        200000,
      );
    });
  });
});

describe('Claude 5.5 model data @issue:3834', () => {
  const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

  it('supports adaptive thinking only for exact 5.5 model IDs', () => {
    for (const model of models)
      expect(supportsAdaptiveThinking(model)).toBe(true);
    for (const model of [
      'claude-opus-5-50',
      'claude-opus-5-5-mini',
      'claude-sonnet-5-50',
      'claude-sonnet-5-5-mini',
      'claude-haiku-5-50',
      'claude-haiku-5-5-mini',
      'anthropic/claude-opus-5-5',
      ' claude-opus-5-5',
      'claude-opus-5-5 ',
    ])
      expect(supportsAdaptiveThinking(model)).toBe(false);
  });

  it('keeps new family predicates anchored @issue:3834', () => {
    for (const model of models) {
      expect(isOpus46Plus(model)).toBe(model === 'claude-opus-5-5');
      expect(isSonnet55(model)).toBe(model === 'claude-sonnet-5-5');
      expect(isHaiku55(model)).toBe(model === 'claude-haiku-5-5');
    }
    for (const model of [
      'claude-opus-5-50',
      'claude-opus-5-5-mini',
      'claude-sonnet-5-50',
      'claude-sonnet-5-5-mini',
      'claude-haiku-5-50',
      'claude-haiku-5-5-mini',
      'anthropic/claude-opus-5-5',
      ' claude-opus-5-5',
      'claude-opus-5-5 ',
    ]) {
      expect(isOpus46Plus(model)).toBe(false);
      expect(isSonnet55(model)).toBe(false);
      expect(isHaiku55(model)).toBe(false);
    }
  });

  it('uses subscription geometry and lists each model in DEFAULT_MODELS @issue:3834', () => {
    for (const id of models) {
      expect(getMaxTokensForModel(id)).toBe(128000);
      expect(getContextWindowForModel(id)).toBe(200000);
      const model = DEFAULT_MODELS.find((candidate) => candidate.id === id);
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(200000);
      expect(model?.maxOutputTokens).toBe(128000);
    }
  });

  it('returns the newest model for each tier and defaults to Sonnet @issue:3834', () => {
    expect(getLatestClaudeModel('opus')).toBe('claude-opus-5-5');
    expect(getLatestClaudeModel('sonnet')).toBe('claude-sonnet-5-5');
    expect(getLatestClaudeModel('haiku')).toBe('claude-haiku-5-5');
    expect(getLatestClaudeModel()).toBe('claude-sonnet-5-5');
  });

  describe('thinking-off effort cap predicate @issue:3834', () => {
    it('matches only the capped thinking-off model identifiers', () => {
      expect(thinkingOffRequiresEffortAtOrBelowHigh('claude-opus-5')).toBe(
        true,
      );
      expect(
        thinkingOffRequiresEffortAtOrBelowHigh('claude-opus-5-20261008'),
      ).toBe(true);
      expect(thinkingOffRequiresEffortAtOrBelowHigh('claude-sonnet-5-5')).toBe(
        true,
      );
      expect(thinkingOffRequiresEffortAtOrBelowHigh('claude-haiku-5-5')).toBe(
        true,
      );
      expect(thinkingOffRequiresEffortAtOrBelowHigh('claude-sonnet-5')).toBe(
        false,
      );
      expect(thinkingOffRequiresEffortAtOrBelowHigh('claude-opus-5-mini')).toBe(
        false,
      );
      expect(thinkingOffRequiresEffortAtOrBelowHigh('claude-opus-50')).toBe(
        false,
      );
      expect(thinkingOffRequiresEffortAtOrBelowHigh('claude-sonnet-5-50')).toBe(
        false,
      );
      expect(thinkingOffRequiresEffortAtOrBelowHigh('claude-haiku-5-50')).toBe(
        false,
      );
    });
  });
});
