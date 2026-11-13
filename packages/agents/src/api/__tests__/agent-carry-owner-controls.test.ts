/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  carryBounds,
  carryFixtureBytes,
  recordCarry,
  withAgentCarry,
} from './helpers/agent-carry-fixture.js';

async function retainingControl(
  size: number,
  copy: boolean,
  bytes = 32 * 1024,
): Promise<number> {
  return withAgentCarry(
    size,
    async (agent, replacement) => {
      await agent.setModel('retaining-carried-model');
      const output = new RowOwnership();
      const retained: IContent[] = [];
      try {
        for await (const row of agent.streamHistory()) {
          const owned = copy ? { ...row, blocks: [...row.blocks] } : row;
          output.retain(owned);
          retained.push(owned);
        }
        recordCarry({
          size,
          copy,
          fixture: carryFixtureBytes(size, bytes),
          allowance: carryBounds,
          deliberatelyRetainedOutput: output.snapshot(),
          reader: replacement().owners.snapshot(),
        });
        expect(output.snapshot().liveRows).toBe(size);
        expect(output.snapshot().peakRows).toBeGreaterThan(carryBounds.rows);
        expect(
          output.snapshot().peakSerializedBytes > carryBounds.serializedBytes,
        ).toBe(true);
        if (bytes === 32 * 1024)
          expect(output.snapshot().peakSerializedBytes).toBeGreaterThan(
            8 * 1024 * 1024,
          );
        expect(output.snapshot().peakSerializedBytes).toBeGreaterThan(
          3 * carryBounds.serializedBytes,
        );
        expect(output.within(carryBounds)).toBe(
          process.env.AGENT_CARRY_RETAINING_TRAP === '1',
        );
      } finally {
        for (const row of retained) output.release(row);
        retained.length = 0;
      }
      expect(output.snapshot().liveRows).toBe(0);
      expect(replacement().owners.snapshot().liveRows).toBe(0);
      return output.snapshot().peakRows;
    },
    bytes,
  );
}

for (const size of [512]) {
  describe(`carried public output retention controls at ${size}`, () => {
    it.each([false, true])(
      'charges the full %s copy output recipient and rejects aggregate retention',
      async (copy) => {
        expect(await retainingControl(size, copy)).toBe(size);
      },
      180000,
    );
  });
}

describe('carry ownership controls on the passing stream fixture', () => {
  it.each([false, true])(
    'rejects retaining the same 65 realistic rows, copy=%s',
    async (copy) => {
      expect(await retainingControl(65, copy, 2048)).toBe(65);
    },
    180000,
  );
});
