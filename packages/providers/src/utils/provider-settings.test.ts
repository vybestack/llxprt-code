/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  captureProviderDefaults,
  extractModelParams,
  isFalsyLikeValue,
} from './provider-settings.js';

describe('provider settings values', () => {
  it('strips credentials and standard fields while retaining model parameters', () => {
    const settings = {
      enabled: true,
      'auth-key': 'secret',
      'auth-keyfile': '/secret',
      apiKey: 'legacy',
      apiKeyfile: '/legacy',
      'api-key': 'legacy-dash',
      'api-keyfile': '/legacy-dash',
      'base-url': 'https://example.test',
      model: 'test-model',
      temperature: 0,
      max_tokens: 100,
      top_p: 0.8,
    };
    expect(extractModelParams(settings)).toStrictEqual({
      temperature: 0,
      max_tokens: 100,
      top_p: 0.8,
    });
    expect(settings['auth-key']).toBe('secret');
  });

  it('returns undefined when no model parameters remain', () => {
    expect(
      extractModelParams({ enabled: false, 'auth-key': 'secret' }),
    ).toBeUndefined();
  });

  it('preserves explicitly supplied falsy model parameters', () => {
    expect(
      extractModelParams({ enabled: true, temperature: null, custom: false }),
    ).toStrictEqual({ temperature: null, custom: false });
  });

  it('recognizes fallback values without discarding objects or nonempty strings', () => {
    expect(
      [undefined, null, false, '', 0, NaN].map(isFalsyLikeValue),
    ).toStrictEqual([true, true, true, true, true, true]);
    expect([true, '0', ' ', 1, [], {}].map(isFalsyLikeValue)).toStrictEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('provider settings defaults', () => {
  it('captures configured defaults without evaluating the fallback model', () => {
    const defaults = captureProviderDefaults(
      {
        defaultModel: 'configured',
        baseUrl: 'https://configured.test',
        temperature: 0,
        readConnectionPolicy: () => ({ 'base-url': 'https://policy.test' }),
      },
      'https://fallback.test',
      () => {
        throw new Error('Fallback model must remain lazy');
      },
    );
    expect(defaults.defaultModel).toBe('configured');
    expect(defaults.baseUrl).toBe('https://configured.test');
    expect(defaults.temperature).toBe(0);
    expect(defaults.ephemerals).toStrictEqual({
      'base-url': 'https://policy.test',
    });
  });

  it('captures fallback defaults when provider configuration is absent', () => {
    const defaults = captureProviderDefaults(
      undefined,
      'https://fallback.test',
      () => 'fallback',
    );
    expect(defaults.defaultModel).toBe('fallback');
    expect(defaults.baseUrl).toBe('https://fallback.test');
    expect(defaults.ephemerals).toBeUndefined();
  });
});
