/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 D3b: the estimate of a chat projection equals the estimate of the
 * body the same send puts on the wire.
 *
 * The projection is made through the real provider from request rows, then
 * estimated with the production tokenizer factory. The same send then goes out
 * through a stub transport; its body is projected the way the whole-body path
 * did and estimated with the same factory. Every history of the estimator
 * corpus runs on three chat routes, so the plain heuristic family and the
 * Kimi and Mistral families all see the segment files. If one count differs,
 * the estimator input changed and `PROJECTION_REVISION` needs a bump.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeProjection,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import { projectOpenAIChatPromptEnvelope } from '../../runtime/promptEnvelopeProjections.js';
import { Gpt56SourceProjection } from '../../tokenizers/gpt56-source-projection.js';
import {
  WIRE_ROUTES,
  buildRouteCallOptions,
  installFakeTransport,
  rowsSelection,
  singleModelRequest,
  type CapturedWireRequest,
  type WireRoute,
} from '../../__tests__/support/wireBodyCapture.js';
import { estimatorCorpus } from '../../__tests__/support/estimatorCorpus.js';
import type { HistoryCase } from '../../__tests__/support/wireBodyHistories.js';
import { collectUnsupportedMedia } from '../../utils/mediaUtils.js';

const ROUTE_IDS = [
  'openai-chat-plain',
  'openai-chat-kimi',
  'openai-chat-mistral',
];
const routes = WIRE_ROUTES.filter((route) => ROUTE_IDS.includes(route.id));
const factory = createRuntimeTokenizerFactory();

function rowsOptions(route: WireRoute, entry: HistoryCase) {
  return {
    ...buildRouteCallOptions(
      route,
      entry,
      entry.rows.map((row) => structuredClone(row)),
      new SettingsService(),
    ),
    requestRows: rowsSelection(entry.rows),
    contentCount: entry.rows.length,
  };
}

async function sendWithToken(
  route: WireRoute,
  provider: ReturnType<WireRoute['createProvider']>,
  entry: HistoryCase,
  token: object,
): Promise<CapturedWireRequest> {
  const captured: CapturedWireRequest[] = [];
  const restore = installFakeTransport(route, captured);
  try {
    for await (const chunk of provider.generateChatCompletion({
      ...rowsOptions(route, entry),
      promptEnvelopeTransportToken: token,
    })) {
      void chunk;
    }
  } finally {
    restore();
  }
  return singleModelRequest(route, captured);
}

async function projectionOf(
  provider: ReturnType<WireRoute['createProvider']>,
  options: ReturnType<typeof rowsOptions>,
): Promise<PromptEnvelopeProjection> {
  const projection = await provider.projectPromptEnvelope?.(options);
  if (projection === undefined) {
    throw new Error(`${provider.name} projected no prompt envelope`);
  }
  return projection;
}

/**
 * The whole-body path: the finished body, projected to its canonical string
 * form, estimated by the same factory.
 */
async function wireBodyEstimate(
  route: WireRoute,
  provider: ReturnType<WireRoute['createProvider']>,
  sent: CapturedWireRequest,
  unsupportedMedia: ReturnType<typeof collectUnsupportedMedia>,
) {
  const body: unknown = JSON.parse(new TextDecoder().decode(sent.bytes));
  return estimatePromptEnvelope(
    provider.name,
    projectOpenAIChatPromptEnvelope(body, { unsupportedMedia }),
    factory,
  );
}

describe.each(routes.map((route) => [route.id, route] as const))(
  'chat estimate from segment files, route %s',
  (_id, route) => {
    const startingScratch = new Set(readdirSync(getScratchRoot()));

    for (const entry of estimatorCorpus()) {
      it(`${entry.id} counts the same as the body that is sent`, async () => {
        const provider = route.createProvider();
        await factory.prepareTokenizer?.(provider.name, route.model);
        const projection = await projectionOf(
          provider,
          rowsOptions(route, entry),
        );
        expect(projection.finalizedProjection).toBeInstanceOf(
          Gpt56SourceProjection,
        );
        const estimate = await estimatePromptEnvelope(
          provider.name,
          projection,
          factory,
        );
        const oracleMedia = collectUnsupportedMedia(
          entry.rows,
          (_block, category) => category === 'image',
        );
        expect(projection.unsupportedMedia).toStrictEqual(oracleMedia);

        const sent = await sendWithToken(
          route,
          provider,
          entry,
          projection.transportToken,
        );

        expect(estimate.estimatedPromptTokens).toBeGreaterThan(0);
        expect(estimate).toStrictEqual(
          await wireBodyEstimate(route, provider, sent, oracleMedia),
        );
      });
    }

    it('leaves no scratch files behind', () => {
      expect(new Set(readdirSync(getScratchRoot()))).toStrictEqual(
        startingScratch,
      );
    });
  },
);
