/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { callerOwnedProviderRequest } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { sourceBeforeModelHook } from './source-before-model-hook.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';
import { journalSendFixture } from '../../../providers/src/__tests__/support/journal-send-fixture.js';
import {
  sendThroughRoute,
  WIRE_ROUTES,
  type WireRoute,
} from '../../../providers/src/__tests__/support/wireBodyCapture.js';

async function digest(rows: ProviderRequestRows): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows.openReader()) hash.update(JSON.stringify(row));
  return hash.digest('hex');
}

async function unmodifiedHook(count: number, route: WireRoute): Promise<void> {
  const rows: IContent[] = Array.from({ length: count }, (_, at) => ({
    speaker: at % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `row ${at}` }],
  }));
  const fixture = await journalSendFixture(rows);
  let hookDigest: string | undefined;
  let hookClosed = false;
  const expectedDigest = await digest(fixture.selection);
  const history = { id: 'hook', description: 'unmodified hook', rows: [] };
  try {
    const expected = await sendThroughRoute(
      route,
      history,
      'rows',
      undefined,
      fixture.selection,
    );
    const creates = await operationFileCreates(async () => {
      const selection = await sourceBeforeModelHook({
        owner: {
          sessionId: () => 'native-hook',
          transcriptPath: () => undefined,
          async beforeModelSnapshot(request) {
            hookDigest = await digest(request.contents);
            return {
              success: true,
              errors: [],
              totalDuration: 0,
              close: () => {
                hookClosed = true;
              },
            };
          },
        },
        snapshot: fixture.selection,
        pending: [],
        model: 'm',
        tools: undefined,
        log: () => undefined,
      });
      try {
        expect(hookClosed).toBe(true);
        expect(hookDigest).toBe(expectedDigest);
        expect(await digest(selection)).toBe(expectedDigest);
        const actual = await sendThroughRoute(
          route,
          history,
          'rows',
          undefined,
          selection,
        );
        expect(actual.bytes).toStrictEqual(expected.bytes);
      } finally {
        await selection.close();
      }
      await expect(
        Promise.resolve().then(() => fixture.selection.readAt(0)),
      ).rejects.toThrow('closed');
    }, true);
    expect(creates).toStrictEqual({ files: [], directories: [] });
  } finally {
    await fixture.close();
  }
}

describe.each([65])('unmodified model hook at %i rows', (count) => {
  for (const route of WIRE_ROUTES) {
    it(`${route.id} retains the pinned request through hook disposal and sends unchanged bytes without files`, async () => {
      await expect(unmodifiedHook(count, route)).resolves.toBeUndefined();
    }, 180000);
  }
});

describe('caller-owned model hook selections', () => {
  it('rejects cancellation during an unmodified hook and retires the request', async () => {
    const snapshot = await callerOwnedProviderRequest([
      { speaker: 'human', blocks: [{ type: 'text', text: 'cancel prompt' }] },
    ]);
    const controller = new AbortController();
    const reason = new Error('hook cancelled');
    await expect(
      sourceBeforeModelHook({
        owner: {
          sessionId: () => 'cancel-hook',
          transcriptPath: () => undefined,
          async beforeModelSnapshot() {
            controller.abort(reason);
            return {
              success: true,
              errors: [],
              totalDuration: 0,
              close: () => undefined,
            };
          },
        },
        snapshot,
        pending: [],
        model: 'm',
        tools: undefined,
        signal: controller.signal,
        log: () => undefined,
      }),
    ).rejects.toBe(reason);
    await expect(snapshot.readAt(0)).rejects.toThrow('closed');
  });
  it('keeps caller-owned request conversion through the pending selection wrapper', async () => {
    const snapshot = await callerOwnedProviderRequest([
      { speaker: 'human', blocks: [{ type: 'text', text: 'caller prompt' }] },
    ]);
    const selection = await sourceBeforeModelHook({
      owner: undefined,
      snapshot,
      pending: [],
      model: 'm',
      tools: undefined,
      log: () => undefined,
    });
    try {
      const creates = await operationFileCreates(async () => {
        for (const route of WIRE_ROUTES) {
          const history = {
            id: 'caller-hook',
            description: 'caller hook',
            rows: [],
          };
          const expected = await sendThroughRoute(
            route,
            history,
            'rows',
            undefined,
            snapshot,
          );
          const actual = await sendThroughRoute(
            route,
            history,
            'rows',
            undefined,
            selection,
          );
          expect(actual.bytes).toStrictEqual(expected.bytes);
        }
      }, true);
      expect(creates).toStrictEqual({ files: [], directories: [] });
    } finally {
      await selection.close();
    }
  });
});
