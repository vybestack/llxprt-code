/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

// Issue #2742: 4000 was too small — the LLM's JSON output for large diffs or
// complex prompts could be truncated mid-object, causing unparseable JSON.
// 16384 (16k) is large enough for any walkthrough JSON payload without being
// wasteful. step-3.7-flash supports up to 256K output tokens, so 16k is well
// within the model's capacity.
export const DEFAULT_MAX_TOKENS = 16384;

// Issue #2742: step-3.7-flash has a 256K context window. If no LLXPRT_CONTEXT_LIMIT
// env var is set, fall back to 256000 (the documented context length) rather
// than the 200000 default that only applies to models not in the catalog.
export const DEFAULT_CONTEXT_LIMIT = 256000;

const TRANSIENT_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

function errorProperty(error: unknown, property: PropertyKey): unknown {
  if (error === null || typeof error !== 'object') {
    return undefined;
  }
  return Reflect.get(error, property);
}

export function isRetryableLlxprtError(error: unknown): boolean {
  const rawCode = errorProperty(error, 'code');
  const code = typeof rawCode === 'string' ? rawCode.toUpperCase() : '';
  if (TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }
  if (code === 'ENOENT') {
    return false;
  }
  const message = String(
    errorProperty(error, 'message') ?? error,
  ).toLowerCase();
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

/**
 * Issue #2742: Classify whether an error is a JSON-parse or response-validation
 * failure (as opposed to a network/spawn error). Parse errors should trigger
 * a fresh LLM call — the model may return valid JSON on retry.
 */
const NON_OBJECT_PARSE_PREFIXES = [
  'Direct parse: expected JSON object but got ',
  'Fenced JSON parse: expected JSON object but got ',
  'Balanced-object parse: expected JSON object but got ',
];

export function isParseError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const message = String(errorProperty(error, 'message') ?? error);
  return (
    message === 'Cannot parse JSON from response' ||
    message === 'Empty response: cannot parse JSON' ||
    /^Invalid (map|group) response:/.test(message) ||
    NON_OBJECT_PARSE_PREFIXES.some((prefix) => message.startsWith(prefix))
  );
}

function defaultBackoffDelay(attempt: number): number {
  return 1000 * 2 ** attempt;
}

/**
 * Issue #2742: Wrap an LLM call + parse in a retry loop that retries on
 * parse errors (not just spawn-level errors). When a parse failure occurs
 * after the final retry, the raw LLM response is saved to a diagnostics
 * artifact so the failure can be debugged post-hoc.
 *
 * @param {function(string): Promise<string>} llmFn - async function that
 *   takes a prompt and returns the raw LLM response string.
 * @param {function(string): Promise<object>} parser - parser function
 *   (e.g. parseMapResponse, parseGroupResponse) that may throw on bad input.
 * @param {object} opts - { maxRetries, delayMs, phase, saveParseFailure,
 *   promptLength }
 * @returns {Promise<object>} the parsed result.
 */
export async function runLlxprtPromptWithParse<T>(
  llmFn: () => Promise<string>,
  parser: (rawText: string) => T,
  {
    maxRetries = 2,
    delayMs = defaultBackoffDelay,
    phase = 'unknown',
    saveParseFailure = () => Promise.resolve(),
    promptLength = 0,
  }: {
    maxRetries?: number;
    delayMs?: (attempt: number) => number | Promise<void>;
    phase?: string;
    saveParseFailure?: (
      phase: string,
      raw: string,
      promptLength: number,
    ) => Promise<void>;
    promptLength?: number;
  } = {},
): Promise<T> {
  let lastRaw = '';
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      lastRaw = await llmFn();
      return parser(lastRaw);
    } catch (error) {
      const canRetry =
        attempt < maxRetries &&
        (isParseError(error) || isRetryableLlxprtError(error));
      if (!canRetry) {
        await handleParseFailure(
          error,
          saveParseFailure,
          phase,
          lastRaw,
          promptLength,
        );
        throw error;
      }
      await delayMs(attempt);
    }
  }
  throw new Error('unreachable');
}

async function handleParseFailure(
  error: unknown,
  saveParseFailure: (
    phase: string,
    raw: string,
    promptLength: number,
  ) => Promise<void>,
  phase: string,
  lastRaw: string,
  promptLength: number,
): Promise<void> {
  if (isParseError(error)) {
    await saveParseFailure(phase, lastRaw, promptLength).catch(() => {});
  }
}

/**
 * Issue #2742: Save the raw LLM response to a diagnostics artifact when
 * parsing fails. The raw response goes to the **artifact file**, not to
 * the error message (which must stay clean for the public PR comment).
 *
 * Writes two files:
 * - `parse-failure-raw-<phase>.txt` — the raw LLM response
 * - `parse-failure-info.json` — metadata (phase, promptLength, timestamp)
 */
export async function saveParseFailureArtifact(
  reviewDir: string,
  phase: string,
  rawResponse: string,
  { promptLength = 0 }: { promptLength?: number } = {},
): Promise<void> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rawPath = path.join(
    reviewDir,
    `parse-failure-raw-${phase}-${suffix}.txt`,
  );
  const infoPath = path.join(reviewDir, `parse-failure-info-${suffix}.json`);
  try {
    await fs.mkdir(reviewDir, { recursive: true });
    await fs.writeFile(rawPath, String(rawResponse ?? ''));
    await fs.writeFile(
      infoPath,
      JSON.stringify(
        {
          phase,
          promptLength,
          timestamp: new Date().toISOString(),
          rawLength: String(rawResponse ?? '').length,
        },
        null,
        2,
      ),
    );
  } catch (writeError) {
    console.error(
      `[pr-review] failed to write parse-failure artifact for phase ${phase}:`,
      writeError,
    );
  }
}
