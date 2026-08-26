/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs every parity probe and writes the artifacts the decision document is
 * built from.
 *
 *   bun run all                 # every probe
 *   bun run probe P04 P06       # named probes only
 *
 * Live by design: a missing API key aborts the run rather than degrading into
 * a table full of `gap` verdicts.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { collectDependencyFacts } from './dependency-facts.ts';
import {
  createProbeContext,
  RESULTS_DIR,
  findTransientStatusInObservation,
  isTransientError,
  writeArtifact,
  writeResult,
  type Probe,
  type ProbeResult,
} from './harness.ts';
import { PROBES } from './probes/index.ts';

const INTER_PROBE_PAUSE_MS = 10_000;

/**
 * Loads every `results/P*.json` artifact, preferring the freshly produced
 * result for any probe this invocation ran.
 */
function readAllResults(fresh: readonly ProbeResult[]): ProbeResult[] {
  const byId = new Map<string, ProbeResult>();
  if (existsSync(RESULTS_DIR)) {
    for (const file of readdirSync(RESULTS_DIR).sort()) {
      if (!/^P\d+\.json$/.test(file)) {
        continue;
      }
      const parsed = JSON.parse(
        readFileSync(join(RESULTS_DIR, file), 'utf8'),
      ) as ProbeResult;
      byId.set(parsed.id, parsed);
    }
  }
  for (const result of fresh) {
    byId.set(result.id, result);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A quota rejection says nothing about parity. Any probe whose adapter side
 * came back 429 is downgraded centrally so a rate-limited run can never be
 * mistaken for a capability finding.
 */
function markInconclusiveIfRateLimited(result: ProbeResult): ProbeResult {
  if (result.transientHandled === true) {
    return result;
  }
  const topLevel = [result.genai.error, result.aisdk.error].find((error) =>
    isTransientError(error),
  );
  const nested =
    findTransientStatusInObservation(result.genai.observation) ??
    findTransientStatusInObservation(result.aisdk.observation);
  const status = topLevel?.statusCode ?? nested;
  if (status === undefined) {
    return result;
  }
  return {
    ...result,
    verdict: 'partial',
    finding:
      `INCONCLUSIVE (HTTP ${status} from the provider, not a capability ` +
      `result): ${result.finding}`,
  };
}

function selectProbes(argv: readonly string[]): Probe[] {
  const onlyIndex = argv.indexOf('--only');
  const requested =
    onlyIndex === -1
      ? []
      : argv.slice(onlyIndex + 1).filter((entry) => !entry.startsWith('--'));
  if (requested.length === 0) {
    return [...PROBES];
  }
  const wanted = new Set(requested.map((entry) => entry.toUpperCase()));
  const selected = PROBES.filter((probe) => wanted.has(probe.id.toUpperCase()));
  const missing = [...wanted].filter(
    (id) => !selected.some((probe) => probe.id.toUpperCase() === id),
  );
  if (missing.length > 0) {
    throw new Error(`Unknown probe id(s): ${missing.join(', ')}`);
  }
  return selected;
}

async function main(): Promise<void> {
  const ctx = createProbeContext();
  const probes = selectProbes(process.argv.slice(2));

  const facts = await collectDependencyFacts();
  writeArtifact('dependency-facts.json', facts, ctx.redact);

  const results: ProbeResult[] = [];
  for (const [index, probe] of probes.entries()) {
    if (index > 0) {
      await new Promise((done) => setTimeout(done, INTER_PROBE_PAUSE_MS));
    }
    process.stdout.write(`→ ${probe.id} ${probe.area}\n`);
    const result = markInconclusiveIfRateLimited(await probe.run(ctx));
    writeResult(result, ctx.redact);
    results.push(result);
    process.stdout.write(`  ${result.verdict.toUpperCase()}: ${result.finding}\n`);
  }

  // The summary reflects every artifact on disk, not just the probes this
  // invocation ran, so re-running one probe after a rate-limited run updates
  // the roll-up instead of shrinking it to a single row.
  const onDisk = readAllResults(results);
  const summary = {
    generatedAt: new Date().toISOString(),
    models: { general: ctx.modelGeneral, gemini3: ctx.modelGemini3 },
    providerProtocolMatches: facts.protocol.matches,
    ranThisInvocation: results.map((result) => result.id),
    counts: {
      parity: onDisk.filter((r) => r.verdict === 'parity').length,
      partial: onDisk.filter((r) => r.verdict === 'partial').length,
      gap: onDisk.filter((r) => r.verdict === 'gap').length,
    },
    rows: onDisk.map((result) => ({
      id: result.id,
      area: result.area,
      question: result.question,
      models: result.models,
      verdict: result.verdict,
      finding: result.finding,
      genaiOk: result.genai.ok,
      aisdkOk: result.aisdk.ok,
      artifact: `results/${result.id}.json`,
    })),
  };
  writeArtifact('results/summary.json', summary, ctx.redact);

  process.stdout.write(
    `\nparity=${summary.counts.parity} partial=${summary.counts.partial} gap=${summary.counts.gap}\n`,
  );
}

await main();
