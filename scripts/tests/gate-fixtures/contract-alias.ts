/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * contract-alias.ts — P02 NEGATIVE fixture triggering checkC.
 *
 * Imports a Contract* payload type alias (ContractContent) from a banned
 * module (clientContract). This is the exact #2424 aliasing bypass.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P02
 * @requirement:REQ-012.1
 */

import type { ContractContent } from '@vybestack/llxprt-code-core/core/clientContract.js';

export function useAlias(payload: ContractContent): void {
  void payload;
}
