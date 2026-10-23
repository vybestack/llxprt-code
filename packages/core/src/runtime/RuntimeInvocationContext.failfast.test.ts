/**
 * @license
 * Copyright 2025
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createRuntimeInvocationContext } from './RuntimeInvocationContext.js';
import { createProviderRuntimeContext } from './providerRuntimeContext.js';

describe('RuntimeInvocationContext fail-fast requirements', () => {
  it('throws when runtimeId is missing', () => {
    const runtime = createProviderRuntimeContext({});

    expect(() =>
      createRuntimeInvocationContext({
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
        runtimeId: runtime.runtimeId,
        runtimeMetadata: runtime.metadata,

        providerName: 'openai',
      }),
    ).toThrowError(
      'RuntimeInvocationContext requires provider ephemerals for provider "openai".',
    );
  });
});
