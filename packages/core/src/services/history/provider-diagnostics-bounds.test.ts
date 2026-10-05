/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ConfigurationManager } from '@vybestack/llxprt-code-telemetry/debug/ConfigurationManager.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { DebugLogger } from '../../debug/index.js';
import { buildCuratedHistory } from './historyCuration.js';
import { buildProviderContent } from './historyProviderPipeline.js';
const oracleLogger = new DebugLogger('llxprt:history:service');
import {
  DiagnosticsCursorHistory,
  captureEagerDiagnostics,
  manyBlocksRow,
  providerDigest,
  useDiagnosticSink,
} from './provider-diagnostics-test-helpers.js';

function reconstructedRow(): IContent {
  return {
    speaker: 'tool',
    blocks: Array.from({ length: 8192 }, (_, i) => ({
      type: 'tool_response',
      callId: `lost-${i}`,
      toolName: 'lost',
      result: 'PRIVATE_RESULT',
    })),
  };
}

describe('bounded diagnostic payloads', () => {
  const take = useDiagnosticSink();
  it.each(['eager', 'stream'])(
    'caps AI analysis details without retaining row payloads in %s logs',
    async (route) => {
      const history = new DiagnosticsCursorHistory();
      const eager = new HistoryService();
      const input = [manyBlocksRow()];
      try {
        await providerDigest(
          route === 'eager'
            ? buildProviderContent(
                buildCuratedHistory(oracleLogger, input, false),
                [],
                oracleLogger,
              )
            : history.getCuratedForProviderStream([], undefined, input),
        );
        const events = take();
        expect(events[0]?.message).toBe('Analyzing AI message:');
        expect(events[0]?.args).toStrictEqual([
          {
            messageIndex: 1,
            hasValidContent: true,
            blockCount: 8192,
            blocks: Array.from({ length: 32 }, () => ({
              type: 'text',
              textLength: 1215,
              textPreview: 'safe prefix '.repeat(100).substring(0, 50),
              isEmpty: false,
            })),
            blocksTruncated: true,
            metadata: { hasUsage: false },
          },
        ]);
        expect(JSON.stringify(events)).not.toContain('PRIVATE_PAYLOAD');
        expect(JSON.stringify(events).length).toBeLessThan(8192);
      } finally {
        history.dispose();
        eager.dispose();
      }
    },
  );
});

describe('bounded reconstruction diagnostics', () => {
  const take = useDiagnosticSink();
  it.each(['eager', 'stream'])(
    'caps reconstructed call details with exact total in %s logs',
    async (route) => {
      const history = new DiagnosticsCursorHistory();
      const eager = new HistoryService();
      try {
        const input = [reconstructedRow()];
        await providerDigest(
          route === 'eager'
            ? buildProviderContent(
                buildCuratedHistory(oracleLogger, input, false),
                [],
                oracleLogger,
              )
            : history.getCuratedForProviderStream([], undefined, input),
        );
        const events = take();
        expect(events[events.length - 1]).toStrictEqual({
          level: 'warn',
          message: 'Synthesizing missing tool_call for responses',
          args: [
            {
              callIds: Array.from({ length: 32 }, (_, i) => `lost-${i}`),
              toolNames: Array.from({ length: 32 }, () => 'lost'),
              callCount: 8192,
              callsTruncated: true,
            },
          ],
        });
        expect(JSON.stringify(events)).not.toContain('PRIVATE_RESULT');
        expect(JSON.stringify(events).length).toBeLessThan(4096);
      } finally {
        history.dispose();
        eager.dispose();
      }
    },
    120_000,
  );
});

describe('diagnostic publication lifecycle', () => {
  const take = useDiagnosticSink();
  it('keeps diagnostics cold and suppresses events when logging is disabled', async () => {
    const history = new DiagnosticsCursorHistory();
    try {
      const stream = history.getCuratedForProviderStream([], undefined, [
        manyBlocksRow(),
      ]);
      const unopened = take();
      ConfigurationManager.getInstance().setEphemeralConfig({ enabled: false });
      await providerDigest(stream);
      expect({ unopened, disabled: take() }).toStrictEqual({
        unopened: [],
        disabled: [],
      });
    } finally {
      history.dispose();
    }
  });

  it('keeps the original small-anchor details and detects surviving anchors', async () => {
    const history = new DiagnosticsCursorHistory();
    const call: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'tool_call', id: 'a', name: 't', parameters: {} }],
    };
    const response: IContent = {
      speaker: 'tool',
      blocks: [
        { type: 'tool_response', callId: 'a', toolName: 't', result: 1 },
      ],
      metadata: { cacheAnchor: true },
    };
    try {
      await providerDigest(
        history.getCuratedForProviderStream([call, response]),
      );
      expect(take().filter((e) => e.level === 'warn')).toStrictEqual([]);
      await providerDigest(
        history.getCuratedForProviderStream([
          call,
          { ...response, metadata: undefined },
          response,
        ]),
      );
      expect(take().filter((e) => e.level === 'warn')).toStrictEqual([
        {
          level: 'warn',
          message: 'Provider history normalization removed a cache anchor',
          args: [
            {
              inputAnchorIndexes: [2],
              inputContentCount: 3,
              outputContentCount: 2,
            },
          ],
        },
      ]);
    } finally {
      history.dispose();
    }
  });
});

describe('bounded tool identifiers', () => {
  const take = useDiagnosticSink();
  const speakers: Array<'human' | 'tool'> = ['human', 'tool'];
  it.each(speakers)(
    'caps oversized %s response identifiers in both routes',
    async (speaker) => {
      const eager = new HistoryService();
      const history = new DiagnosticsCursorHistory();
      const input: IContent[] = [
        {
          speaker,
          blocks: [
            {
              type: 'tool_response',
              callId: 'c'.repeat(65536),
              toolName: 'n'.repeat(65536),
              result: 'PRIVATE_RESULT',
            },
          ],
        },
      ];
      try {
        const reference = captureEagerDiagnostics(input, take);
        const expected = await providerDigest(reference.rows);
        expect(
          await providerDigest(
            history.getCuratedForProviderStream([], undefined, input),
          ),
        ).toBe(expected);
        expect(take()).toStrictEqual(reference.events);
        expect(
          reference.events[reference.events.length - 1]?.args,
        ).toStrictEqual([
          speaker === 'human'
            ? {
                callId: 'c'.repeat(256),
                toolName: 'n'.repeat(256),
                callDetailsTruncated: true,
              }
            : {
                callIds: ['c'.repeat(256)],
                toolNames: ['n'.repeat(256)],
                callDetailsTruncated: true,
              },
        ]);
        expect(JSON.stringify(reference.events)).not.toContain(
          'PRIVATE_RESULT',
        );
        expect(JSON.stringify(reference.events).length).toBeLessThan(2048);
      } finally {
        eager.dispose();
        history.dispose();
      }
    },
  );
});
