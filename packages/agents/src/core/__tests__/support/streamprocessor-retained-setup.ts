/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { observeRetainedLogging } from './streamprocessor-retained-logging.js';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import {
  projectionEndpoint,
  projectionInstructions,
} from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import {
  processorFixture,
  sourcePending,
  sourceWireOracle,
  largestSourceRowBytes,
} from './streamprocessor-source-fixture.js';
import { warmSourceProcessor } from './streamprocessor-source-measurements.js';
import {
  RetainedOwnerCensus,
  observeSourceOwners,
} from './streamprocessor-retained-census.js';
import { observeRetainedBody } from './streamprocessor-retained-body.js';

function observePreparation(
  setup: Awaited<ReturnType<typeof processorFixture>>,
  census: RetainedOwnerCensus,
): void {
  const project = setup.provider.projectPromptEnvelope;
  setup.provider.projectPromptEnvelope = async (options) => {
    census.observe('provider.options', options);
    const result = await project.call(setup.provider, options);
    census.observe('provider.projection', result);
    census.observe('provider.finalized-projection', result.finalizedProjection);
    census.observe('provider.release-closure', result.releaseIfUnsent);
    return result;
  };
  const enforceSource = setup.compression.enforceProviderSource;
  setup.compression.enforceProviderSource = (provider, estimate) => {
    census.observe('compression.estimate-closure', estimate);
    census.cleanup.enforcementAttempts++;
    return enforceSource.call(setup.compression, provider, estimate);
  };
  const clearCallback = setup.compression.clearProviderCompressionCallback;
  setup.compression.clearProviderCompressionCallback = (provider) => {
    census.cleanup.callbackClearAttempts++;
    return clearCallback.call(setup.compression, provider);
  };
}

function noPayloadOracle(): { bytes: number; sha256: string } {
  const body = JSON.stringify({
    model: 'gpt-5.6',
    input: [],
    stream: true,
    instructions: projectionInstructions,
  });
  return {
    bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

async function nativeOracle(
  setup: Awaited<ReturnType<typeof processorFixture>>,
  count: number,
  large: boolean,
) {
  const projected = await setup.provider.projectPromptEnvelope({
    contents: {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < count; index++)
          yield diskTextRow(index, large);
        if (count !== 0) yield sourcePending;
      },
    },
    config: setup.config,
    runtime: setup.runtime.providerRuntime,
    settings: setup.settings,
    systemInstruction: projectionInstructions,
  });
  try {
    return await estimatePromptEnvelope(
      setup.provider.name,
      projected,
      setup.nativeFactory,
    );
  } finally {
    await projected.releaseIfUnsent?.();
  }
}

export interface RetainedSetup {
  readonly evidence: string;
  readonly root: string;
  readonly mode: string;
  readonly count: number;
  readonly census: RetainedOwnerCensus;
  readonly restoreOwners: () => void;
  readonly restoreLogging: () => void;
  readonly http: ReturnType<typeof projectionEndpoint>;
  readonly setup: Awaited<ReturnType<typeof processorFixture>>;
  readonly oracle: Awaited<ReturnType<typeof nativeOracle>>;
  readonly expected: { bytes: number; sha256: string };
  readonly largestRowBytes: number;
  readonly observer: ReturnType<typeof observeRetainedBody>;
  readonly pending: IContent | IContent[];
}

export async function retainedSetup(): Promise<RetainedSetup> {
  const evidence =
    process.env.ISSUE854_RETAINED_EVIDENCE ??
    join(process.cwd(), 'tmp/streamprocessor-retained-20261008-sol');
  const root = mkdtempSync(join(evidence, 'fixtures/run-'));
  const mode = process.env.ISSUE854_RETAINED_MODE ?? 'small';
  const large = mode === 'large';
  const count = mode === 'none' ? 0 : 64;
  await warmSourceProcessor(root);
  const census = new RetainedOwnerCensus();
  const restoreOwners = observeSourceOwners(census);
  const http = projectionEndpoint(true);
  const setup = await processorFixture(
    root,
    `http://127.0.0.1:${http.server.port}/v1`,
    large,
    count,
  );
  observePreparation(setup, census);
  const restoreLogging = observeRetainedLogging(setup.runtime, census);
  const oracle = await nativeOracle(setup, count, large);
  const expected = count === 0 ? noPayloadOracle() : sourceWireOracle(large);
  const largestRowBytes = count === 0 ? 0 : largestSourceRowBytes(large);
  const observer = observeRetainedBody(census);
  const pending: IContent | IContent[] = count === 0 ? [] : sourcePending;
  return {
    evidence,
    root,
    mode,
    count,
    census,
    restoreOwners,
    restoreLogging,
    http,
    setup,
    oracle,
    expected,
    largestRowBytes,
    observer,
    pending,
  };
}
