/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from './types.js';
import { setCommand } from './setCommand.js';

const mockRuntime = {
  getActiveModelParams: vi.fn(() => ({})),
  getEphemeralSettings: vi.fn(() => ({})),
  setEphemeralSetting: vi.fn(),
  setActiveModelParam: vi.fn(),
  clearActiveModelParam: vi.fn(),
};

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => mockRuntime,
}));

describe('setCommand user-agent ephemeral', () => {
  let context: CommandContext;

  beforeEach(() => {
    context = createMockCommandContext();
    vi.clearAllMocks();
  });

  it('stores user-agent as a string', async () => {
    const result = await setCommand.action!(context, 'user-agent RooCode/1.0');

    expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
      'user-agent',
      'RooCode/1.0',
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Ephemeral setting \'user-agent\' set to "RooCode/1.0" (session only, use /profile save to persist)',
    });
  });
});
