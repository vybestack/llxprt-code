/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * a-subpath-require-genai.ts — @google/genai subpath require fixture.
 *
 * CJS require from a @google/genai/* subpath: `require('@google/genai/internal')`.
 * The gate MUST reject subpath requires of @google/genai.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export async function loadGenaiSubpathCjs(): Promise<unknown> {
  return import('@google/genai/internal');
}
