/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { disableMouseEvents, isMouseEventsActive } from '../utils/mouse.js';
import { mouseCommand } from './mouseCommand.js';

describe('mouseCommand', () => {
  const runMouseCommand = async (args: string) => {
    const action = mouseCommand.action;
    if (!action) {
      throw new Error('mouseCommand must have an action.');
    }

    return action(createMockCommandContext(), args);
  };

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    disableMouseEvents();
  });

  it('enables mouse events when called with "on"', async () => {
    const result = await runMouseCommand('on');

    expect(isMouseEventsActive()).toBe(true);
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
      }),
    );
  });

  it('disables mouse events when called with "off"', async () => {
    await runMouseCommand('on');

    const result = await runMouseCommand('off');

    expect(isMouseEventsActive()).toBe(false);
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
      }),
    );
  });

  it('toggles mouse events when called without args', async () => {
    const result = await runMouseCommand('');

    expect(isMouseEventsActive()).toBe(true);
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'info',
      }),
    );
  });

  it('rejects invalid arguments', async () => {
    const result = await runMouseCommand('maybe');

    expect(isMouseEventsActive()).toBe(false);
    expect(result).toEqual(
      expect.objectContaining({
        type: 'message',
        messageType: 'error',
      }),
    );
  });
});
