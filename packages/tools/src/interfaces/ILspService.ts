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
 * Tools-owned interface for LSP diagnostics.
 *
 * Provides diagnostic retrieval and waiting needed by
 * lsp-diagnostics-helper and ast-edit tools.
 *
 * Consumed by: lsp-diagnostics-helper, ast-edit.
 * Implemented by: CoreLspServiceAdapter in packages/core.
 */

/** A single LSP diagnostic entry. */
export interface Diagnostic {
  /** The diagnostic message. */
  message: string;
  /** The severity level. */
  severity: string;
  /** The source of the diagnostic. */
  source?: string;
  /** The diagnostic code. */
  code?: string | number;
  /** The line number (1-based). */
  line?: number;
  /** The column number (1-based). */
  column?: number;
}

export interface LspConfig {
  includeSeverities?: string[];
  maxDiagnosticsPerFile?: number;
}

export interface ILspService {
  /**
   * Get diagnostics for a specific file.
   * @param filePath - The file path to check.
   * @returns Array of diagnostics for the file.
   */
  getDiagnostics(filePath: string): Diagnostic[];

  /**
   * Wait for diagnostics for a specific file, up to a timeout.
   * @param filePath - The file path to check.
   * @param timeout - Maximum time to wait in milliseconds.
   * @returns Array of diagnostics for the file.
   */
  waitForDiagnostics(filePath: string, timeout: number): Promise<Diagnostic[]>;

  /** Returns LSP filtering and display configuration, if LSP is enabled. */
  getLspConfig(): LspConfig | undefined;
}
