/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Artifact identity and cardinality validation for the dedicated Evals Nightly
 * workflow. Handles:
 *   - extracting the matrix attempt identity from artifact/report paths;
 *   - validating the discovered reports correspond EXACTLY to the expected set
 *     of matrix attempts (no missing, duplicate, or unexpected reports);
 *   - validating the DIRECT top-level downloaded artifact directories;
 *   - parsing/resolving the expected-attempts option from CLI args and env.
 *
 * Extracted from aggregate_evals.js so the cardinality concerns are cohesive
 * and independently testable.
 */

import { readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

// The dedicated Evals Nightly workflow uploads one artifact per matrix
// attempt: eval-logs-1, eval-logs-2, eval-logs-3 (matrix [1,2,3] by default).
// The aggregator validates that exactly this expected set is present.
export const DEFAULT_EXPECTED_ATTEMPTS = [1, 2, 3];

/**
 * Validate that a captured digit-string is the CANONICAL form of its numeric
 * value: no leading zeros (unless the value is exactly 0, which is itself not
 * a valid attempt and is rejected upstream by the positive-integer check).
 * "01", "001", "00" are noncanonical and must be rejected so numerical
 * equivalence cannot rescue a drifted/corrupted artifact name. The canonical
 * form is `String(Number(captured))` — e.g. "1" for 1.
 * @param {string} captured - the raw digit-string captured from the name/path
 * @returns {boolean} true when the captured string is canonical
 */
function isCanonicalAttemptString(captured) {
  return captured === String(Number(captured));
}

/**
 * Extract the matrix attempt identity from a report path. The dedicated
 * workflow uploads artifacts named `eval-logs-N`, so a report lives at a path
 * containing the segment `eval-logs-N`. Returns the numeric attempt, or null
 * when no such segment is found. A noncanonical zero-padded segment
 * (eval-logs-01, eval-logs-001) is REJECTED by canonical string validation so
 * numerical equivalence cannot rescue a drifted artifact name.
 * @param {string} reportPath
 * @returns {number|null}
 */
export function extractAttemptFromPath(reportPath) {
  const match = reportPath.match(/eval-logs-(\d+)(?:[/\\]|$)/);
  if (match === null) {
    return null;
  }
  if (!isCanonicalAttemptString(match[1])) {
    return null;
  }
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : null;
}

/**
 * Extract the numeric attempt from a top-level artifact directory name of the
 * form `eval-logs-N`. Returns the numeric attempt, or null when the name is
 * not an eval-logs-N artifact directory. A noncanonical zero-padded name
 * (eval-logs-01, eval-logs-001) is REJECTED by canonical string validation.
 * @param {string} name - top-level directory entry name
 * @returns {number|null}
 */
function attemptFromArtifactName(name) {
  const match = name.match(/^eval-logs-(\d+)$/);
  if (match === null) {
    return null;
  }
  if (!isCanonicalAttemptString(match[1])) {
    return null;
  }
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : null;
}

/**
 * Validate that the discovered reports correspond EXACTLY to the expected set
 * of matrix attempts. Each expected attempt must have exactly one report;
 * missing, duplicate, or unexpected attempts fail closed.
 *
 * @param {string[]} reports - discovered report.json paths
 * @param {number[]} expectedAttempts - sorted unique expected attempt ids
 * @returns {string[]} validation errors (empty when cardinality is correct)
 */
export function validateCardinality(reports, expectedAttempts) {
  const errors = [];
  const counts = new Map();
  const unmatched = [];

  for (const reportPath of reports) {
    const attempt = extractAttemptFromPath(reportPath);
    if (attempt === null) {
      unmatched.push(reportPath);
    } else {
      counts.set(attempt, (counts.get(attempt) ?? 0) + 1);
    }
  }

  for (const reportPath of unmatched) {
    errors.push(
      `Unexpected report with no eval-logs-N artifact identity: ${reportPath}`,
    );
  }

  const expectedSet = new Set(expectedAttempts);
  for (const [attempt, count] of counts) {
    if (!expectedSet.has(attempt)) {
      errors.push(
        `Unexpected report for attempt ${attempt} (not in expected attempts ${JSON.stringify(expectedAttempts)})`,
      );
    } else if (count > 1) {
      errors.push(
        `Duplicate report for attempt ${attempt}: found ${count} report.json files (expected exactly 1)`,
      );
    }
  }

  for (const expected of expectedAttempts) {
    const count = counts.get(expected) ?? 0;
    if (count === 0) {
      errors.push(
        `Missing report for expected attempt ${expected} (expected eval-logs-${expected})`,
      );
    }
  }

  return errors;
}

/**
 * Classify a single top-level entry under the artifacts root into one of:
 *   - {kind: 'unexpected'} - an entry that must fail closed (files, dot-dirs,
 *     symlinks, or any directory not named eval-logs-N);
 *   - {kind: 'attempt', attempt} - a recognized eval-logs-N directory.
 *
 * There are NO name exemptions: every top-level directory must be an expected
 * eval-logs-N directory. This includes dot-directories (.github, .git), which
 * a checkout can leave behind in the download destination. Symlinks are
 * rejected explicitly (via lstatSync) so a symlinked top-level artifact
 * directory pointing outside the artifacts root cannot bypass the cardinality
 * check.
 *
 * Pure and exported for testing so the entry-classification boundary is tested
 * independently of directory iteration.
 *
 * @param {string} artifactsDir - artifacts root directory
 * @param {string} entry - top-level entry name
 * @returns {{kind: 'unexpected'|'attempt', attempt?: number}}
 */
export function classifyTopLevelEntry(artifactsDir, entry) {
  const fullPath = join(artifactsDir, entry);
  let stats;
  try {
    stats = lstatSync(fullPath);
  } catch {
    return { kind: 'unexpected' };
  }
  // Reject symlinks explicitly so a symlinked top-level artifact directory
  // pointing outside the artifacts root cannot bypass the cardinality check.
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return { kind: 'unexpected' };
  }
  const attempt = attemptFromArtifactName(entry);
  if (attempt === null) {
    return { kind: 'unexpected' };
  }
  return { kind: 'attempt', attempt };
}

/**
 * Validate the DIRECT TOP-LEVEL directories under the artifacts root. The
 * GitHub `download-artifact` action lays out one directory per artifact at the
 * top level, so the set of top-level directories must be EXACTLY the expected
 * set of `eval-logs-N` directories. There are no name exemptions: any extra
 * top-level directory (including dot-directories like `.github` and stray
 * artifact directories) is rejected even when it carries no report. Each
 * expected attempt must have exactly one top-level `eval-logs-N` directory.
 *
 * @param {string} artifactsDir - directory containing downloaded artifacts
 * @param {number[]} expectedAttempts - expected matrix attempt identities
 * @returns {string[]} validation errors (empty when cardinality is correct)
 */
export function validateTopLevelArtifactDirs(artifactsDir, expectedAttempts) {
  const errors = [];
  let entries;
  try {
    entries = readdirSync(artifactsDir);
  } catch (err) {
    errors.push(
      `Could not read artifacts directory ${artifactsDir}: ${err.message}`,
    );
    return errors;
  }

  const expectedSet = new Set(expectedAttempts);
  const foundAttempts = new Map();
  const unexpected = [];

  for (const entry of entries) {
    const classified = classifyTopLevelEntry(artifactsDir, entry);
    if (classified.kind === 'attempt') {
      const attempt = classified.attempt;
      foundAttempts.set(attempt, (foundAttempts.get(attempt) ?? 0) + 1);
    } else if (classified.kind === 'unexpected') {
      unexpected.push(entry);
    }
  }

  for (const entry of unexpected) {
    errors.push(
      `Unexpected top-level artifact directory "${entry}" under ${artifactsDir} (not an expected eval-logs-N directory)`,
    );
  }

  for (const [attempt, count] of foundAttempts) {
    if (!expectedSet.has(attempt)) {
      errors.push(
        `Unexpected top-level eval-logs-${attempt} directory (not in expected attempts ${JSON.stringify(expectedAttempts)})`,
      );
    } else if (count > 1) {
      errors.push(
        `Duplicate top-level directories for attempt ${attempt}: found ${count} (expected exactly 1)`,
      );
    }
  }

  for (const expected of expectedAttempts) {
    const count = foundAttempts.get(expected) ?? 0;
    if (count === 0) {
      errors.push(
        `Missing top-level eval-logs-${expected} directory under ${artifactsDir}`,
      );
    }
  }

  return errors;
}

/**
 * Parse the expected-attempts option. Accepts a JSON array of positive
 * integers (e.g. `[1,2,3]`). Returns null on malformed input so the caller can
 * fail closed. The result, when valid, is a nonempty array of unique positive
 * integers: an empty array, duplicates, zero/negative values, or non-integers
 * are all rejected.
 * @param {string} raw
 * @returns {number[]|null}
 */
export function parseExpectedAttempts(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  if (parsed.length === 0) {
    return null;
  }
  const result = [];
  const seen = new Set();
  for (const item of parsed) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item <= 0) {
      return null;
    }
    if (seen.has(item)) {
      return null;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

/**
 * Resolve the expected attempts from CLI args and env. CLI flag
 * `--expected-attempts` takes precedence over the
 * `AGGREGATE_EXPECTED_ATTEMPTS` env var, which takes precedence over the
 * default `[1,2,3]`.
 *
 * When `--expected-attempts` is PRESENT, its value must be present and valid;
 * a missing or malformed value is a configuration error that fails closed
 * rather than silently falling back. The same strictness applies to the env
 * var when it is set to a non-empty value.
 * @param {string[]} argv - process.argv
 * @returns {number[]}
 * @throws {Error} when --expected-attempts or the env var is present but
 *   malformed.
 */
export function resolveExpectedAttempts(argv) {
  const idx = argv.indexOf('--expected-attempts');
  if (idx !== -1) {
    if (idx + 1 >= argv.length) {
      throw new Error(
        '--expected-attempts requires a value (a JSON array of positive integers)',
      );
    }
    const raw = argv[idx + 1];
    const parsed = parseExpectedAttempts(raw);
    if (parsed === null) {
      throw new Error(
        `--expected-attempts is not a valid nonempty array of unique positive integers: ${raw}`,
      );
    }
    return parsed;
  }
  const envVal = process.env.AGGREGATE_EXPECTED_ATTEMPTS;
  if (typeof envVal === 'string' && envVal.trim().length > 0) {
    const parsed = parseExpectedAttempts(envVal);
    if (parsed === null) {
      throw new Error(
        `AGGREGATE_EXPECTED_ATTEMPTS is not a valid nonempty array of unique positive integers: ${envVal}`,
      );
    }
    return parsed;
  }
  return [...DEFAULT_EXPECTED_ATTEMPTS];
}
