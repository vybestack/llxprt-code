/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'bun:test';
import { dumpcontextCommand } from './dumpcontextCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { captureStreamingDump } from './dumpcontext-test-helpers.js';

const actual = { ...(await import('@vybestack/llxprt-code-providers')) };
void vi.mock('@vybestack/llxprt-code-providers', () => ({
  ...actual,
  dumpRequestContextStream: (
    ...args: Parameters<typeof actual.dumpRequestContextStream>
  ) => captureStreamingDump(dumpRequestContext)(...args),
  dumpRequestContext: vi.fn().mockResolvedValue({
    baseId: '20260101-120000-anthropic-abc123',
    requestFilename: '20260101-120000-anthropic-abc123-request.json',
    dumpDir: '/tmp/.llxprt/dumps',
  }),
}));

import { dumpRequestContext } from '@vybestack/llxprt-code-providers';

const getRuntimeApi = vi.fn<() => Record<string, unknown>>(() => ({
  getSessionSetting: vi.fn((key: string) => {
    if (key === 'dumpcontext') {
      return 'off';
    }
    return undefined;
  }),
  setSessionSetting: vi.fn(),
}));
import { assertDefined } from '../../__tests__/assertions.js';

function createOwnedCommandContext(
  ...args: Parameters<typeof createMockCommandContext>
): CommandContext {
  const context = createMockCommandContext(...args);
  Object.defineProperty(context, 'runtimeApi', {
    configurable: true,
    get: () => getRuntimeApi(),
  });
  return context;
}

let mockContext: CommandContext;

describe('dumpcontextCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (dumpRequestContext as Mock<typeof dumpRequestContext>).mockResolvedValue({
      baseId: '20260101-120000-anthropic-abc123',
      requestFilename: '20260101-120000-anthropic-abc123-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });
    mockContext = createOwnedCommandContext();
  });
  registerStatusTests();
  registerOnTests();
  registerErrorTests();
  registerOffTests();
  registerInvalidTests();
});

function registerStatusTests(): void {
  describe('status subcommand', () => {
    it('should show current dumpcontext status when mode is off', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: vi.fn(),
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'status');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: off'),
      });
    });

    it('should show current dumpcontext status when mode is on', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'on'),
        setSessionSetting: vi.fn(),
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'status');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: on'),
      });
    });

    it('should default to status when no args provided', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'error'),
        setSessionSetting: vi.fn(),
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: error'),
      });
    });
  });
}

function registerOnTests(): void {
  describe('on subcommand', () => {
    it('should enable context dumping for all requests', async () => {
      const mockSetSessionSetting = vi.fn();
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: mockSetSessionSetting,
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'on');

      expect(mockSetSessionSetting).toHaveBeenCalledWith('dumpcontext', 'on');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping enabled'),
      });
    });
  });
}

function registerErrorTests(): void {
  describe('error subcommand', () => {
    it('should enable context dumping only for errors', async () => {
      const mockSetSessionSetting = vi.fn();
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: mockSetSessionSetting,
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'error');

      expect(mockSetSessionSetting).toHaveBeenCalledWith(
        'dumpcontext',
        'error',
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping enabled for errors'),
      });
    });
  });
}

function registerOffTests(): void {
  describe('off subcommand', () => {
    it('should disable context dumping', async () => {
      const mockSetSessionSetting = vi.fn();
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'on'),
        setSessionSetting: mockSetSessionSetting,
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'off');

      expect(mockSetSessionSetting).toHaveBeenCalledWith('dumpcontext', 'off');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping disabled'),
      });
    });
  });
}

function registerInvalidTests(): void {
  describe('invalid subcommand', () => {
    it('should return error for invalid mode', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: vi.fn(),
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'invalid');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Invalid mode'),
      });
    });
  });
}
