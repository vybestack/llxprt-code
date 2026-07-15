/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared violation type definitions for the genai-enclave boundary guard
 * (#2352). Extracted so both import-detection and export-detection modules
 * can reference them without creating a circular dependency.
 */

export interface GenaiImportViolation {
  readonly kind: 'genai-import';
  readonly file: string;
  readonly line: number;
  readonly importForm: string;
  readonly specifier: string;
}

export interface ComputedImportViolation {
  readonly kind: 'computed-import';
  readonly file: string;
  readonly line: number;
  readonly importForm: string;
}

export interface GeminiExportViolation {
  readonly kind: 'gemini-export';
  readonly file: string;
  readonly line: number;
  readonly exportName: string;
  readonly exportForm: string;
}

export type Violation =
  | GenaiImportViolation
  | ComputedImportViolation
  | GeminiExportViolation;
