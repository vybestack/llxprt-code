/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  CompressionStatus,
  PerformCompressionResult,
} from '@vybestack/llxprt-code-core/core/turn.js';
import { createCompressCommand } from './compressCommand.js';
import { bindCompressCommand } from './compressCommandHost.js';
import {
  createMockCommandContext,
  type CommandOwnerFixture,
} from '../../__tests__/mockCommandContext.js';
import { MessageType } from '../types.js';
import type { SlashCommand } from './types.js';
import type {
  HistoryItemWithoutId,
  HistoryItemCompression,
  HistoryItemError,
} from '../types.js';

type CapturedItem = Parameters<CommandOwnerFixture['ui']['addItem']>[0];
type AgentCompress = Agent['compress'];
type AgentCompressionResult = Awaited<ReturnType<AgentCompress>>;

interface CapturedState {
  items: CapturedItem[];
  pendingItems: Array<HistoryItemWithoutId | null>;
}

function setupCapturingContext(): {
  context: CommandOwnerFixture;
  state: CapturedState;
} {
  const state: CapturedState = {
    items: [],
    pendingItems: [],
  };
  const base = createMockCommandContext();
  base.ui.addItem = (item): number => state.items.push(item);
  base.ui.setPendingItem = (item: HistoryItemWithoutId | null) => {
    state.pendingItems.push(item);
    base.ui.pendingItem = item;
  };
  return { context: base, state };
}

function findCompressionItem(
  items: CapturedItem[],
): HistoryItemCompression | undefined {
  return items.find(
    (i): i is HistoryItemCompression => i.type === MessageType.COMPRESSION,
  );
}

function findErrorItem(items: CapturedItem[]): HistoryItemError | undefined {
  return items.find((i): i is HistoryItemError => i.type === MessageType.ERROR);
}

/**
 * The result `Agent.compress` returns for one core compression outcome: the
 * detail always carries the counts and the pre-command recency; the public
 * counts of a compressed result are monotonic.
 */
function agentResult(
  raw: PerformCompressionResult,
  originalTokenCount: number,
  newTokenCount: number,
  wasRecentlyCompressed: boolean,
): AgentCompressionResult {
  const detail = {
    result: raw,
    originalTokenCount,
    newTokenCount,
    wasRecentlyCompressed,
  };
  if (raw === PerformCompressionResult.COMPRESSED)
    return {
      status: 'compressed',
      originalTokenCount: Math.max(originalTokenCount, newTokenCount),
      newTokenCount,
      promptId: 'compress',
      detail,
    };
  if (raw === PerformCompressionResult.NOOP)
    return { status: 'noop', promptId: 'compress', detail };
  return {
    status: raw === PerformCompressionResult.FAILED ? 'failed' : 'skipped',
    promptId: 'compress',
    detail,
  };
}

function commandFor(outcome: AgentCompressionResult): SlashCommand {
  return createCompressCommand(bindCompressCommand(async () => outcome));
}

describe('compression scenario conservation', () => {
  let context: CommandOwnerFixture;
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

    const command = createCompressCommand(bindCompressCommand(null));

    await command.action!(context, '');

    expect(state.items).toHaveLength(1);
    const errorItem = findErrorItem(state.items);
    expect(errorItem).toBeDefined();
    expect(errorItem!.text).toContain('Already compressing');
  });

  it('uses COMPRESSED when token count decreases after compression', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.COMPRESSED, 1200, 800, false),
    );

    await command.action!(context, '');

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
    const command = commandFor(
      agentResult(PerformCompressionResult.SKIPPED_EMPTY, 1000, 1000, false),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.NOOP,
    );
  });

  it('uses NOOP when token count is unchanged, result is SKIPPED_EMPTY, and compression ran recently', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.SKIPPED_EMPTY, 1000, 1000, true),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.NOOP,
    );
  });

  it('shows unavailable-chat error when chat is not initialized', async () => {
    const command = createCompressCommand(bindCompressCommand(null));

    await command.action!(context, '');

    const errorItem = findErrorItem(state.items);
    expect(errorItem).toBeDefined();
    expect(errorItem!.text).toBe(
      'Chat instance not available for compression.',
    );
    expect(state.pendingItems[state.pendingItems.length - 1]).toBeNull();
  });

  it('uses COMPRESSION_FAILED when all strategies fail (PerformCompressionResult.FAILED)', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.FAILED, 1000, 1000, false),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('uses COMPRESSION_FAILED when compression is in cooldown (PerformCompressionResult.SKIPPED_COOLDOWN)', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.SKIPPED_COOLDOWN, 1000, 1000, false),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('uses ALREADY_COMPRESSED when core reports COMPRESSED but tokens did not decrease and compression was recent before command', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.COMPRESSED, 1000, 1000, true),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.ALREADY_COMPRESSED,
    );
  });

  it('uses NOOP when core reports COMPRESSED but tokens did not decrease and compression was not recent before command', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.COMPRESSED, 1000, 1000, false),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.NOOP,
    );
  });

  it('uses COMPRESSION_FAILED_INFLATED_TOKEN_COUNT when core reports COMPRESSED but token count increases', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.COMPRESSED, 1000, 1200, true),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT,
    );
  });

  it('shows error when performCompression throws an exception', async () => {
    const command = createCompressCommand(
      bindCompressCommand(async () => {
        throw new Error('API connection refused');
      }),
    );

    await command.action!(context, '');

    const errorItem = findErrorItem(state.items);
    expect(errorItem).toBeDefined();
    expect(errorItem!.text).toContain('Failed to compress chat history');
    expect(errorItem!.text).toContain('API connection refused');
    expect(state.pendingItems[state.pendingItems.length - 1]).toBeNull();
  });

  it('checks wasRecentlyCompressed when result is FAILED', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.FAILED, 1000, 1000, true),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('checks wasRecentlyCompressed when result is SKIPPED_COOLDOWN', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.SKIPPED_COOLDOWN, 1000, 1000, true),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('uses COMPRESSION_FAILED when result is FAILED even if tokens decreased', async () => {
    const command = commandFor(
      agentResult(PerformCompressionResult.FAILED, 1000, 700, false),
    );

    await command.action!(context, '');

    const compressionItem = findCompressionItem(state.items);
    expect(compressionItem).toBeDefined();
    expect(compressionItem!.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSION_FAILED,
    );
  });

  it('shows error when chat has no history service', async () => {
    const command = createCompressCommand(
      bindCompressCommand(async () => {
        throw new Error('Chat instance not available for compression.');
      }),
    );

    await command.action!(context, '');

    const errorItem = findErrorItem(state.items);
    expect(errorItem).toBeDefined();
    expect(errorItem!.text).toBe(
      'Chat instance not available for compression.',
    );
    expect(state.pendingItems[state.pendingItems.length - 1]).toBeNull();
  });
});
