/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { diskSummaryRequestSelection } from '../middleOutDiskPlan.js';
import { referenceSummaryRequest } from './summary-request-reference.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import {
  rowsSelection,
  buildHistoryCallOptions,
  installFakeTransport,
  singleModelRequest,
  WIRE_ROUTES,
  type WireRoute,
  type CapturedWireRequest,
} from '../../../../providers/src/__tests__/support/wireBodyCapture.js';

const rows: IContent[] = [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'outside selected range' }],
  },
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: '<state_snapshot>old</state_snapshot>' },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'YQ==',
        caption: 'diagram',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'signed reason',
        signature: 'signature',
        sourceField: 'thinking',
      },
    ],
  },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'call_a',
        name: 'read',
        parameters: { path: '雪' },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_a',
        toolName: 'read',
        result: 'retry with a path',
        error: 'missing path',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'explain' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'last reason',
        signature: 'last signature',
        sourceField: 'thinking',
      },
      { type: 'text', text: 'last answer' },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'outside tail' }] },
];
const injections: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'active task' }] },
];
const plan = {
  top: 1,
  bottom: rows.length - 1,
  injection: [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'last prompt' }],
    } satisfies IContent,
  ],
};

async function send(
  route: WireRoute,
  strip: string,
  selection: ProviderRequestSelection,
): Promise<Uint8Array> {
  const captured: CapturedWireRequest[] = [];
  const restore = installFakeTransport(route, captured);
  try {
    const options = buildHistoryCallOptions(
      route,
      {
        id: 'summary-edge',
        description: 'summary range and reasoning',
        rows: [],
        ephemerals: {
          'reasoning.includeInContext': true,
          'reasoning.stripFromContext': strip,
        },
      },
      'rows',
      new SettingsService(),
      selection,
    );
    for await (const chunk of route.createProvider().generateChatCompletion({
      ...options,
      metadata: { _retryRequestContext: { reasoningIdTime: 1780000000123 } },
    }))
      void chunk;
    return singleModelRequest(route, captured).bytes;
  } finally {
    restore();
  }
}

describe('summary ranges, framing, media, tool failures and signed thinking', () => {
  for (const route of WIRE_ROUTES) {
    it(`${route.id} preserves bytes for every reasoning policy without staging`, async () => {
      const ownership = new RowOwnership();
      const selection = diskSummaryRequestSelection(
        {
          length: rows.length,
          readRow: (at) => rows[at],
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        },
        plan,
        'summarize this range',
        injections,
        ownership,
      );
      const reference = rowsSelection(
        referenceSummaryRequest(
          rows,
          plan.top,
          plan.bottom,
          'summarize this range',
          [...injections, ...plan.injection],
        ),
      );
      try {
        for (const strip of ['none', 'allButLast', 'all']) {
          const expected = await send(route, strip, reference);
          let actual: Uint8Array | undefined;
          const creates = await operationFileCreates(async () => {
            actual = await send(route, strip, selection);
          }, true);
          expect(creates).toStrictEqual({ files: [], directories: [] });
          expect(actual).toStrictEqual(expected);
        }
        expect(ownership.snapshot().peakRows).toBe(1);
        expect(ownership.snapshot().liveRows).toBe(0);
      } finally {
        await selection.close();
      }
    });
  }
});
