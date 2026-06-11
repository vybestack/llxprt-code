/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001, REQ-TEMPORARY-INTERFACES
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local tool confirmation types.
 *
 * Enumerates possible outcomes of a tool confirmation request and
 * payload types for confirmation overrides. Self-contained with
 * zero core imports.
 */

/** Possible outcomes of a tool confirmation request. */
export enum ToolConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysAndSave = 'proceed_always_and_save',
  ProceedAlwaysServer = 'proceed_always_server',
  ProceedAlwaysTool = 'proceed_always_tool',
  ModifyWithEditor = 'modify_with_editor',
  SuggestEdit = 'suggest_edit',
  Cancel = 'cancel',
}

/** Payload for tool confirmation with optional overrides. */
export interface ToolConfirmationPayload {
  /** Override modifiedProposedContent for modifiable tools. */
  newContent?: string;

  /** Override command text for shell-like confirmations. */
  editedCommand?: string;
}
