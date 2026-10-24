/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { captureProviderInvocation } from './providerRequestContext.js';
import type { NetworkFetch } from '../utils/fetch.js';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

describe('provider invocation data capture', () => {
  it('captures nested request data without retaining settings services or caller mutations', () => {
    const globalSettings = {
      activeProvider: 'openai',
      model: 'first',
      openai: { headers: { 'X-Owner': 'a' } },
    };
    const providerSettings = {
      model: 'provider-model',
      'base-url': 'https://a.example/v1',
      temperature: 0.25,
    };
    const invocation = captureProviderInvocation(
      {
        fetch: requestFetch,
        globalSettings,
        providerSettings,
        runtimeId: 'same-label',
      },
      'openai',
    );
    globalSettings.model = 'later';
    globalSettings.openai.headers['X-Owner'] = 'changed';
    providerSettings['base-url'] = 'https://changed.example/v1';
    expect(invocation.ephemerals.model).toBe('first');
    expect(invocation.ephemerals['base-url']).toBe('https://a.example/v1');
    expect(
      invocation.getProviderOverrides<Record<string, unknown>>('openai'),
    ).toStrictEqual({
      headers: { 'X-Owner': 'a' },
      model: 'provider-model',
      'base-url': 'https://a.example/v1',
      temperature: 0.25,
    });
  });

  it('captures independent selected-member data for same-label owners outside identity scope', () => {
    const a = captureProviderInvocation(
      {
        fetch: requestFetch,
        runtimeId: 'same-label',
        globalSettings: {
          activeProvider: 'loadbalancer',
          model: 'parent-model',
        },
        providerSettings: {
          model: 'member-a',
          'base-url': 'https://a.example',
        },
      },
      'openai',
    );
    const b = captureProviderInvocation(
      {
        fetch: requestFetch,
        runtimeId: 'same-label',
        globalSettings: {
          activeProvider: 'loadbalancer',
          model: 'parent-model',
        },
        providerSettings: {
          model: 'member-b',
          'base-url': 'https://b.example',
        },
      },
      'openai',
    );
    expect([a.ephemerals.model, b.ephemerals.model]).toStrictEqual([
      'member-a',
      'member-b',
    ]);
    expect([a.ephemerals['base-url'], b.ephemerals['base-url']]).toStrictEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});
