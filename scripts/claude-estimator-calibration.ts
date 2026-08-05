/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2835 — offline calibration fit for the Claude 5 prompt estimators.
 *
 * Deterministic and offline. It reads the sanitized live observations produced
 * by `claude-estimator-collect.ts` and fits one calibration per model against
 * the complete provider `promptTokens`.
 *
 * Each model is fitted, selected and gated entirely within its own
 * observations. No coefficient, metric or gate decision crosses between
 * models, so a model can only activate on evidence collected for that model.
 *
 * Because the corpus varies the system/tool envelope, whole requests can be
 * modelled directly and a per-request framing constant is identifiable. Model
 * selection uses leave-one-category-out cross-validation over training rows
 * only, so the held-out rows that justify activation never influence which
 * feature set is chosen.
 *
 * Usage: bun scripts/claude-estimator-calibration.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyClaudeCalibration,
  type ClaudeCalibrationCoefficients,
} from '../packages/providers/src/tokenizers/claude/claudeCalibration.js';
import {
  CLAUDE_CONTENT_FEATURE_NAMES,
  type ClaudeContentFeatureName,
  type ClaudeContentFeatures,
} from '../packages/providers/src/tokenizers/claude/claudeContentFeatures.js';
import { CLAUDE_CORPUS_VERSION } from './claude-estimator-corpus.js';

const SOURCE_RESULTS = 'research/issue2835/claude5-live-results.jsonl';
const REPORT_DIR = 'research/issue2835';
const FIXTURE_DIR = 'packages/providers/src/tokenizers/claude/fixtures';
const EXPECTED_PROJECTION_REVISION = 3;

interface LiveRow {
  readonly target: string;
  readonly model: string;
  readonly activeProvider: string;
  readonly endpointHost: string;
  readonly protocol: string;
  readonly corpusId: number;
  readonly split: 'train' | 'heldout';
  readonly category: string;
  readonly envelope: string;
  readonly projectionRevision: number;
  readonly projectionBaseTokens: number;
  readonly codePoints: number;
  readonly nonAsciiCodePoints: number;
  readonly structuralCodePoints: number;
  readonly whitespaceCodePoints: number;
  readonly heuristicTokens: number;
  readonly providerPromptTokens: number;
  readonly cachedPromptTokens: number;
  readonly corpusVersion: string;
  readonly commitSha: string;
}

function requireInteger(value: unknown, label: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(
      `${label} must be an integer >= ${min}, got ${String(value)}`,
    );
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireSplit(value: unknown): 'train' | 'heldout' {
  if (value !== 'train' && value !== 'heldout') {
    throw new Error(`split must be train or heldout, got ${String(value)}`);
  }
  return value;
}

function validateRow(value: unknown, label: string): LiveRow {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} is not an object`);
  }
  const row = value as Record<string, unknown>;
  return {
    target: requireString(row['target'], 'target'),
    model: requireString(row['model'], 'model'),
    activeProvider: requireString(row['activeProvider'], 'activeProvider'),
    endpointHost: requireString(row['endpointHost'], 'endpointHost'),
    protocol: requireString(row['protocol'], 'protocol'),
    corpusId: requireInteger(row['corpusId'], 'corpusId', 1),
    split: requireSplit(row['split']),
    category: requireString(row['category'], 'category'),
    envelope: requireString(row['envelope'], 'envelope'),
    projectionRevision: requireInteger(
      row['projectionRevision'],
      'projectionRevision',
      0,
    ),
    projectionBaseTokens: requireInteger(
      row['projectionBaseTokens'],
      'projectionBaseTokens',
      1,
    ),
    codePoints: requireInteger(row['codePoints'], 'codePoints', 1),
    nonAsciiCodePoints: requireInteger(
      row['nonAsciiCodePoints'],
      'nonAsciiCodePoints',
      0,
    ),
    structuralCodePoints: requireInteger(
      row['structuralCodePoints'],
      'structuralCodePoints',
      0,
    ),
    whitespaceCodePoints: requireInteger(
      row['whitespaceCodePoints'],
      'whitespaceCodePoints',
      0,
    ),
    heuristicTokens: requireInteger(
      row['heuristicTokens'],
      'heuristicTokens',
      1,
    ),
    providerPromptTokens: requireInteger(
      row['providerPromptTokens'],
      'providerPromptTokens',
      1,
    ),
    cachedPromptTokens: requireInteger(
      row['cachedPromptTokens'],
      'cachedPromptTokens',
      0,
    ),
    corpusVersion: requireString(row['corpusVersion'], 'corpusVersion'),
    commitSha: requireString(row['commitSha'], 'commitSha'),
  };
}

/**
 * Every observation for one model must share its identity and provenance, and
 * the split must be usable. A corpus that mixes models, providers, protocols
 * or projection revisions cannot support a single calibration.
 */
function validateGroup(target: string, rows: readonly LiveRow[]): void {
  if (rows.length === 0) throw new Error(`no observations for ${target}`);
  for (const key of [
    'model',
    'activeProvider',
    'endpointHost',
    'protocol',
    'corpusVersion',
    'commitSha',
  ] as const) {
    const distinct = new Set(rows.map((row) => row[key]));
    if (distinct.size !== 1) {
      throw new Error(`${target} mixes ${key}: ${[...distinct].join(', ')}`);
    }
  }
  const revisions = new Set(rows.map((row) => row.projectionRevision));
  if (revisions.size !== 1 || !revisions.has(EXPECTED_PROJECTION_REVISION)) {
    throw new Error(
      `${target} projection revisions ${[...revisions].join(', ')} !== ${EXPECTED_PROJECTION_REVISION}`,
    );
  }
  if (rows[0]!.corpusVersion !== CLAUDE_CORPUS_VERSION) {
    throw new Error(
      `${target} corpus ${rows[0]!.corpusVersion} !== ${CLAUDE_CORPUS_VERSION}`,
    );
  }
  const ids = rows.map((row) => row.corpusId);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${target} has duplicate corpusId values`);
  }
  if (!rows.some((row) => row.split === 'train')) {
    throw new Error(`${target} has no training observations`);
  }
  if (!rows.some((row) => row.split === 'heldout')) {
    throw new Error(`${target} has no held-out observations`);
  }
}

function featuresOf(row: LiveRow): ClaudeContentFeatures {
  return {
    codePoints: row.codePoints,
    nonAsciiCodePoints: row.nonAsciiCodePoints,
    structuralCodePoints: row.structuralCodePoints,
    whitespaceCodePoints: row.whitespaceCodePoints,
  };
}

/** Design row: intercept, base counter reading, then the selected features. */
function designOf(
  row: LiveRow,
  featureNames: readonly ClaudeContentFeatureName[],
): readonly number[] {
  const features = featuresOf(row);
  return [1, row.projectionBaseTokens, ...featureNames.map((n) => features[n])];
}

function fit(
  rows: readonly LiveRow[],
  featureNames: readonly ClaudeContentFeatureName[],
): readonly number[] {
  const width = featureNames.length + 2;
  if (rows.length < width) {
    throw new Error(`need >= ${width} observations to fit ${width} parameters`);
  }
  const normal = Array.from({ length: width }, () =>
    new Array<number>(width + 1).fill(0),
  );
  for (const row of rows) {
    const design = designOf(row, featureNames);
    for (let i = 0; i < width; i++) {
      normal[i]![width] += design[i]! * row.providerPromptTokens;
      for (let j = 0; j < width; j++) {
        normal[i]![j]! += design[i]! * design[j]!;
      }
    }
  }
  for (let col = 0; col < width; col++) {
    let pivot = col;
    for (let r = col + 1; r < width; r++) {
      if (Math.abs(normal[r]![col]!) > Math.abs(normal[pivot]![col]!))
        pivot = r;
    }
    [normal[col], normal[pivot]] = [normal[pivot]!, normal[col]!];
    const scale = normal[col]![col]!;
    // A near-singular pivot means the candidate features are collinear on this
    // data, so the coefficients would be arbitrary. Reject rather than publish
    // numbers the corpus cannot identify.
    if (!Number.isFinite(scale) || Math.abs(scale) < 1e-9) {
      throw new Error('singular or near-singular normal equations');
    }
    for (let c = col; c <= width; c++) normal[col]![c]! /= scale;
    for (let r = 0; r < width; r++) {
      if (r === col) continue;
      const factor = normal[r]![col]!;
      for (let c = col; c <= width; c++) {
        normal[r]![c]! -= factor * normal[col]![c]!;
      }
    }
  }
  return normal.map((row) => row[width]!);
}

function toCoefficients(
  raw: readonly number[],
  featureNames: readonly ClaudeContentFeatureName[],
): ClaudeCalibrationCoefficients {
  return {
    intercept: round6(raw[0]!),
    baseTokenCoefficient: round6(raw[1]!),
    featureCoefficients: featureNames.map((feature, index) => ({
      feature,
      coefficient: round6(raw[index + 2]!),
    })),
  };
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

interface Scored {
  readonly actual: number;
  readonly predicted: number;
}

/** Predictions made exactly the way the runtime makes them. */
function score(
  rows: readonly LiveRow[],
  coefficients: ClaudeCalibrationCoefficients,
): readonly Scored[] {
  return rows.map((row) => ({
    actual: row.providerPromptTokens,
    predicted: applyClaudeCalibration(
      row.projectionBaseTokens,
      featuresOf(row),
      coefficients,
    ),
  }));
}

function requireScorable(scored: readonly Scored[]): readonly Scored[] {
  if (scored.length === 0) throw new Error('no observations to score');
  for (const entry of scored) {
    if (!Number.isFinite(entry.actual) || entry.actual <= 0) {
      throw new Error(`non-positive actual value ${entry.actual}`);
    }
    if (!Number.isFinite(entry.predicted)) {
      throw new Error(`non-finite prediction ${entry.predicted}`);
    }
  }
  return scored;
}

function mape(scored: readonly Scored[]): number {
  requireScorable(scored);
  return (
    (scored.reduce(
      (sum, e) => sum + Math.abs((e.predicted - e.actual) / e.actual),
      0,
    ) /
      scored.length) *
    100
  );
}

function rmse(scored: readonly Scored[]): number {
  requireScorable(scored);
  return Math.sqrt(
    scored.reduce((sum, e) => sum + (e.predicted - e.actual) ** 2, 0) /
      scored.length,
  );
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new Error('percentile of an empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return (
    sorted[lower]! + (position - lower) * (sorted[upper]! - sorted[lower]!)
  );
}

function underestimationP95(scored: readonly Scored[]): number {
  requireScorable(scored);
  return percentile(
    scored.map((e) => Math.max(0, ((e.actual - e.predicted) / e.actual) * 100)),
    0.95,
  );
}

const CANDIDATE_FEATURE_SETS: ReadonlyArray<
  readonly ClaudeContentFeatureName[]
> = Object.freeze([
  [],
  ['codePoints'],
  ['codePoints', 'nonAsciiCodePoints'],
  ['codePoints', 'structuralCodePoints'],
  ['codePoints', 'whitespaceCodePoints'],
  ['codePoints', 'nonAsciiCodePoints', 'structuralCodePoints'],
  [...CLAUDE_CONTENT_FEATURE_NAMES],
]);

/** Mean out-of-fold MAPE when each group is held out in turn. */
function crossValidatedMape(
  trainRows: readonly LiveRow[],
  featureNames: readonly ClaudeContentFeatureName[],
  groupOf: (row: LiveRow) => string,
): number {
  const groups = [...new Set(trainRows.map(groupOf))].sort();
  const scored: Scored[] = [];
  for (const group of groups) {
    const inner = trainRows.filter((row) => groupOf(row) !== group);
    const outer = trainRows.filter((row) => groupOf(row) === group);
    if (inner.length === 0 || outer.length === 0) {
      throw new Error(`degenerate cross-validation fold: ${group}`);
    }
    scored.push(
      ...score(outer, toCoefficients(fit(inner, featureNames), featureNames)),
    );
  }
  return mape(scored);
}

interface Candidate {
  readonly featureNames: readonly ClaudeContentFeatureName[];
  readonly categoryCvMape: number;
  readonly envelopeCvMape: number;
}

function evaluateCandidates(trainRows: readonly LiveRow[]): Candidate[] {
  return CANDIDATE_FEATURE_SETS.map((featureNames) => ({
    featureNames,
    categoryCvMape: crossValidatedMape(
      trainRows,
      featureNames,
      (row) => row.category,
    ),
    envelopeCvMape: crossValidatedMape(
      trainRows,
      featureNames,
      (row) => row.envelope,
    ),
  }));
}

function describeFeatureSet(
  names: readonly ClaudeContentFeatureName[],
): string {
  return names.length === 0 ? 'base counter only' : names.join(' + ');
}

interface ModelResult {
  readonly target: string;
  readonly model: string;
  readonly coefficients: ClaudeCalibrationCoefficients;
  readonly featureNames: readonly ClaudeContentFeatureName[];
  readonly heldOut: Record<string, number | string>;
  readonly candidates: ReadonlyArray<Record<string, number | string>>;
  readonly rows: readonly LiveRow[];
  readonly gatePassed: boolean;
}

const MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT = 10;

function fitModel(target: string, rows: readonly LiveRow[]): ModelResult {
  validateGroup(target, rows);
  const trainRows = rows.filter((row) => row.split === 'train');
  const heldOutRows = rows.filter((row) => row.split === 'heldout');

  const candidates = evaluateCandidates(trainRows);
  const selected = candidates.reduce((best, candidate) =>
    candidate.categoryCvMape < best.categoryCvMape ? candidate : best,
  );
  const coefficients = toCoefficients(
    fit(trainRows, selected.featureNames),
    selected.featureNames,
  );

  const calibrated = score(heldOutRows, coefficients);
  const baseline = heldOutRows.map((row) => ({
    actual: row.providerPromptTokens,
    predicted: row.heuristicTokens,
  }));
  const calibratedMape = mape(calibrated);
  const baselineMape = mape(baseline);
  if (baselineMape <= 0) {
    throw new Error('baseline MAPE is zero; relative improvement undefined');
  }
  const relativeImprovement =
    ((baselineMape - calibratedMape) / baselineMape) * 100;
  const calibratedP95 = underestimationP95(calibrated);
  const baselineP95 = underestimationP95(baseline);

  return {
    target,
    model: rows[0]!.model,
    coefficients,
    featureNames: selected.featureNames,
    heldOut: {
      sampleCount: calibrated.length,
      mapePercent: round6(calibratedMape),
      rmse: round6(rmse(calibrated)),
      underestimationP95Percent: round6(calibratedP95),
      baselineEstimator: 'AnthropicTokenizer character heuristic',
      baselineMapePercent: round6(baselineMape),
      baselineRmse: round6(rmse(baseline)),
      baselineUnderestimationP95Percent: round6(baselineP95),
      relativeMapeImprovementPercent: round6(relativeImprovement),
    },
    candidates: candidates.map((candidate) => ({
      featureSet: describeFeatureSet(candidate.featureNames),
      leaveOneCategoryOutMapePercent: round6(candidate.categoryCvMape),
      leaveOneEnvelopeOutMapePercent: round6(candidate.envelopeCvMape),
    })),
    rows,
    gatePassed:
      relativeImprovement >= MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT &&
      calibratedP95 <= baselineP95,
  };
}

function buildFixture(result: ModelResult) {
  const first = result.rows[0]!;
  return {
    source: {
      issue: 2835,
      canonicalModel: first.model,
      activeProvider: first.activeProvider,
      endpointHost: first.endpointHost,
      protocol: first.protocol,
      projectionRevision: first.projectionRevision,
      corpusVersion: first.corpusVersion,
      commitSha: first.commitSha,
      groundTruth:
        'complete provider promptTokens including cached prompt tokens',
      method:
        'whole finalized request; the system/tool envelope is varied so a framing constant is identifiable',
      contents:
        'counts only; no prompt text, request body, header or credential is retained',
    },
    observations: result.rows.map((row) => ({
      id: row.corpusId,
      split: row.split,
      category: row.category,
      envelope: row.envelope,
      projectionBaseTokens: row.projectionBaseTokens,
      codePoints: row.codePoints,
      nonAsciiCodePoints: row.nonAsciiCodePoints,
      structuralCodePoints: row.structuralCodePoints,
      whitespaceCodePoints: row.whitespaceCodePoints,
      heuristicTokens: row.heuristicTokens,
      providerPromptTokens: row.providerPromptTokens,
      cachedPromptTokens: row.cachedPromptTokens,
    })),
  };
}

function main(): void {
  const text = readFileSync(SOURCE_RESULTS, 'utf8').trim();
  if (text === '') throw new Error(`${SOURCE_RESULTS} is empty`);
  const rows = text.split('\n').map((line, index) => {
    try {
      return validateRow(JSON.parse(line), 'row');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${SOURCE_RESULTS} line ${index + 1}: ${detail}`);
    }
  });

  const targets = [...new Set(rows.map((row) => row.target))].sort();
  const results = targets.map((target) =>
    fitModel(
      target,
      rows
        .filter((row) => row.target === target)
        .sort((a, b) => a.corpusId - b.corpusId),
    ),
  );

  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const summary = results.map((result) => ({
    target: result.target,
    canonicalModel: result.model,
    protocol: result.rows[0]!.protocol,
    activeProvider: result.rows[0]!.activeProvider,
    endpointHost: result.rows[0]!.endpointHost,
    projectionRevision: result.rows[0]!.projectionRevision,
    corpusObservations: result.rows.length,
    ...result.coefficients,
    heldOut: result.heldOut,
    gatePassed: result.gatePassed,
    candidates: result.candidates,
  }));

  for (const result of results) {
    writeFileSync(
      resolve(FIXTURE_DIR, `${result.model}-provider-usage-v1.json`),
      `${JSON.stringify(buildFixture(result), null, 2)}\n`,
    );
  }
  const summaryPath = resolve(REPORT_DIR, 'claude5-calibration.json');
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
