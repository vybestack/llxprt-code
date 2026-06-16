/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';

const mockTokenLimit = vi.hoisted(() =>
  vi.fn(
    (_model: string, userContextLimit?: number) =>
      userContextLimit ?? 1_000_000,
  ),
);

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return { ...actual, tokenLimit: mockTokenLimit };
});

describe('useStreamEventHandlers context-limit helpers', () => {
  beforeEach(() => {
    mockTokenLimit.mockImplementation(
      (_model: string, userContextLimit?: number) =>
        userContextLimit ?? 1_000_000,
    );
  });

  it('uses configured context-limit for overflow guidance token limits', async () => {
    const { getTokenLimitForConfiguredContext } = await import(
      '../useStreamEventHandlers.js'
    );
    const configWithContextLimit = {
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getEphemeralSetting: vi.fn((key: string) => {
        if (key === 'context-limit') {
          return 200_000;
        }
        return undefined;
      }),
    } as unknown as Config;

    getTokenLimitForConfiguredContext(configWithContextLimit);

    expect(mockTokenLimit).toHaveBeenCalledWith('gemini-2.5-pro', 200_000);
  });
});
