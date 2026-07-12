/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P17
 * @requirement:REQ-011.1
 *
 * Neutral ContentBlock[]-based helpers. Replaces the former
 * googlePartHelpers.ts (Part[]-based) with thin re-exports of the
 * authoritative core block utilities. This file has zero SDK
 * imports.
 */

export {
  getToolCallBlocks,
  getResponseTextFromBlocks,
  analyzeResponseOutcome,
} from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';

export type { ResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
