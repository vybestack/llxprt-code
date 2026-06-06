/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned BucketFailureReason type.
 *
 * Core config uses this type instead of importing BucketFailureReason
 * from the providers package. The provider package's BucketFailureReason
 * values are structurally compatible with this core-owned type.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-05, lines 50-54
 */

/**
 * Reasons for bucket failure during OAuth/API key failover.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export type BucketFailureReason =
  | 'quota-exhausted'
  | 'expired-refresh-failed'
  | 'reauth-failed'
  | 'no-token'
  | 'skipped';
