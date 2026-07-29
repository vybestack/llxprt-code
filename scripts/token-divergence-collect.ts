/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  pairArtifacts,
  parseCliOutput,
  PROJECTION_VERSION,
  type PairedSample,
  type ProjectionProtocol,
} from './token-divergence.js';
import {
  getCorpus,
  getCorpusItem,
  CORPUS_VERSION,
} from './token-divergence-corpus.js';
import { createHash } from 'node:crypto';

export interface TargetSpec {
  readonly key: string;
  readonly profile: string;
  readonly protocol: ProjectionProtocol;
  readonly endpointHost: string;
  readonly model: string;
  readonly modelOverride?: string;
}

export const TARGETS: readonly TargetSpec[] = [
  {
    key: 'opusthinking',
    profile: 'opusthinking-claudecode',
    protocol: 'anthropic-messages',
    endpointHost: 'api.anthropic.com',
    model: 'claude-opus-5',
  },
  {
    key: 'gpt56solhigh',
    profile: 'gpt56solhigh',
    protocol: 'openai-responses',
    endpointHost: 'chatgpt.com',
    model: 'gpt-5.6-sol',
  },
  {
    key: 'zai',
    profile: 'zai',
    protocol: 'anthropic-messages',
    endpointHost: 'api.z.ai',
    model: 'glm-5.2',
  },
  {
    key: 'ollamaglm51',
    profile: 'ollamaglm51',
    protocol: 'openai-chat',
    endpointHost: 'ollama.com',
    model: 'glm-5.2',
  },
  {
    key: 'ollamakimi',
    profile: 'ollamakimi',
    protocol: 'openai-chat',
    endpointHost: 'ollama.com',
    model: 'minimax-m3',
    modelOverride: 'minimax-m3',
  },
] as const;

export interface SanitizedRow {
  readonly target: string;
  readonly profile: string;
  readonly protocol: string;
  readonly endpointHost: string;
  readonly model: string;
  readonly corpusId: number;
  readonly split: string;
  readonly category: string;
  readonly sessionId: string;
  readonly pendingTokens: number;
  readonly requestChars: number;
  readonly charPrediction: number;
  readonly genuineTiktoken: number;
  readonly actualPromptTokens: number;
  readonly cachedTokens: number;
  readonly rejectedAttempts: number;
  readonly commitSha: string;
  readonly projectionVersion: string;
  readonly corpusVersion: string;
  readonly requestHash: string;
  readonly promptHash: string;
  readonly systemHash: string;
  readonly toolsHash: string;
}

export interface ProcessRunner {
  run(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult>;
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CollectOptions {
  readonly resultsPath: string;
  readonly artifactsDir: string;
  readonly runner?: ProcessRunner;
  readonly target?: string;
  readonly corpusId?: number;
  readonly cliPath?: string;
}

const CLI_DEFAULT = 'packages/cli/index.ts';

export async function collect(opts: CollectOptions): Promise<void> {
  const artifactsDir = path.resolve(opts.artifactsDir);
  await fsp.mkdir(artifactsDir, { recursive: true });
  const runner = opts.runner ?? defaultRunner;
  const targets = selectTargets(opts.target);
  const corpusItems = selectCorpus(opts.corpusId);
  const existing = await readExistingRows(opts.resultsPath);
  const acceptedKeys = new Set(existing.map(rowKey));
  const cliPath = opts.cliPath ?? CLI_DEFAULT;

  for (const target of targets) {
    for (const item of corpusItems) {
      const key = `${target.key}:${item.id}`;
      if (acceptedKeys.has(key)) continue;
      const attempt = await prepareRunDir(artifactsDir, target.key, item.id);
      const row = await runOne(
        runner,
        cliPath,
        attempt.runDir,
        attempt.rejectedAttempts,
        target,
        item,
      );
      await appendRow(opts.resultsPath, row);
      acceptedKeys.add(key);
    }
  }
}

function selectTargets(filter?: string): readonly TargetSpec[] {
  if (filter === undefined) return TARGETS;
  const found = TARGETS.find((target) => target.key === filter);
  if (found === undefined) {
    throw new Error(
      `Unknown target "${filter}". Valid: ${TARGETS.map((target) => target.key).join(', ')}`,
    );
  }
  return [found];
}

function selectCorpus(
  filter?: number,
): ReadonlyArray<ReturnType<typeof getCorpusItem>> {
  if (filter === undefined) return getCorpus();
  return [getCorpusItem(filter)];
}

async function prepareRunDir(
  artifactsDir: string,
  targetKey: string,
  corpusId: number,
): Promise<{ runDir: string; rejectedAttempts: number }> {
  const itemDir = path.join(artifactsDir, targetKey, String(corpusId));
  await fsp.mkdir(itemDir, { recursive: true });
  const entries = await fsp.readdir(itemDir, { withFileTypes: true });
  const rejectedAttempts = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith('attempt-'),
  ).length;
  const runDir = await fsp.mkdtemp(path.join(itemDir, 'attempt-'));
  return { runDir, rejectedAttempts };
}

async function runOne(
  runner: ProcessRunner,
  cliPath: string,
  runDir: string,
  rejectedAttempts: number,
  target: TargetSpec,
  item: { id: number; split: string; category: string; prompt: string },
): Promise<SanitizedRow> {
  const childCacheHome = path.join(runDir, 'cache');
  await fsp.mkdir(childCacheHome, { recursive: true });
  const args = [
    cliPath,
    '--profile-load',
    target.profile,
    '--set',
    'dumpcontext=on',
    '--set',
    'tools.allowed=[]',
    '--output-format',
    'json',
    '--prompt',
    item.prompt,
  ];
  if (target.modelOverride !== undefined) {
    args.push('--model', target.modelOverride);
  }
  if (target.key === 'ollamakimi') {
    args.push('--set', `seed=${item.id + rejectedAttempts * 1000}`);
  }
  const result = await runner.run(args, {
    ...process.env,
    LLXPRT_CACHE_HOME: childCacheHome,
    LLXPRT_LOG_HOME: childCacheHome,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `CLI for ${target.key}/${item.id} exited ${result.exitCode}: ${result.stderr}`,
    );
  }

  const output = await writeCliOutput(result.stdout, runDir);
  const artifacts = await discoverArtifacts(
    childCacheHome,
    output.sessionId,
    target.key,
    item.id,
  );
  const paired = pairArtifacts({
    dumpPath: artifacts.dumpPath,
    usagePath: artifacts.usagePath,
    outputPath: output.path,
    expected: {
      model: target.model,
      prompt: item.prompt,
      protocol: target.protocol,
      endpointHost: target.endpointHost,
    },
  });
  validateTarget(target, paired);
  return sanitizeRow(target, item, paired, rejectedAttempts);
}

async function writeCliOutput(
  stdout: string,
  runDir: string,
): Promise<{ sessionId: string; path: string }> {
  const text = stdout.trim();
  if (text.length === 0) throw new Error('CLI stdout is empty');
  const parsed = parseCliOutput(JSON.parse(text));
  const outputPath = path.join(runDir, 'output.json');
  await fsp.writeFile(outputPath, text, 'utf-8');
  return { sessionId: parsed.sessionId, path: outputPath };
}

async function discoverArtifacts(
  cacheHome: string,
  sessionId: string,
  targetKey: string,
  corpusId: number,
): Promise<{ dumpPath: string; usagePath: string }> {
  const requestDumps = await findFiles(path.join(cacheHome, 'dumps'), (name) =>
    name.endsWith('-request.json'),
  );
  if (requestDumps.length !== 1) {
    throw new Error(
      `Expected exactly 1 request dump for ${targetKey}/${corpusId}, found ${requestDumps.length}`,
    );
  }
  const usageFiles = await findFiles(
    cacheHome,
    (name) => name === `${sessionId}.jsonl`,
  );
  if (usageFiles.length !== 1) {
    throw new Error(
      `Expected exactly 1 usage log for ${targetKey}/${corpusId}, found ${usageFiles.length}`,
    );
  }
  return { dumpPath: requestDumps[0]!, usagePath: usageFiles[0]! };
}

async function findFiles(
  root: string,
  matches: (name: string) => boolean,
): Promise<string[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) return findFiles(fullPath, matches);
      return entry.isFile() && matches(entry.name) ? [fullPath] : [];
    }),
  );
  return nested.flat();
}

function validateTarget(target: TargetSpec, paired: PairedSample): void {
  const observed = `${paired.protocol}/${paired.endpointHost}/${paired.model}`;
  const expected = `${target.protocol}/${target.endpointHost}/${target.model}`;
  if (observed !== expected) {
    throw new Error(
      `Target ${target.key} resolved ${observed}, expected ${expected}`,
    );
  }
}

function sanitizeRow(
  target: TargetSpec,
  item: { id: number; split: string; category: string; prompt: string },
  paired: PairedSample,
  rejectedAttempts: number,
): SanitizedRow {
  return {
    target: target.key,
    profile: target.profile,
    protocol: paired.protocol,
    endpointHost: paired.endpointHost,
    model: paired.model,
    corpusId: item.id,
    split: item.split,
    category: item.category,
    sessionId: paired.sessionId,
    pendingTokens: paired.estimatedTokens,
    requestChars: paired.requestChars,
    charPrediction: paired.requestChars / 4,
    genuineTiktoken: paired.genuineTiktokenTokens,
    actualPromptTokens: paired.actualPromptTokens,
    cachedTokens: paired.cachedTokens,
    rejectedAttempts,
    commitSha: getCommitSha(),
    projectionVersion: PROJECTION_VERSION,
    corpusVersion: CORPUS_VERSION,
    requestHash: paired.requestHash,
    promptHash: promptHash(item.prompt),
    systemHash: paired.systemHash,
    toolsHash: paired.toolsHash,
  };
}

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

function getCommitSha(): string {
  return execSync('git rev-parse HEAD', { encoding: 'utf-8' })
    .trim()
    .slice(0, 12);
}

function rowKey(row: SanitizedRow): string {
  return `${row.target}:${row.corpusId}`;
}

async function readExistingRows(resultsPath: string): Promise<SanitizedRow[]> {
  if (!fs.existsSync(resultsPath)) return [];
  const raw = await fsp.readFile(resultsPath, 'utf-8');
  if (raw.trim().length === 0) return [];
  return raw
    .trim()
    .split('\n')
    .map((line) => validateSanitizedRow(JSON.parse(line)));
}

export function validateSanitizedRow(value: unknown): SanitizedRow {
  if (!isRecord(value)) throw new Error('Sanitized row is not an object');
  const rejected = value['rejectedAttempts'];
  if (rejected !== undefined && (!isFiniteNumber(rejected) || rejected < 0))
    throw new Error('Sanitized row has invalid rejectedAttempts');
  const corpusId = requiredNumber(value, 'corpusId');
  const corpusVersion = requiredString(value, 'corpusVersion');
  const promptHashValue = requiredString(value, 'promptHash');
  const projectionVersion = requiredString(value, 'projectionVersion');
  const item = getCorpusItem(corpusId);
  const split = requiredString(value, 'split');
  const category = requiredString(value, 'category');
  if (split !== item.split)
    throw new Error(
      `Row corpusId ${corpusId} split "${split}" !== corpus "${item.split}"`,
    );
  if (category !== item.category)
    throw new Error(
      `Row corpusId ${corpusId} category "${category}" !== corpus "${item.category}"`,
    );
  if (corpusVersion !== CORPUS_VERSION)
    throw new Error(
      `Row corpusVersion "${corpusVersion}" !== current "${CORPUS_VERSION}"`,
    );
  if (promptHashValue !== promptHash(item.prompt))
    throw new Error(
      `Row promptHash for corpusId ${corpusId} does not match current corpus prompt`,
    );
  if (projectionVersion !== PROJECTION_VERSION)
    throw new Error(
      `Row projectionVersion "${projectionVersion}" !== current "${PROJECTION_VERSION}"`,
    );
  return {
    target: requiredString(value, 'target'),
    profile: requiredString(value, 'profile'),
    protocol: requiredString(value, 'protocol'),
    endpointHost: requiredString(value, 'endpointHost'),
    model: requiredString(value, 'model'),
    corpusId,
    split,
    category,
    sessionId: requiredString(value, 'sessionId'),
    pendingTokens: requiredNumber(value, 'pendingTokens'),
    requestChars: requiredNumber(value, 'requestChars'),
    charPrediction: requiredNumber(value, 'charPrediction'),
    genuineTiktoken: requiredNumber(value, 'genuineTiktoken'),
    actualPromptTokens: requiredNumber(value, 'actualPromptTokens'),
    cachedTokens: requiredNumber(value, 'cachedTokens'),
    rejectedAttempts: rejected ?? 0,
    commitSha: requiredString(value, 'commitSha'),
    projectionVersion,
    corpusVersion,
    requestHash: requiredString(value, 'requestHash'),
    promptHash: promptHashValue,
    systemHash: requiredString(value, 'systemHash'),
    toolsHash: requiredString(value, 'toolsHash'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0)
    throw new Error(`Sanitized row missing string ${key}`);
  return field;
}

function requiredNumber(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (!isFiniteNumber(field))
    throw new Error(`Sanitized row missing finite number ${key}`);
  return field;
}

async function appendRow(
  resultsPath: string,
  row: SanitizedRow,
): Promise<void> {
  await fsp.mkdir(path.dirname(resultsPath), { recursive: true });
  await fsp.appendFile(resultsPath, `${JSON.stringify(row)}\n`, 'utf-8');
}

const CHILD_TIMEOUT_MS = 120_000;

const defaultRunner: ProcessRunner = {
  async run(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('bun', args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          terminateChild(child);
          reject(
            new Error(
              `CLI child exceeded ${CHILD_TIMEOUT_MS}ms timeout for ${args.join(' ')}`,
            ),
          );
        }
      }, CHILD_TIMEOUT_MS);
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout.on('data', (data: Buffer) => {
        stdoutChunks.push(data);
      });
      child.stderr.on('data', (data: Buffer) => {
        stderrChunks.push(data);
      });
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
      child.on('close', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
            stderr: Buffer.concat(stderrChunks).toString('utf-8'),
            exitCode: code ?? -1,
          });
        }
      });
    });
  },
};

function terminateChild(child: ReturnType<typeof spawn>): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // best-effort termination
  }
}
