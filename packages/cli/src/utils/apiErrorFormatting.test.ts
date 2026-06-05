/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  getActiveProviderNameForApiError,
  getErrorFallbackModel,
} from './apiErrorFormatting.js';

function makeConfig(options: {
  model?: string;
  configProvider?: string;
  settingsProvider?: unknown;
  managerProvider?: string;
  throwFromManager?: boolean;
  throwFromSettings?: boolean;
}): Config {
  return {
    getModel: vi.fn(() => options.model ?? 'test-model'),
    getProvider: vi.fn(() => options.configProvider),
    getProviderManager: vi.fn(() => {
      if (options.throwFromManager === true) {
        throw new Error('provider manager unavailable');
      }
      return options.managerProvider === undefined
        ? undefined
        : { getActiveProviderName: vi.fn(() => options.managerProvider) };
    }),
    getSettingsService: vi.fn(() => {
      if (options.throwFromSettings === true) {
        throw new Error('settings unavailable');
      }
      return { get: vi.fn(() => options.settingsProvider) };
    }),
  } as unknown as Config;
}

describe('apiErrorFormatting', () => {
  describe('getActiveProviderNameForApiError', () => {
    it('uses provider manager active provider before settings', () => {
      const config = makeConfig({
        managerProvider: 'anthropic',
        settingsProvider: 'profile-name',
      });
      expect(getActiveProviderNameForApiError(config)).toBe('anthropic');
    });

    it('falls back to activeProvider setting when provider manager is blank', () => {
      const config = makeConfig({
        managerProvider: '   ',
        settingsProvider: 'openai',
      });
      expect(getActiveProviderNameForApiError(config)).toBe('openai');
    });

    it('returns undefined when provider context is unavailable', () => {
      const config = makeConfig({
        throwFromManager: true,
        throwFromSettings: true,
      });
      expect(getActiveProviderNameForApiError(config)).toBeUndefined();
    });
  });

  it('uses config provider before settings when provider manager is blank', () => {
    const config = makeConfig({
      managerProvider: '   ',
      configProvider: 'anthropic',
      settingsProvider: 'profile-name',
    });
    expect(getActiveProviderNameForApiError(config)).toBe('anthropic');
  });

  describe('getErrorFallbackModel', () => {
    it('returns model for unknown provider', () => {
      const config = makeConfig({ model: 'gemini-2.5-pro' });
      expect(getErrorFallbackModel(config, undefined)).toBe('gemini-2.5-pro');
    });

    it('returns model for Gemini provider regardless of case or whitespace', () => {
      const config = makeConfig({ model: 'gemini-2.5-pro' });
      expect(getErrorFallbackModel(config, ' Gemini ')).toBe('gemini-2.5-pro');
    });

    it('returns model for blank provider as unknown provider', () => {
      const config = makeConfig({ model: 'gemini-2.5-pro' });
      expect(getErrorFallbackModel(config, '   ')).toBe('gemini-2.5-pro');
    });

    it('does not return model for non-Gemini provider', () => {
      const config = makeConfig({ model: 'claude-opus-4-6' });
      expect(getErrorFallbackModel(config, 'anthropic')).toBeUndefined();
    });
  });
});
