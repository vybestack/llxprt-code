/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue:2329 — Single source of truth for the safety-classifier refusal
 * notice text. Shared by the interactive CLI, the non-interactive (headless)
 * CLI, and the a2a-server so all surfaces present an identical notice when the
 * model's safety classifier refuses a request.
 */
export const REFUSAL_NOTICE_MESSAGE =
  'Request declined: the model\u2019s safety classifier refused to answer this request. Try rephrasing, or switch to a different model.';
