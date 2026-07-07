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

interface GitCommitInfo {
  commit: string;
}

let infoCache: string | null = null;
let infoLoaded = false;

function isDebugEnabled(): boolean {
  try {
    const flag = process.env.DEBUG;
    if (flag === '1' || flag === 'true') {
      return true;
    }
    return typeof flag === 'string' && flag.includes('llxprt:git-commit');
  } catch {
    return false;
  }
}

function candidatePaths(): string[] {
  const override = process.env.LLXPRT_GIT_COMMIT_INFO_PATH;
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

  const debug = isDebugEnabled();
  const candidates = candidatePaths();
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as GitCommitInfo;
      if (typeof parsed.commit === 'string' && parsed.commit !== '') {
        infoCache = parsed.commit;
        infoLoaded = true;
        return infoCache;
      }
    } catch (error) {
      if (debug) {
        logger.debug(
          () =>
            `[GIT_COMMIT] Failed to read ${candidate}: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      }
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
