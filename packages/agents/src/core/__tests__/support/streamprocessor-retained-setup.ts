/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { observeRetainedLogging } from './streamprocessor-retained-logging.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import {
  diskTextRow,
  type DiskTextTail,
  type DistributedTextRows,
} from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import {
  projectionEndpoint,
  projectionInstructions,
} from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import {
  processorFixture,
  sourcePending,
  sourceWireOracle,
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
  const enforceSource = setup.compression.enforceProviderSource.bind(
    setup.compression,
  );
  setup.compression.enforceProviderSource = <
    S extends ProviderRequestSelection,
  >(
    ...args: Parameters<typeof enforceSource<S>>
  ): Promise<S> => {
    census.observe('compression.estimate-closure', args[3]);
    census.cleanup.enforcementAttempts++;
    return enforceSource<S>(...args);
  };
  const clearCallback = setup.compression.clearProviderCompressionCallback;
  setup.compression.clearProviderCompressionCallback = (provider) => {
    census.cleanup.callbackClearAttempts++;
    return clearCallback.call(setup.compression, provider);
  };
}

async function nativeOracle(
  setup: Awaited<ReturnType<typeof processorFixture>>,
  count: number,
  large: DiskTextTail | DistributedTextRows,
) {
  const projected = await setup.provider.projectPromptEnvelope({
    contents: callerOwnedRawProviderSource([
      ...Array.from({ length: count }, (_, index) => diskTextRow(index, large)),
      ...(count === 0 ? [] : [sourcePending]),
    ]),
    invocation: setup.runtime.prepareProviderInvocation(setup.provider.name),
    resolved: { model: 'gpt-5.6' },
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
  readonly root: string;
  readonly count: number;
  readonly census: RetainedOwnerCensus;
  readonly restoreOwners: () => void;
  readonly restoreLogging: () => void;
  readonly http: ReturnType<typeof projectionEndpoint>;
  readonly setup: Awaited<ReturnType<typeof processorFixture>>;
  readonly oracle: Awaited<ReturnType<typeof nativeOracle>>;
  readonly expected: { bytes: number; sha256: string };
  readonly largestRowBytes: number;
  readonly largestRowTokens: number;
  readonly contextLimit: number;
  readonly observer: ReturnType<typeof observeRetainedBody>;
  readonly pending: IContent | IContent[];
}

export async function retainedSetup(
  large: DiskTextTail | DistributedTextRows = false,
): Promise<RetainedSetup> {
  const root = mkdtempSync(join(tmpdir(), 'streamprocessor-retained-'));
  const count = 64;
  await warmSourceProcessor(root);
  const census = new RetainedOwnerCensus();
  const http = projectionEndpoint(true);
  const setup = await processorFixture(
    root,
    `http://127.0.0.1:${http.server.port}/v1`,
    large,
    count,
  );
  const restoreOwners = observeSourceOwners(census, (row) => {
    setup.history.references.push(new WeakRef(row));
    if (setup.history.retainRows) setup.history.retained.push(row);
  });
  observePreparation(setup, census);
  const restoreLogging = observeRetainedLogging(setup.runtime, census);
  const oracle = await nativeOracle(setup, count, large);
  const expected = sourceWireOracle(large);
  const tokenizer = setup.nativeFactory.getTokenizer(
    'openai-responses',
    'gpt-5.6',
  );
  if (tokenizer === undefined) throw new Error('Missing route tokenizer');
  let largestRowBytes = 0;
  let largestRowTokens = 0;
  for (let index = 0; index < count; index++) {
    const row = diskTextRow(index, large);
    largestRowBytes = Math.max(
      largestRowBytes,
      Buffer.byteLength(JSON.stringify(row)),
    );
    const text = row.blocks
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join(row.speaker === 'human' ? '\n' : '');
    largestRowTokens = Math.max(
      largestRowTokens,
      await tokenizer.countTokens(text),
    );
  }
  const contextLimit = setup.runtime.ephemerals.contextLimit();
  if (oracle.estimatedPromptTokens >= contextLimit)
    throw new Error('Census fixture exceeds the real model window');
  const observer = observeRetainedBody(census);
  const pending: IContent | IContent[] = sourcePending;
  return {
    root,
    count,
    census,
    restoreOwners,
    restoreLogging,
    http,
    setup,
    oracle,
    expected,
    largestRowBytes,
    largestRowTokens,
    contextLimit,
    observer,
    pending,
  };
}
