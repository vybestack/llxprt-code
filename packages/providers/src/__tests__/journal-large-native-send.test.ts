import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Limits: core/src/core/model-limits.json + composition/aliases/*.config give
 * gpt-4o 128,000, gpt-5.6 1,050,000, gpt-5.2 200,000 and opus-5 1,000,000
 * context tokens (GPT-5.6 and Opus overrides come from the built-in aliases).
 * Fixtures cap even GPT-5.6 at 1,000,000, per Andrew's context-window ruling.
 * AnthropicEndpointUtils.ts caps native bodies at 32,000,000 bytes (#3988);
 * OpenAI has only boundedJsonBody.ts's 128 MiB allocation ceiling in this code,
 * not an endpoint-specific byte cap. These send paths enforce no image-count
 * or per-image byte cap: request-media-resolver.ts enforces aggregate base64
 * bytes, default 15 MiB (core/src/config/configTypes.ts). Alias resize defaults
 * bound Claude to 1568px / 1,229,312 pixels, GPT-4o to 2048px / 1,572,864 pixels,
 * and GPT-5.2+ to 2000px / 1,572,864 pixels. Our valid RGB PNGs are <=1024x1000
 * and <3.1 MB each, also below Anthropic's documented 5 MB/image allowance.
 * agents/src/compression/{historicalImageRetirement,source-image-retirement}.ts
 * retire oldest historical pixels to 75% only after crossing the media budget;
 * pending pixels stay. mediaPressureFallback.ts drops all historical images,
 * never pending ones. Four PNGs nearly fill the default budget without retiring.
 * A 32 MB explicit media budget admits the pending-only body-cap image set;
 * retirement/fallback cannot shrink it. Default-budget text plus images cannot
 * reach that cap. A 1024-token output budget and compression-threshold=1 are
 * valid settings for these near-window sends; finalized estimates below prove
 * that the real source enforcer sends them without compression. No buffering
 * control existed in this file or its send/sink helpers.
 */
import { describe, expect, it } from 'bun:test';
import { randomFillSync } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  DEFAULT_REQUEST_MEDIA_BUDGET_BYTES,
  RequestBodyByteOverflowError,
  RequestMediaResolver,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import {
  retireHistoricalImages,
  retireEveryHistoricalImage,
} from '../../../agents/src/compression/historicalImageRetirement.js';
import { retireSourceImages } from '../../../agents/src/compression/source-image-retirement.js';
import { ProviderSourceEnforcer } from '../../../agents/src/compression/provider-source-enforcement.js';
import { computeMarginAdjustedLimit } from '../../../agents/src/compression/contextLimitPolicy.js';
import { ANTHROPIC_NATIVE_REQUEST_ENVELOPE_BYTES } from '../anthropic/AnthropicEndpointUtils.js';
import { loadProviderAliasEntries } from '../composition/providerAliases.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { computeModelDefaults } from '../model-defaults.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
  type WireRoute,
  type MediaBinding,
  type WireBodyRecord,
} from './support/wireBodyCapture.js';
import type { HistoryCase } from './support/wireBodyHistories.js';
import { nativeJournalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import { providerStreamError } from './support/provider-stream-error.js';
import { withFetchPreconnect } from '../../../test-utils/src/fetch-test-helpers.js';
const tokenizerScratchRoots = createTestScratchOwner();

const routeIds = [
  'openai-chat-plain',
  'openai-responses-via-openai',
  'openai-responses',
  'anthropic-cache-off',
];
const aliases = loadProviderAliasEntries();
const routes = WIRE_ROUTES.filter((route) => routeIds.includes(route.id)).map(
  (route): WireRoute => {
    const alias = aliases.find(
      (entry) =>
        entry.alias === route.providerName && entry.source === 'builtin',
    );
    if (alias === undefined)
      throw new Error(`Missing built-in ${route.providerName}`);
    const defaults = computeModelDefaults(
      route.model,
      alias.config.modelDefaults ?? [],
    );
    const override = defaults['context-limit'];
    const limit = tokenLimit(
      route.model,
      typeof override === 'number' ? override : undefined,
    );
    return {
      ...route,
      ephemerals: {
        ...defaults,
        ...route.ephemerals,
        'context-limit': Math.min(limit, 1_000_000),
        'reasoning.enabled': false,
        maxOutputTokens: 1024,
        'compression-threshold': 1,
      },
    };
  },
);
const shape: HistoryCase = {
  id: 'native-realistic-maximum',
  description: 'near-window text and budget-filling PNGs',
  rows: [],
};
const tokenizers = createRuntimeTokenizerFactory(tokenizerScratchRoots);

function contextLimit(route: WireRoute): number {
  const override = route.ephemerals['context-limit'];
  return tokenLimit(
    route.model,
    typeof override === 'number' ? override : undefined,
  );
}

interface MediaFixture {
  readonly references: MediaReferenceBlock[];
  readonly binding: MediaBinding;
  readonly store: LocalMediaStore;
  readonly encodedBytes: number;
}

async function mediaFixture(
  targetBytes = DEFAULT_REQUEST_MEDIA_BUDGET_BYTES,
  budgetBytes = DEFAULT_REQUEST_MEDIA_BUDGET_BYTES,
): Promise<MediaFixture> {
  const parent = join(
    import.meta.dir,
    '../../../../tmp/854-notes/p4/w23/limits-memory-run-c/fixtures',
  );
  mkdirSync(parent, { recursive: true });
  const store = new LocalMediaStore({
    rootDirectory: mkdtempSync(join(parent, 'media-')),
    quotaBytes: budgetBytes,
  });
  const references: MediaReferenceBlock[] = [];
  let encodedBytes = 0;
  // Uncompressed noisy PNGs exercise actual pixels, not oversized fake headers.
  for (;;) {
    const height = Math.min(
      1000,
      Math.floor((((targetBytes - encodedBytes) * 3) / 4 - 8192) / (1024 * 3)),
    );
    if (height < 1) break;
    const bytes = await sharp(randomFillSync(Buffer.alloc(1024 * height * 3)), {
      raw: { width: 1024, height, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const reference = await store.admit({
      bytes,
      mimeType: 'image/png',
      dimensions: { width: 1024, height },
      semanticMetadata: {},
    });
    references.push(reference);
    encodedBytes += reference.normalizedBase64Length;
  }
  expect(encodedBytes).toBeLessThanOrEqual(targetBytes);
  expect(targetBytes - encodedBytes).toBeLessThan(16_000);
  return {
    references,
    store,
    encodedBytes,
    binding: { resolver: new RequestMediaResolver(store), budgetBytes },
  };
}

async function historyRows(
  route: WireRoute,
  media: MediaFixture,
): Promise<IContent[]> {
  await tokenizers.prepareTokenizer?.(route.providerName, route.model);
  const tokenizer = tokenizers.getTokenizer(route.providerName, route.model);
  if (tokenizer === undefined)
    throw new Error(`Missing tokenizer for ${route.id}`);
  const imageTokens = media.references.reduce(
    (sum, image) =>
      sum +
      estimateImageTokens({
        provider: route.providerName,
        model: route.model,
        dimensions: image.dimensions,
      }),
    0,
  );
  const sample = ' information'.repeat(4096);
  const framingAndOutput = Math.min(
    8192,
    Math.floor(contextLimit(route) * 0.02),
  );
  const target = contextLimit(route) - imageTokens - framingAndOutput;
  const repeats = Math.floor(
    (target * 4096) / (await tokenizer.countTokens(sample)),
  );
  const rows: IContent[] = Array.from({ length: 64 }, (_, index) => ({
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text: ' information'.repeat(
          Math.floor(repeats / 64) + (index < repeats % 64 ? 1 : 0),
        ),
      },
    ],
  }));
  rows.push({
    speaker: 'human',
    blocks: [
      {
        type: 'text',
        text: 'Compare these images with the conversation above.',
      },
      ...media.references,
    ],
  });
  expect(retireHistoricalImages(rows, [], media.binding.budgetBytes)).toBe(
    rows,
  );
  return rows;
}

async function oracle(
  route: WireRoute,
  rows: IContent[],
  media: MediaFixture,
): Promise<WireBodyRecord> {
  return recordOf(
    await sendThroughRoute(route, { ...shape, rows }, 'rows', media.binding),
  );
}

function assertReleased(media: MediaFixture): void {
  expect(media.binding.resolver.accounting().activeRequestCount).toBe(0);
  expect(media.binding.resolver.accounting().reservedContentCount).toBe(0);
}

async function verifyMaximumSend(
  route: WireRoute,
): Promise<ProviderRequestSelection> {
  const media = await mediaFixture();
  expect(media.references).toHaveLength(4);
  const rows = await historyRows(route, media);
  const fixture = await nativeJournalSendFixture(rows, {
    mediaStore: media.store,
  });
  const sink = await localWireHashSink(route);
  try {
    expect(
      await retireSourceImages(
        fixture.selection,
        [rows[rows.length - 1]],
        media.binding.budgetBytes,
      ),
    ).toBe(fixture.selection);
    const expected = await oracle(
      route.id === 'anthropic-cache-off' ? sink.route : route,
      rows,
      media,
    );
    expect(expected.length).toBeLessThan(
      ANTHROPIC_NATIVE_REQUEST_ENVELOPE_BYTES,
    );
    expect(expected.length).toBeGreaterThan(media.encodedBytes);
    const provider = bindProviderMedia(
      route.createProvider(),
      media.binding.resolver,
      media.binding.budgetBytes,
    );
    const options = buildHistoryCallOptions(
      sink.route,
      shape,
      'rows',
      new SettingsService(),
      fixture.selection,
    );
    const projection = await provider.projectPromptEnvelope?.(options);
    if (projection === undefined)
      throw new Error(`Missing projection for ${route.id}`);
    try {
      const estimate = await estimatePromptEnvelope(
        route.providerName,
        projection,
        tokenizers,
      );
      expect(estimate.estimatedPromptTokens).toBeGreaterThan(
        contextLimit(route) * 0.95,
      );
      const enforcer = new ProviderSourceEnforcer({
        limits: {
          limit: contextLimit(route),
          completionBudget: 1024,
          marginAdjustedLimit: computeMarginAdjustedLimit(contextLimit(route)),
          compressionThreshold: contextLimit(route),
        },
        estimate: async () => estimate.estimatedPromptTokens,
        getHistoryTokens: () => estimate.estimatedPromptTokens,
      });
      expect((await enforcer.assess('initial')).next).toBe('send');
      for await (const chunk of provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      }))
        void chunk;
      expect(fixture.selection.count).toBe(rows.length);
      expect(sink.entries()).toBe(1);
      expect(sink.requests).toHaveLength(1);
      expect(sink.requests[0].bytes).toBe(expected.length);
      expect(sink.requests[0].sha256).toBe(expected.sha256);
      expect(sink.requests[0].contentLength).toBe(String(expected.length));
      if (process.env.SEND_PEAK_LOG !== undefined)
        appendFileSync(
          process.env.SEND_PEAK_LOG,
          `${JSON.stringify({ route: route.id, contextTokens: contextLimit(route), estimatedTokens: estimate.estimatedPromptTokens, textBytes: rows.reduce((sum, row) => sum + row.blocks.reduce((bytes, block) => bytes + (block.type === 'text' ? Buffer.byteLength(block.text) : 0), 0), 0), imageCount: media.references.length, imageBytes: media.encodedBytes, expected, actual: sink.requests[0] })}\n`,
        );
      assertReleased(media);
    } finally {
      await projection.releaseIfUnsent?.();
    }
  } finally {
    await sink.close();
    await fixture.close();
  }
  return fixture.selection;
}

describe('native journal realistic maximum production sends', () => {
  for (const route of routes) {
    it(`${route.id}: sends near-context text and the full image budget with exact oracle bytes and Content-Length over HTTP`, async () => {
      const selection = await verifyMaximumSend(route);
      expect(() => selection.openReader()).toThrow('closed');
    }, 170000);
  }
});

describe('native Anthropic pending-image body overflow', () => {
  it('refuses allowed pending images just over 32,000,000 bytes before submitting HTTP', async () => {
    const route = routes.find((route) => route.id === 'anthropic-cache-off');
    if (route === undefined) throw new Error('Missing native Anthropic route');
    const baselineMedia = await mediaFixture();
    const baselineRows = await historyRows(route, baselineMedia);
    const sizingSink = await localWireHashSink(route);
    let baseline: WireBodyRecord;
    try {
      baseline = await oracle(sizingSink.route, baselineRows, baselineMedia);
    } finally {
      await sizingSink.close();
    }
    assertReleased(baselineMedia);
    const target =
      ANTHROPIC_NATIVE_REQUEST_ENVELOPE_BYTES -
      baseline.length +
      baselineMedia.encodedBytes +
      16_000;
    const media = await mediaFixture(
      target,
      ANTHROPIC_NATIVE_REQUEST_ENVELOPE_BYTES,
    );
    const pending: IContent = {
      ...baselineRows[baselineRows.length - 1],
      blocks: [
        {
          type: 'text',
          text: 'Compare these images with the conversation above.',
        },
        ...media.references,
      ],
    };
    const rows = [...baselineRows.slice(0, -1), pending];
    expect(media.references.length).toBeLessThanOrEqual(8);
    expect(
      retireHistoricalImages(
        rows.slice(0, -1),
        [pending],
        media.binding.budgetBytes,
      ),
    ).toStrictEqual(rows.slice(0, -1));
    expect(retireEveryHistoricalImage(rows, rows.length - 1)).toBe(rows);
    const fixture = await nativeJournalSendFixture(rows, {
      mediaStore: media.store,
    });
    const originalFetch = globalThis.fetch;
    let networkSubmissions = 0;
    try {
      expect(
        await retireSourceImages(
          fixture.selection,
          [pending],
          media.binding.budgetBytes,
        ),
      ).toBe(fixture.selection);
      expect(
        await retireSourceImages(
          fixture.selection,
          [pending],
          media.binding.budgetBytes,
          true,
        ),
      ).toBe(fixture.selection);
      globalThis.fetch = withFetchPreconnect(async (): Promise<Response> => {
        networkSubmissions += 1;
        return route.respond();
      });
      const provider = bindProviderMedia(
        route.createProvider(),
        media.binding.resolver,
        media.binding.budgetBytes,
      );
      const error = await providerStreamError(
        provider.generateChatCompletion(
          buildHistoryCallOptions(
            route,
            shape,
            'rows',
            new SettingsService(),
            fixture.selection,
          ),
        ),
      );
      expect(error).toBeInstanceOf(RequestBodyByteOverflowError);
      if (!(error instanceof RequestBodyByteOverflowError)) throw error;
      expect(error.limitBytes).toBe(ANTHROPIC_NATIVE_REQUEST_ENVELOPE_BYTES);
      expect(error.totalBytes).toBeGreaterThan(error.limitBytes);
      expect(error.totalBytes - error.limitBytes).toBeLessThan(17_000);
      expect(networkSubmissions).toBe(0);
      assertReleased(media);
      if (process.env.SEND_PEAK_LOG !== undefined)
        appendFileSync(
          process.env.SEND_PEAK_LOG,
          `${JSON.stringify({ route: route.id, refused: true, imageCount: media.references.length, imageBytes: media.encodedBytes, totalBytes: error.totalBytes, limitBytes: error.limitBytes })}\n`,
        );
    } finally {
      globalThis.fetch = originalFetch;
      await fixture.close();
    }
    expect(() => fixture.selection.openReader()).toThrow('closed');
  }, 170000);
});
