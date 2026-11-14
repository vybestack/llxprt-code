/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HookOutputOwner } from '@vybestack/llxprt-code-core/hooks/hookOutputSnapshot.js';
import { HookModelSnapshotOutput } from '@vybestack/llxprt-code-core/hooks/hookSnapshotAggregator.js';
import { callerOwnedProviderRequest } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import { sourceBeforeModelHook } from './source-before-model-hook.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';
import {
  sendThroughRoute,
  WIRE_ROUTES,
} from '../../../providers/src/__tests__/support/wireBodyCapture.js';

import frozenWire from './source-model-hook-modified-wire.json' with { type: 'json' };

const expectedWire: Readonly<Record<string, string>> = frozenWire;

const replacement: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'rewritten 雪' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'reason',
        signature: 'signed',
        sourceField: 'thinking',
      },
      {
        type: 'tool_call',
        id: 'call_edit',
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
        callId: 'call_edit',
        toolName: 'read',
        result: 'edited result',
        error: 'missing',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'edited pending' }] },
];

describe('modified BeforeModel output', () => {
  for (const route of WIRE_ROUTES) {
    it(`${route.id} preserves old request bytes after hook disposal without creating files`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'modified-hook-'));
      const output = new HookOutputOwner(root);
      output.stdout.append(
        Buffer.from(
          JSON.stringify({
            hookSpecificOutput: {
              llm_request: { contents: replacement },
              llm_request_boundary: { pendingMessageStartIndex: 3 },
            },
          }),
        ),
      );
      const document = output.output(0);
      if (document === undefined) throw new Error('Missing hook document');
      const snapshot = await callerOwnedProviderRequest([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'original request' }],
        },
      ]);
      const history = {
        id: 'modified-hook',
        description: 'hook replacement',
        rows: [],
      };
      let closed = false;
      try {
        const creates = await operationFileCreates(async () => {
          const selection = await sourceBeforeModelHook({
            owner: {
              sessionId: () => 'modified-hook',
              transcriptPath: () => undefined,
              async beforeModelSnapshot() {
                return {
                  success: true,
                  errors: [],
                  totalDuration: 0,
                  finalOutput: new HookModelSnapshotOutput([document]),
                  close() {
                    closed = true;
                    output.dispose();
                  },
                };
              },
            },
            snapshot,
            pending: [],
            model: 'm',
            tools: undefined,
            log: () => undefined,
          });
          try {
            expect(closed).toBe(true);
            const actual = await sendThroughRoute(
              route,
              history,
              'rows',
              undefined,
              selection,
            );
            expect(actual.bytes).toStrictEqual(
              new TextEncoder().encode(expectedWire[route.id]),
            );
          } finally {
            await selection.close();
          }
        }, true);
        expect(creates).toStrictEqual({ files: [], directories: [] });
      } finally {
        await snapshot.close();
        output.dispose();
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
