/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P29
 * @requirement:REQ-019
 *
 * Stable fixture-root resolution that survives Stryker's `inPlace` mutation
 * mode.
 *
 * The B8 mutation gate runs Stryker with `inPlace: true` (see
 * stryker.conf.json). In that mode Stryker instruments the ORIGINAL source
 * files and keeps a pristine backup under `.stryker-tmp/backup-<id>/`. The
 * Vitest test runner is launched such that `import.meta.url` of the
 * instrumented test/helper modules resolves THROUGH that backup tree — but
 * Stryker only backs up the files it mutates/touches, NOT the committed test
 * fixtures under `src/api/__tests__/fixtures/`. Resolving fixtures naively via
 * `new URL('.', import.meta.url)` therefore yields a path inside
 * `.stryker-tmp/backup-<id>/...` and ENOENTs.
 *
 * `stripSandboxSegment` rewrites any such path back onto the real working tree
 * by removing a leading `.stryker-tmp/backup-<id>/` (or `.stryker-tmp/sandbox-
 * <id>/`) path segment. In NORMAL (non-mutation) test runs no such segment is
 * present, so the path is returned unchanged and behavior is identical to the
 * previous direct-`import.meta.url` resolution. This keeps the durable fix in
 * test infrastructure — no production `src/api/**` runtime code changes.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const SANDBOX_SEGMENT_RE =
  /[\\/]\.stryker-tmp[\\/](?:backup|sandbox)-[^\\/]+(?=[\\/])/;

/**
 * Removes a `.stryker-tmp/backup-<id>` (or `sandbox-<id>`) segment from an
 * absolute path so fixture lookups always target the real working tree, even
 * when Stryker's inPlace mode rewrites `import.meta.url` through its backup
 * directory. Paths without such a segment are returned unchanged.
 */
export function stripSandboxSegment(absPath: string): string {
  return absPath.replace(SANDBOX_SEGMENT_RE, '');
}

/**
 * Resolves the committed fixtures directory
 * (`src/api/__tests__/fixtures`) from a helper/spec module URL, robust to
 * Stryker inPlace mutation runs.
 *
 * @param moduleUrl    `import.meta.url` of the calling module.
 * @param relToFixtures Path segments from the calling module's directory to the
 *                      fixtures directory (e.g. `['..', 'fixtures']` for a
 *                      helper under `__tests__/helpers/`).
 */
export function resolveFixturesDir(
  moduleUrl: string,
  ...relToFixtures: string[]
): string {
  const moduleDir = fileURLToPath(new URL('.', moduleUrl));
  return stripSandboxSegment(resolve(moduleDir, ...relToFixtures));
}
