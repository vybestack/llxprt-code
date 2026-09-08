/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { applyKimiCacheAffinity } from './kimiCacheAffinity.js';

describe('Kimi cache affinity', () => {
  it('adds one sanitized runtime key for a declared Kimi capability', () => {
    const request: Record<string, unknown> = {};

    applyKimiCacheAffinity(request, {
      providerName: 'kimi',
      runtimeId: `runtime-${'x'.repeat(100)}`,
      cacheAffinityKey: true,
    });

    expect(typeof request.prompt_cache_key).toBe('string');
    expect(String(request.prompt_cache_key).length).toBeLessThanOrEqual(64);
  });

  it('keeps the key stable across exact replay, append-only turns, and image removal', () => {
    const keys = [0, 1, 2].map(() => {
      const request: Record<string, unknown> = {};
      applyKimiCacheAffinity(request, {
        providerName: 'kimi',
        runtimeId: 'stable-runtime',
        cacheAffinityKey: true,
      });
      return request.prompt_cache_key;
    });

    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('stable-runtime');
  });

  it('changes the key when the runtime identity changes', () => {
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};

    applyKimiCacheAffinity(first, {
      providerName: 'kimi',
      runtimeId: 'runtime-a',
      cacheAffinityKey: true,
    });
    applyKimiCacheAffinity(second, {
      providerName: 'kimi',
      runtimeId: 'runtime-b',
      cacheAffinityKey: true,
    });

    expect(first.prompt_cache_key).not.toBe(second.prompt_cache_key);
  });

  it('preserves a caller-specified cache key', () => {
    const request: Record<string, unknown> = {
      prompt_cache_key: 'caller-key',
    };

    applyKimiCacheAffinity(request, {
      providerName: 'kimi',
      runtimeId: 'runtime-key',
      cacheAffinityKey: true,
    });

    expect(request.prompt_cache_key).toBe('caller-key');
  });

  it('does not infer support for an unknown provider or disabled capability', () => {
    const unknown: Record<string, unknown> = {};
    const disabled: Record<string, unknown> = {};

    applyKimiCacheAffinity(unknown, {
      providerName: 'custom-kimi-shaped-endpoint',
      runtimeId: 'runtime-key',
      cacheAffinityKey: true,
    });
    applyKimiCacheAffinity(disabled, {
      providerName: 'kimi',
      runtimeId: 'runtime-key',
      cacheAffinityKey: false,
    });

    expect(unknown.prompt_cache_key).toBeUndefined();
    expect(disabled.prompt_cache_key).toBeUndefined();
  });
});
