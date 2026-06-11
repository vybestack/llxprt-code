/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for IDE service.
 *
 * Provides diff application, connection status, and diff opening
 * needed by apply-patch, edit, and ast-edit tools.
 *
 * Consumed by: apply-patch, edit, ast-edit.
 * Implemented by: CoreIdeServiceAdapter in packages/core.
 */

/** Parameters for applying a diff. */
export interface DiffParams {
  /** The file path to apply the diff to. */
  filePath: string;
  /** The diff content to apply. */
  diff: string;
}

/** Result of a diff application. */
export type DiffUpdateResult =
  | {
      status: 'accepted';
      content?: string;
    }
  | {
      status: 'rejected';
      content: undefined;
    };

/** Connection status of the IDE. */
export type IDEConnectionStatus = 'connected' | 'disconnected' | 'connecting';

/** Parameters for opening a diff view. */
export interface OpenDiffParams {
  /** The file path to open diff for. */
  filePath: string;
  /** The original content. */
  originalContent?: string;
  /** The new content. */
  newContent?: string;
}

export interface IIdeService {
  /**
   * Apply a diff to a file.
   * @param params - The diff parameters.
   * @returns The result of the diff application.
   */
  applyDiff(params: DiffParams): Promise<DiffUpdateResult>;

  /**
   * Get the current IDE connection status.
   * @returns The connection status.
   */
  getConnectionStatus(): IDEConnectionStatus;

  /**
   * Open a diff view in the IDE.
   * @param params - The open diff parameters.
   */
  openDiff(params: OpenDiffParams): Promise<void>;
}
