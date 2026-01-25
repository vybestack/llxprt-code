/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CompressionStatus, GeminiClient } from '@vybestack/llxprt-code-core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { compressCommand } from './compressCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';

describe('compressCommand', () => {
  let context: ReturnType<typeof createMockCommandContext>;
  let mockPerformCompression: ReturnType<typeof vi.fn>;
  let mockGetHistoryService: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPerformCompression = vi.fn();
    mockGetHistoryService = vi.fn();
    context = createMockCommandContext({
      services: {
        config: {
          getGeminiClient: () =>
            ({
              getChat: () => ({
                performCompression: mockPerformCompression,
                getHistoryService: mockGetHistoryService,
              }),
            }) as unknown as GeminiClient,
        },
      },
    });
  });

  it('should do nothing if a compression is already pending', async () => {
    context.ui.pendingItem = {
      type: MessageType.COMPRESSION,
      compression: {
        isPending: true,
        originalTokenCount: null,
        newTokenCount: null,
        compressionStatus: null,
      },
    };
    await compressCommand.action!(context, '');
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: 'Already compressing, wait for previous request to complete',
      }),
      expect.any(Number),
    );
    expect(context.ui.setPendingItem).not.toHaveBeenCalled();
    expect(mockPerformCompression).not.toHaveBeenCalled();
  });

  it('should set pending item, call performCompression, and add result on success', async () => {
    const mockHistoryService = {
      getTotalTokens: vi.fn().mockReturnValueOnce(200).mockReturnValueOnce(100),
    };
    mockGetHistoryService.mockReturnValue(mockHistoryService);
    mockPerformCompression.mockResolvedValue(undefined);

    await compressCommand.action!(context, '');

    expect(context.ui.setPendingItem).toHaveBeenNthCalledWith(1, {
      type: MessageType.COMPRESSION,
      compression: {
        isPending: true,
        compressionStatus: null,
        originalTokenCount: null,
        newTokenCount: null,
      },
    });

    expect(mockPerformCompression).toHaveBeenCalledWith(
      expect.stringMatching(/^compress-\d+$/),
    );

    expect(context.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.COMPRESSION,
        compression: {
          isPending: false,
          compressionStatus: CompressionStatus.COMPRESSED,
          originalTokenCount: 200,
          newTokenCount: 100,
        },
      },
      expect.any(Number),
    );

    expect(context.ui.setPendingItem).toHaveBeenNthCalledWith(2, null);
  });

  it('should add an error message if performCompression throws', async () => {
    const error = new Error('Compression failed');
    mockPerformCompression.mockRejectedValue(error);

    await compressCommand.action!(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: `Failed to compress chat history: ${error.message}`,
      }),
      expect.any(Number),
    );
    expect(context.ui.setPendingItem).toHaveBeenCalledWith(null);
  });

  it('should add an error message if chat instance is unavailable', async () => {
    context = createMockCommandContext({
      services: {
        config: {
          getGeminiClient: () =>
            ({
              getChat: () => undefined,
            }) as unknown as GeminiClient,
        },
      },
    });

    await compressCommand.action!(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: 'Chat instance not available for compression.',
      }),
      expect.any(Number),
    );
    expect(context.ui.setPendingItem).toHaveBeenCalledWith(null);
  });

  it('should clear the pending item in a finally block', async () => {
    mockPerformCompression.mockRejectedValue(new Error('some error'));
    await compressCommand.action!(context, '');
    expect(context.ui.setPendingItem).toHaveBeenCalledWith(null);
  });
});
