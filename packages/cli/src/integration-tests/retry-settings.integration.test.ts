/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setCommand } from '../ui/commands/setCommand.js';
import { createMockCommandContext } from '../test-utils/mockCommandContext.js';
import type { CommandContext } from '../ui/commands/types.js';
import type { Config } from '@vybestack/llxprt-code-core';

describe('retry settings integration tests', () => {
  let context: CommandContext;

  beforeEach(() => {
    const mockConfig = {
      setEphemeralSetting: vi.fn(),
    } as unknown as Config;

    context = createMockCommandContext({
      services: {
        config: mockConfig,
      },
    });
  });

  it('should set retries as ephemeral setting', async () => {
    const result = await setCommand.action!(context, 'retries 3');

    expect(context.services.config?.setEphemeralSetting).toHaveBeenCalledWith(
      'retries',
      3,
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Ephemeral setting 'retries' set to 3 (session only, use /profile save to persist)",
    });
  });

  it('should set retrywait as ephemeral setting', async () => {
    const result = await setCommand.action!(context, 'retrywait 10000');

    expect(context.services.config?.setEphemeralSetting).toHaveBeenCalledWith(
      'retrywait',
      10000,
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Ephemeral setting 'retrywait' set to 10000 (session only, use /profile save to persist)",
    });
  });

  it('should validate retries setting', async () => {
    const result = await setCommand.action!(context, 'retries -1');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'retries must be a non-negative integer (e.g., 3)',
    });
  });

  it('should validate retrywait setting', async () => {
    const result = await setCommand.action!(context, 'retrywait 0');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'retrywait must be a positive integer in milliseconds (e.g., 5000 for 5 seconds)',
    });
  });
});
