/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { helpCommand } from './helpCommand';
import { type CommandContext } from './types.js';
import { MessageType } from '../types.js';

describe('helpCommand', () => {
  let mockContext: CommandContext;
  let mockAddItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAddItem = vi.fn();
    mockContext = {
      ui: {
        addItem: mockAddItem,
      },
    } as unknown as CommandContext;
  });

  it("should add a HELP history item for '/help'", async () => {
    if (!helpCommand.action) {
      throw new Error('Help command has no action');
    }
    await helpCommand.action(mockContext, '');

    expect(mockAddItem).toHaveBeenCalledTimes(1);
    const [historyItem, timestamp] = mockAddItem.mock.calls[0];
    expect(historyItem.type).toBe(MessageType.HELP);
    expect(historyItem.timestamp).toBeInstanceOf(Date);
    expect(typeof timestamp).toBe('number');
  });

  it("should also be triggered by its alternative name '?'", () => {
    // This test is more conceptual. The routing of altNames to the command
    // is handled by the slash command processor, but we can assert the
    // altNames is correctly defined on the command object itself.
    expect(helpCommand.altNames).toContain('?');
  });
});
