/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * roundtrip-symbol.ts — P31 NEGATIVE fixture triggering checkD.
 *
 * Imports a round-trip conversion symbol (streamChunkWrapper) from a
 * module. This is the deleted-helper re-introduction vector.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

import { streamChunkWrapper } from '@vybestack/llxprt-code-core/core/deletedHelper.js';

export function useRoundtrip(): void {
  void streamChunkWrapper;
}
