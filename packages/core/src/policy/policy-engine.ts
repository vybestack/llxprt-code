/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260609-ISSUE1591.P10d
 * @requirement REQ-008.1
 * Backward-compatible re-export shim. The PolicyEngine implementation now
 * lives in `@vybestack/llxprt-code-policy` as the public entry point.
 */
export { PolicyEngine } from '@vybestack/llxprt-code-policy';
