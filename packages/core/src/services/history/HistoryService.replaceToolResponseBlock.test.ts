/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from './HistoryService.js';
import type { IContent, ToolResponseBlock } from './IContent.js';

function makeToolResponseEntry(
  callId: string,
  toolName: string,
  result: unknown,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
      },
    ],
  };
}

function makeTextEntry(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

describe('HistoryService.replaceToolResponseBlock', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('replaces a tool_response block at the given entry/block indices', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'original'));
    await service.waitForTokenUpdates();

    const newBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'replaced',
    };

    const ok = await service.replaceToolResponseBlock(0, 0, newBlock);
    expect(ok).toBe(true);

    const raw = service.getRawHistory();
    expect(raw[0].blocks[0]).toBe(newBlock);
  });

  it('returns false for negative entry index', async () => {
    service.add(makeTextEntry('human', 'hello'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(-1, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false for non-integer entry index', async () => {
    service.add(makeTextEntry('human', 'hello'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0.5, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false for entry index beyond history length', async () => {
    service.add(makeTextEntry('human', 'hello'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(10, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false for negative block index', async () => {
    service.add(makeToolResponseEntry('call-1', 'tool', 'output'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, -1, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false for block index beyond blocks length', async () => {
    service.add(makeToolResponseEntry('call-1', 'tool', 'output'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, 10, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false on empty history', async () => {
    const ok = await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false when the target block is not a tool_response', async () => {
    service.add(makeTextEntry('human', 'hello'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false when the replacement callId does not match', async () => {
    service.add(makeToolResponseEntry('call-1', 'tool', 'output'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-MISMATCH',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false when the replacement toolName does not match', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'output'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'MISMATCH',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('recalculates total tokens after replacement', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)));
    await service.waitForTokenUpdates();
    const tokensBefore = service.getTotalTokens();

    await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'tiny',
    });
    await service.waitForTokenUpdates();

    expect(service.getTotalTokens()).toBeLessThan(tokensBefore);
  });

  it('does not mutate the original entry object', async () => {
    const entry = makeToolResponseEntry('call-1', 'read_file', 'original');
    service.add(entry);
    await service.waitForTokenUpdates();

    const originalBlocksRef = entry.blocks;
    await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'replaced',
    });

    expect(entry.blocks).toBe(originalBlocksRef);
    expect(entry.blocks[0]).toHaveProperty('result', 'original');
  });

  it('replaces a block at a multi-block entry correctly', async () => {
    const entry: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'tool-a',
          result: 'first',
        },
        {
          type: 'tool_response',
          callId: 'call-2',
          toolName: 'tool-b',
          result: 'second',
        },
      ],
    };
    service.add(entry);
    await service.waitForTokenUpdates();

    const newBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-2',
      toolName: 'tool-b',
      result: 'replaced-second',
    };
    const ok = await service.replaceToolResponseBlock(0, 1, newBlock);
    expect(ok).toBe(true);

    const raw = service.getRawHistory();
    expect(raw[0].blocks[0]).toStrictEqual({
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool-a',
      result: 'first',
    });
    expect(raw[0].blocks[1]).toBe(newBlock);
  });

  it('replaces a block at a later entry index', async () => {
    service.add(makeTextEntry('human', 'first turn'));
    service.add(makeToolResponseEntry('call-1', 'tool', 'output'));
    await service.waitForTokenUpdates();

    const newBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'truncated',
    };
    const ok = await service.replaceToolResponseBlock(1, 0, newBlock);
    expect(ok).toBe(true);

    const raw = service.getRawHistory();
    expect(raw[1].blocks[0]).toBe(newBlock);
    expect(raw[0].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'first turn',
    });
  });

  it('accepts a model name for token recalculation', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)));
    await service.waitForTokenUpdates();
    const tokensBefore = service.getTotalTokens();

    await service.replaceToolResponseBlock(
      0,
      0,
      {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'read_file',
        result: 'tiny',
      },
      'gpt-4.1',
    );
    await service.waitForTokenUpdates();

    expect(service.getTotalTokens()).toBeLessThan(tokensBefore);
  });

  it('returns false when the replacement lacks a type field despite matching callId/toolName', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'output'));
    await service.waitForTokenUpdates();

    const malformed = {
      callId: 'call-1',
      toolName: 'read_file',
      result: 'x',
    } as unknown as ToolResponseBlock;

    const ok = await service.replaceToolResponseBlock(0, 0, malformed);
    expect(ok).toBe(false);

    const raw = service.getRawHistory();
    const block = raw[0].blocks[0] as ToolResponseBlock;
    expect(block.result).toBe('output');
  });

  it('returns false when the replacement has wrong type despite matching callId/toolName', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'output'));
    await service.waitForTokenUpdates();

    const malformed = {
      type: 'text',
      text: 'not a tool response',
      callId: 'call-1',
      toolName: 'read_file',
    } as unknown as ToolResponseBlock;

    const ok = await service.replaceToolResponseBlock(0, 0, malformed);
    expect(ok).toBe(false);

    const raw = service.getRawHistory();
    const block = raw[0].blocks[0] as ToolResponseBlock;
    expect(block.type).toBe('tool_response');
    expect(block.result).toBe('output');
  });

  it('rolls back BOTH history and token accounting when recalculation throws', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)));
    await service.waitForTokenUpdates();
    const tokensBefore = service.getTotalTokens();
    expect(tokensBefore).toBeGreaterThan(0);

    // Force recalculateTotalTokens to reject by attaching a listener that
    // throws during the tokensUpdated event emitted by recalc.
    service.on('tokensUpdated', () => {
      throw new Error('listener failure');
    });

    const replacement: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'should not persist',
    };

    await expect(
      service.replaceToolResponseBlock(0, 0, replacement),
    ).rejects.toThrow('listener failure');

    // Invariant 1: history is restored to the original block.
    const raw = service.getRawHistory();
    const block = raw[0].blocks[0] as ToolResponseBlock;
    expect(block.result).toBe('x'.repeat(4000));

    // Invariant 2: token accounting is restored to the pre-replacement value.
    // Without this, the token budget would silently reflect the discarded
    // replacement content, corrupting downstream compression/threshold logic.
    expect(service.getTotalTokens()).toBe(tokensBefore);
  });
});
