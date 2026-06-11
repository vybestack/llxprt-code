/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260609-ISSUE1591.P10d
 * @requirement REQ-008
 * Backward-compatible re-export shim. The confirmation outcome/payload types
 * now live in `@vybestack/llxprt-code-policy` so the policy and confirmation
 * bus share a single nominal identity. These aliases preserve the historic
 * `ToolConfirmationOutcome` / `ToolConfirmationPayload` names used across the
 * codebase.
 */
export { ToolConfirmationOutcome } from '@vybestack/llxprt-code-policy';
export type { ConfirmationPayload as ToolConfirmationPayload } from '@vybestack/llxprt-code-policy';
