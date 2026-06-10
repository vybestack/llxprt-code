/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
vi.mock('@vybestack/llxprt-code-auth', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@vybestack/llxprt-code-auth')
  >('@vybestack/llxprt-code-auth');
  return {
    ...actual,
    flushRuntimeAuthScope: vi.fn(),
  };
});

import { StreamProcessor } from './StreamProcessor.js';
import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-auth';

describe('StreamProcessor._handleBucketFailover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows single-bucket handlers to run tryFailover and flush auth scope', async () => {
    const tryFailover = vi.fn().mockResolvedValue(true);

    const processor = Object.create(
      StreamProcessor.prototype,
    ) as StreamProcessor;
    Object.assign(processor, {
      runtimeContext: {
        state: {
          runtimeId: 'state-runtime-1739',
        },
        providerRuntime: {
          runtimeId: 'provider-runtime-1739',
          config: {
            getBucketFailoverHandler: () => ({
              tryFailover,
              getCurrentBucket: () => 'default',
              isEnabled: () => false,
            }),
          },
        },
      },
      logger: {
        debug: vi.fn(),
      },
    });

    const result = await (
      processor as unknown as {
        _handleBucketFailover: () => Promise<boolean | null>;
      }
    )._handleBucketFailover();

    expect(result).toBe(true);
    expect(tryFailover).toHaveBeenCalledTimes(1);
    expect(flushRuntimeAuthScope).toHaveBeenCalledWith('provider-runtime-1739');
  });
});
