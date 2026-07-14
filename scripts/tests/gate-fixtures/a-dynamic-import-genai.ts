/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * a-dynamic-import-genai.ts — Finding #3 adversarial PASS (must fail) fixture.
 *
 * Dynamic import of @google/genai: `import('@google/genai')`. The current
 * checkA only detects static `import ... from`, missing dynamic import().
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export async function loadGenai(): Promise<unknown> {
  return import('@google/genai');
}
