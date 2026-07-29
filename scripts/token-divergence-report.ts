/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ordinaryLeastSquares,
  meanAbsolutePercentageError,
  rootMeanSquareError,
  evaluateGate,
  type GateResult,
} from './token-divergence.js';
import {
  TRAIN_COUNT,
  HOLDOUT_COUNT,
  CORPUS_VERSION,
  type CorpusCategory,
} from './token-divergence-corpus.js';
import {
  TARGETS,
  validateSanitizedRow,
  type SanitizedRow,
  type TargetSpec,
} from './token-divergence-collect.js';

const ANALYSIS_METHOD = 'within-category incremental';
const CATEGORIES: readonly CorpusCategory[] = [
  'prose',
  'code',
  'json',
  'unicode',
  'mixed',
];

interface DeltaSample {
  readonly corpusId: number;
  readonly category: string;
  readonly split: 'train' | 'heldout';
  readonly estimated: number;
  readonly actual: number;
}

interface HeldoutError {
  readonly corpusId: number;
  readonly category: string;
  readonly actual: number;
  readonly current: number;
  readonly fitted: number;
  readonly currentError: number;
  readonly currentErrorPercent: number;
  readonly fittedError: number;
}

interface TargetReport {
  readonly target: string;
  readonly model: string;
  readonly protocol: string;
  readonly endpointHost: string;
  readonly runtimeEstimator: string;
  readonly controlCount: number;
  readonly trainCount: number;
  readonly heldoutCount: number;
  readonly slope: number;
  readonly intercept: number;
  readonly currentMape: number;
  readonly currentRmse: number;
  readonly currentMeanSignedPercent: number;
  readonly fittedMape: number;
  readonly fittedRmse: number;
  readonly fittedMapeDelta: number;
  readonly fittedRmseDelta: number;
  readonly cachedTokens: number;
  readonly cachedRows: number;
  readonly rejectedAttempts: number;
  readonly commitSha: string;
  readonly projectionVersion: string;
  readonly heldoutErrors: readonly HeldoutError[];
  readonly gate: GateResult;
}

export interface ReportOptions {
  readonly resultsPath: string;
  readonly outputPath: string;
  readonly analysisPath?: string;
}

export function generateReport(opts: ReportOptions): void {
  const rows = readRows(opts.resultsPath);
  validateCompleteness(rows);
  const reports = TARGETS.map((target) => buildTargetReport(rows, target));
  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  fs.writeFileSync(opts.outputPath, renderMarkdown(reports), 'utf-8');
  if (opts.analysisPath !== undefined) {
    fs.mkdirSync(path.dirname(opts.analysisPath), { recursive: true });
    fs.writeFileSync(
      opts.analysisPath,
      JSON.stringify({
        corpusVersion: CORPUS_VERSION,
        analysisMethod: ANALYSIS_METHOD,
        targets: reports,
      }),
      'utf-8',
    );
  }
}

function readRows(resultsPath: string): SanitizedRow[] {
  const raw = fs.readFileSync(resultsPath, 'utf-8').trim();
  if (raw.length === 0) throw new Error('Results file is empty');
  return raw.split('\n').map((line) => validateSanitizedRow(JSON.parse(line)));
}

function validateCompleteness(rows: readonly SanitizedRow[]): void {
  const expectedRowCount = TARGETS.length * (TRAIN_COUNT + HOLDOUT_COUNT);
  if (rows.length !== expectedRowCount)
    throw new Error(
      `Expected ${expectedRowCount} accepted rows, found ${rows.length}`,
    );
  if (new Set(rows.map((row) => row.sessionId)).size !== rows.length)
    throw new Error('Accepted rows contain duplicate session IDs');
  requireSingleValue(
    rows.map((row) => row.commitSha),
    'commitSha',
  );
  requireSingleValue(
    rows.map((row) => row.projectionVersion),
    'projectionVersion',
  );
  requireSingleValue(
    rows.map((row) => row.corpusVersion),
    'corpusVersion',
  );
  for (const target of TARGETS)
    validateTargetRows(
      rows.filter((row) => row.target === target.key),
      target,
    );
}

function requireSingleValue(values: readonly string[], label: string): void {
  if (new Set(values).size !== 1)
    throw new Error(`Rows contain mixed ${label}`);
}

function validateTargetRows(
  rows: readonly SanitizedRow[],
  target: TargetSpec,
): void {
  const expectedIds = Array.from(
    { length: TRAIN_COUNT + HOLDOUT_COUNT },
    (_, i) => i + 1,
  );
  const ids = [...rows.map((r) => r.corpusId)].sort((a, b) => a - b);
  if (ids.some((id, i) => id !== expectedIds[i]))
    throw new Error(
      `Target "${target.key}" has duplicate or missing corpus IDs`,
    );
  const metadataMatches = rows.every(
    (r) =>
      r.profile === target.profile &&
      r.protocol === target.protocol &&
      r.endpointHost === target.endpointHost &&
      r.model === target.model,
  );
  if (!metadataMatches)
    throw new Error(
      `Target "${target.key}" has unexpected profile or endpoint metadata`,
    );
  const expectedPerCategory = (TRAIN_COUNT + HOLDOUT_COUNT) / CATEGORIES.length;
  for (const category of CATEGORIES) {
    const count = rows.filter((r) => r.category === category).length;
    if (count !== expectedPerCategory)
      throw new Error(
        `Target "${target.key}" category "${category}" has ${count} rows`,
      );
  }
}

function buildDeltas(rows: readonly SanitizedRow[]): DeltaSample[] {
  return CATEGORIES.flatMap((category) => {
    const categoryRows = rows
      .filter((row) => row.category === category)
      .sort((left, right) => left.corpusId - right.corpusId);
    const control = categoryRows[0]!;
    return categoryRows.slice(1).map((row) => {
      const estimated = row.pendingTokens - control.pendingTokens;
      const actual = row.actualPromptTokens - control.actualPromptTokens;
      if (estimated <= 0 || actual <= 0) {
        throw new Error(
          `Nonpositive incremental tokens for ${row.target}/${category}/${row.corpusId}`,
        );
      }
      return {
        corpusId: row.corpusId,
        category,
        split: row.split === 'heldout' ? 'heldout' : 'train',
        estimated,
        actual,
      };
    });
  });
}

function buildTargetReport(
  rows: readonly SanitizedRow[],
  target: TargetSpec,
): TargetReport {
  const targetRows = rows.filter((row) => row.target === target.key);
  const deltas = buildDeltas(targetRows);
  const train = deltas.filter((sample) => sample.split === 'train');
  const heldout = deltas.filter((sample) => sample.split === 'heldout');
  const fit = ordinaryLeastSquares(
    train.map((sample) => ({ x: sample.estimated, y: sample.actual })),
  );
  const actuals = heldout.map((sample) => sample.actual);
  const currentPreds = heldout.map((sample) => sample.estimated);
  const fittedPreds = heldout.map(
    (sample) => fit.slope * sample.estimated + fit.intercept,
  );
  const currentMape = meanAbsolutePercentageError(actuals, currentPreds);
  const currentRmse = rootMeanSquareError(actuals, currentPreds);
  const fittedMape = meanAbsolutePercentageError(actuals, fittedPreds);
  const fittedRmse = rootMeanSquareError(actuals, fittedPreds);
  return {
    target: target.key,
    model: target.model,
    protocol: target.protocol,
    endpointHost: target.endpointHost,
    runtimeEstimator: estimatorName(target.model),
    controlCount: CATEGORIES.length,
    trainCount: train.length,
    heldoutCount: heldout.length,
    slope: fit.slope,
    intercept: fit.intercept,
    currentMape,
    currentRmse,
    currentMeanSignedPercent: mean(
      heldout.map(
        (sample) => ((sample.estimated - sample.actual) / sample.actual) * 100,
      ),
    ),
    fittedMape,
    fittedRmse,
    fittedMapeDelta: fittedMape - currentMape,
    fittedRmseDelta: fittedRmse - currentRmse,
    cachedTokens: targetRows.reduce((sum, row) => sum + row.cachedTokens, 0),
    cachedRows: targetRows.filter((row) => row.cachedTokens > 0).length,
    rejectedAttempts: targetRows.reduce(
      (sum, row) => sum + row.rejectedAttempts,
      0,
    ),
    commitSha: targetRows[0]!.commitSha,
    projectionVersion: targetRows[0]!.projectionVersion,
    heldoutErrors: heldout.map((sample, index) => ({
      corpusId: sample.corpusId,
      category: sample.category,
      actual: sample.actual,
      current: sample.estimated,
      fitted: fittedPreds[index]!,
      currentError: sample.estimated - sample.actual,
      currentErrorPercent:
        ((sample.estimated - sample.actual) / sample.actual) * 100,
      fittedError: fittedPreds[index]! - sample.actual,
    })),
    gate: evaluateGate({ currentMape, currentRmse, fittedMape, fittedRmse }),
  };
}

function estimatorName(model: string): string {
  if (model.includes('claude')) return 'AnthropicTokenizer character heuristic';
  if (model.includes('gpt')) return 'OpenAITokenizer o200k tiktoken fallback';
  return 'HistoryService generic max(words*1.3, chars/4)';
}

function renderMarkdown(reports: readonly TargetReport[]): string {
  const lines = [
    '# Issue #2253 — Runtime Token Estimator Divergence',
    '',
    `Corpus version: ${CORPUS_VERSION}`,
    `Analysis method: ${ANALYSIS_METHOD}`,
    '',
    '## Per-target results',
    '',
  ];
  for (const report of reports) renderTarget(lines, report);
  lines.push(
    '## Methodology',
    '',
    'For each target and content category, the smallest observation is the control. The analysis subtracts that control from each larger observation, comparing the incremental llxprt pending-content estimate with the incremental provider prompt/input usage. This within-category incremental subtraction controls for the fixed first-request system/tool/request accounting gap under validated fixed-component invariants tracked separately in issue 2817.',
    '',
    "Fifteen size-2 through size-4 deltas train OLS actualDelta = m * estimatedDelta + b. Five size-5 deltas are held out. The gate passes only when fitted held-out MAPE and RMSE are both no worse than the current runtime estimator. Train and held-out deltas share each category's size-1 control.",
    '',
    '## Validity caveats',
    '',
    '- Tool hashes were stable for every target. Projected request length after removing the controlled prompt was stable, except a two-character variation for one Ollama GLM run.',
    '- System payload hashes changed for four targets because each fresh CLI process included dynamic context, but system payload character counts and local o200k token counts were invariant within each target. Provider totals progressed deterministically with corpus size.',
    '- These results measure incremental estimator behavior, not first-turn full-request accounting, context-window synchronization, or TPM.',
    '- Cached tokens are reported but are not subtracted from provider ground truth.',
    '- Raw request dumps, prompts, model responses, credentials, and headers are excluded from committed results.',
    '',
  );
  return lines.join('\n');
}

function renderTarget(lines: string[], report: TargetReport): void {
  lines.push(
    `### ${report.target} (${report.model})`,
    `- Protocol: ${report.protocol}`,
    `- Endpoint host: ${report.endpointHost}`,
    `- Runtime estimator: ${report.runtimeEstimator}`,
    `- Samples: ${report.controlCount} controls, ${report.trainCount} train deltas, ${report.heldoutCount} held-out deltas`,
    `- OLS fit: actualDelta = ${report.slope.toFixed(6)} * estimatedDelta + ${report.intercept.toFixed(2)}`,
    `- Current mean signed error: ${signed(report.currentMeanSignedPercent)}%`,
    `- Delta from current: fitted MAPE ${signed(report.fittedMapeDelta)} points; fitted RMSE ${signed(report.fittedRmseDelta)} tokens`,
    `- Cached-token summary: ${report.cachedTokens} tokens across ${report.cachedRows} rows`,
    `- Rejected attempts: ${report.rejectedAttempts}`,
    `- Provenance: commit ${report.commitSha}; projection ${report.projectionVersion}; corpus ${CORPUS_VERSION}`,
    '',
    '| Predictor | Held-out MAPE (%) | Held-out RMSE |',
    '| --- | --- | --- |',
    `| current runtime estimator | ${report.currentMape.toFixed(2)} | ${report.currentRmse.toFixed(2)} |`,
    `| fitted correction | ${report.fittedMape.toFixed(2)} | ${report.fittedRmse.toFixed(2)} |`,
    '',
    `- Gate: ${report.gate.passed ? 'PASS' : 'FAIL'} — ${report.gate.reason}`,
    '',
    '#### Held-out errors',
    '',
    '| ID | Category | Provider delta | Current delta | Current error | Current error (%) | Fitted delta | Fitted error |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const error of report.heldoutErrors) {
    lines.push(
      `| ${error.corpusId} | ${error.category} | ${error.actual} | ${error.current} | ${signed(error.currentError)} | ${signed(error.currentErrorPercent)} | ${error.fitted.toFixed(2)} | ${signed(error.fittedError)} |`,
    );
  }
  lines.push('');
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
