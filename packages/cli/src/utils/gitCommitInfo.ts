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

let infoCache: string | null = null;
let infoLoaded = false;

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

  add(path.join(loaderDir, '..', 'generated', INFO_FILENAME));
  add(path.join(process.cwd(), 'bundle', INFO_FILENAME));
  add(path.join(loaderDir, '..', '..', 'dist', INFO_FILENAME));

  return Array.from(candidates);
}

function loadGitCommitInfo(): string {
  if (infoLoaded) {
    return infoCache ?? NOT_AVAILABLE;
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
    infoCache = null;
    infoLoaded = true;
    return NOT_AVAILABLE;
  }

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as GitCommitInfo;
      if (typeof parsed.commit === 'string' && parsed.commit !== '') {
        infoCache = parsed.commit;
        infoLoaded = true;
        return infoCache;
      }
      // Found and parsed, but the commit field is missing/empty/wrong type.
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

  infoCache = null;
  infoLoaded = true;
  return NOT_AVAILABLE;
}

export function getGitCommitInfo(): string {
  return loadGitCommitInfo();
}

export function __resetGitCommitInfoCacheForTests(): void {
  infoCache = null;
  infoLoaded = false;
}
