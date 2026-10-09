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
} from '@vybestack/llxprt-code-providers/openai-responses/projection-ownership-fixture.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';
import { processorFixture } from './streamprocessor-source-fixture.js';
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

async function requiredCompression(large: boolean): Promise<void> {
  const http = projectionEndpoint(false);
  http.readBody.release();
  http.respond.release();
  const setup = await processorFixture(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
    large,
  );
  setup.settings.set('compression.strategy', 'high-density');
  setup.settings.set('context-limit', 4000);
  setup.settings.set('maxOutputTokens', 128);
  const before = await historyDigest(setup);
  const initialEstimate = large ? undefined : await legacyFinalized(setup);
  let failure: unknown;
  try {
    const stream = await setup.processor.makeApiCallAndProcessStream(
      {
        message: 'Compress history without losing pending.',
        config: { requestHistorySource: 'responses-disk-text' },
      },
      'source-pending-compression',
      pending,
    );
    const oracle = await legacyFinalized(setup);
    for await (const _chunk of stream) {
      /* Drain real HTTP and commit its lifecycle. */
    }
    expect(http.bodies).toHaveLength(1);
    expect(setup.processor.getPromptEnvelopeEstimate()).toStrictEqual(oracle);
    expect(oracle.estimatedPromptTokens + 128).toBeLessThanOrEqual(
      computeMarginAdjustedLimit(4000),
    );
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const after = await historyDigest(setup);
    expect(failure === undefined || after === before).toBe(true);
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

describe('required actual source pending-aware compression escalation', () => {
  it.each([false, true])(
    'compresses configured high-density disk history before HTTP, oversized=%s',
    async (large) => {
      await expect(requiredCompression(large)).resolves.toBeUndefined();
    },
    600000,
  );
});
