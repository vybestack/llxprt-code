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
  TRIAGE_TAGS,
  DEFAULT_PR_TEMPLATE_SECTIONS,
} from './pr-review-prompts.mjs';
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_CONTEXT_LIMIT,
  isParseError,
  runLlxprtPromptWithParse,
  saveParseFailureArtifact,
} from './pr-review-llm-helpers.mjs';
import {
  readArtifacts,
  parseDiffManifest,
  resolveOriginalPath,
} from './pr-review-artifacts.mjs';

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

const COMMENT_TAG = '<!-- llxprt-walkthrough -->';
const PLANNER_ISSUE = '#2256';
export const MAX_DIFF_BYTES = 50000;
const MAGNITUDE_LABELS = ['S', 'M', 'L', 'XL', 'XXL'];
const RUNTIME_LAYERS = new Set([
  'api',
  'core',
  'ui',
  'server',
  'provider',
  'client',
  'service',
  'controller',
  'router',
]);

// ---------------------------------------------------------------------------
// JSON extraction / parsers (pure)
// ---------------------------------------------------------------------------

function describeJsonValue(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function assertJsonObject(value, source) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${source}: expected JSON object but got ${describeJsonValue(value)}`,
    );
  }
  return value;
}

function extractJsonObject(rawText) {
  const text = String(rawText ?? '').trim();
  if (text === '') {
    throw new Error('Empty response: cannot parse JSON');
  }
  const direct = tryParseJson(text);
  if (direct.ok) {
    return assertJsonObject(direct.value, 'Direct parse');
  }
  const fenceMatch = text.match(/```(?:json)?[^\S\n]*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    const fenced = tryParseJson(fenceMatch[1].trim());
    if (fenced.ok) {
      return assertJsonObject(fenced.value, 'Fenced JSON parse');
    }
  }
  for (const candidate of findBalancedObjects(text)) {
    const parsed = tryParseJson(candidate);
    if (parsed.ok) {
      return assertJsonObject(parsed.value, 'Balanced-object parse');
    }
  }
  throw new Error('Cannot parse JSON from response');
}

function findBalancedObjects(text) {
  const candidates = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') {
      continue;
    }
    const end = findBalancedObjectEnd(text, start);
    if (end !== -1) {
      candidates.push(text.slice(start, end + 1));
      start = end;
    }
  }
  return candidates;
}

function findBalancedObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function parseMapResponse(rawText) {
  const parsed = extractJsonObject(rawText);
  if (typeof parsed.summary !== 'string' || typeof parsed.triage !== 'string') {
    throw new Error('Invalid map response: missing summary or triage');
  }
  const triage = TRIAGE_TAGS.includes(parsed.triage) ? parsed.triage : 'chore';
  return {
    summary: truncateSummary(parsed.summary),
    signature: String(parsed.signature ?? ''),
    triage,
  };
}

const MAX_SUMMARY_WORDS = 100;
const SUMMARY_HARD_LIMIT = 150;

function truncateSummary(summary) {
  const words = summary.trim().split(/\s+/);
  if (words.length > SUMMARY_HARD_LIMIT) {
    return words.slice(0, MAX_SUMMARY_WORDS).join(' ') + '...';
  }
  return summary;
}

export function parseGroupResponse(rawText) {
  const parsed = extractJsonObject(rawText);
  if (!Array.isArray(parsed.themes)) {
    throw new Error('Invalid group response: themes is not an array');
  }
  return { themes: validateGroupThemes(parsed.themes) };
}

/**
 * Validate that each theme has layer (string), files (array of strings),
 * and summary (string). Drop themes that are structurally invalid.
 */
export function validateGroupThemes(themes) {
  if (!Array.isArray(themes)) {
    return [];
  }
  return themes
    .filter(
      (t) =>
        t !== null &&
        typeof t === 'object' &&
        typeof t.layer === 'string' &&
        typeof t.summary === 'string',
    )
    .map((t) => ({
      layer: t.layer,
      summary: t.summary,
      files: Array.isArray(t.files)
        ? t.files.filter((f) => typeof f === 'string')
        : [],
    }));
}

// ---------------------------------------------------------------------------
// Renderer (pure)
// ---------------------------------------------------------------------------

export function renderWalkthroughComment({
  releaseNotes,
  walkthrough,
  themes,
  sequenceDiagram,
  magnitude,
  related,
  preMergeChecks,
}) {
  const validThemes = validateGroupThemes(themes);
  const sections = [COMMENT_TAG, '# Walkthrough', walkthrough || ''];
  if (releaseNotes) {
    sections.push(releaseNotes);
  }
  sections.push(renderChangesTable(validThemes));
  if (sequenceDiagram) {
    sections.push(`## Sequence Diagram\n${sequenceDiagram}`);
  }
  if (magnitude) {
    sections.push(renderMagnitudeSection(magnitude));
  }
  sections.push(renderRelatedSection(related));
  sections.push(renderPreMergeChecks(preMergeChecks));
  sections.push(renderFooter());
  return sections.filter((section) => section !== '').join('\n\n');
}

function renderRelatedSection(related) {
  const content = typeof related === 'string' ? related.trim() : '';
  return content
    ? `## Related\n${content}`
    : '## Related\nNo related items found.';
}

function renderChangesTable(themes) {
  if (!themes || themes.length === 0) {
    return '';
  }
  const header = '| Layer | File(s) | Summary |\n| --- | --- | --- |';
  const rows = themes.map((t) => {
    const layer = escapeMarkdownTableCell(t.layer);
    const files =
      t.files && t.files.length > 0
        ? t.files.map((f) => escapeMarkdownTableCell(f)).join(', ')
        : '(none)';
    const summary = escapeMarkdownTableCell(t.summary);
    return `| ${layer} | ${files} | ${summary} |`;
  });
  return `## Changes\n${header}\n${rows.join('\n')}`;
}

/**
 * Escape a string for safe interpolation into a markdown table cell.
 * Escapes backslash, pipe, and replaces newlines with <br>.
 */
export function escapeMarkdownTableCell(text) {
  const value = text == null ? '' : String(text);
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n/g, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/\r/g, '<br>');
}

function renderMagnitudeSection(magnitude) {
  return `## Magnitude\n\u{1F3AF} ${magnitude.score} (${magnitude.label})\n${magnitude.basis}`;
}

function renderPreMergeChecks(checks) {
  if (!checks) {
    return '';
  }
  const ok = '\u2705';
  const no = '\u274C';
  const esc = escapeMarkdownTableCell;
  const rows = [
    '| Check | Status | Note |',
    '| --- | --- | --- |',
    `| Title | ${checks.title?.ok ? ok : no} | ${esc(checks.title?.note)} |`,
    `| Description | ${checks.description?.ok ? ok : no} | ${esc(checks.description?.note)} |`,
    `| Linked Issues | ${checks.linked_issues?.ok ? ok : no} | ${esc(checks.linked_issues?.note)} |`,
    `| Out of Scope | \u2014 | ${esc(checks.out_of_scope?.note)} |`,
  ];
  return `## Pre-merge Checks\n${rows.join('\n')}`;
}

function renderFooter() {
  return `---\n\nWalkthrough generated by LLxprt PR Review. Planner issue: ${PLANNER_ISSUE}`;
}

// ---------------------------------------------------------------------------
// Magnitude (pure, deterministic)
// ---------------------------------------------------------------------------

export function computeMagnitude({
  additions,
  deletions,
  changedFiles,
  packageCount,
  criteriaCount,
}) {
  const totalLoc = additions + deletions;
  const rawScore =
    Math.min(totalLoc / 500, 5) * 0.3 +
    Math.min(changedFiles / 5, 5) * 0.3 +
    Math.min(packageCount, 5) * 0.2 +
    Math.min(criteriaCount, 5) * 0.2;
  const score = Math.max(1, Math.min(5, Math.round(rawScore)));
  const label = MAGNITUDE_LABELS[score - 1];
  const basis = formatMagnitudeBasis(
    additions,
    deletions,
    changedFiles,
    packageCount,
    criteriaCount,
  );
  return { score, label, basis };
}

function formatMagnitudeBasis(
  additions,
  deletions,
  changedFiles,
  packageCount,
  criteriaCount,
) {
  const pkgWord = packageCount === 1 ? 'package' : 'packages';
  const critWord = criteriaCount === 1 ? 'criterion' : 'criteria';
  return `${additions} additions, ${deletions} deletions, ${changedFiles} changed files across ${packageCount} ${pkgWord}, ${criteriaCount} acceptance ${critWord}`;
}

// ---------------------------------------------------------------------------
// Concurrency limiter (pure async logic)
// ---------------------------------------------------------------------------

export async function mapWithConcurrency(items, concurrencyLimit, asyncFn) {
  if (!Number.isInteger(concurrencyLimit) || concurrencyLimit < 1) {
    throw new RangeError('concurrencyLimit must be a positive integer');
  }
  const results = new Array(items.length);
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
  const workerCount = Math.min(concurrencyLimit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Sequence diagram gate (pure heuristic)
// ---------------------------------------------------------------------------

export function gateSequenceDiagram(themes, changedFiles) {
  const packages = new Set(
    changedFiles
      .filter((f) => f.startsWith('packages/'))
      .map((f) => f.split('/')[1]),
  );
  if (packages.size > 1) {
    return true;
  }
  const runtimeLayerCount = themes.filter((t) =>
    RUNTIME_LAYERS.has(String(t.layer).toLowerCase()),
  ).length;
  return runtimeLayerCount >= 2;
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

export function isRetryableLlxprtError(error) {
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : '';
  if (TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }
  if (code === 'ENOENT') {
    return false;
  }
  const message = String(error?.message ?? error).toLowerCase();
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLlxprtPrompt(
  prompt,
  { model, timeoutMs = 120000 } = {},
) {
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

function spawnCapturingStdout(command, args, timeoutMs, extraEnv) {
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
  error,
  secret = process.env.OPENAI_API_KEY,
) {
  const source = error instanceof Error ? error : new Error(String(error));
  const hasSecret = Boolean(secret) && source.message.includes(secret);
  if (!source.message.includes('--key') && !hasSecret) {
    return source;
  }
  let sanitized = source.message
    .replace(/--key=(?:"[^"]*"|'[^']*'|[^\s]+)/g, '--key=[REDACTED]')
    .replace(/(--key\b)(?:\s+)(?!-)(\S+)/g, '$1 [REDACTED]');
  if (hasSecret) {
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  const clean = new Error(sanitized);
  for (const prop of ['code', 'exitCode', 'signal', 'killed']) {
    if (source[prop] !== undefined) {
      clean[prop] = source[prop];
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
    // CRITICAL: Never write the raw error message to the comment file — it
    // may contain sanitized-but-still-sensitive process output. Write a
    // generic message for the PR; the detail goes to stderr/log only.
    console.error(`Walkthrough pipeline failed: ${error.message}`);
    await fs.mkdir(reviewDir, { recursive: true }).catch(() => undefined);
    const nl = String.fromCharCode(10);
    const fallbackComment =
      COMMENT_TAG +
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

async function runPipeline(reviewDir) {
  const artifacts = await readArtifacts(reviewDir);
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
    console.error(
      `Pipeline phase failed unexpectedly, writing minimal walkthrough: ${pipelineError.message}`,
    );
    const comment = renderWalkthroughComment({
      releaseNotes: '',
      walkthrough: buildMinimalWalkthrough(
        artifacts,
        artifacts.diffs.map((d) => ({
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

async function runMapPhase(reviewDir, artifacts) {
  const mapItems = artifacts.diffs.map((d) => ({
    filePath: d.filePath,
    diff: d.content,
    prContext: artifacts.prContext,
  }));
  const results = await mapWithConcurrency(mapItems, 3, (item) =>
    mapSingleItem(reviewDir, item),
  );
  const summariesDir = path.join(reviewDir, 'summaries');
  await fs.mkdir(summariesDir, { recursive: true });
  for (const result of results) {
    if ('error' in result) {
      continue;
    }
    const safe = result.filePath.replace(/\//g, '__');
    await fs.writeFile(
      path.join(summariesDir, `${safe}.json`),
      JSON.stringify(result, null, 2),
    );
  }
  return results.map((r) =>
    'error' in r
      ? placeholderSummary(r.filePath, `(per-file summary failed: ${r.error})`)
      : r,
  );
}

const MAP_MODEL = process.env.LLXPRT_DEFAULT_MODEL;
const STRONG_MODEL =
  process.env.LLXPRT_STRONG_MODEL || process.env.LLXPRT_DEFAULT_MODEL;

function placeholderSummary(filePath, reason) {
  return { filePath, summary: reason, signature: '', triage: 'chore' };
}

async function mapSingleItem(reviewDir, item) {
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
      saveParseFailure: (phase, raw, promptLength) =>
        saveParseFailureArtifact(reviewDir, phase, raw, { promptLength }),
      promptLength: prompt.length,
    },
  );
  return { filePath: item.filePath, ...parsed };
}

async function runGroupPhase(reviewDir, artifacts, summaries) {
  const prompt = buildGroupPrompt(summaries, artifacts.prContext);
  try {
    const themes = await runLlxprtPromptWithParse(
      () => runLlxprtPrompt(prompt, { model: STRONG_MODEL }),
      parseGroupResponse,
      {
        phase: 'group',
        saveParseFailure: (phase, raw, promptLength) =>
          saveParseFailureArtifact(reviewDir, phase, raw, { promptLength }),
        promptLength: prompt.length,
      },
    );
    return themes.themes;
  } catch (error) {
    console.error(
      `Group phase failed, falling back to directory grouping: ${error.message}`,
    );
    return fallbackGroupByDirectory(summaries);
  }
}

function fallbackGroupByDirectory(summaries) {
  const groups = new Map();
  for (const s of summaries) {
    const dir = path.dirname(s.filePath);
    if (!groups.has(dir)) {
      groups.set(dir, {
        layer: dir,
        files: [],
        summary: `Changes in ${dir}`,
        triage: 'chore',
        signature: '',
      });
    }
    groups.get(dir).files.push(s.filePath);
  }
  return Array.from(groups.values());
}

async function runSynthesisPhases(reviewDir, artifacts, summaries, themes) {
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
        saveParseFailure: (phase, raw, promptLength) =>
          saveParseFailureArtifact(reviewDir, phase, raw, { promptLength }),
        promptLength: prompts.walkthroughReleaseNotes.length,
      },
    );
    return await buildSynthesisTail(
      prompts,
      themes,
      artifacts,
      walkthroughParsed,
    );
  } catch (error) {
    console.error(
      `Synthesis phase failed, producing minimal walkthrough: ${error.message}`,
    );
    return {
      walkthrough: buildMinimalWalkthrough(artifacts, summaries),
      releaseNotes: '',
      sequenceDiagram: '',
      related: '',
    };
  }
}

async function buildSynthesisTail(
  prompts,
  themes,
  artifacts,
  walkthroughParsed,
) {
  const validThemes = validateGroupThemes(themes);
  const shouldDiagram = gateSequenceDiagram(
    validThemes,
    artifacts.changedFilePaths,
  );
  const sequenceDiagram = shouldDiagram
    ? await runOptionalStage(prompts.sequenceDiagram, 'diagram')
    : '';
  const related = await runOptionalStage(prompts.related, 'related');
  return {
    walkthrough: String(walkthroughParsed.walkthrough ?? ''),
    releaseNotes: String(walkthroughParsed.release_notes ?? ''),
    sequenceDiagram,
    related,
  };
}

function buildMinimalWalkthrough(artifacts, summaries) {
  const fileList = summaries
    .map((s) => `- \`${s.filePath}\`: ${s.summary}`)
    .join('\n');
  return `This PR changes ${summaries.length} file(s).\n\n${fileList}`;
}

async function runOptionalStage(prompt, key) {
  try {
    const raw = await runLlxprtPrompt(prompt, { model: STRONG_MODEL });
    const parsed = extractJsonObject(raw);
    return parsed[key] || '';
  } catch (error) {
    console.error(`Optional stage "${key}" failed: ${error.message}`);
    return '';
  }
}

async function runPreMergeChecksPhase(reviewDir, artifacts, summaries) {
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
        saveParseFailure: (phase, raw, promptLength) =>
          saveParseFailureArtifact(reviewDir, phase, raw, { promptLength }),
        promptLength: prompt.length,
      },
    );
  } catch (error) {
    console.error(`Pre-merge checks phase failed, skipping: ${error.message}`);
    return null;
  }
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  main();
}
