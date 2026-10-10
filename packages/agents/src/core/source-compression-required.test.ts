/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  projectionEndpoint,
  projectionInstructions,
} from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { ContextOverflowError } from '../compression/contextOverflowError.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  largestSourceRowBytes,
  processorFixture,
} from './__tests__/support/streamprocessor-source-fixture.js';
import { computeMarginAdjustedLimit } from '../compression/contextLimitPolicy.js';

const root = sourceRootSetup();
const pending: IContent = {
  speaker: 'human',
  blocks: [
    {
      type: 'text',
      text: 'Pending semantic suffix: preserve every quoted fact. "雪\\"',
    },
  ],
};

async function historyDigest(
  setup: Awaited<ReturnType<typeof processorFixture>>,
): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of setup.history.getCuratedForProviderStream([]))
    hash.update(JSON.stringify(row));
  return hash.digest('hex');
}

async function legacyFinalized(
  setup: Awaited<ReturnType<typeof processorFixture>>,
) {
  const projection = await setup.provider.projectPromptEnvelope({
    contents: setup.history.getCuratedForProviderStream([pending]),
    config: setup.config,
    runtime: setup.runtime.providerRuntime,
    settings: setup.settings,
    systemInstruction: projectionInstructions,
  });
  try {
    return await estimatePromptEnvelope(
      setup.provider.name,
      projection,
      setup.nativeFactory,
    );
  } finally {
    await projection.releaseIfUnsent?.();
  }
}

/** Holds the >10 MiB protected tail (about 1.3M tokens) but not the earlier history. */
const FITS_TAIL_LIMIT = 1322500;
const SMALL_LIMIT = 4000;

interface RequiredCase {
  readonly name: string;
  readonly large: boolean;
  readonly limit: number;
  readonly outcome: 'sent' | 'overflow';
}

async function requiredCompression(spec: RequiredCase): Promise<void> {
  const { large, limit, outcome } = spec;
  const http = projectionEndpoint(false);
  http.readBody.release();
  http.respond.release();
  const setup = await processorFixture(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
    large,
  );
  setup.settings.set('compression.strategy', 'high-density');
  setup.settings.set('context-limit', limit);
  setup.settings.set('maxOutputTokens', 128);
  const before = await historyDigest(setup);
  const initialEstimate = large ? undefined : await legacyFinalized(setup);
  let failure: unknown;
  try {
    const stream = await setup.processor.makeApiCallAndProcessStream(
      {
        message: 'Compress history without losing pending.',
        config: {},
      },
      'source-pending-compression',
      pending,
    );
    // The legacy collecting projection of a >10 MiB row does not finish in
    // test time; it is an array-route cost that WP16 deletes, so the large
    // rows are checked against the source estimate and the sent body instead.
    const oracle = large ? undefined : await legacyFinalized(setup);
    for await (const _chunk of stream) {
      /* Drain real HTTP and commit its lifecycle. */
    }
    expect(http.bodies).toHaveLength(1);
    const estimate = setup.processor.getPromptEnvelopeEstimate();
    if (oracle !== undefined) expect(estimate).toStrictEqual(oracle);
    expect(estimate?.estimatedPromptTokens).toBeLessThanOrEqual(
      computeMarginAdjustedLimit(limit) - 128,
    );
    if (large)
      expect(http.bodies[0]?.bytes).toBeGreaterThan(
        largestSourceRowBytes(true),
      );
  } catch (error) {
    failure = error;
    if (outcome === 'sent') throw error;
  } finally {
    const after = await historyDigest(setup);
    if (outcome === 'overflow') {
      expect(failure).toBeInstanceOf(ContextOverflowError);
      expect(http.bodies).toHaveLength(0);
    } else {
      expect(failure === undefined || after === before).toBe(true);
    }
    expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
    expect(activeRequestBodyCount()).toBe(0);
    const evidence = process.env.ISSUE854_COMPRESSION_EVIDENCE;
    if (evidence !== undefined)
      writeFileSync(
        join(evidence, `required-${large}-${process.pid}.json`),
        JSON.stringify(
          {
            large,
            before,
            after,
            initialEstimate,
            finalEstimate: setup.processor.getPromptEnvelopeEstimate(),
            bodies: http.bodies,
            owners: setup.history.owners,
            activeBodies: activeRequestBodyCount(),
            error: failure instanceof Error ? failure.message : String(failure),
          },
          null,
          2,
        ),
      );
    setup.history.dispose();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

const cases: RequiredCase[] = [
  { name: 'ordinary rows', large: false, limit: SMALL_LIMIT, outcome: 'sent' },
  {
    name: 'a valid row above 10MiB that the limit holds',
    large: true,
    limit: FITS_TAIL_LIMIT,
    outcome: 'sent',
  },
  {
    name: 'a protected row above 10MiB that exceeds the limit',
    large: true,
    limit: SMALL_LIMIT,
    outcome: 'overflow',
  },
];

describe('required actual source pending-aware compression escalation', () => {
  it.each(cases)(
    'compresses configured high-density disk history before HTTP, $name',
    async (spec) => {
      await expect(requiredCompression(spec)).resolves.toBeUndefined();
    },
    600000,
  );
});
