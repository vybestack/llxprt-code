/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { RETRY_REQUEST_CONTEXT_KEY } from '../transportAttemptBudget.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import { rowsSelection } from './support/wireBodyCapture.js';
import {
  anthropicJournalSink,
  sendAnthropicJournalCase,
} from './support/anthropic-journal-case.js';

const rows: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'continue 雪 🐈' }] },
  {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'call_lookup', name: 'lookup', parameters: {} },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_lookup',
        toolName: 'lookup',
        result: 'no images remain',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'finish' }] },
];

describe('native Anthropic retained recovery budgets without media', () => {
  it.each([{ maxDimension: 2000 }, { maxDimension: 2000, maxPixels: 1000000 }])(
    'sends the builder bytes without request files under %j',
    async (recoveryBudget) => {
      const sink = await anthropicJournalSink();
      const fixture = await journalSendFixture(rows, [], {
        directory: `${import.meta.dir}/../../../../tmp/anthropic-cases/fixtures`,
      });
      const overrides = {
        metadata: {
          [RETRY_REQUEST_CONTEXT_KEY]: {
            anthropicImageRecovery: { recoveryUsed: true, recoveryBudget },
          },
        },
      };
      try {
        await sendAnthropicJournalCase(
          sink.route,
          rowsSelection(await normalizedRows(rows)),
          overrides,
        );
        const created = await operationFileCreates(async () => {
          await sendAnthropicJournalCase(
            sink.route,
            fixture.selection,
            overrides,
          );
        }, true);
        expect(sink.requests).toHaveLength(2);
        expect(sink.requests[1]).toStrictEqual(sink.requests[0]);
        expect(sink.requests[1].length).toBe(
          String(Buffer.byteLength(sink.requests[1].body)),
        );
        expect(created).toStrictEqual({ files: [], directories: [] });
      } finally {
        await fixture.close();
        await sink.close();
      }
    },
  );
  it('applies retained recovery to a pending image without persisted media', async () => {
    const png = Buffer.alloc(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(3000, 16);
    png.writeUInt32BE(3000, 20);
    const pending: IContent = {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'look' },
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: png.toString('base64'),
        },
      ],
    };
    const sink = await anthropicJournalSink();
    const fixture = await journalSendFixture([], [pending], {
      directory: `${import.meta.dir}/../../../../tmp/anthropic-media2/fixtures`,
    });
    const overrides = {
      metadata: {
        [RETRY_REQUEST_CONTEXT_KEY]: {
          anthropicImageRecovery: {
            recoveryUsed: true,
            recoveryBudget: { maxDimension: 2000 },
          },
        },
      },
    };
    try {
      await sendAnthropicJournalCase(
        sink.route,
        rowsSelection([pending]),
        overrides,
      );
      await sendAnthropicJournalCase(sink.route, fixture.selection, overrides);
      expect(sink.requests).toHaveLength(2);
      expect(sink.requests[1]).toStrictEqual(sink.requests[0]);
      expect(sink.requests[1].length).toBe(
        String(Buffer.byteLength(sink.requests[1].body)),
      );
      expect(sink.requests[1].body).toContain('Image dropped');
      expect(sink.requests[1].body).not.toContain(png.toString('base64'));
    } finally {
      await fixture.close();
      await sink.close();
    }
  });
});
