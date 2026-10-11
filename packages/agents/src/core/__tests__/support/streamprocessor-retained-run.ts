/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { existsSync, rmSync } from 'node:fs';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import type { DiskTextTail } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import {
  retainedCheckpoint,
  type RowRetention,
} from './streamprocessor-retained-census.js';
import { retainedSetup } from './streamprocessor-retained-setup.js';

type RetainedSetup = Awaited<ReturnType<typeof retainedSetup>>;

async function measure(input: RetainedSetup) {
  const { setup, http, observer, census } = input;
  const baseline = await retainedCheckpoint(census);
  const started = setup.processor.makeApiCallAndProcessStream(
    {
      message: 'Answer the history.',
      config: {},
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
    http.respond.release();
    const stream = await started;
    if (input.census.rowRetention === 'in-flight') input.census.trap.length = 0;
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
    pid: process.pid,
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

/**
 * Runs the scenario once at full size on the same path to settle one-time
 * state (encoder, code blocks) and then measures a second run.
 */
export async function runRetainedCensus(
  retention: RowRetention = 'none',
  tail: DiskTextTail = false,
) {
  await runCensusOnce('none', tail);
  return runCensusOnce(retention, tail);
}

/**
 * One full-size warm pass at the large tail, then the measured scenario at
 * the small tail and again `sends` times at each of the small and large tails, all in this
 * process. `large` is the first large send; `larges` holds every one so a
 * settled-heap gate can use the median of several sends. Retention
 * proportional to context is present in every send, while the collector noise
 * of a single settled reading is not.
 */
export async function runRetainedScaling(
  retention: RowRetention,
  small: DiskTextTail,
  large: DiskTextTail,
  sends = 1,
) {
  await runCensusOnce('none', large);
  const smalls = [];
  for (let index = 0; index < sends; index++)
    smalls.push(await runCensusOnce(retention, small));
  const larges = [];
  for (let index = 0; index < sends; index++)
    larges.push(await runCensusOnce(retention, large));
  return { small: smalls[0], smalls, large: larges[0], larges };
}

async function runCensusOnce(retention: RowRetention, tail: DiskTextTail) {
  const input = await retainedSetup(tail);
  input.census.rowRetention = retention;
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
