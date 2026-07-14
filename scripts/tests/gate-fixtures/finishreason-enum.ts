/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * finishreason-enum.ts — P02 NEGATIVE fixture triggering checkE.
 *
 * Contains a local `enum FinishReason { STOP = 'STOP' }` — a Google-enum-
 * shaped re-declaration.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P02
 * @requirement:REQ-012.1
 */

export enum FinishReason {
  STOP = 'STOP',
  MAX_TOKENS = 'MAX_TOKENS',
}

export function useFinishReason(reason: FinishReason): void {
  void reason;
}
