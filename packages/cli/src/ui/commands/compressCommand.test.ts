/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CompressionStatus,
  GeminiClient,
  PerformCompressionResult,
} from '@vybestack/llxprt-code-core';
import { compressCommand } from './compressCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import type { CommandContext } from './types.js';

describe('compressCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockCommandContext();
  });

  it('returns already-compressing error when a compression request is pending', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    context.ui.pendingItem = {
      type: MessageType.COMPRESSION,
      compression: {
        isPending: true,
        originalTokenCount: null,
        newTokenCount: null,
        compressionStatus: null,
      },
    };

    await compressCommand.action(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Already compressing, wait for previous request to complete',
      },
      expect.any(Number),
    );
  });

  it('uses COMPRESSED when token count decreases after compression', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.COMPRESSED);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1200)
      .mockReturnValueOnce(800);

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: vi.fn().mockReturnValue(false),
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(context.ui.setPendingItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({ isPending: true }),
      }),
    );

    expect(performCompression).toHaveBeenCalledTimes(1);
    expect(performCompression).toHaveBeenCalledWith(
      expect.stringMatching(/^compress-/),
    );
    expect(chat.wasRecentlyCompressed).toHaveBeenCalledTimes(1);

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: {
          isPending: false,
          originalTokenCount: 1200,
          newTokenCount: 800,
          compressionStatus: CompressionStatus.COMPRESSED,
        },
      }),
    );

    expect(context.ui.setPendingItem).toHaveBeenLastCalledWith(null);
  });

  it('uses NOOP when token count is unchanged and compression did not run recently', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.SKIPPED_EMPTY);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000);

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: vi.fn().mockReturnValue(false),
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(chat.wasRecentlyCompressed).toHaveBeenCalledTimes(1);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({
          compressionStatus: CompressionStatus.NOOP,
        }),
      }),
    );
  });

  it('uses NOOP when token count is unchanged, result is SKIPPED_EMPTY, and compression ran recently', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.SKIPPED_EMPTY);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000);

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: vi.fn().mockReturnValue(true),
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(chat.wasRecentlyCompressed).toHaveBeenCalledTimes(1);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({
          compressionStatus: CompressionStatus.NOOP,
        }),
      }),
    );
  });

  it('shows unavailable-chat error when chat is not initialized', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => false,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Chat instance not available for compression.',
      },
      expect.any(Number),
    );
    expect(context.ui.setPendingItem).toHaveBeenLastCalledWith(null);
  });

  it('uses COMPRESSION_FAILED when all strategies fail (PerformCompressionResult.FAILED)', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.FAILED);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000);

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: vi.fn().mockReturnValue(false),
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({
          compressionStatus: CompressionStatus.COMPRESSION_FAILED,
        }),
      }),
    );
  });

  it('uses COMPRESSION_FAILED when compression is in cooldown (PerformCompressionResult.SKIPPED_COOLDOWN)', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.SKIPPED_COOLDOWN);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000);

    const wasRecentlyCompressed = vi.fn().mockReturnValue(false);
    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed,
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(wasRecentlyCompressed).toHaveBeenCalledTimes(1);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({
          compressionStatus: CompressionStatus.COMPRESSION_FAILED,
        }),
      }),
    );
  });

  it('uses ALREADY_COMPRESSED when core reports COMPRESSED but tokens did not decrease and compression was recent before command', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.COMPRESSED);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000);

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: vi.fn().mockReturnValue(true),
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({
          compressionStatus: CompressionStatus.ALREADY_COMPRESSED,
        }),
      }),
    );
  });

  it('uses NOOP when core reports COMPRESSED but tokens did not decrease and compression was not recent before command', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.COMPRESSED);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000);

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: vi.fn().mockReturnValue(false),
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({
          compressionStatus: CompressionStatus.NOOP,
        }),
      }),
    );
  });

  it('shows error when performCompression throws an exception', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockRejectedValue(new Error('API connection refused'));
    const getTotalTokens = vi.fn().mockReturnValueOnce(1000);

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: vi.fn().mockReturnValue(false),
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(performCompression).toHaveBeenCalledTimes(1);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Failed to compress chat history: API connection refused',
      },
      expect.any(Number),
    );
    expect(context.ui.setPendingItem).toHaveBeenLastCalledWith(null);
  });

  it('checks wasRecentlyCompressed when result is FAILED', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.FAILED);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000);

    const wasRecentlyCompressed = vi.fn().mockReturnValue(true);
    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed,
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(wasRecentlyCompressed).toHaveBeenCalledTimes(1);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({
          compressionStatus: CompressionStatus.COMPRESSION_FAILED,
        }),
      }),
    );
  });

  it('checks wasRecentlyCompressed when result is SKIPPED_COOLDOWN', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.SKIPPED_COOLDOWN);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000);

    const wasRecentlyCompressed = vi.fn().mockReturnValue(true);
    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed,
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(wasRecentlyCompressed).toHaveBeenCalledTimes(1);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({
          compressionStatus: CompressionStatus.COMPRESSION_FAILED,
        }),
      }),
    );
  });

  it('uses COMPRESSION_FAILED when result is FAILED even if tokens decreased', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const performCompression = vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.FAILED);
    const getTotalTokens = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(700);

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: vi.fn().mockReturnValue(false),
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({
          compressionStatus: CompressionStatus.COMPRESSION_FAILED,
        }),
      }),
    );
  });

  it('shows error when chat has no history service', async () => {
    if (!compressCommand.action) {
      throw new Error('compressCommand must have an action.');
    }

    const chat = {
      performCompression: vi.fn(),
      getHistoryService: () => null,
      wasRecentlyCompressed: vi.fn().mockReturnValue(false),
    };

    context.services.config = {
      getGeminiClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as GeminiClient,
    } as CommandContext['services']['config'];

    await compressCommand.action(context, '');

    expect(chat.performCompression).not.toHaveBeenCalled();
    expect(context.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Chat instance not available for compression.',
      },
      expect.any(Number),
    );
    expect(context.ui.setPendingItem).toHaveBeenLastCalledWith(null);
  });
});
