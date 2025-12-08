/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { dumpcontextCommand } from './dumpcontextCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: vi.fn(() => ({
    getEphemeralSetting: vi.fn((key: string) => {
      if (key === 'dumpcontext') {
        return 'off';
      }
      return undefined;
    }),
    setEphemeralSetting: vi.fn(),
  })),
}));

import { getRuntimeApi } from '../contexts/RuntimeContext.js';

describe('dumpcontextCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockCommandContext();
  });

  describe('status subcommand', () => {
    it('should show current dumpcontext status when mode is off', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
      } as never);

      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'status');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: off'),
      });
    });

    it('should show current dumpcontext status when mode is on', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'on'),
        setEphemeralSetting: vi.fn(),
      } as never);

      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'status');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: on'),
      });
    });

    it('should default to status when no args provided', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'error'),
        setEphemeralSetting: vi.fn(),
      } as never);

      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: error'),
      });
    });
  });

  describe('on subcommand', () => {
    it('should enable context dumping for all requests', async () => {
      const mockSetEphemeralSetting = vi.fn();
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: mockSetEphemeralSetting,
      } as never);

      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'on');

      expect(mockSetEphemeralSetting).toHaveBeenCalledWith('dumpcontext', 'on');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping enabled'),
      });
    });
  });

  describe('error subcommand', () => {
    it('should enable context dumping only for errors', async () => {
      const mockSetEphemeralSetting = vi.fn();
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: mockSetEphemeralSetting,
      } as never);

      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'error');

      expect(mockSetEphemeralSetting).toHaveBeenCalledWith(
        'dumpcontext',
        'error',
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping enabled for errors'),
      });
    });
  });

  describe('off subcommand', () => {
    it('should disable context dumping', async () => {
      const mockSetEphemeralSetting = vi.fn();
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'on'),
        setEphemeralSetting: mockSetEphemeralSetting,
      } as never);

      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'off');

      expect(mockSetEphemeralSetting).toHaveBeenCalledWith(
        'dumpcontext',
        'off',
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping disabled'),
      });
    });
  });

  describe('now subcommand', () => {
    it('should return message indicating immediate dump', async () => {
      const mockSetEphemeralSetting = vi.fn();
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: mockSetEphemeralSetting,
      } as never);

      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'now');

      expect(mockSetEphemeralSetting).toHaveBeenCalledWith(
        'dumpcontext',
        'now',
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining(
          'Context will be dumped on next request',
        ),
      });
    });
  });

  describe('invalid subcommand', () => {
    it('should return error for invalid mode', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
      } as never);

      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'invalid');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Invalid mode'),
      });
    });
  });
});
