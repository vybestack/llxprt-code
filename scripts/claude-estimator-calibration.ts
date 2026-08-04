/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2835 — offline calibration fit for the Claude 5 prompt estimators.
 *
 * Deterministic and offline: it re-derives the controlled prompts from the
 * committed #2253 corpus generator, re-counts them with the pinned local
 * `o200k_base` base counter, and fits a correction against the recorded live
 * provider `promptTokens`. It performs no network access.
 *
 * Analysis is within-category incremental. Each category's smallest item is
 * the control, and every larger item contributes the delta from that control.
 * Subtracting the control cancels the fixed system/tool envelope, which is the
 * only way this corpus can identify a marginal content rate at all.
 *
 * Usage: bun scripts/claude-estimator-calibration.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get_encoding } from '@dqbd/tiktoken';
import { getCorpus, CORPUS_VERSION } from './token-divergence-corpus.js';
import { AnthropicTokenizer } from '../packages/providers/src/tokenizers/AnthropicTokenizer.js';
import {
  applyClaudeCalibration,
  type ClaudeCalibrationCoefficients,
} from '../packages/providers/src/tokenizers/claude/claudeCalibration.js';
import {
  extractClaudeContentFeatures,
  CLAUDE_CONTENT_FEATURE_NAMES,
  type ClaudeContentFeatureName,
  type ClaudeContentFeatures,
} from '../packages/providers/src/tokenizers/claude/claudeContentFeatures.js';

const CANONICAL_MODEL = 'claude-opus-5';
const SOURCE_RESULTS = 'research/issue2253/live-results.jsonl';
const REPORT_DIR = 'research/issue2835';
const FIXTURE_PATH =
  'packages/providers/src/tokenizers/claude/fixtures/claude-opus-5-provider-usage-v1.json';
const CONTROL_MAX_ID = 5;
const TRAIN_MAX_ID = 20;
/**
 * The projection version the corpus was recorded under. It serializes the same
 * prompt-bearing keys, in the same order, as the current finalized projection
 * for media-free anthropic-messages bodies; that equivalence is proved by
 * `claudeProjectionBridge.test.ts` rather than assumed here.
 */
const EXPECTED_SOURCE_PROJECTION_VERSION = 'responses-fields-v1';

interface LiveRow {
  readonly model: string;
  readonly corpusId: number;
  readonly split: string;
  readonly category: string;
  readonly genuineTiktoken: number;
  readonly actualPromptTokens: number;
  readonly cachedTokens: number;
  readonly requestChars: number;
  readonly endpointHost: string;
  readonly protocol: string;
  readonly commitSha: string;
  readonly corpusVersion: string;
  readonly projectionVersion: string;
}

interface Observation {
  readonly id: number;
  readonly category: string;
  readonly split: 'control' | 'train' | 'heldout';
  readonly promptText: string;
  readonly baseTokens: number;
  readonly features: ClaudeContentFeatures;
  readonly heuristicTokens: number;
  readonly providerPromptTokens: number;
  readonly cachedPromptTokens: number;
}

interface Delta {
  readonly id: number;
  readonly category: string;
  readonly split: 'train' | 'heldout';
  readonly design: readonly number[];
  readonly actual: number;
  readonly heuristic: number;
}

const encoder = get_encoding('o200k_base');
const heuristicTokenizer = new AnthropicTokenizer();

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${label} must be a positive integer, got ${String(value)}`,
    );
  }
  return value;
}

function requireNonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `${label} must be a non-negative finite number, got ${String(value)}`,
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

/**
 * Validate one recorded observation completely before it can influence a
 * coefficient. Bad source data must fail here, not silently become a NaN in a
 * published metric.
 */
function validateLiveRow(value: unknown): LiveRow {
  if (typeof value !== 'object' || value === null) {
    throw new Error('live result row is not an object');
  }
  const row = value as Record<string, unknown>;
  return {
    model: requireString(row.model, 'model'),
    corpusId: requirePositiveInteger(row.corpusId, 'corpusId'),
    split: requireString(row.split, 'split'),
    category: requireString(row.category, 'category'),
    genuineTiktoken: requirePositiveInteger(
      row.genuineTiktoken,
      'genuineTiktoken',
    ),
    actualPromptTokens: requirePositiveInteger(
      row.actualPromptTokens,
      'actualPromptTokens',
    ),
    cachedTokens: requireNonNegative(row.cachedTokens, 'cachedTokens'),
    requestChars: requirePositiveInteger(row.requestChars, 'requestChars'),
    endpointHost: requireString(row.endpointHost, 'endpointHost'),
    protocol: requireString(row.protocol, 'protocol'),
    commitSha: requireString(row.commitSha, 'commitSha'),
    corpusVersion: requireString(row.corpusVersion, 'corpusVersion'),
    projectionVersion: requireString(
      row.projectionVersion,
      'projectionVersion',
    ),
  };
}

/**
 * Every row must share one model, protocol, endpoint, corpus and projection
 * version, and every category must have exactly one control. A corpus that
 * mixes provenance cannot support a single calibration.
 */
function validateCorpus(rows: readonly LiveRow[]): void {
  const first = rows[0]!;
  for (const key of [
    'protocol',
    'endpointHost',
    'commitSha',
    'corpusVersion',
    'projectionVersion',
  ] as const) {
    const distinct = new Set(rows.map((row) => row[key]));
    if (distinct.size !== 1) {
      throw new Error(
        `corpus mixes ${key} values: ${[...distinct].join(', ')}`,
      );
    }
  }
  if (first.projectionVersion !== EXPECTED_SOURCE_PROJECTION_VERSION) {
    throw new Error(
      `corpus projection version ${first.projectionVersion} is not the bridged ${EXPECTED_SOURCE_PROJECTION_VERSION}`,
    );
  }
  const ids = rows.map((row) => row.corpusId);
  if (new Set(ids).size !== ids.length) {
    throw new Error('corpus contains duplicate corpusId values');
  }
  const controlsByCategory = new Map<string, number>();
  for (const row of rows) {
    if (row.corpusId > CONTROL_MAX_ID) continue;
    if (controlsByCategory.has(row.category)) {
      throw new Error(`category ${row.category} has more than one control`);
    }
    controlsByCategory.set(row.category, row.corpusId);
  }
  for (const row of rows) {
    if (!controlsByCategory.has(row.category)) {
      throw new Error(`category ${row.category} has no control observation`);
    }
  }
}

function parseLine(line: string, lineNumber: number): LiveRow {
  try {
    return validateLiveRow(JSON.parse(line));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${SOURCE_RESULTS} line ${lineNumber}: ${detail}`);
  }
}

function readLiveRows(): readonly LiveRow[] {
  const text = readFileSync(SOURCE_RESULTS, 'utf8').trim();
  if (text === '') throw new Error(`${SOURCE_RESULTS} is empty`);
  const rows = text
    .split('\n')
    .map((line, index) => parseLine(line, index + 1))
    .filter((row) => row.model === CANONICAL_MODEL)
    .sort((a, b) => a.corpusId - b.corpusId);
  if (rows.length === 0) {
    throw new Error(`no ${CANONICAL_MODEL} observations in ${SOURCE_RESULTS}`);
  }
  validateCorpus(rows);
  return rows;
}

/**
 * The controlled prompt as it appears inside the finalized projection: the
 * projection serializes the request body with `JSON.stringify`, so the string
 * the base counter actually sees is the JSON-escaped form, not the raw prompt.
 */
function embeddedForm(prompt: string): string {
  return JSON.stringify(prompt);
}

function splitOf(id: number): 'control' | 'train' | 'heldout' {
  if (id <= CONTROL_MAX_ID) return 'control';
  return id <= TRAIN_MAX_ID ? 'train' : 'heldout';
}

async function buildObservations(
  rows: readonly LiveRow[],
): Promise<readonly Observation[]> {
  const corpus = new Map(getCorpus().map((item) => [item.id, item]));
  const observations: Observation[] = [];
  for (const row of rows) {
    const item = corpus.get(row.corpusId);
    if (item === undefined) {
      throw new Error(`corpus item ${row.corpusId} is missing`);
    }
    if (item.category !== row.category) {
      throw new Error(`corpus item ${row.corpusId} category mismatch`);
    }
    const promptText = embeddedForm(item.prompt);
    observations.push({
      id: row.corpusId,
      category: row.category,
      split: splitOf(row.corpusId),
      promptText,
      baseTokens: encoder.encode(promptText, [], []).length,
      features: extractClaudeContentFeatures(promptText),
      heuristicTokens: await heuristicTokenizer.countTokens(
        promptText,
        CANONICAL_MODEL,
      ),
      providerPromptTokens: row.actualPromptTokens,
      cachedPromptTokens: row.cachedTokens,
    });
  }
  return observations;
}

/**
 * Guard the reconstruction: recomputed base-counter deltas must reproduce the
 * deltas recorded live, otherwise the corpus regenerated here is not the
 * corpus that produced the provider ground truth.
 */
function verifyReconstruction(
  rows: readonly LiveRow[],
  observations: readonly Observation[],
): void {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const controls = new Map<string, LiveRow>();
  for (const row of rows) {
    if (row.corpusId <= CONTROL_MAX_ID) controls.set(row.category, row);
  }
  for (const row of rows) {
    if (row.corpusId <= CONTROL_MAX_ID) continue;
    const control = controls.get(row.category)!;
    const recorded = row.genuineTiktoken - control.genuineTiktoken;
    const rebuilt =
      byId.get(row.corpusId)!.baseTokens -
      byId.get(control.corpusId)!.baseTokens;
    if (recorded !== rebuilt) {
      throw new Error(
        `reconstruction mismatch for corpus ${row.corpusId}: recorded ${recorded}, rebuilt ${rebuilt}`,
      );
    }
  }
}

function designVector(
  observation: Observation,
  featureNames: readonly ClaudeContentFeatureName[],
): readonly number[] {
  return [
    observation.baseTokens,
    ...featureNames.map((name) => observation.features[name]),
  ];
}

function buildDeltas(
  observations: readonly Observation[],
  featureNames: readonly ClaudeContentFeatureName[],
): readonly Delta[] {
  const controls = new Map<string, Observation>();
  for (const o of observations) {
    if (o.split === 'control') controls.set(o.category, o);
  }
  return observations
    .filter((o) => o.split !== 'control')
    .map((o) => {
      const control = controls.get(o.category)!;
      const target = designVector(o, featureNames);
      const base = designVector(control, featureNames);
      return {
        id: o.id,
        category: o.category,
        split: o.split as 'train' | 'heldout',
        design: target.map((value, index) => value - base[index]!),
        actual: o.providerPromptTokens - control.providerPromptTokens,
        heuristic: o.heuristicTokens - control.heuristicTokens,
      };
    });
}

/** Ordinary least squares through the origin. */
function fit(deltas: readonly Delta[], width: number): readonly number[] {
  const normal = Array.from({ length: width }, () =>
    new Array<number>(width + 1).fill(0),
  );
  for (const delta of deltas) {
    for (let i = 0; i < width; i++) {
      normal[i]![width] += delta.design[i]! * delta.actual;
      for (let j = 0; j < width; j++) {
        normal[i]![j]! += delta.design[i]! * delta.design[j]!;
      }
    }
  }
  for (let col = 0; col < width; col++) {
    let pivot = col;
    for (let row = col + 1; row < width; row++) {
      if (Math.abs(normal[row]![col]!) > Math.abs(normal[pivot]![col]!)) {
        pivot = row;
      }
    }
    [normal[col], normal[pivot]] = [normal[pivot]!, normal[col]!];
    const scale = normal[col]![col]!;
    // A near-singular pivot means the candidate features are collinear on this
    // data, so its coefficients would be arbitrary. Reject rather than publish
    // numbers the corpus cannot identify.
    if (!Number.isFinite(scale) || Math.abs(scale) < 1e-9) {
      throw new Error('singular or near-singular normal equations');
    }
    for (let c = col; c <= width; c++) normal[col]![c]! /= scale;
    for (let row = 0; row < width; row++) {
      if (row === col) continue;
      const factor = normal[row]![col]!;
      for (let c = col; c <= width; c++) {
        normal[row]![c]! -= factor * normal[col]![c]!;
      }
    }
  }
  return normal.map((row) => row[width]!);
}

function predict(delta: Delta, coefficients: readonly number[]): number {
  return delta.design.reduce(
    (total, value, index) => total + value * coefficients[index]!,
    0,
  );
}

type Error_ = { actual: number; predicted: number };

function requireScorable(errors: readonly Error_[]): readonly Error_[] {
  if (errors.length === 0) throw new Error('no observations to score');
  for (const error of errors) {
    if (!Number.isFinite(error.actual) || error.actual <= 0) {
      throw new Error(`non-positive actual value: ${error.actual}`);
    }
    if (!Number.isFinite(error.predicted)) {
      throw new Error(`non-finite prediction: ${error.predicted}`);
    }
  }
  return errors;
}

function mape(errors: readonly Error_[]) {
  requireScorable(errors);
  return (
    (errors.reduce(
      (sum, e) => sum + Math.abs((e.predicted - e.actual) / e.actual),
      0,
    ) /
      errors.length) *
    100
  );
}

function rmse(errors: readonly Error_[]) {
  requireScorable(errors);
  return Math.sqrt(
    errors.reduce((sum, e) => sum + (e.predicted - e.actual) ** 2, 0) /
      errors.length,
  );
}

/** Linear-interpolated percentile over a sorted copy of `values`. */
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

function underestimationP95(errors: readonly Error_[]): number {
  requireScorable(errors);
  return percentile(
    errors.map((e) => Math.max(0, ((e.actual - e.predicted) / e.actual) * 100)),
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

/**
 * Held-out predictions produced the way the runtime produces them: apply the
 * shipped calibration to the item and to its control, then difference the two
 * rounded counts.
 */
function heldOutPredictions(
  observations: readonly Observation[],
  shipped: ClaudeCalibrationCoefficients,
): ReadonlyArray<{ actual: number; predicted: number }> {
  const controls = new Map<string, Observation>();
  for (const o of observations) {
    if (o.split === 'control') controls.set(o.category, o);
  }
  const count = (o: Observation): number =>
    applyClaudeCalibration(o.baseTokens, o.features, shipped);
  return observations
    .filter((o) => o.split === 'heldout')
    .map((o) => {
      const control = controls.get(o.category)!;
      return {
        actual: o.providerPromptTokens - control.providerPromptTokens,
        predicted: count(o) - count(control),
      };
    });
}

interface CandidateResult {
  readonly featureNames: readonly ClaudeContentFeatureName[];
  readonly coefficients: readonly number[];
  readonly heldOutMape: number;
  readonly locoMape: number;
}

function evaluateCandidate(
  observations: readonly Observation[],
  featureNames: readonly ClaudeContentFeatureName[],
): CandidateResult {
  const deltas = buildDeltas(observations, featureNames);
  const width = featureNames.length + 1;
  const trainDeltas = deltas.filter((d) => d.split === 'train');
  const trained = fit(trainDeltas, width);
  const heldOut = deltas
    .filter((d) => d.split === 'heldout')
    .map((d) => ({ actual: d.actual, predicted: predict(d, trained) }));

  // Model selection sees training data only. Letting a held-out observation
  // influence which feature set is chosen would make the held-out metrics
  // that justify activation self-fulfilling.
  const categories = [...new Set(trainDeltas.map((d) => d.category))].sort();
  const locoErrors: Array<{ actual: number; predicted: number }> = [];
  for (const category of categories) {
    const foldTrain = trainDeltas.filter((d) => d.category !== category);
    const foldTest = trainDeltas.filter((d) => d.category === category);
    if (foldTrain.length === 0 || foldTest.length === 0) {
      throw new Error(`degenerate leave-one-category-out fold: ${category}`);
    }
    const foldCoefficients = fit(foldTrain, width);
    for (const delta of foldTest) {
      locoErrors.push({
        actual: delta.actual,
        predicted: predict(delta, foldCoefficients),
      });
    }
  }

  return {
    featureNames,
    coefficients: trained,
    heldOutMape: mape(heldOut),
    locoMape: mape(locoErrors),
  };
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

function formatFeatureSet(names: readonly ClaudeContentFeatureName[]): string {
  return names.length === 0 ? 'base counter only' : names.join(' + ');
}

function toShippedCoefficients(
  selected: CandidateResult,
): ClaudeCalibrationCoefficients {
  // Coefficients are rounded before any metric is computed so the published
  // numbers describe the coefficients that actually ship.
  const rounded = selected.coefficients.map(round6);
  return {
    intercept: 0,
    baseTokenCoefficient: rounded[0]!,
    featureCoefficients: selected.featureNames.map((feature, index) => ({
      feature,
      coefficient: rounded[index + 1]!,
    })),
  };
}

/**
 * Held-out evidence for the shipped coefficients, measured through the same
 * runtime application function the estimator uses, including its per-estimate
 * rounding. Reporting full-precision regression output instead would overstate
 * the shipped estimator's accuracy.
 */
function measureHeldOut(
  observations: readonly Observation[],
  selected: CandidateResult,
  shipped: ClaudeCalibrationCoefficients,
) {
  const calibrated = heldOutPredictions(observations, shipped);
  const baseline = buildDeltas(observations, selected.featureNames)
    .filter((d) => d.split === 'heldout')
    .map((d) => ({ actual: d.actual, predicted: d.heuristic }));
  const calibratedMape = mape(calibrated);
  const baselineMape = mape(baseline);
  if (baselineMape <= 0) {
    throw new Error(
      'baseline MAPE is zero; a relative improvement over it is undefined',
    );
  }
  return {
    sampleCount: calibrated.length,
    mapePercent: round6(calibratedMape),
    rmse: round6(rmse(calibrated)),
    underestimationP95Percent: round6(underestimationP95(calibrated)),
    baselineEstimator: 'AnthropicTokenizer character heuristic',
    baselineMapePercent: round6(baselineMape),
    baselineRmse: round6(rmse(baseline)),
    baselineUnderestimationP95Percent: round6(underestimationP95(baseline)),
    relativeMapeImprovementPercent: round6(
      ((baselineMape - calibratedMape) / baselineMape) * 100,
    ),
  };
}

function buildFixture(
  rows: readonly LiveRow[],
  observations: readonly Observation[],
) {
  return {
    source: {
      issue: 2835,
      derivedFrom: {
        issue: 2253,
        corpusVersion: CORPUS_VERSION,
        commitSha: rows[0]!.commitSha,
        results: SOURCE_RESULTS,
      },
      canonicalModel: CANONICAL_MODEL,
      protocol: rows[0]!.protocol,
      endpointHost: rows[0]!.endpointHost,
      groundTruth:
        'complete provider promptTokens including cached prompt tokens',
      sourceProjectionVersion: rows[0]!.projectionVersion,
      method:
        'within-category incremental; the smallest item in each category is the control',
      promptTextForm:
        'JSON-escaped, as the controlled prompt appears inside the finalized projection promptText',
    },
    observations: observations.map((o) => ({
      id: o.id,
      category: o.category,
      split: o.split,
      promptText: o.promptText,
      providerPromptTokens: o.providerPromptTokens,
      cachedPromptTokens: o.cachedPromptTokens,
    })),
  };
}

async function main(): Promise<void> {
  const rows = readLiveRows();
  const observations = await buildObservations(rows);
  verifyReconstruction(rows, observations);

  const candidates = CANDIDATE_FEATURE_SETS.map((names) =>
    evaluateCandidate(observations, names),
  );
  const selected = candidates.reduce((best, candidate) =>
    candidate.locoMape < best.locoMape ? candidate : best,
  );
  const shipped = toShippedCoefficients(selected);

  const fixture = buildFixture(rows, observations);
  const calibration = {
    canonicalModelFamily: CANONICAL_MODEL,
    protocol: rows[0]!.protocol,
    ...shipped,
    heldOut: measureHeldOut(observations, selected, shipped),
    candidates: candidates.map((candidate) => ({
      featureSet: formatFeatureSet(candidate.featureNames),
      heldOutMapePercent: round6(candidate.heldOutMape),
      leaveOneCategoryOutMapePercent: round6(candidate.locoMape),
    })),
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'opus5-calibration.json'),
    JSON.stringify(calibration, null, 2) + '\n',
  );
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n');
  process.stdout.write(JSON.stringify(calibration, null, 2) + '\n');
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
