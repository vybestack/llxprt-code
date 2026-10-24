/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { normalizeChatCompletionOptions } from './optionsNormalizer.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

const providerName = 'provider-a';

describe('logging request admission from data', () => {
  it('captures immutable settings without retaining a settings service', () => {
    const globalSettings = { model: 'first-model', retrywait: 3 };
    const providerSettings = { temperature: 0.4 };
    const result = normalizeChatCompletionOptions([], undefined, {
      providerName,
      statelessRuntimeMetadata: { strict: true },
      optionsNormalizer: null,
      readInvocationData: () => ({
        runtimeId: 'data-owner',
        metadata: { owner: 'data' },
        globalSettings,
        providerSettings,
      }),
      readRuntimeKind: () => 'subagent',
    });
    globalSettings.model = 'changed-model';
    providerSettings.temperature = 0.9;

    expect(result.invocation?.ephemerals).toMatchObject({
      model: 'first-model',
      retrywait: 3,
      [providerName]: { temperature: 0.4 },
    });
    expect(result.runtimeKind).toBe('subagent');
    expect(result.metadata).toMatchObject({ strict: true, owner: 'data' });
    expect(result).not.toHaveProperty('runtime');
    expect(result).not.toHaveProperty('settings');
  });

  it('preserves admitted invocation and explicit kind over owner defaults', () => {
    const invocation = captureProviderInvocation(
      {
        fetch: requestFetch,
        globalSettings: { model: 'caller-model' },
        providerSettings: {},
      },
      providerName,
    );
    const result = normalizeChatCompletionOptions(
      {
        contents: [],
        invocation,
        runtimeKind: 'agent',
        metadata: { owner: 'caller' },
      },
      undefined,
      {
        providerName,
        statelessRuntimeMetadata: null,
        optionsNormalizer: null,
        readInvocationData: () => ({
          globalSettings: { model: 'owner-model' },
          providerSettings: {},
          metadata: { owner: 'default' },
        }),
        readRuntimeKind: () => 'cli-interactive',
      },
    );

    expect(result.invocation?.ephemerals.model).toBe('caller-model');
    expect(result.runtimeKind).toBe('agent');
    expect(result.metadata?.owner).toBe('caller');
  });
});
