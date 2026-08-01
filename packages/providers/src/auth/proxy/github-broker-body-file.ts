/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Body-text materialisation for mutating GitHub broker operations.
 *
 * Free-form body text is never placed in argv. Each body parameter is
 * written to a mode-0600 temp file and the parameter value is replaced with
 * that path, so an op emits `--body-file <path>` instead of `--body <text>`.
 * Newlines, length and leading dashes are then structurally incapable of
 * affecting argument parsing.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 22-23
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs `fn` with body parameters replaced by temp-file paths.
 *
 * The temp directory is removed in a finally block so it cannot leak when
 * `fn` throws — which it routinely does, because gh failures surface as
 * exceptions.
 *
 * @param bodyParams parameter names carrying body text; empty means no-op
 * @param params the validated operation parameters
 * @param fn receives the params with body values swapped for file paths
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export async function withBodyFiles<T>(
  bodyParams: readonly string[] | undefined,
  params: Record<string, unknown>,
  fn: (effectiveParams: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const present = (bodyParams ?? []).filter(
    (name) => typeof params[name] === 'string',
  );
  if (present.length === 0) return fn(params);

  const dir = await mkdtemp(join(tmpdir(), 'llxprt-gh-body-'));
  try {
    const effective: Record<string, unknown> = { ...params };
    for (const name of present) {
      const path = join(dir, `${name}.md`);
      await writeFile(path, params[name] as string, {
        encoding: 'utf8',
        mode: 0o600,
      });
      effective[name] = path;
    }
    return await fn(effective);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
