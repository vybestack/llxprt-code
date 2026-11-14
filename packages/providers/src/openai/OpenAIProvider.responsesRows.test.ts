/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step C1: the openai provider sends Responses requests whose
 * history arrives as `requestRows` through the same disk text route the
 * openai-responses provider uses. Both ways of reaching it (a projected token
 * and a send without a projection) put the bytes of the array route on the
 * wire, with a Content-Length that equals them. Only global fetch is stubbed.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { GenerateChatOptions } from '../IProvider.js';
import {
  createCorpus,
  type Corpus,
} from '../__tests__/support/wireBodyCorpus.js';
import {
  WIRE_ROUTES,
  buildRouteCallOptions,
  installFakeTransport,
  recordOf,
  rowsSelection,
  singleModelRequest,
  type CapturedWireRequest,
  type WireRoute,
} from '../__tests__/support/wireBodyCapture.js';
import type { HistoryCase } from '../__tests__/support/wireBodyHistories.js';
import { OpenAIProvider } from './OpenAIProvider.js';

// Responses ids minted from the clock must be equal across the compared sends.
const PINNED_CLOCK = Date.UTC(2026, 0, 2, 3, 4, 5);

const CASES = [
  'tool-calls-with-results',
  'orphan-tool-call',
  'reasoning-thinking',
  'blockless-row',
] as const;

let corpus: Corpus;
let route: WireRoute;

function historyOf(id: string): HistoryCase {
  const history = corpus.histories.find((candidate) => candidate.id === id);
  if (history === undefined) throw new Error(`no history ${id}`);
  return history;
}

function arrayOptions(history: HistoryCase): GenerateChatOptions {
  return buildRouteCallOptions(
    route,
    history,
    history.rows.map((row) => structuredClone(row)),
    new SettingsService(),
  );
}

function rowsOptions(history: HistoryCase): GenerateChatOptions {
  return {
    ...arrayOptions(history),
    requestRows: rowsSelection(history.rows),
    contentCount: history.rows.length,
  };
}

async function capture(
  provider: OpenAIProvider,
  send: () => GenerateChatOptions | Promise<GenerateChatOptions>,
): Promise<CapturedWireRequest> {
  const captured: CapturedWireRequest[] = [];
  const restore = installFakeTransport(route, captured);
  try {
    for await (const chunk of provider.generateChatCompletion(await send())) {
      void chunk;
    }
  } finally {
    restore();
  }
  return singleModelRequest(route, captured);
}

function newProvider(): OpenAIProvider {
  return new OpenAIProvider('test-api-key', route.baseURL);
}

describe('openai provider, Responses route, request rows (C1)', () => {
  beforeAll(async () => {
    corpus = await createCorpus();
    const found = WIRE_ROUTES.find(
      (candidate) => candidate.id === 'openai-responses-via-openai',
    );
    if (found === undefined) throw new Error('route is not in the corpus');
    route = found;
  });

  afterAll(async () => {
    await corpus.dispose();
  });

  beforeEach(() => {
    setSystemTime(new Date(PINNED_CLOCK));
  });

  afterEach(() => {
    setSystemTime();
  });

  for (const id of CASES) {
    it(`${id}: a projected token sends the array route bytes with a matching content-length`, async () => {
      const history = historyOf(id);
      const expected = await capture(newProvider(), () =>
        arrayOptions(history),
      );
      const provider = newProvider();
      const sent = await capture(provider, async () => {
        const options = rowsOptions(history);
        const projection = await provider.projectPromptEnvelope(options);
        return {
          ...options,
          promptEnvelopeTransportToken: projection.transportToken,
        };
      });
      expect(Buffer.from(sent.bytes).equals(Buffer.from(expected.bytes))).toBe(
        true,
      );
      expect(recordOf(sent).contentLength).toBe('present');
    });

    it(`${id}: rows sent without a projection send the same bytes`, async () => {
      const history = historyOf(id);
      const expected = await capture(newProvider(), () =>
        arrayOptions(history),
      );
      const sent = await capture(newProvider(), () => rowsOptions(history));
      expect(Buffer.from(sent.bytes).equals(Buffer.from(expected.bytes))).toBe(
        true,
      );
      expect(recordOf(sent).contentLength).toBe('present');
    });
  }

  it('refuses a rows token on a send that carries no request rows', async () => {
    const history = historyOf('tool-calls-with-results');
    const provider = newProvider();
    const restore = installFakeTransport(route, []);
    try {
      const options = rowsOptions(history);
      const projection = await provider.projectPromptEnvelope(options);
      const send = async (): Promise<void> => {
        for await (const chunk of provider.generateChatCompletion({
          ...arrayOptions(history),
          promptEnvelopeTransportToken: projection.transportToken,
        })) {
          void chunk;
        }
      };
      await expect(send()).rejects.toThrow(
        'Source token requires its transport-read request rows',
      );
      await projection.releaseIfUnsent?.();
    } finally {
      restore();
    }
  });
});
