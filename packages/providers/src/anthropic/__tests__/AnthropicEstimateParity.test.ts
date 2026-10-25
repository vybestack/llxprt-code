/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 E5: the estimate of an Anthropic projection equals the estimate
 * of the body the same send puts on the wire.
 *
 * The projection is made through the real provider from request rows, then
 * estimated with the production tokenizer factory. The same send then goes out
 * through a stub transport; its body is projected the way the whole-body path
 * did and estimated with the same factory. Every history of the estimator
 * corpus runs with prompt caching at 1h and off (a system block array and a
 * system string) and with an API key and an OAuth token, so every shape of the
 * `system` key reaches the segment files. If one count differs, the estimator
 * input changed and `PROJECTION_REVISION` needs a bump.
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
import { projectAnthropicPromptEnvelope } from '../../runtime/promptEnvelopeProjections.js';
import { NativeAnthropicEstimateProjection } from '../native-anthropic-estimate.js';
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
import { AnthropicProvider } from '../AnthropicProvider.js';
import { createMediaSupportPredicate } from '../AnthropicEndpointUtils.js';
import { TEST_PROVIDER_CONFIG } from '../../__tests__/providerTestConfig.js';
import { collectUnsupportedMedia } from '../../utils/mediaUtils.js';

const OAUTH_TOKEN = 'sk-ant-oat-estimate-parity';

/**
 * Media the Messages protocol cannot carry (audio, video) next to a PDF it
 * can, so the unsupported-media list is compared on every route.
 */
const unsupportedMediaCase: HistoryCase = {
  id: 'unsupported-media',
  description: 'audio and video replaced by placeholders, a PDF kept',
  systemInstruction: 'Describe recordings.',
  rows: [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'Describe these' },
        {
          type: 'media',
          mimeType: 'audio/wav',
          data: 'AAAA',
          encoding: 'base64',
        },
        {
          type: 'media',
          mimeType: 'video/mp4',
          data: 'BBBB',
          encoding: 'base64',
        },
        {
          type: 'media',
          mimeType: 'application/pdf',
          data: 'JVBERi0=',
          encoding: 'base64',
          filename: 'document.pdf',
        },
      ],
    },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] },
    { speaker: 'human', blocks: [{ type: 'text', text: 'and again' }] },
  ],
};

interface ParityRoute {
  readonly id: string;
  readonly route: WireRoute;
  readonly authToken: string | undefined;
  readonly systemShape: 'string' | 'blocks';
}

const caching = WIRE_ROUTES.filter((route) =>
  route.id.startsWith('anthropic-'),
);

function oauthRoute(route: WireRoute): WireRoute {
  return {
    ...route,
    id: `${route.id}-oauth`,
    createProvider: () =>
      new AnthropicProvider(OAUTH_TOKEN, undefined, TEST_PROVIDER_CONFIG),
  };
}

const parityRoutes: readonly ParityRoute[] = caching.flatMap((route) => [
  {
    id: route.id,
    route,
    authToken: undefined,
    systemShape: route.id.endsWith('-1h') ? 'blocks' : 'string',
  } as const,
  {
    id: `${route.id}-oauth`,
    route: oauthRoute(route),
    authToken: OAUTH_TOKEN,
    systemShape: 'string',
  } as const,
]);

const factory = createRuntimeTokenizerFactory();

function rowsOptions(parity: ParityRoute, entry: HistoryCase) {
  const options = buildRouteCallOptions(
    parity.route,
    entry,
    entry.rows.map((row) => structuredClone(row)),
    new SettingsService(),
  );
  return {
    ...options,
    ...(parity.authToken === undefined
      ? {}
      : { resolved: { ...options.resolved, authToken: parity.authToken } }),
    requestRows: rowsSelection(entry.rows),
    contentCount: entry.rows.length,
  };
}

async function sendWithToken(
  parity: ParityRoute,
  provider: ReturnType<WireRoute['createProvider']>,
  entry: HistoryCase,
  token: object,
): Promise<CapturedWireRequest> {
  const captured: CapturedWireRequest[] = [];
  const restore = installFakeTransport(parity.route, captured);
  try {
    for await (const chunk of provider.generateChatCompletion({
      ...rowsOptions(parity, entry),
      promptEnvelopeTransportToken: token,
    })) {
      void chunk;
    }
  } finally {
    restore();
  }
  return singleModelRequest(parity.route, captured);
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

describe.each(parityRoutes.map((parity) => [parity.id, parity] as const))(
  'anthropic estimate from segment files, route %s',
  (_id, parity) => {
    const startingScratch = new Set(readdirSync(getScratchRoot()));

    for (const entry of [...estimatorCorpus(), unsupportedMediaCase]) {
      it(`${entry.id} counts the same as the body that is sent`, async () => {
        const provider = parity.route.createProvider();
        await factory.prepareTokenizer?.(provider.name, parity.route.model);
        const projection = await projectionOf(
          provider,
          rowsOptions(parity, entry),
        );
        expect(projection.finalizedProjection).toBeInstanceOf(
          NativeAnthropicEstimateProjection,
        );
        const estimate = await estimatePromptEnvelope(
          provider.name,
          projection,
          factory,
        );
        const oracleMedia = collectUnsupportedMedia(
          entry.rows,
          createMediaSupportPredicate(parity.route.baseURL),
        );
        expect(projection.unsupportedMedia).toStrictEqual(oracleMedia);
        expect(oracleMedia.map((media) => media.mediaType)).toStrictEqual(
          entry === unsupportedMediaCase
            ? ['audio', 'video']
            : oracleMedia.map((media) => media.mediaType),
        );

        const sent = await sendWithToken(
          parity,
          provider,
          entry,
          projection.transportToken,
        );
        const body: Record<string, unknown> = JSON.parse(
          new TextDecoder().decode(sent.bytes),
        );
        expect(
          body['system'] === undefined ||
            Array.isArray(body['system']) === (parity.systemShape === 'blocks'),
        ).toBe(true);

        expect(estimate.estimatedPromptTokens).toBeGreaterThan(0);
        expect(estimate).toStrictEqual(
          await estimatePromptEnvelope(
            provider.name,
            projectAnthropicPromptEnvelope(body, {
              unsupportedMedia: oracleMedia,
            }),
            factory,
          ),
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
