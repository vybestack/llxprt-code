/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { assertSupportedReplacementRoute } from './admittedRouteSecurity.js';

describe('admitted route replacement eligibility', () => {
  it('rejects a direct continuation with no captured endpoint after replacement', () => {
    expect(() =>
      assertSupportedReplacementRoute('openai', undefined, undefined, true),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('rejects a direct replacement without a captured static credential source', () => {
    expect(() =>
      assertSupportedReplacementRoute(
        'openai',
        'https://old.example',
        undefined,
        true,
        false,
      ),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('rejects an unverified provider family after replacement', () => {
    expect(() =>
      assertSupportedReplacementRoute(
        'anthropic',
        'https://old.example',
        undefined,
        true,
      ),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('rejects load-balancer replacement when a captured member uses an unverified provider', () => {
    expect(() =>
      assertSupportedReplacementRoute(
        'load-balancer',
        undefined,
        [
          {
            providerName: 'openai',
            baseURL: 'https://old.example',
            hasInlineKey: true,
          },
          {
            providerName: 'anthropic',
            baseURL: 'https://old.example',
            hasInlineKey: true,
          },
        ],
        true,
      ),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('rejects an OpenAI LB member with no captured endpoint or inline credential', () => {
    expect(() =>
      assertSupportedReplacementRoute(
        'load-balancer',
        undefined,
        [{ providerName: 'openai' }],
        true,
      ),
    ).toThrow('Unsupported admitted provider route after replacement');
  });

  it('does not constrain the unmodified route or supported OpenAI member routes', () => {
    expect(() =>
      assertSupportedReplacementRoute('anthropic', undefined, undefined, false),
    ).not.toThrow();
    expect(() =>
      assertSupportedReplacementRoute(
        'openai',
        'https://old.example',
        undefined,
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertSupportedReplacementRoute(
        'load-balancer',
        undefined,
        [
          {
            providerName: 'openai',
            baseURL: 'https://old.example',
            hasInlineKey: true,
          },
        ],
        true,
      ),
    ).not.toThrow();
  });
});
