/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  appendFileSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { validateTelemetryRecord } from './ocr-telemetry-schema.js';

function readJsonArtifact(path, label) {
  try {
    const raw = readFileSync(path, 'utf8');
    if (raw.trim().length === 0) {
      return { value: null, error: `${label} was empty` };
    }
    return { value: JSON.parse(raw), error: null };
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'was unavailable' : 'was corrupt';
    return { value: null, error: `${label} ${reason}` };
  }
}

function parseCount(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNumber(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= Number.MAX_SAFE_INTEGER
    ? parsed
    : null;
}

function parseList(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0) return [];
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function loadTelemetryInput(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const metadata = readJsonArtifact(
    join(cwd, 'ocr-metadata.json'),
    'OCR metadata artifact',
  );
  const manifest = readJsonArtifact(
    join(cwd, 'ocr-reviewed-range-manifest.json'),
    'OCR reviewed-range manifest',
  );
  const routing = readJsonArtifact(
    join(cwd, 'ocr-routing-decisions.json'),
    'OCR routing decisions artifact',
  );
  const errors = [metadata.error, manifest.error, routing.error].filter(
    Boolean,
  );
  return {
    metadata: metadata.value,
    manifest: manifest.value,
    routingDecisions: Array.isArray(routing.value) ? routing.value : null,
    errors,
    context: {
      runId: env.OCR_RUN_ID ?? null,
      runAttempt: env.OCR_RUN_ATTEMPT ?? null,
      prNumber: parseCount(env.OCR_PR_NUMBER),
      sha: env.OCR_SHA || null,
      generatedAt: env.OCR_GENERATED_AT || new Date().toISOString(),
      infrastructureFailure: env.OCR_INFRASTRUCTURE_FAILURE === 'true',
      policyFailure: env.OCR_POLICY_FAILURE === 'true',
      inlinePosted: parseCount(env.OCR_INLINE_POSTED),
      alreadyResolved: parseCount(env.OCR_ALREADY_RESOLVED),
      alreadyPostedOrSkippedDedup: parseCount(
        env.OCR_ALREADY_POSTED_OR_SKIPPED_DEDUP,
      ),
      commentsSkipped: parseCount(env.OCR_COMMENTS_SKIPPED),
      commentsFailed: parseCount(env.OCR_COMMENTS_FAILED),
      commentsRoutedSummary: parseCount(env.OCR_COMMENTS_ROUTED_SUMMARY),
      commentsTotal: parseCount(env.OCR_COMMENTS_TOTAL),
      wallClockSeconds: parseNumber(env.OCR_WALL_CLOCK_SECONDS),
      filesReviewed: parseCount(env.OCR_FILES_REVIEWED),
      fileReadFailures: parseList(env.OCR_FILE_READ_FAILURES),
      perFileReviewFailures: parseList(env.OCR_PER_FILE_REVIEW_FAILURES),
      previewAttempted: env.OCR_PREVIEW_ATTEMPTED === 'true',
      previewSucceeded: env.OCR_PREVIEW_SUCCEEDED === 'true',
      sourceRedactionState: env.OCR_SOURCE_REDACTION_STATE || null,
      telemetryState: env.OCR_TELEMETRY_STATE || null,
      postState: env.OCR_POST_STATE || null,
      postOutcome: env.OCR_POST_OUTCOME || null,
      artifactState: env.OCR_ARTIFACT_STATE || null,
      hashState: env.OCR_HASH_STATE || null,
    },
  };
}

function assertValid(record) {
  const schemaError = validateTelemetryRecord(record);
  if (schemaError) throw new Error(`Invalid OCR telemetry: ${schemaError}`);
}

export function validateTelemetryFile(path) {
  const raw = readFileSync(path, 'utf8');
  if (raw.trim().length === 0) throw new Error('OCR telemetry file is empty');
  const record = JSON.parse(raw);
  assertValid(record);
  return record;
}

function redactString(value, secrets) {
  return secrets.reduce(
    (redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'),
    value,
  );
}

function copyWithRedactedStrings(value, secrets) {
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) {
    return value.map((entry) => copyWithRedactedStrings(entry, secrets));
  }
  if (value === null || typeof value !== 'object') return value;
  const copy = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    Object.defineProperty(copy, key, {
      value: copyWithRedactedStrings(value[key], secrets),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

let temporarySequence = 0;

function atomicWriteFile(target, content, operation) {
  temporarySequence += 1;
  const temporary = `${target}.${operation}-${process.pid}-${temporarySequence}`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function redactTelemetryFile(path, secrets) {
  const record = validateTelemetryFile(path);
  const usableSecrets = secrets.filter(
    (secret) => typeof secret === 'string' && secret.length > 0,
  );
  const redacted = copyWithRedactedStrings(record, usableSecrets);
  assertValid(redacted);
  atomicWriteFile(path, `${JSON.stringify(redacted, null, 2)}\n`, 'redacting');
}

export function writeTelemetryArtifacts(record, markdown, options = {}) {
  assertValid(record);
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const target = join(cwd, 'ocr-telemetry.json');
  atomicWriteFile(target, `${JSON.stringify(record, null, 2)}\n`, 'writing');
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  }
}
