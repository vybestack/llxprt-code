/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import { replaceRowAt } from './__tests__/support/row-replacement.js';
import {
  FanoutHarness,
  rowText,
  textRow,
} from './__tests__/support/fanout-harness.js';

const harness = new FanoutHarness();

function toolCall(id: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id, name: 'tool', parameters: {} }],
  };
}

function toolResponse(id: string, result: string): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId: id, toolName: 'tool', result }],
  };
}

describe('journal writers keep every row with its owner', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  it('a tail removal reaches only the mirror that owned the removed row', async () => {
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    service.add(textRow('A1'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    service.add(textRow('A2'), undefined, ownerA);
    await service.waitForCommit();

    expect((await service.pop())?.blocks).toStrictEqual(textRow('A2').blocks);
    await service.waitForCommit();
    expect(await harness.replayed(a)).toStrictEqual(['seed', 'A1']);
    expect(await harness.replayed(b)).toStrictEqual(['seed', 'B1']);

    expect(await service.removeLastIfMatches(await lastRow(service))).toBe(
      true,
    );
    await service.waitForCommit();
    expect(await harness.replayed(a)).toStrictEqual(['seed', 'A1']);
    expect(await harness.replayed(b)).toStrictEqual(['seed']);
  });

  it('an undone tail removal puts the row back with its owner', async () => {
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    service.add(textRow('A1'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();
    let armed = true;
    service.on('tokensUpdated', () => {
      if (armed) throw new Error('removal failed');
    });

    await expect(service.pop()).rejects.toThrow('removal failed');
    armed = false;
    await service.waitForCommit();

    expect((await harness.shared(service)).map(rowText)).toStrictEqual([
      'seed',
      'A1',
      'B1',
    ]);
    expect(await harness.replayed(a)).toStrictEqual(['seed', 'A1']);
    expect(await harness.replayed(b)).toStrictEqual(['seed', 'B1']);
  });

  it('an undone clear puts every row back with its owner', async () => {
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    service.add(textRow('A1'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();
    let armed = true;
    service.on('tokensUpdated', () => {
      if (armed) throw new Error('clear observer failed');
    });

    await expect(service.clear()).rejects.toThrow('clear observer failed');
    armed = false;
    await service.waitForCommit();

    expect((await harness.shared(service)).map(rowText)).toStrictEqual([
      'seed',
      'A1',
      'B1',
    ]);
    expect(await harness.replayed(a)).toStrictEqual(['seed', 'A1']);
    expect(await harness.replayed(b)).toStrictEqual(['seed', 'B1']);
  });

  it('a clear reaches every mirror that held a row', async () => {
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    service.add(textRow('A1'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();

    await service.clear();
    await service.waitForCommit();

    expect(await harness.replayed(a)).toStrictEqual([]);
    expect(await harness.replayed(b)).toStrictEqual([]);
  });

  it('a rewritten tool response stays with the mirror that owns it', async () => {
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    service.add(toolCall('call-1'), undefined, ownerA);
    service.add(
      toolResponse('call-1', 'a very long result'),
      undefined,
      ownerA,
    );
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();

    await replaceRowAt(service, 2, {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'tool',
          result: 'short',
        },
      ],
    });
    await service.waitForCommit();

    const rowsA = await harness.replayedRows(a);
    expect(rowsA.map(rowText)).toStrictEqual([
      'seed',
      '<tool_call:call-1>',
      '<tool_response:call-1>',
    ]);
    expect(rowsA[2].blocks).toMatchObject([{ result: 'short' }]);
    expect(await harness.replayed(b)).toStrictEqual(['seed', 'B1']);
  });

  it('a repair row answering a tool call stays with the mirror that owns the call', async () => {
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    service.add(toolCall('call-9'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();

    await service.validateAndFix();
    await service.waitForCommit();

    expect((await harness.shared(service)).map(rowText)).toStrictEqual([
      'seed',
      '<tool_call:call-9>',
      '<tool_response:call-9>',
      'B1',
    ]);
    expect(await harness.replayed(a)).toStrictEqual([
      'seed',
      '<tool_call:call-9>',
      '<tool_response:call-9>',
    ]);
    expect(await harness.replayed(b)).toStrictEqual(['seed', 'B1']);
  });
});

async function lastRow(
  service: Parameters<FanoutHarness['shared']>[0],
): Promise<IContent> {
  const rows = await harness.shared(service);
  return rows[rows.length - 1];
}
