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

  it('allows single-bucket handlers to run tryFailover', async () => {
    const tryFailover = vi.fn().mockResolvedValue(true);
    const controller = new AbortController();

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
          tryBucketFailover: tryFailover,
          readCurrentBucket: () => 'default',
        },
      },
      logger: {
        debug: vi.fn(),
      },
    });

    const result = await (
      processor as unknown as {
        _handleBucketFailover: (signal: AbortSignal) => Promise<boolean | null>;
      }
    )._handleBucketFailover(controller.signal);

    expect(result).toBe(true);
    expect(tryFailover).toHaveBeenCalledWith({ signal: controller.signal });
  });
});
