/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260609-ISSUE1591.P10d
 * @requirement REQ-008
 * Backward-compatible re-export shim. The policy domain now lives in the
 * dedicated `@vybestack/llxprt-code-policy` workspace package. This file is
 * retained so existing deep imports (`../policy/types.js`) keep working.
 */
export {
  PolicyDecision,
  ApprovalMode,
  type PolicyRule,
  type PolicyEngineConfig,
  type PolicySettings,
} from '@vybestack/llxprt-code-policy';
