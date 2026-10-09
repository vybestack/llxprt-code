/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  suffixRow,
  withSuffixFixture,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createPerfCommand } from './perfCommand.js';
import { formatHistoryMemoryBreakdown } from './perfMemoryBreakdown.js';

for (const size of [512, 8192]) {
  describe(`/perf memory over ${size} journal rows`, () => {
    it('keeps the complete diagnostic text while reading one raw row at a time', async () => {
      await withSuffixFixture(size, async (history, ownership, counters) => {
        const expected = formatHistoryMemoryBreakdown(
          Array.from({ length: size }, (_, index) => suffixRow(index)),
        );
        const context = createMockCommandContext();
        if (context.services.config === null)
          throw new Error('Missing test config');
        context.services.config = Object.assign(context.services.config, {
          getAgentClient: () => ({ getHistoryService: () => history }),
        });
        const memory = createPerfCommand().subCommands?.find(
          (command) => command.name === 'memory',
        );
        if (memory?.action === undefined)
          throw new Error('Missing memory action');
        const result = await memory.action(context, '');
        expect(result).toMatchObject({ content: expected });
        expect(counters.snapshot().rowsDecoded).toBe(size);
        expect(ownership.snapshot().peakRows).toBe(1);
        expect(ownership.snapshot().liveRows).toBe(0);
      });
    }, 120_000);
  });
}
