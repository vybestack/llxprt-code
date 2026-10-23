/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { beforeEach, describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { CompressionStatus } from '@vybestack/llxprt-code-core/core/turn.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { MessageType } from '../types.js';
import type {
  HistoryItemCompression,
  HistoryItemError,
  HistoryItemWithoutId,
} from '../types.js';
import { bindCompressCommand } from './compressCommandHost.js';
import {
  createCompressCommand,
  makePendingCompression,
} from './compressCommand.js';
import type { SlashCommand } from './types.js';

type AgentCompressionResult = Awaited<ReturnType<Agent['compress']>>;

interface CapturedState {
  readonly items: HistoryItemWithoutId[];
  readonly pendingItems: Array<HistoryItemWithoutId | null>;
}

function setupCapturingContext(): {
  context: CommandOwnerFixture;
  state: CapturedState;
} {
  const state: CapturedState = { items: [], pendingItems: [] };
  const base = createMockCommandContext();
  base.ui.addItem = ((item: HistoryItemWithoutId) => {
    state.items.push(item);
  }) as CommandOwnerFixture['ui']['addItem'];
  base.ui.setPendingItem = ((item: HistoryItemWithoutId | null) => {
    state.pendingItems.push(item);
    base.ui.pendingItem = item;
  }) as CommandOwnerFixture['ui']['setPendingItem'];
  return { context: base, state };
}

function commandFor(result: AgentCompressionResult): SlashCommand {
  return createCompressCommand(bindCompressCommand(async () => result));
}

function findCompressionItem(
  items: readonly HistoryItemWithoutId[],
): HistoryItemCompression | undefined {
  return items.find(
    (item): item is HistoryItemCompression =>
      item.type === MessageType.COMPRESSION,
  );
}

function findErrorItem(
  items: readonly HistoryItemWithoutId[],
): HistoryItemError | undefined {
  return items.find(
    (item): item is HistoryItemError => item.type === MessageType.ERROR,
  );
}

describe('compress command', () => {
  let context: CommandOwnerFixture;
  let state: CapturedState;

  beforeEach(() => {
    ({ context, state } = setupCapturingContext());
  });

  it('reports an error when a compression request is already pending', async () => {
    context.ui.pendingItem = makePendingCompression();
    const command = createCompressCommand(async () => {
      throw new Error(
        'compression should not start while another request is pending',
      );
    });

    await command.action!(context, '');

    expect(state.items).toHaveLength(1);
    expect(findErrorItem(state.items)?.text).toContain('Already compressing');
    expect(state.pendingItems).toHaveLength(0);
    expect(state.pendingItems.at(-1)).toBeUndefined();
  });

  it('maps a compressed result with fewer tokens to COMPRESSED', async () => {
    const command = commandFor({
      status: 'compressed',
      originalTokenCount: 1200,
      newTokenCount: 800,
    });

    await command.action!(context, '');

    const item = findCompressionItem(state.items);
    expect(item).toBeDefined();
    expect(item?.compression.isPending).toBe(false);
    expect(item?.compression.originalTokenCount).toBe(1200);
    expect(item?.compression.newTokenCount).toBe(800);
    expect(item?.compression.compressionStatus).toBe(
      CompressionStatus.COMPRESSED,
    );
    expect(state.pendingItems[0]?.type).toBe(MessageType.COMPRESSION);
    expect(state.pendingItems.at(-1)).toBeNull();
  });

  it('maps an unchanged compressed result to NOOP', async () => {
    const command = commandFor({
      status: 'compressed',
      originalTokenCount: 1000,
      newTokenCount: 1000,
    });

    await command.action!(context, '');

    expect(
      findCompressionItem(state.items)?.compression.compressionStatus,
    ).toBe(CompressionStatus.NOOP);
    expect(
      findCompressionItem(state.items)?.compression.originalTokenCount,
    ).toBe(1000);
    expect(findCompressionItem(state.items)?.compression.newTokenCount).toBe(
      1000,
    );
  });

  it('maps a larger compressed result to the inflated-token failure', async () => {
    const command = commandFor({
      status: 'compressed',
      originalTokenCount: 1000,
      newTokenCount: 1200,
    });

    await command.action!(context, '');

    expect(
      findCompressionItem(state.items)?.compression.compressionStatus,
    ).toBe(CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT);
    expect(
      findCompressionItem(state.items)?.compression.originalTokenCount,
    ).toBe(1000);
    expect(findCompressionItem(state.items)?.compression.newTokenCount).toBe(
      1200,
    );
  });

  it('maps an explicit noop result to NOOP', async () => {
    const command = commandFor({ status: 'noop' });

    await command.action!(context, '');

    expect(
      findCompressionItem(state.items)?.compression.compressionStatus,
    ).toBe(CompressionStatus.NOOP);
    expect(state.pendingItems.at(-1)).toBeNull();
  });

  it('maps a skipped result to NOOP', async () => {
    const command = commandFor({ status: 'skipped' });

    await command.action!(context, '');

    expect(
      findCompressionItem(state.items)?.compression.compressionStatus,
    ).toBe(CompressionStatus.NOOP);
    expect(
      findCompressionItem(state.items)?.compression.originalTokenCount,
    ).toBeNull();
  });

  it('maps a failed result to COMPRESSION_FAILED', async () => {
    const command = commandFor({ status: 'failed' });

    await command.action!(context, '');

    expect(
      findCompressionItem(state.items)?.compression.compressionStatus,
    ).toBe(CompressionStatus.COMPRESSION_FAILED);
    expect(
      findCompressionItem(state.items)?.compression.newTokenCount,
    ).toBeNull();
  });

  it('keeps a failed status when token counts decreased', async () => {
    const command = commandFor({
      status: 'failed',
      originalTokenCount: 1200,
      newTokenCount: 800,
    });

    await command.action!(context, '');

    expect(
      findCompressionItem(state.items)?.compression.compressionStatus,
    ).toBe(CompressionStatus.COMPRESSION_FAILED);
    expect(
      findCompressionItem(state.items)?.compression.originalTokenCount,
    ).toBe(1200);
    expect(findCompressionItem(state.items)?.compression.newTokenCount).toBe(
      800,
    );
  });

  it('maps missing token counts on a compressed result to NOOP', async () => {
    const command = commandFor({ status: 'compressed' });

    await command.action!(context, '');

    expect(
      findCompressionItem(state.items)?.compression.compressionStatus,
    ).toBe(CompressionStatus.NOOP);
    expect(
      findCompressionItem(state.items)?.compression.originalTokenCount,
    ).toBeNull();
  });

  it('maps an incomplete token-count pair to NOOP', async () => {
    const command = commandFor({
      status: 'compressed',
      originalTokenCount: 900,
    });

    await command.action!(context, '');

    expect(
      findCompressionItem(state.items)?.compression.compressionStatus,
    ).toBe(CompressionStatus.NOOP);
    expect(
      findCompressionItem(state.items)?.compression.originalTokenCount,
    ).toBe(900);
    expect(
      findCompressionItem(state.items)?.compression.newTokenCount,
    ).toBeNull();
  });

  it('keeps a complete count pair when the new count is absent', async () => {
    const command = commandFor({
      status: 'compressed',
      newTokenCount: 700,
    });

    await command.action!(context, '');

    expect(
      findCompressionItem(state.items)?.compression.compressionStatus,
    ).toBe(CompressionStatus.NOOP);
    expect(
      findCompressionItem(state.items)?.compression.originalTokenCount,
    ).toBeNull();
    expect(findCompressionItem(state.items)?.compression.newTokenCount).toBe(
      700,
    );
  });

  it('reports the missing registered Agent when no compression owner is bound', async () => {
    const command = createCompressCommand(bindCompressCommand(null));

    await command.action!(context, '');

    expect(findErrorItem(state.items)?.text).toBe(
      'Chat instance not available for compression.',
    );
    expect(state.pendingItems[0]?.type).toBe(MessageType.COMPRESSION);
    expect(state.pendingItems.at(-1)).toBeNull();
  });

  it('converts a rejected compression operation into a UI error', async () => {
    const command = createCompressCommand(async () => {
      throw new Error('provider rejected compression');
    });

    await command.action!(context, '');

    expect(findErrorItem(state.items)?.text).toBe(
      'Failed to compress chat history: provider rejected compression',
    );
    expect(state.pendingItems[0]?.type).toBe(MessageType.COMPRESSION);
    expect(state.pendingItems.at(-1)).toBeNull();
  });

  it('renders non-Error rejection values in the UI error', async () => {
    const command = createCompressCommand(() =>
      Promise.reject('provider unavailable'),
    );

    await command.action!(context, '');

    expect(findErrorItem(state.items)?.text).toBe(
      'Failed to compress chat history: provider unavailable',
    );
    expect(state.items).toHaveLength(1);
    expect(state.pendingItems.at(-1)).toBeNull();
  });

  it('does not wrap the missing-chat error with the generic compression prefix', async () => {
    const command = createCompressCommand(async () => {
      throw new Error('Chat instance not available for compression.');
    });

    await command.action!(context, '');

    expect(findErrorItem(state.items)?.text).toBe(
      'Chat instance not available for compression.',
    );
    expect(state.items).toHaveLength(1);
    expect(state.pendingItems[0]?.type).toBe(MessageType.COMPRESSION);
    expect(state.pendingItems.at(-1)).toBeNull();
  });
});
