/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * a-subpath-import-genai.ts — @google/genai subpath import fixture.
 *
 * Static import from a @google/genai/* subpath: `import ... from '@google/genai/internal'`.
 * The gate MUST reject subpath imports of @google/genai, not just the bare specifier.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export async function loadGenaiSubpath(): Promise<unknown> {
  const mod = await import('@google/genai/internal');
  return mod;
}
