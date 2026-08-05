/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* global module */

// --- BEGIN OCR REVIEW CONTEXT SNIPPET ---
function resolveEffectiveReviewContext(input) {
  const eventName =
    input && typeof input.eventName === 'string' ? input.eventName : '';
  const mergeBaseSha =
    input && typeof input.mergeBaseSha === 'string' ? input.mergeBaseSha : '';
  const rangeFromSha =
    input && typeof input.rangeFromSha === 'string' ? input.rangeFromSha : '';
  const rangeMode =
    input && typeof input.rangeMode === 'string' ? input.rangeMode : '';
  const prNumber =
    input && typeof input.prNumber === 'string' ? input.prNumber : '';
  const trustedBaseSha =
    input && typeof input.trustedBaseSha === 'string'
      ? input.trustedBaseSha
      : '';
  if (eventName === 'workflow_dispatch') {
    return {
      fromSha: mergeBaseSha,
      rangeMode: 'full',
      prNumber,
      trustedBaseSha,
    };
  }
  return {
    fromSha: rangeFromSha,
    rangeMode,
    prNumber,
    trustedBaseSha,
  };
}
// --- END OCR REVIEW CONTEXT SNIPPET ---

module.exports = {
  resolveEffectiveReviewContext,
};
