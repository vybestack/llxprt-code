/**
 * @license
 * Copyright 2025
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createRuntimeInvocationContext } from './RuntimeInvocationContext.js';
import { createProviderRuntimeContext } from './providerRuntimeContext.js';
import type { NetworkFetch } from '../utils/fetch.js';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

describe('RuntimeInvocationContext fail-fast requirements', () => {
  it('throws when runtimeId is missing', () => {
    const runtime = createProviderRuntimeContext({});

    expect(() =>
      createRuntimeInvocationContext({
        fetch: requestFetch,
        runtimeId: runtime.runtimeId,
        runtimeMetadata: runtime.metadata,

        providerName: 'openai',
      }),
    ).toThrowError('RuntimeInvocationContext requires a non-empty runtimeId.');
  });

  it('throws when provider ephemerals are not available', () => {
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-missing-ephemerals',
    });

    expect(() =>
      createRuntimeInvocationContext({
        fetch: requestFetch,
        runtimeId: runtime.runtimeId,
        runtimeMetadata: runtime.metadata,

        providerName: 'openai',
      }),
    ).toThrowError(
      'RuntimeInvocationContext requires provider ephemerals for provider "openai".',
    );
  });
});
