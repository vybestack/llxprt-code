/**
 * Runtime manifest loader for default prompt markdown content.
 * Attempts to load the generated JSON manifest first, and falls back to
 * returning null if the manifest is unavailable so callers can read files
 * directly from source.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:prompt:manifest');
const MANIFEST_FILENAME = 'default-prompts.json';
let manifestCache: Record<string, string> | null = null;
let manifestLoaded = false;
let manifestOrigin: string | null = null;

const hasOwn = Object.prototype.hasOwnProperty;

function isDebugEnabled(): boolean {
  try {
    const flag = process.env.DEBUG;
    if (flag === '1' || flag === 'true') {
      return true;
    }
    return typeof flag === 'string' && flag.includes('llxprt:prompt');
  } catch {
    return false;
  }
}

function candidatePaths(): string[] {
  const candidates = new Set<string>();
  const loaderDir = path.dirname(fileURLToPath(import.meta.url));

  const add = (candidate: string | null | undefined) => {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    candidates.add(resolved);
  };

  // Explicit override takes top priority.
  add(process.env.LLXPRT_PROMPT_MANIFEST);

  // Same directory as the compiled loader (dist and bundled runtime).
  add(path.join(loaderDir, MANIFEST_FILENAME));

  // Dist output path relative to the source tree.
  add(
    path.join(
      loaderDir,
      '..',
      '..',
      '..',
      'dist',
      'prompt-config',
      'defaults',
      MANIFEST_FILENAME,
    ),
  );

  // Bundle directory relative to repository root / runtime cwd.
  add(path.join(process.cwd(), 'bundle', MANIFEST_FILENAME));

  // Workspace dist relative to repository root.
  add(
    path.join(
      process.cwd(),
      'packages/core/dist/prompt-config/defaults',
      MANIFEST_FILENAME,
    ),
  );

  return Array.from(candidates);
}

function loadManifest(): Record<string, string> | null {
  if (manifestLoaded) {
    return manifestCache;
  }

  const debug = isDebugEnabled();
  const candidates = candidatePaths();

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, string>;
      manifestCache = parsed;
      manifestOrigin = candidate;
      manifestLoaded = true;
      if (debug) {
        logger.debug(
          () => `[MANIFEST] Loaded prompt manifest from ${candidate}`,
        );
      }
      return manifestCache;
    } catch (error) {
      if (debug) {
        logger.debug(
          () =>
            `[MANIFEST] Failed to read ${candidate}: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      }
    }
  }

  manifestCache = null;
  manifestLoaded = true;
  manifestOrigin = null;
  if (debug) {
    logger.debug(
      () =>
        `[MANIFEST] No prompt manifest found. Falling back to direct filesystem reads.`,
    );
  }
  return manifestCache;
}

export function loadPromptFromManifest(filename: string): string | null {
  const manifest = loadManifest();
  if (manifest && hasOwn.call(manifest, filename)) {
    return manifest[filename];
  }
  return null;
}

export function getManifestOrigin(): string | null {
  return manifestOrigin;
}

export function __resetManifestCacheForTests(): void {
  manifestCache = null;
  manifestLoaded = false;
  manifestOrigin = null;
}
