/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2835 — live provider-ground-truth collection for the Claude 5
 * estimators.
 *
 * Runs the real CLI once per corpus item, pairs the dumped request with the
 * recorded provider usage, and writes one sanitized row per observation.
 *
 * Rows carry counts only: the finalized projection is measured here with the
 * production projector, base counter and one-pass feature extractor, and only
 * the resulting integers are persisted. No prompt text, request body, header
 * or credential is ever written to the results file.
 *
 * Usage:
 *   bun scripts/claude-estimator-collect.ts --results <path> --artifacts <dir>
 *                                           [--target <key>] [--id <n>]
 */

import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get_encoding } from '@dqbd/tiktoken';
import {
  CLAUDE_CORPUS_VERSION,
  envelopeToolsAllowList,
  getClaudeCorpus,
  getClaudeCorpusItem,
  type ClaudeCorpusItem,
} from './claude-estimator-corpus.js';
import {
  PROJECTION_REVISION,
  projectAnthropicPromptEnvelope,
  type ProviderFinalizedPromptProjection,
} from '../packages/providers/src/runtime/promptEnvelopeProjections.js';
import { extractClaudeContentFeatures } from '../packages/providers/src/tokenizers/claude/claudeContentFeatures.js';
import { AnthropicTokenizer } from '../packages/providers/src/tokenizers/AnthropicTokenizer.js';

export interface ClaudeTargetSpec {
  readonly key: string;
  readonly profile: string;
  readonly model: string;
  readonly endpointHost: string;
  readonly activeProvider: string;
}

/**
 * Both targets run over the OAuth-backed `claudecode` provider against
 * `api.anthropic.com`, so the two models differ only by model identity. Fable
 * 5 is collected independently and is never allowed to reuse Opus data.
 */
export const CLAUDE_TARGETS: readonly ClaudeTargetSpec[] = Object.freeze([
  {
    key: 'opus5',
    profile: 'opusthinking-claudecode',
    model: 'claude-opus-5',
    endpointHost: 'api.anthropic.com',
    activeProvider: 'claudecode',
  },
  {
    key: 'fable5',
    profile: 'opusthinking-claudecode',
    model: 'claude-fable-5',
    endpointHost: 'api.anthropic.com',
    activeProvider: 'claudecode',
  },
]);

export interface ClaudeSanitizedRow {
  readonly target: string;
  readonly model: string;
  readonly activeProvider: string;
  readonly endpointHost: string;
  readonly protocol: 'anthropic-messages';
  readonly corpusId: number;
  readonly split: string;
  readonly category: string;
  readonly envelope: string;
  readonly scale: number;
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
  readonly promptHash: string;
  readonly projectionHash: string;
}

const encoder = get_encoding('o200k_base');
const heuristicTokenizer = new AnthropicTokenizer();
const CLI_PATH = 'packages/cli/index.ts';
const CHILD_TIMEOUT_MS = 300_000;

function sha256Short(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Run the CLI until the first turn's artifacts exist, then stop it.
 *
 * Only the first request is measured: it is the finalized prompt envelope the
 * pre-send estimate has to predict, and the only turn whose content is fully
 * determined by the corpus item. Later turns carry tool results and model
 * output. Some Claude models treat a code-shaped prompt as an agentic task and
 * keep working for minutes; waiting for them to finish would both waste quota
 * and bias acceptance toward the less agentic model, which is precisely the
 * difference between the two models being measured here.
 */
async function runCliUntilFirstTurn(
  args: string[],
  env: NodeJS.ProcessEnv,
  cacheHome: string,
): Promise<void> {
  // stdout is discarded rather than piped: the run is observed through its
  // artifacts, and an unread pipe would eventually block the child.
  const child = spawn('bun', args, {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const stderr: Buffer[] = [];
  child.stderr.on('data', (data: Buffer) => stderr.push(data));
  let exited: number | null = null;
  let spawnError: Error | undefined;
  child.on('close', (code) => {
    exited = code ?? -1;
  });
  // Without this the loop below would wait out the full timeout when the
  // child cannot start at all.
  child.on('error', (error) => {
    spawnError = error instanceof Error ? error : new Error(String(error));
    exited = -1;
  });

  const deadline = Date.now() + CHILD_TIMEOUT_MS;
  try {
    for (;;) {
      if (await firstTurnArtifactsReady(cacheHome)) return;
      if (spawnError !== undefined) {
        throw new Error(`could not start the CLI: ${spawnError.message}`);
      }
      if (exited !== null) {
        throw new Error(
          `CLI exited ${exited} before the first turn was recorded: ${Buffer.concat(
            stderr,
          )
            .toString('utf-8')
            .slice(0, 300)}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(`no first-turn artifacts within ${CHILD_TIMEOUT_MS}ms`);
      }
      await new Promise((wake) => setTimeout(wake, 500));
    }
  } finally {
    if (exited === null) child.kill('SIGTERM');
  }
}

/**
 * The usage row for a turn is written after that turn's response completes, so
 * its presence alongside a request dump means the first turn is fully
 * measured.
 */
async function firstTurnArtifactsReady(cacheHome: string): Promise<boolean> {
  const dumpsDir = path.join(cacheHome, 'dumps');
  if (!fs.existsSync(dumpsDir)) return false;
  const dumps = await findFiles(dumpsDir, (name) =>
    name.endsWith('-request.json'),
  );
  if (dumps.length === 0) return false;
  const usage = await findFiles(cacheHome, (name) => name.endsWith('.jsonl'));
  for (const file of usage) {
    const text = await fsp.readFile(file, 'utf-8');
    if (text.trim() !== '') return true;
  }
  return false;
}

async function findFiles(
  root: string,
  matches: (name: string) => boolean,
): Promise<string[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) return findFiles(full, matches);
      return entry.isFile() && matches(entry.name) ? [full] : [];
    }),
  );
  return nested.flat();
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} missing finite "${key}"`);
  }
  return value;
}

interface UsageRow {
  readonly actualPromptTokens: number;
  readonly cachedTokens: number;
  readonly model: string;
  readonly provider: string;
}

/** Usage for the first turn, which is the turn being measured. */
async function readUsage(usagePath: string): Promise<UsageRow> {
  const lines = (await fsp.readFile(usagePath, 'utf-8'))
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (lines.length < 1) {
    throw new Error('usage log is empty');
  }
  const record = readRecord(JSON.parse(lines[0]!), 'usage row');
  const model = record['model'];
  const provider = record['provider'];
  if (typeof model !== 'string' || typeof provider !== 'string') {
    throw new Error('usage row missing model/provider');
  }
  return {
    actualPromptTokens: readFiniteNumber(
      record,
      'actual_prompt_tokens',
      'usage row',
    ),
    cachedTokens: readFiniteNumber(record, 'cached_tokens', 'usage row'),
    model,
    provider,
  };
}

/**
 * Extract the user text the provider actually received, so the collected row
 * can be proved to correspond to the intended corpus item.
 */
function extractUserText(body: Record<string, unknown>): string {
  const messages = body['messages'];
  if (!Array.isArray(messages)) return '';
  return messages
    .filter(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        (message as Record<string, unknown>)['role'] === 'user',
    )
    .map((message) => {
      const content = (message as Record<string, unknown>)['content'];
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';
      return content
        .map((part) => {
          if (typeof part !== 'object' || part === null) return '';
          const text = (part as Record<string, unknown>)['text'];
          return typeof text === 'string' ? text : '';
        })
        .join('');
    })
    .join('');
}

function buildCliArgs(
  target: ClaudeTargetSpec,
  item: ClaudeCorpusItem,
): string[] {
  const args = [
    CLI_PATH,
    '--profile-load',
    target.profile,
    '--model',
    target.model,
    '--set',
    'dumpcontext=on',
    '--set',
    'emojifilter=allowed',
    '--output-format',
    'json',
  ];
  const allowList = envelopeToolsAllowList(item.envelope);
  if (allowList !== undefined) {
    args.push('--set', `tools.allowed=${JSON.stringify(allowList)}`);
  }
  args.push('--prompt', item.prompt);
  return args;
}

/**
 * The body of the first request, proved to be the request this corpus item
 * intended: same endpoint, same model, and the item's prompt present verbatim.
 */
async function readFirstRequestBody(
  cacheHome: string,
  target: ClaudeTargetSpec,
  item: ClaudeCorpusItem,
): Promise<{ body: Record<string, unknown>; host: string }> {
  // Dump filenames are timestamp-prefixed, so lexical order is chronological
  // and the first entry is the first turn.
  const dumps = (
    await findFiles(path.join(cacheHome, 'dumps'), (name) =>
      name.endsWith('-request.json'),
    )
  ).sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  if (dumps.length < 1) {
    throw new Error('no request dump found');
  }
  const dump = readRecord(
    JSON.parse(await fsp.readFile(dumps[0]!, 'utf-8')),
    'dump',
  );
  const request = readRecord(dump['request'], 'dump.request');
  const url = request['url'];
  if (typeof url !== 'string') throw new Error('dump.request missing url');
  const host = new URL(url).host;
  if (host !== target.endpointHost) {
    throw new Error(`endpoint ${host} !== expected ${target.endpointHost}`);
  }
  const body = readRecord(request['body'], 'dump.request.body');
  if (body['model'] !== target.model) {
    throw new Error(
      `request body model ${String(body['model'])} !== ${target.model}`,
    );
  }
  if (!extractUserText(body).includes(item.prompt)) {
    throw new Error(
      `request body user text does not contain corpus item ${item.id} verbatim`,
    );
  }
  return { body, host };
}

async function readFirstTurnUsage(
  cacheHome: string,
  target: ClaudeTargetSpec,
): Promise<UsageRow> {
  const usageFiles = await findFiles(cacheHome, (name) =>
    name.endsWith('.jsonl'),
  );
  if (usageFiles.length !== 1) {
    throw new Error(`expected exactly 1 usage log, found ${usageFiles.length}`);
  }
  const usage = await readUsage(usageFiles[0]!);
  if (usage.model !== target.model) {
    throw new Error(`usage model ${usage.model} !== ${target.model}`);
  }
  if (usage.provider !== target.activeProvider) {
    throw new Error(
      `usage provider ${usage.provider} !== ${target.activeProvider}`,
    );
  }
  return usage;
}

async function collectOne(
  target: ClaudeTargetSpec,
  item: ClaudeCorpusItem,
  runDir: string,
): Promise<ClaudeSanitizedRow> {
  const cacheHome = path.join(runDir, 'cache');
  await fsp.mkdir(cacheHome, { recursive: true });
  await runCliUntilFirstTurn(
    buildCliArgs(target, item),
    {
      ...process.env,
      LLXPRT_CACHE_HOME: cacheHome,
      LLXPRT_LOG_HOME: cacheHome,
    },
    cacheHome,
  );

  const { body, host } = await readFirstRequestBody(cacheHome, target, item);
  const usage = await readFirstTurnUsage(cacheHome, target);
  const projection = projectAnthropicPromptEnvelope(body);
  const promptText = (
    projection.finalizedProjection as ProviderFinalizedPromptProjection
  ).promptText;
  const features = extractClaudeContentFeatures(promptText);

  return {
    target: target.key,
    model: target.model,
    activeProvider: usage.provider,
    endpointHost: host,
    protocol: 'anthropic-messages',
    corpusId: item.id,
    split: item.split,
    category: item.category,
    envelope: item.envelope,
    scale: item.scale,
    projectionRevision: PROJECTION_REVISION,
    projectionBaseTokens: encoder.encode(promptText, [], []).length,
    codePoints: features.codePoints,
    nonAsciiCodePoints: features.nonAsciiCodePoints,
    structuralCodePoints: features.structuralCodePoints,
    whitespaceCodePoints: features.whitespaceCodePoints,
    heuristicTokens: await heuristicTokenizer.countTokens(
      promptText,
      target.model,
    ),
    providerPromptTokens: usage.actualPromptTokens,
    cachedPromptTokens: usage.cachedTokens,
    corpusVersion: CLAUDE_CORPUS_VERSION,
    commitSha: execSync('git rev-parse HEAD', { encoding: 'utf-8' })
      .trim()
      .slice(0, 12),
    promptHash: sha256Short(item.prompt),
    projectionHash: sha256Short(promptText),
  };
}

const MAX_ATTEMPTS = 4;

/**
 * A run is only usable when it produced exactly one provider request whose
 * dumped body matches the intended corpus item. A retried or multi-turn run
 * is discarded rather than recorded, because its usage no longer corresponds
 * to a single measurable prompt.
 */
async function collectWithRetries(
  target: ClaudeTargetSpec,
  item: ClaudeCorpusItem,
  artifactsDir: string,
): Promise<ClaudeSanitizedRow> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const runDir = await fsp.mkdtemp(
      path.join(artifactsDir, `${target.key}-${item.id}-`),
    );
    try {
      const row = await collectOne(target, item, runDir);
      await fsp.rm(runDir, { recursive: true, force: true });
      return row;
    } catch (error) {
      lastError = error;
      await fsp.rm(runDir, { recursive: true, force: true });
      const detail = error instanceof Error ? error.message : String(error);
      process.stdout.write(
        `${target.key}:${item.id} attempt ${attempt} rejected: ${detail.slice(0, 160)}
`,
      );
    }
  }
  throw new Error(
    `${target.key}:${item.id} failed after ${MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Keys of observations already collected, so a run can resume.
 *
 * A line that does not parse is skipped rather than fatal: a crash can leave a
 * partially written final line, and refusing to resume because of it would
 * force re-spending provider quota on rows that were already collected.
 */
async function readExisting(resultsPath: string): Promise<Set<string>> {
  if (!fs.existsSync(resultsPath)) return new Set();
  const raw = await fsp.readFile(resultsPath, 'utf-8');
  if (raw.trim() === '') return new Set();
  const keys = new Set<string>();
  for (const [index, line] of raw.trim().split('\n').entries()) {
    try {
      const row = readRecord(JSON.parse(line), 'existing row');
      keys.add(`${String(row['target'])}:${String(row['corpusId'])}`);
    } catch {
      process.stdout.write(
        `skipping unreadable results line ${index + 1}; it will be recollected\n`,
      );
    }
  }
  return keys;
}

export interface CollectOptions {
  readonly resultsPath: string;
  readonly artifactsDir: string;
  readonly target?: string;
  readonly corpusId?: number;
}

export async function collectClaude(options: CollectOptions): Promise<void> {
  const artifactsDir = path.resolve(options.artifactsDir);
  await fsp.mkdir(artifactsDir, { recursive: true });
  const targets =
    options.target === undefined
      ? CLAUDE_TARGETS
      : [
          CLAUDE_TARGETS.find(
            (candidate) => candidate.key === options.target,
          ) ??
            (() => {
              throw new Error(`unknown target ${String(options.target)}`);
            })(),
        ];
  const items =
    options.corpusId === undefined
      ? getClaudeCorpus()
      : [getClaudeCorpusItem(options.corpusId)];
  const done = await readExisting(options.resultsPath);

  for (const target of targets) {
    for (const item of items) {
      const key = `${target.key}:${item.id}`;
      if (done.has(key)) continue;
      const row = await collectWithRetries(target, item, artifactsDir);
      await fsp.mkdir(path.dirname(options.resultsPath), { recursive: true });
      await fsp.appendFile(
        options.resultsPath,
        `${JSON.stringify(row)}\n`,
        'utf-8',
      );
      done.add(key);
      process.stdout.write(
        `${key} ${item.category}/${item.envelope} provider=${row.providerPromptTokens} base=${row.projectionBaseTokens}\n`,
      );
    }
  }
}

function parseFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[arg.slice(2)] = next;
      i++;
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags['results'] === undefined || flags['artifacts'] === undefined) {
    throw new Error('requires --results <path> and --artifacts <dir>');
  }
  await collectClaude({
    resultsPath: flags['results'],
    artifactsDir: flags['artifacts'],
    target: flags['target'],
    corpusId: flags['id'] === undefined ? undefined : Number(flags['id']),
  });
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
