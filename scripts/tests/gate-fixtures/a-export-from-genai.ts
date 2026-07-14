/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * a-export-from-genai.ts — Finding #3 adversarial PASS (must fail) fixture.
 *
 * Re-exports from @google/genai via `export ... from`. The current checkA
 * only detects `import ... from`, missing re-export declarations.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export { Content } from '@google/genai';
