/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBucketFailoverHandlerFromConfig,
  getBucketFailoverHandlerFromOptions,
  resolveOnAuthErrorHandlerFromConfig,
  getOnAuthErrorHandlerFromOptions,
} from './retryConfigHandlers.js';
import type { GenerateChatOptions } from './IProvider.js';

describe('resolveBucketFailoverHandlerFromConfig', () => {
  it('returns undefined for null config', () => {
    expect(resolveBucketFailoverHandlerFromConfig(null)).toBeUndefined();
  });

  it('returns undefined for undefined config', () => {
    expect(resolveBucketFailoverHandlerFromConfig(undefined)).toBeUndefined();
  });

  it('returns undefined when getBucketFailoverHandler is missing', () => {
    expect(resolveBucketFailoverHandlerFromConfig({})).toBeUndefined();
  });

  it('returns the handler when present', () => {
    const handler = {
      tryFailover: () => Promise.resolve(true),
      getBuckets: () => [],
    };
    const config = {
      getBucketFailoverHandler: () => handler,
    };
    expect(resolveBucketFailoverHandlerFromConfig(config)).toBe(handler);
  });

  it('returns undefined when getBucketFailoverHandler returns undefined', () => {
    const config = {
      getBucketFailoverHandler: () => undefined,
    };
    expect(resolveBucketFailoverHandlerFromConfig(config)).toBeUndefined();
  });
});

describe('getBucketFailoverHandlerFromOptions', () => {
  const handler = {
    tryFailover: () => Promise.resolve(true),
    getBuckets: () => [],
  };

  it('prefers runtime config over static config', () => {
    const runtimeHandler = {
      tryFailover: () => Promise.resolve(true),
      getBuckets: () => ['runtime'],
    };
    const staticHandler = {
      tryFailover: () => Promise.resolve(true),
      getBuckets: () => ['static'],
    };
    const options = {
      runtime: {
        config: { getBucketFailoverHandler: () => runtimeHandler },
      },
      config: { getBucketFailoverHandler: () => staticHandler },
    } as unknown as GenerateChatOptions;
    expect(getBucketFailoverHandlerFromOptions(options)).toBe(runtimeHandler);
  });

  it('falls back to static config when runtime config has no handler', () => {
    const options = {
      runtime: { config: {} },
      config: { getBucketFailoverHandler: () => handler },
    } as unknown as GenerateChatOptions;
    expect(getBucketFailoverHandlerFromOptions(options)).toBe(handler);
  });

  it('returns undefined when neither config has a handler', () => {
    const options = {} as GenerateChatOptions;
    expect(getBucketFailoverHandlerFromOptions(options)).toBeUndefined();
  });
});

describe('resolveOnAuthErrorHandlerFromConfig', () => {
  it('returns undefined for null config', () => {
    expect(resolveOnAuthErrorHandlerFromConfig(null)).toBeUndefined();
  });

  it('returns undefined for undefined config', () => {
    expect(resolveOnAuthErrorHandlerFromConfig(undefined)).toBeUndefined();
  });

  it('returns undefined when getOnAuthErrorHandler is missing', () => {
    expect(resolveOnAuthErrorHandlerFromConfig({})).toBeUndefined();
  });

  it('returns the handler when present', () => {
    const handler = {
      handleAuthError: () => Promise.resolve(),
    };
    const config = {
      getOnAuthErrorHandler: () => handler,
    };
    expect(resolveOnAuthErrorHandlerFromConfig(config)).toBe(handler);
  });
});

describe('getOnAuthErrorHandlerFromOptions', () => {
  it('prefers runtime config over static config', () => {
    const runtimeHandler = {
      handleAuthError: () => Promise.resolve(),
    };
    const staticHandler = {
      handleAuthError: () => Promise.resolve(),
    };
    const options = {
      runtime: {
        config: { getOnAuthErrorHandler: () => runtimeHandler },
      },
      config: { getOnAuthErrorHandler: () => staticHandler },
    } as unknown as GenerateChatOptions;
    expect(getOnAuthErrorHandlerFromOptions(options)).toBe(runtimeHandler);
  });

  it('falls back to static config when runtime config has no handler', () => {
    const handler = {
      handleAuthError: () => Promise.resolve(),
    };
    const options = {
      runtime: { config: {} },
      config: { getOnAuthErrorHandler: () => handler },
    } as unknown as GenerateChatOptions;
    expect(getOnAuthErrorHandlerFromOptions(options)).toBe(handler);
  });

  it('returns undefined when neither config has a handler', () => {
    const options = {} as GenerateChatOptions;
    expect(getOnAuthErrorHandlerFromOptions(options)).toBeUndefined();
  });
});
