/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { projectionEndpoint } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import type { DiskTextTail } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { processorFixture } from './streamprocessor-source-fixture.js';

function failureName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function failureMessage(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}

export const ladderPending: IContent = {
  speaker: 'human',
  blocks: [
    {
      type: 'text',
      text: 'Preserve pending facts exactly: "雪\\" and the final choice.',
    },
  ],
};

export async function ladderHistoryDigest(
  setup: Awaited<ReturnType<typeof processorFixture>>,
): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of setup.history.streamRawHistory())
    hash.update(JSON.stringify(row));
  return hash.digest('hex');
}

type TracedStage =
  | 'ensureDensityOptimized'
  | 'performCompression'
  | 'runDiskFallback';

/** Records the ordered reduction stages both routes drive through the shared handler. */
function traceStages(
  compression: Awaited<ReturnType<typeof processorFixture>>['compression'],
  stages: string[],
): void {
  const handler = compression as unknown as Record<
    TracedStage,
    (...args: unknown[]) => unknown
  >;
  const names: Array<[TracedStage, string]> = [
    ['ensureDensityOptimized', 'density'],
    ['performCompression', 'compress'],
    ['runDiskFallback', 'fallback'],
  ];
  for (const [method, label] of names) {
    const original = handler[method].bind(compression);
    handler[method] = (...args) => {
      stages.push(label);
      return original(...args);
    };
  }
}

export async function ladderAttempt(
  root: string,
  disk: boolean,
  large: DiskTextTail,
  contextLimit = 4000,
  preserveThreshold?: number,
) {
  const http = projectionEndpoint(false);
  http.readBody.release();
  http.respond.release();
  const setup = await processorFixture(
    root,
    `http://127.0.0.1:${http.server.port}/v1`,
    large,
  );
  setup.settings.set('compression.strategy', 'high-density');
  setup.settings.set('context-limit', contextLimit);
  setup.settings.set('maxOutputTokens', 128);
  if (preserveThreshold !== undefined)
    setup.settings.set('compression-preserve-threshold', preserveThreshold);
  const stages: string[] = [];
  traceStages(setup.compression, stages);
  const before = await ladderHistoryDigest(setup);
  let error: unknown;
  const output: unknown[] = [];
  try {
    const stream = await setup.processor.makeApiCallAndProcessStream(
      {
        message: 'Compress before sending.',
        config: disk ? { requestHistorySource: 'responses-disk-text' } : {},
      },
      'source-compression-ladder',
      ladderPending,
    );
    for await (const chunk of stream) output.push(chunk);
  } catch (failure: unknown) {
    error = failure;
  }
  const result = {
    disk,
    large,
    before,
    after: await ladderHistoryDigest(setup),
    historyTokens: setup.history.getTotalTokens(),
    estimate: setup.processor.getPromptEnvelopeEstimate(),
    bodies: http.bodies,
    output,
    owners: setup.history.owners,
    projections: setup.provider.tokens.length,
    activeBodies: activeRequestBodyCount(),
    cooldown: setup.compression.isCompressionInCooldown(),
    error: failureMessage(error),
    errorName: failureName(error),
    stages,
  };
  setup.history.dispose();
  await http.server.stop(true);
  await setup.config.dispose();
  return result;
}
