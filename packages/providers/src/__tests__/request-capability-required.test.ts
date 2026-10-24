/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { inMemoryRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { sendThroughRoute, WIRE_ROUTES } from './support/wireBodyCapture.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';

describe('provider request capability admission', () => {
  for (const route of WIRE_ROUTES) {
    it(`${route.id} refuses a capability-less selection before creating files`, async () => {
      const selection = inMemoryRequestSelection([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'unsupported rows' }],
        },
      ]);
      const creates = await operationFileCreates(async () => {
        await expect(
          sendThroughRoute(
            route,
            {
              id: 'missing-capability',
              description: 'unsupported selection',
              rows: [],
            },
            'rows',
            undefined,
            selection,
          ),
        ).rejects.toThrow(
          'requires a native or caller-owned request selection',
        );
      });
      expect(creates).toStrictEqual({ files: [], directories: [] });
    });
  }
});
