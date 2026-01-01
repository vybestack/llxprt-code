/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { terminalRepairCommand } from './terminalRepairCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

describe('terminalRepairCommand', () => {
  let mockWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockWrite = vi.fn().mockReturnValue(true);
    vi.spyOn(process.stdout, 'write').mockImplementation(mockWrite);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(terminalRepairCommand.name).toBe('terminal-repair');
    expect(terminalRepairCommand.description).toContain('terminal');
    // Description should mention repair/Repair (case insensitive)
    expect(terminalRepairCommand.description.toLowerCase()).toContain('repair');
  });

  it('writes terminal contract sequences when executed', async () => {
    const context = createMockCommandContext();
    await terminalRepairCommand.action!(context, '');

    expect(mockWrite).toHaveBeenCalled();
    const writtenData = mockWrite.mock.calls
      .map((call: unknown[]) => call[0])
      .join('');

    // Should include bracketed paste
    expect(writtenData).toContain('\x1b[?2004h');

    // Should include focus tracking
    expect(writtenData).toContain('\x1b[?1004h');

    // Should include show cursor
    expect(writtenData).toContain('\x1b[?25h');

    // Note: Mouse sequences are only included if isMouseEventsActive() returns true.
    // In test context, mouse events are not active by default, so we don't assert them here.
    // The mouse re-enabling is tested separately in the terminalContract.test.ts
  });

  it('returns success message', async () => {
    const context = createMockCommandContext();
    const result = await terminalRepairCommand.action!(context, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('repaired'),
    });
  });

  it('emits resize event to trigger UI redraw', async () => {
    const emitSpy = vi.spyOn(process.stdout, 'emit');
    const context = createMockCommandContext();

    await terminalRepairCommand.action!(context, '');

    expect(emitSpy).toHaveBeenCalledWith('resize');
  });
});
