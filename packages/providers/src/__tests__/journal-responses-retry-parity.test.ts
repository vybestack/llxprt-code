/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readSync, writeSync } from 'node:fs';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProviderCore.js';
import { RejectedParentSet } from '../openai-responses/rejected-parent-set.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { withCoreSuffixFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  WIRE_ROUTES,
  buildHistoryCallOptions,
  installFakeTransport,
  recordOf,
  type CapturedWireRequest,
  type WireRoute,
} from './support/wireBodyCapture.js';
import {
  eagerProviderOracle,
  withJournalProviderSelection,
} from './support/journal-provider-fixture.js';
import { rejectedParentRows } from './support/frozenWire/explicit/responsesCases.js';
import { readExplicitFixture } from './support/frozenWire/explicit/explicitFixture.js';
import { observeBody } from './support/frozenWire/explicit/explicitSend.js';
import type { Observation } from './support/frozenWire/explicit/explicitCase.js';
import type { HistoryCase } from './support/wireBodyHistories.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

async function sequence(
  route: WireRoute,
  native: boolean,
  singleParent = false,
  clearBeforeSecond = false,
  nonJournalSecond = false,
): Promise<CapturedWireRequest[][]> {
  const provider = route.createProvider();
  const rows = rejectedParentRows();
  const sources = singleParent
    ? [rows.first.slice(2)]
    : [rows.first, rows.second];
  const captured: CapturedWireRequest[][] = [];
  for (const [index, source] of sources.entries()) {
    const useNative = native && !(index === 1 && nonJournalSecond);
    if (index === 1 && clearBeforeSecond) {
      if (
        !('clearState' in provider) ||
        typeof provider.clearState !== 'function'
      )
        throw new Error('Provider cannot clear its state');
      provider.clearState();
    }
    const input: HistoryCase = {
      id: `source-${index}`,
      description: 'rejected parent replay',
      rows: source,
      ephemerals: { 'responses-stateful': true },
    };
    const requests: CapturedWireRequest[] = [];
    let calls = 0;
    const answering = {
      ...route,
      respond: (): Response => {
        if (index === 0 && calls++ === 0)
          return Response.json(
            {
              error: {
                message: "Previous response with id 'resp_dead' not found.",
              },
            },
            { status: 400 },
          );
        return route.respond();
      },
    };
    const restore = installFakeTransport(answering, requests);
    const send = async (
      selection?: ProviderRequestSelection,
    ): Promise<void> => {
      const options = buildHistoryCallOptions(
        route,
        useNative ? input : eagerProviderOracle(input),
        'rows',
        new SettingsService(),
        selection,
      );
      const projection = await provider.projectPromptEnvelope?.(options);
      if (projection === undefined)
        throw new Error('Missing native retry projection');
      for await (const item of provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      }))
        void item;
    };
    try {
      if (useNative) {
        await withJournalProviderSelection(
          input,
          async (selection, history) => {
            history.add({
              speaker: 'human',
              blocks: [{ type: 'text', text: 'post-pin native row' }],
            });
            await history.waitForCommit();
            await send(selection);
          },
        );
      } else await send();
    } finally {
      restore();
    }
    for (const request of requests) recordOf(request);
    captured.push(requests);
  }
  return captured;
}

function bodies(requests: CapturedWireRequest[][]): string[][] {
  return requests.map((source) =>
    source.map((request) => new TextDecoder().decode(request.bytes)),
  );
}

class RefusingRejectionProvider extends OpenAIResponsesProvider {
  protected override createRejectedParentSet(): RejectedParentSet {
    let writes = 0;
    return new RejectedParentSet({
      io: {
        read: readSync,
        write: (...args) => {
          if (++writes > 1) throw new Error('slot write refused');
          return writeSync(...args);
        },
      },
    });
  }
}

describe('native Responses rejected-parent replay', () => {
  for (const route of WIRE_ROUTES.filter(
    (candidate) => candidate.endpoint === '/responses',
  )) {
    describe(`route ${route.id}`, () => {
      it('keeps the pinned selection live across rejection and retires the dead parent for another source', async () => {
        const expected = await sequence(route, false);
        const actual = await sequence(route, true);
        expect(actual.map((source) => source.map(recordOf))).toStrictEqual(
          expected.map((source) => source.map(recordOf)),
        );
        const sent = bodies(actual);
        expect(sent.map((source) => source.length)).toStrictEqual([2, 1]);
        expect(sent[0][0]).toContain('"previous_response_id":"resp_dead"');
        expect(sent[0][1]).toContain('"previous_response_id":"resp_ok"');
        expect(sent[1][0]).toContain('"previous_response_id":"resp_ok"');
        expect(sent[1][0]).not.toContain('resp_dead');
      });
      it('shares rejection with a non-journal call', async () => {
        const actual = bodies(await sequence(route, true, false, false, true));
        expect(actual[1][0]).toContain('"previous_response_id":"resp_ok"');
        expect(actual[1][0]).not.toContain('resp_dead');
      });
      it('clears rejected parent identities when provider state is cleared', async () => {
        const actual = bodies(await sequence(route, true, false, true));
        expect(actual.map((source) => source.length)).toStrictEqual([2, 1]);
        expect(actual[1][0]).toContain('"previous_response_id":"resp_dead"');
        expect(actual[1][0]).not.toContain('post-pin native row');
      });
      it('rebuilds complete history and correct Content-Length when no older parent survives', async () => {
        const expected = await sequence(route, false, true);
        const actual = await sequence(route, true, true);
        expect(actual.map((source) => source.map(recordOf))).toStrictEqual(
          expected.map((source) => source.map(recordOf)),
        );
        const sent = bodies(actual)[0];
        expect(sent).toHaveLength(2);
        expect(sent[0]).toContain('"previous_response_id":"resp_dead"');
        expect(sent[1]).not.toContain('previous_response_id');
        for (const text of ['q1', 'a1', 'q2']) expect(sent[1]).toContain(text);
      });
    });
  }

  it('keeps rejection after a pop, forgets on clear and disposal, and starts a second instance empty', async () => {
    const route = WIRE_ROUTES.find(
      (candidate) => candidate.id === 'openai-responses',
    );
    if (route === undefined) throw new Error('Missing Responses route');
    const provider = new OpenAIResponsesProvider('test-api-key');
    const other = new OpenAIResponsesProvider('test-api-key');
    const input: HistoryCase = {
      id: 'rejection-pop',
      description: 'rejection survives pop',
      rows: rejectedParentRows().first,
      ephemerals: { 'responses-stateful': true },
    };
    const requests: CapturedWireRequest[] = [];
    let rejectNext = true;
    const before = new Set(readdirSync(getScratchRoot()));
    const restore = installFakeTransport(
      {
        ...route,
        respond: () => {
          if (!rejectNext) return route.respond();
          rejectNext = false;
          return Response.json(
            {
              error: {
                message: "Previous response with id 'resp_dead' not found.",
              },
            },
            { status: 400 },
          );
        },
      },
      requests,
    );
    try {
      await withCoreSuffixFixture(
        input.rows.length,
        async (history, ownership) => {
          const send = async (
            active: OpenAIResponsesProvider,
          ): Promise<void> => {
            const selection = await history.prepareCuratedForProviderSnapshot(
              [],
              { ownership },
            );
            try {
              const options = buildHistoryCallOptions(
                route,
                input,
                'rows',
                new SettingsService(),
                {
                  callerOwned: true,
                  count: selection.count,
                  readAt: (index, signal) => selection.readAt(index, signal),
                  openReader: (signal) => selection.openReader(signal),
                  close: async () => {},
                },
              );
              const projection = await active.projectPromptEnvelope(options);
              for await (const item of active.generateChatCompletion({
                ...options,
                promptEnvelopeTransportToken: projection.transportToken,
              }))
                void item;
            } finally {
              await selection.close();
            }
          };
          await send(provider);
          expect(new TextDecoder().decode(requests[1].bytes)).toContain(
            '"previous_response_id":"resp_ok"',
          );
          await history.pop();
          history.add({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'replacement question' }],
          });
          await history.waitForCommit();
          await send(provider);
          expect(new TextDecoder().decode(requests[2].bytes)).toContain(
            '"previous_response_id":"resp_ok"',
          );
          await send(other);
          expect(new TextDecoder().decode(requests[3].bytes)).toContain(
            '"previous_response_id":"resp_dead"',
          );
          expect(
            readdirSync(getScratchRoot()).filter(
              (name) =>
                !before.has(name) && name.startsWith('responses-rejections-'),
            ),
          ).toHaveLength(1);
          provider.clearState();
          expect(
            readdirSync(getScratchRoot()).filter(
              (name) =>
                !before.has(name) && name.startsWith('responses-rejections-'),
            ),
          ).toHaveLength(0);
          await send(provider);
          expect(new TextDecoder().decode(requests[4].bytes)).toContain(
            '"previous_response_id":"resp_dead"',
          );
          rejectNext = true;
          await send(provider);
          expect(new TextDecoder().decode(requests[6].bytes)).toContain(
            '"previous_response_id":"resp_ok"',
          );
          provider.dispose();
          expect(
            readdirSync(getScratchRoot()).filter(
              (name) =>
                !before.has(name) && name.startsWith('responses-rejections-'),
            ),
          ).toHaveLength(0);
          await send(provider);
          expect(new TextDecoder().decode(requests[7].bytes)).toContain(
            '"previous_response_id":"resp_dead"',
          );
        },
        0,
        (index) => input.rows[index],
      );
    } finally {
      restore();
      provider.dispose();
      other.dispose();
    }
    expect(
      readdirSync(getScratchRoot()).filter(
        (name) => !before.has(name) && name.startsWith('responses-rejections-'),
      ),
    ).toHaveLength(0);
  });

  it('fails the turn when recording a rejected parent fails', async () => {
    const route = WIRE_ROUTES.find(
      (candidate) => candidate.id === 'openai-responses',
    );
    if (route === undefined) throw new Error('Missing Responses route');
    const provider = new RefusingRejectionProvider('test-api-key');
    try {
      await expect(
        sequence({ ...route, createProvider: () => provider }, true),
      ).rejects.toThrow('slot write refused');
    } finally {
      provider.clearState();
    }
  });

  it('matches the untouched rejected-parent frozen body oracle for both sources', async () => {
    const route = WIRE_ROUTES.find(
      (candidate) => candidate.id === 'openai-responses',
    );
    if (route === undefined) throw new Error('Missing Responses route');
    const actual = await sequence(route, true);
    const expected =
      readExplicitFixture('responses').cases[
        'responses parent: a rejected parent is not reused by a second source'
      ];
    if (expected === undefined)
      throw new Error('Missing rejected-parent frozen oracle');
    const observation: Observation = {
      'first source': actual[0].map((request) => observeBody(request, 'input')),
      'second source, same provider': actual[1].map((request) =>
        observeBody(request, 'input'),
      ),
    };
    expect(observation).toStrictEqual(expected);
  });
});
