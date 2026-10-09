/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { retainedCheckpoint } from './streamprocessor-retained-census.js';
import { retainedSetup } from './streamprocessor-retained-setup.js';

type RetainedSetup = Awaited<ReturnType<typeof retainedSetup>>;

function snapshot(input: RetainedSetup, stage: string): void {
  if (process.env.ISSUE854_HEAP_SNAPSHOT !== '1') return;
  writeFileSync(
    join(input.evidence, `heap-${input.mode}-${stage}-${process.pid}.json`),
    JSON.stringify(Bun.generateHeapSnapshot()),
  );
}

async function measure(input: RetainedSetup) {
  const { setup, http, observer, census } = input;
  const baseline = await retainedCheckpoint(census);
  snapshot(input, 'baseline');
  const started = setup.processor.makeApiCallAndProcessStream(
    {
      message: 'Answer the history.',
      config: { requestHistorySource: 'responses-disk-text' },
    },
    'retained-census',
    input.pending,
  );
  void started.catch(() => undefined);
  try {
    await Promise.race([
      observer.first.wait,
      started.then(() => {
        throw new Error('No BODY demand');
      }),
    ]);
    const first = await retainedCheckpoint(census);
    observer.resume.release();
    await http.arrived.wait;
    const receiver = await retainedCheckpoint(census);
    http.readBody.release();
    await http.uploaded.wait;
    await observer.last.wait;
    const last = await retainedCheckpoint(census);
    snapshot(input, 'last');
    http.respond.release();
    const stream = await started;
    const output: string[] = [];
    for await (const chunk of stream)
      output.push(
        ...chunk.content.blocks.flatMap((block) =>
          block.type === 'text' ? [block.text] : [],
        ),
      );
    const final = await retainedCheckpoint(census);
    return { baseline, first, receiver, last, final, output: output.join('') };
  } finally {
    observer.resume.release();
    http.readBody.release();
    http.respond.release();
    const stream = await started.catch(() => undefined);
    await stream?.return(undefined);
  }
}

function requestFacts(input: RetainedSetup) {
  const { setup, census } = input;
  return {
    mode: input.mode,
    pid: process.pid,
    retaining: process.env.ISSUE854_RETAIN_DERIVED_ROWS === '1',
    snapshots: process.env.ISSUE854_HEAP_SNAPSHOT === '1',
    bodyShells: census.bodyShells.length,
    supportsCompressionCallback:
      'setCompressionCallback' in setup.provider &&
      typeof setup.provider.setCompressionCallback === 'function',
    activeRowPeak: census.peak,
    cleanup: census.cleanup,
    segmentsRemaining: [...census.segmentPaths].filter((path) =>
      existsSync(path),
    ),
    rows: setup.history.references.length,
    originalSurvivors: setup.history.references.filter(
      (ref) => ref.deref() !== undefined,
    ).length,
    inputSurvivors: setup.history.inputReferences.filter(
      (ref) => ref.deref() !== undefined,
    ).length,
    owners: setup.history.owners,
    tokens: setup.provider.tokens.length,
    distinctRetryTokens: setup.provider.tokens[1] !== setup.provider.tokens[2],
    estimate: setup.processor.getPromptEnvelopeEstimate(),
    oracle: input.oracle,
    bodies: input.http.bodies,
    expected: input.expected,
    largestRowBytes: input.largestRowBytes,
    activeBodies: activeRequestBodyCount(),
    demand: input.observer.state,
    requests: setup.requests,
    telemetryEnabled: setup.config.getTelemetryEnabled(),
    logPrompts: setup.config.getTelemetryLogPromptsEnabled(),
  };
}

export async function runRetainedCensus() {
  const input = await retainedSetup();
  try {
    const measured = await measure(input);
    const detached = await retainedCheckpoint(input.census);
    const facts = {
      ...requestFacts(input),
      ...measured,
      detached,
      gateDelta:
        Math.max(
          measured.first.heap,
          measured.receiver.heap,
          measured.last.heap,
          measured.final.heap,
        ) - measured.baseline.heap,
      settledDelta: measured.final.heap - measured.baseline.heap,
      detachedDelta: detached.heap - measured.baseline.heap,
    };
    writeFileSync(
      join(
        input.evidence,
        `census-${input.mode}-${facts.retaining ? 'trap' : 'release'}-${process.pid}.json`,
      ),
      JSON.stringify(facts, null, 2),
    );
    snapshot(input, 'detached');
    return facts;
  } finally {
    input.observer.restore();
    input.restoreOwners();
    input.restoreLogging();
    input.setup.history.dispose();
    await input.http.server.stop(true);
    await input.setup.config.dispose();
    rmSync(input.root, { recursive: true, force: true });
  }
}
