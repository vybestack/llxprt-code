/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Shared types for the config-boundary guard (issue #2615). */

/** A production file outside core that reads one or more Config members. */
export interface ConfigHolder {
  readonly file: string;
  readonly packageName: string;
  readonly members: ReadonlySet<string>;
}

/** A production file outside core importing the Config type (enforcement target). */
export interface ImportFinding {
  readonly file: string;
  readonly packageName: string;
}

/** A role-interface member that matches the service-locator naming pattern. */
export interface RoleViolation {
  readonly file: string;
  readonly member: string;
}

/** Per-package roll-up of holders. */
export interface PackageCount {
  readonly packageName: string;
  readonly files: number;
  readonly members: number;
}

/** A syntax error that caused the guard to fail closed. */
export interface ParseError {
  readonly file: string;
  readonly message: string;
}

/** The full result of a guard run. */
export interface BoundaryResult {
  readonly root: string;
  readonly enforce: boolean;
  readonly holders: readonly ConfigHolder[];
  readonly findings: readonly ImportFinding[];
  readonly roleViolations: readonly RoleViolation[];
  readonly perPackage: readonly PackageCount[];
  readonly totalFiles: number;
  readonly totalMembers: number;
  readonly parseErrors: readonly ParseError[];
}

/** Exit codes used by the guard. */
export const EXIT_OK = 0;
export const EXIT_ENFORCE = 1;
export const EXIT_FAIL_CLOSED = 2;
