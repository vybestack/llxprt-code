/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import { getTokenLimitForConfiguredContext } from '../contextLimit.js';

/**
 * The overflow-guidance token-limit helper delegates to the shared resolver in
 * @vybestack/llxprt-code-agents (single source of truth for the
 * user-override → provider-limit → model-name precedence, issue #2251).
 * These tests assert the real resolved value through the thin cli wrapper.
 */
describe('contextLimit helper (cli wrapper)', () => {
  it('resolves the configured context-limit for the overflow guidance token limit', () => {
    const configWithContextLimit = {
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getEphemeralSetting: vi.fn((key: string) =>
        key === 'context-limit' ? 200_000 : undefined,
      ),
    } as unknown as Config;

    const limit = getTokenLimitForConfiguredContext(configWithContextLimit);

    expect(limit).toBe(200_000);
  });

  it('falls back to the model-name window when no context-limit is configured', () => {
    // gpt-4o resolves to a 128K window, distinct from DEFAULT_TOKEN_LIMIT (1M),
    // so the model-lookup path is genuinely exercised.
    const configWithoutLimit = {
      getModel: vi.fn(() => 'gpt-4o'),
      getEphemeralSetting: vi.fn(() => undefined),
    } as unknown as Config;

    const limit = getTokenLimitForConfiguredContext(configWithoutLimit);

    expect(limit).toBe(128_000);
  });
});
