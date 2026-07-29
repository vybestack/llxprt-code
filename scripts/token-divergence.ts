/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2253 — bounded token divergence measurement utility.
 * Strict artifact pairing, prompt-bearing field projection, direct character
 * counting, genuine tiktoken encoding, OLS fitting, MAPE/RMSE, and a
 * dual-metric gate. Ground truth is actual_prompt_tokens (never cache-subtracted).
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encoding_for_model } from '@dqbd/tiktoken';
import * as path from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECTION_VERSION = 'responses-fields-v1';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isPositiveFinite(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0;
}
function reqStr(r: Record<string, unknown>, k: string, label: string): string {
  if (typeof r[k] !== 'string')
    throw new Error(`${label} missing string "${k}"`);
  return r[k];
}
function reqFin(r: Record<string, unknown>, k: string, label: string): number {
  if (!isFiniteNumber(r[k])) throw new Error(`${label} missing finite "${k}"`);
  return r[k];
}

export interface DumpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}
export interface DumpArtifact {
  readonly provider: string;
  readonly timestamp: string;
  readonly request: DumpRequest;
}

function validateDumpArtifact(value: unknown): DumpArtifact {
  if (!isRecord(value)) throw new Error('Dump artifact is not an object');
  const provider = reqStr(value, 'provider', 'Dump artifact');
  const request = value['request'];
  if (!isRecord(request))
    throw new Error('Dump artifact missing object "request"');
  return {
    provider,
    timestamp: typeof value['timestamp'] === 'string' ? value['timestamp'] : '',
    request: {
      url: reqStr(request, 'url', 'Dump request'),
      method: reqStr(request, 'method', 'Dump request'),
      headers: isRecord(request['headers'])
        ? (request['headers'] as Record<string, string>)
        : undefined,
      body: request['body'],
    },
  };
}

export interface UsageRow {
  readonly ts: string;
  readonly prompt_id: string;
  readonly provider: string;
  readonly model: string;
  readonly estimated_tokens: number;
  readonly estimator: string;
  readonly tiktoken_tokens: number | null;
  readonly tiktoken_estimation_failed: boolean;
  readonly actual_prompt_tokens: number;
  readonly cached_tokens: number;
  readonly effective_actual_tokens: number;
}

function validateUsageRow(value: unknown): UsageRow {
  if (!isRecord(value)) throw new Error('Usage row is not an object');
  const tt = value['tiktoken_tokens'];
  return {
    ts: typeof value['ts'] === 'string' ? value['ts'] : '',
    prompt_id: reqStr(value, 'prompt_id', 'Usage row'),
    provider: reqStr(value, 'provider', 'Usage row'),
    model: reqStr(value, 'model', 'Usage row'),
    estimated_tokens: reqFin(value, 'estimated_tokens', 'Usage row'),
    estimator: typeof value['estimator'] === 'string' ? value['estimator'] : '',
    tiktoken_tokens:
      tt === null || isFiniteNumber(tt) ? (tt as number | null) : null,
    tiktoken_estimation_failed: value['tiktoken_estimation_failed'] === true,
    actual_prompt_tokens: reqFin(value, 'actual_prompt_tokens', 'Usage row'),
    cached_tokens: reqFin(value, 'cached_tokens', 'Usage row'),
    effective_actual_tokens: reqFin(
      value,
      'effective_actual_tokens',
      'Usage row',
    ),
  };
}

export interface CliOutputResult {
  readonly sessionId: string;
  readonly response: string;
  readonly actualPromptTokens: number;
  readonly model: string;
}

export function parseCliOutput(value: unknown): CliOutputResult {
  if (!isRecord(value)) throw new Error('CLI output is not an object');
  const sessionId = reqStr(value, 'session_id', 'CLI output');
  const response = reqStr(value, 'response', 'CLI output');
  if (response !== 'OK') {
    throw new Error(
      `CLI output response must be exactly "OK", got "${response}"`,
    );
  }
  const stats = value['stats'];
  if (!isRecord(stats)) throw new Error('CLI output missing object "stats"');
  const models = stats['models'];
  if (!isRecord(models))
    throw new Error('CLI output missing object "stats.models"');
  const keys = Object.keys(models);
  if (keys.length !== 1) {
    throw new Error(
      `CLI output must have exactly one model entry, found ${keys.length}`,
    );
  }
  const ms = models[keys[0]!];
  if (!isRecord(ms)) throw new Error('CLI output model stats is not an object');
  const api = ms['api'];
  if (!isRecord(api))
    throw new Error('CLI output missing "stats.models[model].api"');
  if (!isFiniteNumber(api['totalRequests']) || api['totalRequests'] !== 1) {
    throw new Error(
      `CLI output totalRequests must be 1, found ${String(api['totalRequests'])}`,
    );
  }
  if (!isFiniteNumber(api['totalErrors']) || api['totalErrors'] !== 0) {
    throw new Error(
      `CLI output totalErrors must be 0, found ${String(api['totalErrors'])}`,
    );
  }
  const tokens = ms['tokens'];
  if (!isRecord(tokens))
    throw new Error('CLI output missing "stats.models[model].tokens"');
  const actualPromptTokens = isPositiveFinite(tokens['prompt'])
    ? tokens['prompt']
    : tokens['input'];
  if (!isPositiveFinite(actualPromptTokens)) {
    throw new Error(
      'CLI output missing positive "tokens.prompt" or "tokens.input"',
    );
  }
  return { sessionId, response, actualPromptTokens, model: keys[0]! };
}

export type ProjectionProtocol =
  | 'openai-chat'
  | 'anthropic-messages'
  | 'openai-responses';

export interface ProjectionInput {
  readonly providerName: string;
  readonly endpointPath: string;
  readonly body: unknown;
}

function bodyHas(body: unknown, key: string): boolean {
  return isRecord(body) && body[key] !== undefined;
}

export function resolveProtocol(input: ProjectionInput): ProjectionProtocol {
  const b = input.body;
  const hasMsg = bodyHas(b, 'messages');
  const hasInput = bodyHas(b, 'input');
  const hasSys = bodyHas(b, 'system');
  const hasInstr = bodyHas(b, 'instructions');
  if (hasInstr && hasInput && !hasMsg) return 'openai-responses';
  if (hasSys && hasMsg && !hasInput) return 'anthropic-messages';
  if (hasMsg && !hasInput) return 'openai-chat';
  throw new Error(
    `Cannot resolve protocol from body shape for provider "${input.providerName}" endpoint "${input.endpointPath}"`,
  );
}

export function projectPromptBearingFields(
  protocol: ProjectionProtocol,
  body: unknown,
): Record<string, unknown> {
  if (!isRecord(body))
    throw new Error('Cannot project: request body is absent');
  switch (protocol) {
    case 'openai-chat':
      return pickKeys(body, ['messages', 'tools']);
    case 'anthropic-messages':
      return pickKeys(body, ['system', 'messages', 'tools']);
    case 'openai-responses':
      return pickKeys(body, ['instructions', 'input', 'tools']);
    default:
      throw new Error(`Unknown protocol: ${String(protocol)}`);
  }
}

function pickKeys(
  rec: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (rec[k] !== undefined) out[k] = rec[k];
  return out;
}

export function countChars(text: string): number {
  return text.length;
}

let encoder: ReturnType<typeof encoding_for_model> | null = null;
function getEncoder(): ReturnType<typeof encoding_for_model> {
  if (encoder === null) encoder = encoding_for_model('gpt-4o');
  return encoder;
}
export function countTiktoken(text: string): number {
  if (text.length === 0) return 0;
  return getEncoder().encode(text).length;
}

export interface DataPoint {
  readonly x: number;
  readonly y: number;
}
export interface OLSResult {
  readonly slope: number;
  readonly intercept: number;
}

export function ordinaryLeastSquares(points: readonly DataPoint[]): OLSResult {
  if (points.length < 2)
    throw new Error(`OLS requires >=2 points, got ${points.length}`);
  const n = points.length;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y <= 0) {
      throw new Error(`OLS rejects non-finite/non-positive y=${p.y}`);
    }
    sx += p.x;
    sy += p.y;
    sxy += p.x * p.y;
    sxx += p.x * p.x;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) throw new Error('OLS: zero variance in x');
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

export function meanAbsolutePercentageError(
  actuals: readonly number[],
  preds: readonly number[],
): number {
  if (actuals.length !== preds.length) throw new Error('MAPE: length mismatch');
  if (actuals.length === 0) throw new Error('MAPE: no data');
  let sum = 0;
  for (let i = 0; i < actuals.length; i++) {
    const y = actuals[i]!;
    const yh = preds[i]!;
    if (!Number.isFinite(y) || !Number.isFinite(yh) || y <= 0) {
      throw new Error(`MAPE: non-positive/non-finite actual at ${i}`);
    }
    sum += Math.abs((y - yh) / y);
  }
  return (sum / actuals.length) * 100;
}

export function rootMeanSquareError(
  actuals: readonly number[],
  preds: readonly number[],
): number {
  if (actuals.length !== preds.length) throw new Error('RMSE: length mismatch');
  if (actuals.length === 0) throw new Error('RMSE: no data');
  let ss = 0;
  for (let i = 0; i < actuals.length; i++) {
    const d = actuals[i]! - preds[i]!;
    ss += d * d;
  }
  return Math.sqrt(ss / actuals.length);
}

export interface GateInput {
  readonly currentMape: number;
  readonly currentRmse: number;
  readonly fittedMape: number;
  readonly fittedRmse: number;
}
export interface GateResult {
  readonly passed: boolean;
  readonly reason: string;
}

export function evaluateGate(input: GateInput): GateResult {
  const vals = [
    input.currentMape,
    input.currentRmse,
    input.fittedMape,
    input.fittedRmse,
  ];
  if (vals.some((v) => !Number.isFinite(v)))
    return { passed: false, reason: 'Non-finite metric(s)' };
  if (input.fittedMape > input.currentMape) {
    return {
      passed: false,
      reason: `Fitted MAPE ${input.fittedMape.toFixed(2)} > current ${input.currentMape.toFixed(2)}`,
    };
  }
  if (input.fittedRmse > input.currentRmse) {
    return {
      passed: false,
      reason: `Fitted RMSE ${input.fittedRmse.toFixed(2)} > current ${input.currentRmse.toFixed(2)}`,
    };
  }
  return {
    passed: true,
    reason: `Fitted no worse (MAPE ${input.fittedMape.toFixed(2)}, RMSE ${input.fittedRmse.toFixed(2)})`,
  };
}

export interface ExpectedBinding {
  readonly model: string;
  readonly prompt: string;
  readonly protocol: ProjectionProtocol;
  readonly endpointHost: string;
}

export interface PairedSample {
  readonly provider: string;
  readonly model: string;
  readonly promptId: string;
  readonly sessionId: string;
  readonly response: string;
  readonly protocol: ProjectionProtocol;
  readonly endpointHost: string;
  readonly estimatedTokens: number;
  readonly actualPromptTokens: number;
  readonly cachedTokens: number;
  readonly requestChars: number;
  readonly genuineTiktokenTokens: number;
  readonly requestHash: string;
  readonly systemHash: string;
  readonly toolsHash: string;
  readonly userContentHash: string;
}
export interface PairArtifactsInput {
  readonly dumpPath: string;
  readonly usagePath: string;
  readonly outputPath: string;
  readonly expected: ExpectedBinding;
}

export function pairArtifacts(input: PairArtifactsInput): PairedSample {
  const dump = readDump(input.dumpPath);
  const rows = readUsageRows(input.usagePath);
  const output = readCliOutput(input.outputPath);
  if (rows.length !== 1)
    throw new Error(`Expected exactly 1 usage row, found ${rows.length}`);
  const row = rows[0]!;
  if (!isPositiveFinite(row.actual_prompt_tokens)) {
    throw new Error(
      `Nonpositive actual_prompt_tokens=${row.actual_prompt_tokens}`,
    );
  }
  const usageBasename = path.basename(input.usagePath);
  if (usageBasename !== `${output.sessionId}.jsonl`) {
    throw new Error(
      `Usage path "${usageBasename}" does not match session "${output.sessionId}.jsonl"`,
    );
  }
  const protocol = resolveProtocol({
    providerName: dump.provider,
    endpointPath: urlPart(dump.request.url, 'pathname'),
    body: dump.request.body,
  });
  const modelFromBody = bodyModel(dump.request.body);
  if (
    modelFromBody !== row.model ||
    modelFromBody !== output.model ||
    modelFromBody !== input.expected.model
  ) {
    throw new Error(
      `Model mismatch: dump="${modelFromBody}" usage="${row.model}" output="${output.model}" expected="${input.expected.model}"`,
    );
  }
  if (output.actualPromptTokens !== row.actual_prompt_tokens) {
    throw new Error(
      `Output actual ${output.actualPromptTokens} !== usage actual ${row.actual_prompt_tokens}`,
    );
  }
  if (protocol !== input.expected.protocol) {
    throw new Error(
      `Protocol "${protocol}" !== expected "${input.expected.protocol}"`,
    );
  }
  const host = urlPart(dump.request.url, 'host');
  if (host !== input.expected.endpointHost) {
    throw new Error(
      `Endpoint host "${host}" !== expected "${input.expected.endpointHost}"`,
    );
  }
  const userContent = extractUserContent(protocol, dump.request.body);
  if (userContent !== input.expected.prompt) {
    throw new Error(`Dump user content does not match expected corpus prompt`);
  }
  const projected = projectPromptBearingFields(protocol, dump.request.body);
  const serialized = JSON.stringify(projected);
  return {
    provider: row.provider,
    model: row.model,
    promptId: row.prompt_id,
    sessionId: output.sessionId,
    response: output.response,
    protocol,
    endpointHost: host,
    estimatedTokens: row.estimated_tokens,
    actualPromptTokens: row.actual_prompt_tokens,
    cachedTokens: row.cached_tokens,
    requestChars: countChars(serialized),
    genuineTiktokenTokens: countTiktoken(serialized),
    requestHash: sha256Hex(serialized),
    systemHash: sha256Hex(
      JSON.stringify(systemProjection(protocol, projected)),
    ),
    toolsHash: sha256Hex(JSON.stringify(pickKeys(projected, ['tools']))),
    userContentHash: sha256Hex(userContent),
  };
}

function bodyModel(body: unknown): string {
  if (!isRecord(body) || typeof body['model'] !== 'string') {
    throw new Error('Dump request body missing string "model"');
  }
  return body['model'];
}

function messageContent(message: unknown): string {
  if (!isRecord(message)) return '';
  const content = message['content'];
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!isRecord(part)) return '';
        if (typeof part['text'] === 'string') return part['text'];
        if (typeof part['content'] === 'string') return part['content'];
        return '';
      })
      .join('');
  }
  return '';
}

export function extractUserContent(
  protocol: ProjectionProtocol,
  body: unknown,
): string {
  if (!isRecord(body))
    throw new Error('Cannot extract user content: body is absent');
  if (protocol === 'openai-chat' || protocol === 'anthropic-messages') {
    const messages = body['messages'];
    if (!Array.isArray(messages)) return '';
    const userMsgs = messages.filter(
      (m) => isRecord(m) && m['role'] === 'user',
    );
    return userMsgs.map(messageContent).join('');
  }
  if (protocol === 'openai-responses') {
    const input = body['input'];
    if (!Array.isArray(input)) return '';
    const userMsgs = input.filter(
      (item) =>
        isRecord(item) && item['type'] === 'message' && item['role'] === 'user',
    );
    return userMsgs.map(messageContent).join('');
  }
  return '';
}

function systemProjection(
  protocol: ProjectionProtocol,
  projected: Record<string, unknown>,
): unknown {
  if (protocol !== 'openai-chat') {
    return pickKeys(projected, ['system', 'instructions']);
  }
  const messages = projected['messages'];
  if (!Array.isArray(messages)) return [];
  return messages.filter(
    (message) =>
      isRecord(message) &&
      (message['role'] === 'system' || message['role'] === 'developer'),
  );
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function urlPart(url: string, part: 'pathname' | 'host'): string {
  return new URL(url)[part];
}
function readDump(filePath: string): DumpArtifact {
  return validateDumpArtifact(
    JSON.parse(readFileSync(filePath, 'utf-8')) as unknown,
  );
}
function readUsageRows(filePath: string): UsageRow[] {
  const raw = readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw.split('\n').map((l) => validateUsageRow(JSON.parse(l) as unknown));
}
function readCliOutput(filePath: string): CliOutputResult {
  return parseCliOutput(JSON.parse(readFileSync(filePath, 'utf-8')) as unknown);
}

export { isFiniteNumber, isPositiveFinite };

// ─── CLI dispatch ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;
  const flags = parseFlags(rest);
  if (sub === 'collect') {
    if (flags['results'] === undefined || flags['artifacts'] === undefined)
      throw new Error('collect requires --results and --artifacts');
    const { collect } = await import('./token-divergence-collect.js');
    await collect({
      resultsPath: flags['results'],
      artifactsDir: flags['artifacts'],
      target: flags['target'],
      corpusId:
        flags['corpus-id'] === undefined
          ? undefined
          : Number(flags['corpus-id']),
    });
  } else if (sub === 'report') {
    if (flags['results'] === undefined || flags['output'] === undefined)
      throw new Error('report requires --results and --output');
    const { generateReport } = await import('./token-divergence-report.js');
    generateReport({
      resultsPath: flags['results'],
      outputPath: flags['output'],
      analysisPath: flags['analysis'],
    });
  } else {
    process.stderr.write(
      'Usage: token-divergence <collect|report> [options]\n' +
        '  collect --results <path> --artifacts <dir> [--target <key>] [--corpus-id <n>]\n' +
        '  report --results <path> --output <path> [--analysis <path>]\n',
    );
    process.exitCode = 1;
  }
}

function parseFlags(args: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    }
  }
  return out;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`token-divergence: ${message}\n`);
    process.exitCode = 1;
  });
}
