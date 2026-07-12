/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { StreamProcessor } from './StreamProcessor.js';

describe('StreamProcessor._handleBucketFailover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows single-bucket handlers to run tryFailover and flush auth scope', async () => {
    const tryFailover = vi.fn().mockResolvedValue(true);
    const flushAuthScope = vi.fn();

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
      flushAuthScope,
    });

    const result = await (
      processor as unknown as {
        _handleBucketFailover: () => Promise<boolean | null>;
      }
    )._handleBucketFailover();

    expect(result).toBe(true);
    expect(tryFailover).toHaveBeenCalledTimes(1);
    expect(flushAuthScope).toHaveBeenCalledWith('provider-runtime-1739');
  });
});
