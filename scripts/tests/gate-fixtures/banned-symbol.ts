/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * banned-symbol.ts — P02 NEGATIVE fixture triggering checkB.
 *
 * Imports a §1.3 banned Google symbol (GenerateContentResponse) from a
 * BANNED MODULE that is NOT the raw @google/genai specifier — here
 * `@vybestack/llxprt-code-core/core/clientContract.js`. This proves checkB
 * catches the symbol by PROVENANCE (banned-module binding), not by raw
 * @google/genai import alone.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P02
 * @requirement:REQ-012.1
 */

import type { GenerateContentResponse } from '@vybestack/llxprt-code-core/core/clientContract.js';

export function useBanned(resp: GenerateContentResponse): void {
  void resp;
}
