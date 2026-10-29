/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createDumpcontextCommand } from './dumpcontextCommand.js';

describe('dumpcontext command mode validation', () => {
  it('returns an error for an invalid mode', async () => {
    const command = createDumpcontextCommand({
      dumpDirectory: '',
      readMode: () => 'off',
      writeMode: () => {},
      dumpNow: async () => ({
        type: 'message',
        messageType: 'info',
        content: '',
      }),
    });
    const result = await command.action?.(
      createMockCommandContext(),
      'invalid',
    );

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content:
        "Invalid mode 'invalid'. Valid modes are: now, status, on, error, off",
    });
  });
});
