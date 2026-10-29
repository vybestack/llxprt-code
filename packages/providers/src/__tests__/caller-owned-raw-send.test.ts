/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  WIRE_ROUTES,
  rowsSelection,
  sendThroughRoute,
} from './support/wireBodyCapture.js';

const human: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'Start' }],
};
const call: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id: 'call_a', name: 'lookup', parameters: {} }],
};
const result: IContent = {
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      callId: 'call_a',
      toolName: 'lookup',
      result: 'found',
    },
    { type: 'media', mimeType: 'image/png', encoding: 'base64', data: 'YQ==' },
  ],
};
const cases: ReadonlyArray<readonly IContent[]> = [
  [human],
  [result],
  [human, result],
  [human, call, result, result, human],
  [human, call, human, result],
  [
    human,
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'mixed' }, ...result.blocks],
    },
    human,
  ],
];

describe('raw caller-owned native requests', () => {
  for (const route of WIRE_ROUTES) {
    for (const [index, rows] of cases.entries()) {
      it(`${route.id} keeps raw row semantics for case ${index} without scratch`, async () => {
        const history = {
          id: `raw-${index}`,
          description: 'raw caller-built rows',
          rows: [...rows],
        };
        const expected = await sendThroughRoute(
          route,
          history,
          'rows',
          undefined,
          rowsSelection(rows),
        );
        let actual: Uint8Array | undefined;
        const creates = await operationFileCreates(async () => {
          actual = (
            await sendThroughRoute(
              route,
              history,
              'rows',
              undefined,
              await callerOwnedRawProviderSource(rows).openProviderRequest(),
            )
          ).bytes;
        }, true);
        expect(creates).toStrictEqual({ files: [], directories: [] });
        expect(actual).toStrictEqual(expected.bytes);
      });
    }
  }
});
