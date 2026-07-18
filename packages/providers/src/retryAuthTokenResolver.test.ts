/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { resolveAuthTokenFromOptions } from './retryAuthTokenResolver.js';
import type { GenerateChatOptions } from './IProvider.js';

function optsWith(authToken: unknown): GenerateChatOptions {
  return {
    contents: [],
    resolved: { authToken } as GenerateChatOptions['resolved'],
  } as GenerateChatOptions;
}

describe('resolveAuthTokenFromOptions', () => {
  it('returns a plain string token directly', async () => {
    const result = await resolveAuthTokenFromOptions(
      optsWith('my-static-token'),
    );
    expect(result).toBe('my-static-token');
  });

  it('uses provide() on a callable object with provide before plain-function invocation', async () => {
    let provideCalled = false;
    let plainCallCalled = false;

    const tokenProvider = {
      provide: () => {
        provideCalled = true;
        return 'from-provide';
      },
      // The object is also callable — provide() must win.
      __call: () => {
        plainCallCalled = true;
        return 'from-call';
      },
    };
    // Make it callable by setting it as a function with a property
    const callable = Object.assign(
      () => {
        plainCallCalled = true;
        return 'from-call';
      },
      { provide: tokenProvider.provide },
    );

    const result = await resolveAuthTokenFromOptions(optsWith(callable));
    expect(result).toBe('from-provide');
    expect(provideCalled).toBe(true);
    expect(plainCallCalled).toBe(false);
  });

  it('calls a plain function token provider', async () => {
    const result = await resolveAuthTokenFromOptions(
      optsWith(() => 'from-function'),
    );
    expect(result).toBe('from-function');
  });

  it('returns empty string when provide() returns undefined', async () => {
    const result = await resolveAuthTokenFromOptions(
      optsWith({ provide: () => undefined }),
    );
    expect(result).toBe('');
  });

  it('returns empty string for undefined authToken', async () => {
    const result = await resolveAuthTokenFromOptions(optsWith(undefined));
    expect(result).toBe('');
  });

  it('returns empty string when provide() throws', async () => {
    const result = await resolveAuthTokenFromOptions(
      optsWith({
        provide: () => {
          throw new Error('provider failure');
        },
      }),
    );
    expect(result).toBe('');
  });

  it('returns empty string when a plain function throws', async () => {
    const result = await resolveAuthTokenFromOptions(
      optsWith(() => {
        throw new Error('function failure');
      }),
    );
    expect(result).toBe('');
  });

  it('awaits an async provide()', async () => {
    const result = await resolveAuthTokenFromOptions(
      optsWith({ provide: () => Promise.resolve('async-token') }),
    );
    expect(result).toBe('async-token');
  });

  it('awaits an async plain function', async () => {
    const result = await resolveAuthTokenFromOptions(
      optsWith(() => Promise.resolve('async-fn-token')),
    );
    expect(result).toBe('async-fn-token');
  });
});
