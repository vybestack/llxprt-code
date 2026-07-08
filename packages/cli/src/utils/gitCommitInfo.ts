/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const NOT_AVAILABLE = 'N/A';
const INFO_FILENAME = 'git-commit.json';
const logger = new DebugLogger('llxprt:git-commit');

/**
 * Environment variable that overrides the git-commit.json lookup path. Exported
 * so tests reference the same constant as the implementation (no name drift).
 */
export const GIT_COMMIT_INFO_PATH_ENV = 'LLXPRT_GIT_COMMIT_INFO_PATH';

interface GitCommitInfo {
  commit: string;
}

// Non-null once a valid commit has been read. Misses are intentionally not
// cached (see loadGitCommitInfo), so consumers self-heal after the artifact is
// generated instead of locking in a transient 'N/A'.
let infoCache: string | null = null;

function candidatePaths(): string[] {
  const override = process.env[GIT_COMMIT_INFO_PATH_ENV];
  if (override && override.trim() !== '') {
    // Override-exclusivity: when the override is set it is the SOLE candidate.
    // This is what makes the #2435 regression test hermetic — pointing the
    // override at a missing path deterministically reproduces the
    // fresh-checkout "no generated artifact" state without deleting any real
    // on-disk file, so the test is reproducible on developer machines where
    // the generated JSON already exists.
    return [path.resolve(override)];
  }

  const candidates = new Set<string>();
  const loaderDir = path.dirname(fileURLToPath(import.meta.url));

  const add = (candidate: string) => {
    candidates.add(path.resolve(candidate));
  };

  // Sibling generated/ dir. This single candidate covers BOTH runtime layouts:
  // source (src/utils -> src/generated) and tsc dist output
  // (dist/src/utils -> dist/src/generated, since copy_files.ts mirrors the JSON
  // into dist). No separate dist candidate is needed.
  add(path.join(loaderDir, '..', 'generated', INFO_FILENAME));
  // Bundled runtime: the JSON is copied to the bundle root (parity with the
  // bundle candidate in core's manifest-loader.ts).
  add(path.join(process.cwd(), 'bundle', INFO_FILENAME));

  return Array.from(candidates);
}

function loadGitCommitInfo(): string {
  if (infoCache !== null) {
    return infoCache;
  }

  let candidates: string[];
  try {
    candidates = candidatePaths();
  } catch (error) {
    // The loader must always return a string, never throw. Building the
    // candidate list touches the environment (process.env / process.cwd),
    // which can be unusable under a partial test mock or an exotic runtime;
    // degrade gracefully to 'N/A' instead of crashing the importing module.
    logger.debug(
      () =>
        `[GIT_COMMIT] Failed to resolve candidate paths: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    // Do not cache this miss: a load before the artifact exists (fresh checkout
    // or incremental build) must not lock in 'N/A' for the process lifetime.
    // Only a successful read is cached, so call-time consumers self-heal once
    // git-commit.json is generated.
    return NOT_AVAILABLE;
  }

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as GitCommitInfo;
      const commit =
        typeof parsed.commit === 'string' ? parsed.commit.trim() : '';
      if (commit !== '') {
        infoCache = commit;
        return infoCache;
      }
      // Found and parsed, but the commit field is missing/blank/wrong type.
      // Log so a corrupt artifact is distinguishable from a missing one.
      logger.debug(
        () =>
          `[GIT_COMMIT] Ignoring ${candidate}: missing or invalid "commit" field`,
      );
    } catch (error) {
      // DebugLogger gates emission on the DEBUG namespace itself (wildcards
      // included); the lazy message builder runs only when it is enabled.
      logger.debug(
        () =>
          `[GIT_COMMIT] Failed to read ${candidate}: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      // Fall through to the next candidate.
    }
  }

  // No candidate yielded a valid commit. Do not cache this miss: the artifact
  // may not have been generated yet (fresh checkout / incremental build), so a
  // later call must re-read rather than serve a stale 'N/A'. Only successful
  // reads are cached (see the early return above).
  return NOT_AVAILABLE;
}

export function getGitCommitInfo(): string {
  return loadGitCommitInfo();
}

export function __resetGitCommitInfoCacheForTests(): void {
  infoCache = null;
}
