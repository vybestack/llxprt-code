/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260609-ISSUE1591.P10d
 * @requirement REQ-008
 * Backward-compatible re-export shim. Implementation lives in
 * `@vybestack/llxprt-code-policy`.
 */
export {
  escapeRegex,
  loadPoliciesFromToml,
  loadPolicyFromToml,
  loadDefaultPolicies,
  type PolicyFileError,
  type PolicyFileErrorType,
  type PolicyLoadResult,
} from '@vybestack/llxprt-code-policy';
