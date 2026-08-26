/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2761 probe harness.
 *
 * Every probe answers one parity question by issuing the SAME logical request
 * through both adapters and recording what each one actually did. A verdict
 * without a recorded observation is not evidence, so `ProbeResult` requires
 * both.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADAPTER_GENAI = 'google-genai@1.30.0' as const;
export const ADAPTER_AISDK = '@ai-sdk/google@2.0.85' as const;

export type AdapterId = typeof ADAPTER_GENAI | typeof ADAPTER_AISDK;

/**
 * `parity` — both adapters deliver the behavior llxprt depends on.
 * `partial` — the AI SDK delivers it only with extra adapter-side work, or
 *             delivers a lossy version of it.
 * `gap`     — the AI SDK cannot deliver it at this pin.
 */
export type Verdict = 'parity' | 'partial' | 'gap';

export interface CapturedError {
  readonly name: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly responseBody?: unknown;
}

export interface AdapterObservation {
  readonly adapter: AdapterId;
  readonly ok: boolean;
  /** Raw, redacted evidence. Never a bare boolean. */
  readonly observation: Record<string, unknown>;
  readonly error?: CapturedError;
}

export interface ProbeResult {
  readonly id: string;
  readonly area: string;
  /** The parity question this probe answers, in one sentence. */
  readonly question: string;
  readonly models: readonly string[];
  readonly genai: AdapterObservation;
  readonly aisdk: AdapterObservation;
  readonly verdict: Verdict;
  /** What the observations mean for the adapter decision. */
  readonly finding: string;
  /**
   * Set by a probe that runs several independent sub-cases and has already
   * accounted for a transient provider failure in one of them. It suppresses
   * the central inconclusive downgrade in `run-all.ts`, so one rate-limited
   * sub-case cannot erase evidence the other sub-cases did produce.
   */
  readonly transientHandled?: boolean;
}

export interface ProbeContext {
  readonly apiKey: string;
  /**
   * General-purpose model for behaviors that are not generation-specific.
   *
   * Defaults to a Gemini 3 model. The Gemini 2.x generation could not be used:
   * `gemini-2.5-pro` and `gemini-2.5-flash-lite` answer
   * "no longer available to new users" on the available keys, and the single
   * key with `gemini-2.5-flash` access is on a free tier capped at 20
   * generate-content requests per day. Override with
   * `LLXPRT_PROBE_MODEL_GENERAL` to re-run against a 2.x model.
   */
  readonly modelGeneral: string;
  /** Gemini 3 model, for thought signatures and `thinkingLevel`. */
  readonly modelGemini3: string;
  /** Redacts the live API key out of anything before it is written to disk. */
  redact<T>(value: T): T;
}

export interface Probe {
  readonly id: string;
  readonly area: string;
  run(ctx: ProbeContext): Promise<ProbeResult>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROBE_ROOT = resolve(HERE, '..');
export const RESULTS_DIR = join(PROBE_ROOT, 'results');

/**
 * Local default. Overridden with `LLXPRT_PROBE_KEY_FILE` or `GEMINI_API_KEY`.
 * The key behind this file has access to both a Gemini 2.x-generation model
 * and a Gemini 3-generation one, which the probe matrix needs.
 */
const DEFAULT_KEY_FILE = join(homedir(), '.keys', '.google_key_from_e2720pjk');

/**
 * Loads the live API key. Fails loudly: a probe run without credentials must
 * not be mistaken for a run that found gaps.
 */
export function loadApiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const keyFile = process.env.LLXPRT_PROBE_KEY_FILE?.trim() ?? DEFAULT_KEY_FILE;
  if (existsSync(keyFile)) {
    const fromFile = readFileSync(keyFile, 'utf8').trim();
    if (fromFile) {
      return fromFile;
    }
  }
  throw new Error(
    `No Gemini API key available. Set GEMINI_API_KEY, or point ` +
      `LLXPRT_PROBE_KEY_FILE at a key file (tried ${keyFile}). ` +
      `These probes are live by design and must not run credential-less.`,
  );
}

const REDACTED = '<redacted-api-key>';

/**
 * Recursively replaces every occurrence of the live key with a placeholder.
 * Applied to headers, URLs (the v1beta `?key=` form) and bodies alike.
 */
export function makeRedactor(apiKey: string): <T>(value: T) => T {
  const needle = apiKey;
  const scrubString = (input: string): string =>
    needle.length > 0 ? input.split(needle).join(REDACTED) : input;

  // `ancestors` tracks only the current path, so a value legitimately shared
  // between two branches (the same control object recorded under both adapters)
  // is serialized twice rather than being mislabelled as a cycle.
  const walk = (value: unknown, ancestors: readonly object[]): unknown => {
    if (typeof value === 'string') {
      return scrubString(value);
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (ancestors.includes(value)) {
      return '<circular>';
    }
    const nextAncestors = [...ancestors, value];
    if (Array.isArray(value)) {
      return value.map((entry) => walk(entry, nextAncestors));
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[scrubString(key)] = walk(entry, nextAncestors);
    }
    return out;
  };

  return <T>(value: T): T => walk(value, []) as T;
}

export function createProbeContext(): ProbeContext {
  const apiKey = loadApiKey();
  return {
    apiKey,
    modelGeneral:
      process.env.LLXPRT_PROBE_MODEL_GENERAL?.trim() ?? 'gemini-3.1-flash-lite',
    modelGemini3:
      process.env.LLXPRT_PROBE_MODEL_GEMINI3?.trim() ?? 'gemini-3.5-flash',
    redact: makeRedactor(apiKey),
  };
}

/** HTTP status the Gemini API uses for both per-minute and per-day quota. */
export const RATE_LIMIT_STATUS = 429;

/**
 * Statuses that say something about Google's capacity or our quota, and
 * nothing whatsoever about adapter parity. A probe that ends on one of these
 * is inconclusive and must never be read as a capability finding.
 */
const TRANSIENT_STATUSES = new Set([RATE_LIMIT_STATUS, 500, 502, 503, 504]);

export function isTransientError(error: CapturedError | undefined): boolean {
  return error !== undefined && TRANSIENT_STATUSES.has(error.statusCode ?? 0);
}

export function isRateLimitError(error: CapturedError | undefined): boolean {
  return error?.statusCode === RATE_LIMIT_STATUS;
}

/**
 * Probes that run several sub-cases catch their own failures and fold them
 * into the observation, so a transient status can hide below the top-level
 * `error`. This walks a recorded observation for any `statusCode` that means
 * "Google was busy or we ran out of quota".
 */
export function findTransientStatusInObservation(
  value: unknown,
  depth = 0,
): number | undefined {
  if (depth > 12 || value === null || typeof value !== 'object') {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findTransientStatusInObservation(entry, depth + 1);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      (key === 'statusCode' || key === 'httpStatus' || key === 'status') &&
      typeof entry === 'number' &&
      TRANSIENT_STATUSES.has(entry)
    ) {
      return entry;
    }
    const found = findTransientStatusInObservation(entry, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Retries a transient failure a bounded number of times. A per-day quota
 * exhaustion will still fail after the retries, which is correct: it has to
 * surface as an inconclusive probe rather than be retried into oblivion.
 */
export async function withTransientRetry<T>(
  body: () => Promise<T>,
  attempts = 3,
  waitMs = 35_000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await body();
    } catch (error) {
      lastError = error;
      if (!isTransientError(captureError(error)) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((done) => setTimeout(done, waitMs));
    }
  }
  throw lastError;
}

/** Normalizes a thrown value into recordable evidence. */
export function captureError(error: unknown): CapturedError {
  if (error instanceof Error) {
    const withStatus = error as Error & {
      status?: unknown;
      statusCode?: unknown;
      responseBody?: unknown;
      data?: unknown;
    };
    const rawStatus = withStatus.statusCode ?? withStatus.status;
    return {
      name: error.name,
      message: error.message,
      ...(typeof rawStatus === 'number' ? { statusCode: rawStatus } : {}),
      ...(withStatus.responseBody !== undefined
        ? { responseBody: withStatus.responseBody }
        : withStatus.data !== undefined
          ? { responseBody: withStatus.data }
          : {}),
    };
  }
  return { name: 'NonError', message: String(error) };
}

/**
 * Runs one adapter side of a probe, turning a throw into a recorded
 * observation rather than aborting the whole run.
 */
export async function observe(
  adapter: AdapterId,
  body: () => Promise<Record<string, unknown>>,
): Promise<AdapterObservation> {
  try {
    return { adapter, ok: true, observation: await withTransientRetry(body) };
  } catch (error) {
    return {
      adapter,
      ok: false,
      observation: {},
      error: captureError(error),
    };
  }
}

export function writeResult(result: ProbeResult, redact: ProbeContext['redact']): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const path = join(RESULTS_DIR, `${result.id}.json`);
  writeFileSync(path, `${JSON.stringify(redact(result), null, 2)}\n`, 'utf8');
  return path;
}

export function writeArtifact(
  fileName: string,
  payload: unknown,
  redact: ProbeContext['redact'],
): string {
  const path = join(PROBE_ROOT, fileName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(redact(payload), null, 2)}\n`, 'utf8');
  return path;
}
