/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentClientContract as AgentClient } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  CompressionStatus,
  PerformCompressionResult,
} from '@vybestack/llxprt-code-core/core/turn.js';
import { compressCommand } from './compressCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import type { CommandContext } from './types.js';
import type {
  HistoryItemWithoutId,
  HistoryItemCompression,
  HistoryItemError,
} from '../types.js';

interface CapturedState {
  items: HistoryItemWithoutId[];
  pendingItems: Array<HistoryItemWithoutId | null>;
}

function setupCapturingContext(): {
  context: CommandContext;
  state: CapturedState;
} {
  const state: CapturedState = {
    items: [],
    pendingItems: [],
  };
  const base = createMockCommandContext();
  base.ui.addItem = ((item: HistoryItemWithoutId) => {
    state.items.push(item);
  }) as CommandContext['ui']['addItem'];
  base.ui.setPendingItem = ((item: HistoryItemWithoutId | null) => {
    state.pendingItems.push(item);
    base.ui.pendingItem = item;
  }) as CommandContext['ui']['setPendingItem'];
  return { context: base, state };
}

function findCompressionItem(
  items: HistoryItemWithoutId[],
): HistoryItemCompression | undefined {
  return items.find(
    (i): i is HistoryItemCompression => i.type === MessageType.COMPRESSION,
  );
}

function findErrorItem(
  items: HistoryItemWithoutId[],
): HistoryItemError | undefined {
  return items.find((i): i is HistoryItemError => i.type === MessageType.ERROR);
}

describe('compressCommand', () => {
  let context: CommandContext;
  let state: CapturedState;

  beforeEach(() => {
    ({ context, state } = setupCapturingContext());
  });

  it('returns already-compressing error when a compression request is pending', async () => {
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

    expect(state.items).toHaveLength(1);
    const errorItem = findErrorItem(state.items);
    expect(errorItem).toBeDefined();
    expect(errorItem!.text).toContain('Already compressing');
  });

  it('uses COMPRESSED when token count decreases after compression', async () => {
    const performCompression = async () => PerformCompressionResult.COMPRESSED;
    let tokenCall = 0;
    const getTotalTokens = () => {
      tokenCall++;
      return tokenCall === 1 ? 1200 : 800;
    };

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => false,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    expect(state.pendingItems[0]).toStrictEqual(
      expect.objectContaining({
        type: MessageType.COMPRESSION,
        compression: expect.objectContaining({ isPending: true }),
      }),
    );

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression).toStrictEqual({
      isPending: false,
      originalTokenCount: 1200,
      newTokenCount: 800,
      compressionStatus: CompressionStatus.COMPRESSED,
    });

    expect(state.pendingItems[state.pendingItems.length - 1]).toBeNull();
  });

  it('uses NOOP when token count is unchanged and compression did not run recently', async () => {
    const performCompression = async () =>
      PerformCompressionResult.SKIPPED_EMPTY;
    const getTotalTokens = () => 1000;

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => false,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.NOOP,
    );
  });

  it('uses NOOP when token count is unchanged, result is SKIPPED_EMPTY, and compression ran recently', async () => {
    const performCompression = async () =>
      PerformCompressionResult.SKIPPED_EMPTY;
    const getTotalTokens = () => 1000;

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => true,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.NOOP,
    );
  });

  it('shows unavailable-chat error when chat is not initialized', async () => {
    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => false,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const errorItem = findErrorItem(state.items);
    expect(errorItem).toBeDefined();
    expect(errorItem!.text).toBe(
      'Chat instance not available for compression.',
    );
    expect(state.pendingItems[state.pendingItems.length - 1]).toBeNull();
  });

  it('uses COMPRESSION_FAILED when all strategies fail (PerformCompressionResult.FAILED)', async () => {
    const performCompression = async () => PerformCompressionResult.FAILED;
    const getTotalTokens = () => 1000;

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => false,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('uses COMPRESSION_FAILED when compression is in cooldown (PerformCompressionResult.SKIPPED_COOLDOWN)', async () => {
    const performCompression = async () =>
      PerformCompressionResult.SKIPPED_COOLDOWN;
    const getTotalTokens = () => 1000;

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => false,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('uses ALREADY_COMPRESSED when core reports COMPRESSED but tokens did not decrease and compression was recent before command', async () => {
    const performCompression = async () => PerformCompressionResult.COMPRESSED;
    const getTotalTokens = () => 1000;

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => true,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.ALREADY_COMPRESSED,
    );
  });

  it('uses NOOP when core reports COMPRESSED but tokens did not decrease and compression was not recent before command', async () => {
    const performCompression = async () => PerformCompressionResult.COMPRESSED;
    const getTotalTokens = () => 1000;

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => false,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.NOOP,
    );
  });

  it('uses COMPRESSION_FAILED_INFLATED_TOKEN_COUNT when core reports COMPRESSED but token count increases', async () => {
    const performCompression = async () => PerformCompressionResult.COMPRESSED;
    let tokenCall = 0;
    const getTotalTokens = () => {
      tokenCall++;
      return tokenCall === 1 ? 1000 : 1200;
    };

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => true,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT,
    );
  });

  it('shows error when performCompression throws an exception', async () => {
    const performCompression = async () => {
      throw new Error('API connection refused');
    };
    const getTotalTokens = () => 1000;

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => false,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const errorItem = findErrorItem(state.items);
    expect(errorItem).toBeDefined();
    expect(errorItem!.text).toContain('Failed to compress chat history');
    expect(errorItem!.text).toContain('API connection refused');
    expect(state.pendingItems[state.pendingItems.length - 1]).toBeNull();
  });

  it('checks wasRecentlyCompressed when result is FAILED', async () => {
    let recentlyCompressedCalled = false;
    const performCompression = async () => PerformCompressionResult.FAILED;
    const getTotalTokens = () => 1000;

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => {
        recentlyCompressedCalled = true;
        return true;
      },
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    expect(recentlyCompressedCalled).toBe(true);
    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('checks wasRecentlyCompressed when result is SKIPPED_COOLDOWN', async () => {
    let recentlyCompressedCalled = false;
    const performCompression = async () =>
      PerformCompressionResult.SKIPPED_COOLDOWN;
    const getTotalTokens = () => 1000;

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => {
        recentlyCompressedCalled = true;
        return true;
      },
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    expect(recentlyCompressedCalled).toBe(true);
    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('uses COMPRESSION_FAILED when result is FAILED even if tokens decreased', async () => {
    const performCompression = async () => PerformCompressionResult.FAILED;
    let tokenCall = 0;
    const getTotalTokens = () => {
      tokenCall++;
      return tokenCall === 1 ? 1000 : 700;
    };

    const chat = {
      performCompression,
      getHistoryService: () => ({
        getTotalTokens,
      }),
      wasRecentlyCompressed: () => false,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('shows error when chat has no history service', async () => {
    let performCompressionCalled = false;
    const chat = {
      performCompression: async () => {
        performCompressionCalled = true;
        return PerformCompressionResult.COMPRESSED;
      },
      getHistoryService: () => null,
      wasRecentlyCompressed: () => false,
    };

    context.services.config = {
      getAgentClient: () =>
        ({
          hasChatInitialized: () => true,
          getChat: () => chat,
        }) as unknown as AgentClient,
    } as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    expect(performCompressionCalled).toBe(false);
    const errorItem = findErrorItem(state.items);
    expect(errorItem).toBeDefined();
    expect(errorItem!.text).toBe(
      'Chat instance not available for compression.',
    );
    expect(state.pendingItems[state.pendingItems.length - 1]).toBeNull();
  });
});
