/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  projectionEndpoint,
  projectionInstructions,
} from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { createSourcePromptEnvelopePreparer } from './prompt-envelope-source-send.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { sourceBeforeModelHook } from './source-before-model-hook.js';
import { processorFixture } from './__tests__/support/streamprocessor-source-fixture.js';
import { ProviderSourceEnforcer } from '../compression/provider-source-enforcement.js';
import {
  ladderPending,
  ladderHistoryDigest,
} from './__tests__/support/source-compression-ladder-fixture.js';

const root = sourceRootSetup();

async function scalarSetup() {
  const http = projectionEndpoint(false);
  const setup = await processorFixture(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
  );
  setup.settings.set('compression.strategy', 'high-density');
  setup.settings.set('context-limit', 4000);
  setup.settings.set('maxOutputTokens', 128);
  const preparer = createSourcePromptEnvelopePreparer(
    setup.provider,
    (source) => ({
      contents: { [Symbol.asyncIterator]: () => source.openReader() },
      requestRows: source,
      contentCount: source.count,
      config: setup.config,
      runtime: setup.runtime.providerRuntime,
      settings: setup.settings,
      systemInstruction: projectionInstructions,
    }),
  );
  const open = async () =>
    sourceBeforeModelHook({
      config: undefined,
      snapshot: await setup.history.prepareCuratedForProviderSnapshot(
        [ladderPending],
        { root: root() },
      ),
      pending: ladderPending,
      model: 'gpt-5.6',
      tools: undefined,
      log: () => undefined,
    });
  let source = await open();
  preparer.own(source);
  const scalar = new ProviderSourceEnforcer({
    limits: setup.compression.sourceContextLimits(setup.provider),
    estimate: async () =>
      (await preparer.prepare(source)).estimatedPromptTokens,
    getHistoryTokens: () => setup.history.getTotalTokens(),
  });
  return {
    http,
    setup,
    preparer,
    scalar,
    async replace(): Promise<void> {
      source = await open();
      preparer.own(source);
    },
  };
}

async function scalarDiskDiagnostic() {
  const { http, setup, preparer, scalar, replace } = await scalarSetup();
  try {
    const beforeDigest = await ladderHistoryDigest(setup);
    const before = await scalar.assess('initial');
    await setup.compression.ensureDensityOptimized();
    await replace();
    const density = await scalar.assess('post-density-optimization');
    const result = await setup.compression.performCompression(
      'scalar-disk-diagnostic',
      { bypassCooldown: true, trigger: 'auto' },
    );
    await replace();
    const after = await scalar.assess(
      'post-compression',
      density.projected,
      result,
    );
    const facts = {
      before,
      density,
      result,
      after,
      beforeDigest,
      afterDigest: await ladderHistoryDigest(setup),
      bodies: http.bodies,
      projections: setup.provider.tokens.length,
    };
    const evidence = process.env.ISSUE854_COMPRESSION_EVIDENCE;
    if (evidence !== undefined)
      writeFileSync(
        join(evidence, `scalar-disk-${process.pid}.json`),
        JSON.stringify(facts, null, 2),
      );
    return facts;
  } finally {
    await preparer.releaseUnused();
    expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
    expect(activeRequestBodyCount()).toBe(0);
    setup.history.dispose();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

describe('real configured compressor with scalar full-disk measurements', () => {
  it('measures the whole fresh owner after density and atomic compression, without claiming source-ladder HTTP success', async () => {
    const facts = await scalarDiskDiagnostic();
    expect(facts.before.next).toBe('density');
    expect(facts.density.next).toBe('compression');
    expect(facts.result).toBe(PerformCompressionResult.COMPRESSED);
    expect(facts.after.next).toBe('send');
    expect(facts.after.projected).toBeLessThanOrEqual(3015);
    expect(facts.afterDigest).not.toBe(facts.beforeDigest);
    expect(facts.projections).toBe(3);
    expect(facts.bodies).toHaveLength(0);
  }, 600000);
});
