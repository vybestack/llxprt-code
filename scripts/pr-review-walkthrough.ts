#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMapPrompt,
  buildGroupPrompt,
  buildSynthesisPrompts,
  buildPreMergeChecksPrompt,
  DEFAULT_PR_TEMPLATE_SECTIONS,
  type PrContext,
} from './pr-review-prompts.ts';
import { z } from 'zod';
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_CONTEXT_LIMIT,
  isParseError,
  runLlxprtPromptWithParse,
  saveParseFailureArtifact,
} from './pr-review-llm-helpers.ts';
import {
  readArtifacts,
  parseDiffManifest,
  resolveOriginalPath,
} from './pr-review-artifacts.ts';
import {
  extractJsonObject,
  parseMapResponse,
  parseGroupResponse,
  renderWalkthroughComment,
  validateGroupThemes,
  escapeMarkdownTableCell,
  computeMagnitude,
  gateSequenceDiagram,
  sanitizeSequenceDiagram,
  type GroupTheme,
} from './pr-review-walkthrough-parse.ts';

export {
  buildMapPrompt,
  buildGroupPrompt,
  buildSynthesisPrompts,
  buildPreMergeChecksPrompt,
};
export {
  DEFAULT_MAX_TOKENS,
  DEFAULT_CONTEXT_LIMIT,
  isParseError,
  runLlxprtPromptWithParse,
  saveParseFailureArtifact,
};
export { parseDiffManifest, resolveOriginalPath };
export {
  parseMapResponse,
  parseGroupResponse,
  renderWalkthroughComment,
  validateGroupThemes,
  escapeMarkdownTableCell,
  computeMagnitude,
  gateSequenceDiagram,
  sanitizeSequenceDiagram,
};
export type { GroupTheme };

export const MAX_DIFF_BYTES = 50000;

// ---------------------------------------------------------------------------
// Concurrency limiter (pure async logic)
// ---------------------------------------------------------------------------

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrencyLimit: unknown,
  asyncFn: (item: T) => Promise<R>,
): Promise<Array<R | { error: string; filePath: unknown }>> {
  const limit = Number(concurrencyLimit);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('concurrencyLimit must be a positive integer');
  }
  const results: Array<R | { error: string; filePath: unknown }> = new Array(
    items.length,
  );
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      try {
        results[index] = await asyncFn(item);
      } catch (error) {
        results[index] = {
          error: error instanceof Error ? error.message : String(error),
          filePath:
            item && typeof item === 'object' && 'filePath' in item
              ? item.filePath
              : undefined,
        };
      }
    }
  };
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// LLM call wrapper (impure — network/process I/O)
// ---------------------------------------------------------------------------

const TRANSIENT_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

export function isRetryableLlxprtError(error: unknown): boolean {
  let code = '';
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const rawCode = Reflect.get(error, 'code');
    if (typeof rawCode === 'string') {
      code = rawCode.toUpperCase();
    }
  }
  if (TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }
  if (code === 'ENOENT') {
    return false;
  }
  let message = '';
  if (typeof error === 'string') {
    message = error;
  } else if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error
  ) {
    const rawMessage = Reflect.get(error, 'message');
    if (typeof rawMessage === 'string') {
      message = rawMessage;
    }
  }
  message = message.toLowerCase();
  if (
    /\b(401|403)\b|unauthorized|forbidden|authentication|invalid api key/.test(
      message,
    )
  ) {
    return false;
  }
  return /\b(408|425|429|500|502|503|504|529)\b|rate.?limit|overload|timed?out|temporar|connection reset/.test(
    message,
  );
}

function delay(ms: number | undefined) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLlxprtPrompt(
  prompt: string,
  { model, timeoutMs = 120000 }: { model?: string; timeoutMs?: number } = {},
): Promise<string> {
  const provider = process.env.LLXPRT_DEFAULT_PROVIDER;
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL;
  if (!provider || !apiKey || !baseUrl || !model) {
    throw new Error(
      'Missing required configuration: LLXPRT_DEFAULT_PROVIDER, OPENAI_API_KEY, OPENAI_BASE_URL, and a model must all be set',
    );
  }
  const contextLimit =
    process.env.LLXPRT_CONTEXT_LIMIT || String(DEFAULT_CONTEXT_LIMIT);
  const args = [
    '--provider',
    provider,
    '--model',
    model,
    '--baseurl',
    baseUrl,
    '--set',
    'modelparam.temperature=0.7',
    '--set',
    `modelparam.max_tokens=${DEFAULT_MAX_TOKENS}`,
    '--set',
    `context-limit=${contextLimit}`,
    '--prompt',
    prompt,
  ];
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await spawnCapturingStdout('llxprt', args, timeoutMs, {
        OPENAI_API_KEY: apiKey,
      });
    } catch (error) {
      if (attempt === maxRetries || !isRetryableLlxprtError(error)) {
        throw error;
      }
      await delay(1000 * 2 ** attempt);
    }
  }
  throw new Error('unreachable');
}

function spawnCapturingStdout(
  command: string,
  args: string[],
  timeoutMs: number,
  extraEnv: { OPENAI_API_KEY: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const childEnv = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const child = execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: childEnv,
      },
      (error, stdout) => {
        cleanup();
        if (error) {
          reject(sanitizeErrorMessage(error));
        } else {
          resolve(stdout);
        }
      },
    );
    const terminate = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Child may have already exited; ignore ESRCH/ENOENT.
      }
    };
    const cleanup = () => {
      process.off('exit', terminate);
      process.off('SIGINT', terminate);
      process.off('SIGTERM', terminate);
    };
    process.on('exit', terminate);
    process.on('SIGINT', terminate);
    process.on('SIGTERM', terminate);
    child.on('error', (error) => {
      cleanup();
      reject(sanitizeErrorMessage(error));
    });
  });
}

/**
 * Strip API key values from process error messages so that rejected promises
 * never carry secrets. The negative lookahead `(?!-)` ensures we only redact
 * a value that does not itself look like a flag (e.g. `--key --prompt` does
 * not redact `--prompt`). This is belt-and-suspenders for any legacy errors;
 * the API key is now passed via environment variable, not CLI args.
 */
export function sanitizeErrorMessage(
  error: string | Error,
  secret = process.env.OPENAI_API_KEY,
): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const hasSecret =
    typeof secret === 'string' && secret.length > 0
      ? source.message.includes(secret)
      : false;
  if (!source.message.includes('--key') && !hasSecret) {
    return source;
  }
  let sanitized = source.message
    .replace(/--key=(?:"[^"]*"|'[^']*'|[^\s]+)/g, '--key=[REDACTED]')
    .replace(/(--key\b)(?:\s+)(?!-)(\S+)/g, '$1 [REDACTED]');
  if (hasSecret && secret) {
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  const clean = new Error(sanitized);
  if (typeof source !== 'string') {
    for (const prop of ['code', 'exitCode', 'signal', 'killed']) {
      const descriptor = Object.getOwnPropertyDescriptor(source, prop);
      if (descriptor && descriptor.value !== undefined) {
        Object.defineProperty(clean, prop, descriptor);
      }
    }
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Orchestrator (impure — entry point, called only when run as a script)
// ---------------------------------------------------------------------------

async function main() {
  const reviewDir = 'review';
  try {
    await runPipeline(reviewDir);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`Walkthrough pipeline failed: ${errMsg}`);
    await fs.mkdir(reviewDir, { recursive: true }).catch(() => undefined);
    const nl = String.fromCharCode(10);
    const fallbackComment =
      '<!-- llxprt-walkthrough -->' +
      nl +
      nl +
      '## LLxprt walkthrough unavailable' +
      nl +
      nl +
      'The walkthrough commenter encountered an internal error. Please inspect the workflow logs.';
    await fs.writeFile(path.join(reviewDir, 'comment.md'), fallbackComment);
    process.exitCode = 1;
  }
}

async function runPipeline(reviewDir: string): Promise<void> {
  const raw = await readArtifacts(reviewDir);
  const artifacts = validateArtifactsData(raw);
  if (artifacts.diffs.length === 0) {
    const comment = renderWalkthroughComment({
      releaseNotes: '',
      walkthrough: 'No code changes were detected for this PR.',
      themes: [],
      sequenceDiagram: '',
      magnitude: computeMagnitude(artifacts.magnitudeInput),
      related: '',
      preMergeChecks: null,
    });
    await fs.writeFile(path.join(reviewDir, 'comment.md'), comment);
    await fs.writeFile(path.join(reviewDir, 'walkthrough.md'), comment);
    console.log('No diffs detected; minimal walkthrough written.');
    return;
  }
  try {
    const summaries = await runMapPhase(reviewDir, artifacts);
    const themes = await runGroupPhase(reviewDir, artifacts, summaries);
    const synthesis = await runSynthesisPhases(
      reviewDir,
      artifacts,
      summaries,
      themes,
    );
    const preMergeChecks = await runPreMergeChecksPhase(
      reviewDir,
      artifacts,
      summaries,
    );
    const magnitude = computeMagnitude(artifacts.magnitudeInput);
    const comment = renderWalkthroughComment({
      releaseNotes: synthesis.releaseNotes,
      walkthrough: synthesis.walkthrough,
      themes,
      sequenceDiagram: synthesis.sequenceDiagram,
      magnitude,
      related: synthesis.related,
      preMergeChecks,
    });
    await fs.writeFile(path.join(reviewDir, 'comment.md'), comment);
    await fs.writeFile(path.join(reviewDir, 'walkthrough.md'), comment);
    console.log('Walkthrough written to review/comment.md');
  } catch (pipelineError) {
    const pipelineErrMsg =
      pipelineError instanceof Error
        ? pipelineError.message
        : String(pipelineError);
    console.error(
      `Pipeline phase failed unexpectedly, writing minimal walkthrough: ${pipelineErrMsg}`,
    );
    const comment = renderWalkthroughComment({
      releaseNotes: '',
      walkthrough: buildMinimalWalkthrough(
        artifacts.diffs.map((d: { filePath: string }) => ({
          filePath: d.filePath,
          summary: d.filePath,
        })),
      ),
      themes: [],
      sequenceDiagram: '',
      magnitude: computeMagnitude(artifacts.magnitudeInput),
      related: '',
      preMergeChecks: null,
    });
    await fs.writeFile(path.join(reviewDir, 'comment.md'), comment);
    await fs.writeFile(path.join(reviewDir, 'walkthrough.md'), comment);
  }
}

async function runMapPhase(
  reviewDir: string,
  artifacts: {
    diffs: Array<{ filePath: string; content: string }>;
    prContext: PrContext;
  },
): Promise<Array<Record<string, unknown>>> {
  const mapItems = artifacts.diffs.map(
    (d: { filePath: string; content: string }) => ({
      filePath: d.filePath,
      diff: d.content,
      prContext: artifacts.prContext,
    }),
  );
  const results = await mapWithConcurrency(mapItems, 3, (item: MapItem) =>
    mapSingleItem(reviewDir, item),
  );
  const summariesDir = path.join(reviewDir, 'summaries');
  await fs.mkdir(summariesDir, { recursive: true });
  for (const result of results) {
    if ('error' in result && typeof result.error === 'string') {
      continue;
    }
    const safe = String(result.filePath).replace(/\//g, '__');
    await fs.writeFile(
      path.join(summariesDir, `${safe}.json`),
      JSON.stringify(result, null, 2),
    );
  }
  return results.map((result) => {
    if (!('error' in result) || typeof result.error !== 'string') {
      return result;
    }
    // The rejection message carries the prompt and untrusted payload; keep it
    // on stderr/logs only and render a fixed label into the public comment.
    console.error(
      `[walkthrough] per-file summary failed for ${result.filePath}: ${result.error}`,
    );
    return placeholderSummary(
      String(result.filePath),
      PER_FILE_SUMMARY_UNAVAILABLE,
    );
  });
}

interface MapItem {
  filePath: string;
  diff: string;
  prContext: PrContext;
}

const prContextSchema = z.object({
  number: z.number(),
  title: z.string(),
  author: z.string().optional(),
  body: z.string().optional(),
  baseRefName: z.string().optional(),
  headRefName: z.string().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  changedFiles: z.number().optional(),
  commits: z.number().optional(),
});

const diffArtifactSchema = z.object({
  filePath: z.string(),
  content: z.string(),
});

const magnitudeInputSchema = z.object({
  additions: z.number().default(0),
  deletions: z.number().default(0),
  changedFiles: z.number().default(0),
  packageCount: z.number().default(0),
  criteriaCount: z.number().default(0),
});
const MAP_MODEL = process.env.LLXPRT_DEFAULT_MODEL;
const STRONG_MODEL =
  process.env.LLXPRT_STRONG_MODEL || process.env.LLXPRT_DEFAULT_MODEL;

/**
 * Public placeholder shown when a single file's summary could not be produced.
 *
 * The underlying failure message (from the model subprocess) embeds the full
 * prompt, including untrusted diff/PR data and the exact command line, so it
 * must never be rendered into the published comment. The real diagnostic is
 * written to stderr/logs instead; the comment gets only this fixed label.
 */
const PER_FILE_SUMMARY_UNAVAILABLE = '(per-file summary unavailable)';

function placeholderSummary(
  filePath: string,

  reason: string,
): {
  filePath: string;
  summary: string;
  signature: string;
  triage: string;
} {
  return { filePath, summary: reason, signature: '', triage: 'chore' };
}

async function mapSingleItem(
  reviewDir: string,
  item: MapItem,
): Promise<Record<string, unknown>> {
  if (item.diff.length > MAX_DIFF_BYTES) {
    return placeholderSummary(
      item.filePath,
      '(file too large for per-file summary, skipped)',
    );
  }
  const prompt = buildMapPrompt(item.filePath, item.diff, item.prContext);
  const parsed = await runLlxprtPromptWithParse(
    () => runLlxprtPrompt(prompt, { model: MAP_MODEL }),
    parseMapResponse,
    {
      phase: 'map',
      saveParseFailure: (phase: string, raw: string, promptLength: number) =>
        saveParseFailureArtifact(reviewDir, phase, raw, { promptLength }),
      promptLength: prompt.length,
    },
  );
  return { filePath: item.filePath, ...parsed };
}

interface ArtifactsData {
  prContext: PrContext;
  issues: unknown[];
  changedFilePaths: string[];
  diffs: Array<{ filePath: string; content: string }>;
  magnitudeInput: {
    additions: number;
    deletions: number;
    changedFiles: number;
    packageCount: number;
    criteriaCount: number;
  };
}

function validateArtifactsData(raw: Record<string, unknown>): ArtifactsData {
  return {
    prContext: prContextSchema.parse(raw.prContext),
    issues: Array.isArray(raw.issues) ? raw.issues : [],
    changedFilePaths: z.array(z.string()).parse(raw.changedFilePaths ?? []),
    diffs: z.array(diffArtifactSchema).parse(raw.diffs ?? []),
    magnitudeInput: magnitudeInputSchema.parse(raw.magnitudeInput ?? {}),
  };
}

async function runGroupPhase(
  reviewDir: string,
  artifacts: ArtifactsData,
  summaries: Array<Record<string, unknown>>,
): Promise<GroupTheme[] | FallbackGroup[]> {
  const prompt = buildGroupPrompt(summaries, artifacts.prContext);
  try {
    const themes = await runLlxprtPromptWithParse(
      () => runLlxprtPrompt(prompt, { model: STRONG_MODEL }),
      parseGroupResponse,
      {
        phase: 'group',
        saveParseFailure: (phase: string, raw: string, promptLength: number) =>
          saveParseFailureArtifact(reviewDir, phase, raw, { promptLength }),
        promptLength: prompt.length,
      },
    );
    return themes.themes;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `Group phase failed, falling back to directory grouping: ${errMsg}`,
    );
    return fallbackGroupByDirectory(summaries);
  }
}

interface FallbackGroup {
  layer: string;
  files: string[];
  summary: string;
  triage: string;
  signature: string;
}

function fallbackGroupByDirectory(
  summaries: Array<Record<string, unknown>>,
): FallbackGroup[] {
  const groups = new Map<string, FallbackGroup>();
  for (const s of summaries) {
    const dir = path.dirname(String(s.filePath));
    if (!groups.has(dir)) {
      groups.set(dir, {
        layer: dir,
        files: [],
        summary: `Changes in ${dir}`,
        triage: 'chore',
        signature: '',
      });
    }
    const group = groups.get(dir);
    if (group !== undefined) {
      group.files.push(String(s.filePath));
    }
  }
  return Array.from(groups.values());
}

interface SynthesisResult {
  walkthrough: string;
  releaseNotes: string;
  sequenceDiagram: string;
  related: string;
}

async function runSynthesisPhases(
  reviewDir: string,
  artifacts: ArtifactsData,
  summaries: Array<Record<string, unknown>>,
  themes: unknown[],
): Promise<SynthesisResult> {
  const prompts = buildSynthesisPrompts({
    prContext: artifacts.prContext,
    summaries,
    themes,
    fullIssueBodies: artifacts.issues,
  });
  try {
    const walkthroughParsed = await runLlxprtPromptWithParse(
      () =>
        runLlxprtPrompt(prompts.walkthroughReleaseNotes, {
          model: STRONG_MODEL,
        }),
      extractJsonObject,
      {
        phase: 'synthesis',
        saveParseFailure: (phase: string, raw: string, promptLength: number) =>
          saveParseFailureArtifact(reviewDir, phase, raw, { promptLength }),
        promptLength: prompts.walkthroughReleaseNotes.length,
      },
    );
    return await buildSynthesisTail(
      reviewDir,
      prompts,
      themes,
      artifacts,
      walkthroughParsed,
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `Synthesis phase failed, producing minimal walkthrough: ${errMsg}`,
    );
    return {
      walkthrough: buildMinimalWalkthrough(summaries),
      releaseNotes: '',
      sequenceDiagram: '',
      related: '',
    };
  }
}

interface SynthesisPrompts {
  walkthroughReleaseNotes: string;
  sequenceDiagram: string;
  related: string;
}

async function buildSynthesisTail(
  reviewDir: string,
  prompts: SynthesisPrompts,
  themes: unknown[],
  artifacts: ArtifactsData,
  walkthroughParsed: Record<string, unknown>,
): Promise<SynthesisResult> {
  const validThemes = validateGroupThemes(themes);
  const shouldDiagram = gateSequenceDiagram(
    validThemes,
    artifacts.changedFilePaths,
  );
  const rawDiagram = shouldDiagram
    ? await runOptionalStage(reviewDir, prompts.sequenceDiagram, 'diagram')
    : '';
  const sequenceDiagram = sanitizeSequenceDiagram(rawDiagram);
  const related = await runOptionalStage(reviewDir, prompts.related, 'related');
  return {
    walkthrough: String(walkthroughParsed.walkthrough ?? ''),
    releaseNotes: String(walkthroughParsed.release_notes ?? ''),
    sequenceDiagram,
    related,
  };
}

function buildMinimalWalkthrough(
  summaries: Array<Record<string, unknown>>,
): string {
  const fileList = summaries
    .map((s) => `- \`${s.filePath}\`: ${s.summary}`)
    .join('\n');
  return `This PR changes ${summaries.length} file(s).\n\n${fileList}`;
}

async function runOptionalStage(
  reviewDir: string,
  prompt: string,
  key: string,
): Promise<string> {
  try {
    const parsed = await runLlxprtPromptWithParse(
      () => runLlxprtPrompt(prompt, { model: STRONG_MODEL }),
      extractJsonObject,
      {
        phase: key,
        saveParseFailure: (
          failPhase: string,
          raw: string,
          promptLength: number,
        ) =>
          saveParseFailureArtifact(reviewDir, failPhase, raw, { promptLength }),
        promptLength: prompt.length,
      },
    );
    const value = parsed[key];
    return typeof value === 'string' ? value : '';
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`Optional stage "${key}" failed: ${errMsg}`);
    return '';
  }
}

async function runPreMergeChecksPhase(
  reviewDir: string,
  artifacts: ArtifactsData,
  summaries: Array<Record<string, unknown>>,
): Promise<Record<string, unknown> | null> {
  const changeEvidence = summaries.map((s) => ({
    filePath: s.filePath,
    summary: s.summary,
    triage: s.triage,
  }));
  const prompt = buildPreMergeChecksPrompt(
    artifacts.prContext,
    artifacts.issues,
    DEFAULT_PR_TEMPLATE_SECTIONS,
    changeEvidence,
  );
  try {
    return await runLlxprtPromptWithParse(
      () => runLlxprtPrompt(prompt, { model: STRONG_MODEL }),
      extractJsonObject,
      {
        phase: 'pre-merge',
        saveParseFailure: (phase: string, raw: string, promptLength: number) =>
          saveParseFailureArtifact(reviewDir, phase, raw, { promptLength }),
        promptLength: prompt.length,
      },
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`Pre-merge checks phase failed, skipping: ${errMsg}`);
    return null;
  }
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  main();
}
