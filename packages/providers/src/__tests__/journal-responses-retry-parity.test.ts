/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
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
): Promise<CapturedWireRequest[][]> {
  const provider = route.createProvider();
  const rows = rejectedParentRows();
  const sources = singleParent
    ? [rows.first.slice(2)]
    : [rows.first, rows.second];
  const captured: CapturedWireRequest[][] = [];
  for (const [index, source] of sources.entries()) {
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
        native ? input : eagerProviderOracle(input),
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
      if (native) {
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
