/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { env } from 'node:process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Local diagnostic-output helper for the test harness.
 *
 * The package source is covered by the repo-wide `no-console` policy. To keep
 * failure diagnostics available without scattered bare `console.*` calls, every
 * diagnostic route is routed through this helper. Output is emitted only when
 * explicitly requested (VERBOSE/KEEP_OUTPUT), and detailed dumps are written to
 * a log file inside the active test directory when a TestRig directory is set.
 */
export interface DiagnosticsSink {
  /**
   * Human-readable message intended for a process stream. Emitted to stdout
   * only when verbose output is enabled.
   */
  verbose(message: string): void;
  /**
   * Warning-level diagnostic. Emitted to stderr only when verbose output is
   * enabled.
   */
  warn(message: string, detail?: unknown): void;
  /**
   * Error-level diagnostic used for parse failures / failure dumps. Emitted to
   * stderr only when verbose output is enabled.
   */
  error(message: string, detail?: unknown): void;
  /**
   * Writes a structured dump (file contents, result preview, etc.) to the log
   * file under the active test directory when one is configured, otherwise to
   * stderr when verbose output is enabled.
   */
  dump(label: string, content: string): void;
}

function isVerbose(): boolean {
  return env['VERBOSE'] === 'true' || env['KEEP_OUTPUT'] === 'true';
}

function appendToTestLog(
  testDir: string | null,
  label: string,
  content: string,
): void {
  if (testDir === null) {
    return;
  }
  try {
    writeFileSync(
      join(testDir, 'harness-diagnostics.log'),
      `\n--- ${label} ---\n${content}\n`,
      { flag: 'a' },
    );
  } catch {
    // Diagnostic logging must never fail a test.
  }
}

/**
 * Creates a diagnostics sink bound to a test directory. The directory may be
 * `null` before setup completes; the returned sink degrades gracefully.
 */
export function createDiagnosticsSink(testDir: string | null): DiagnosticsSink {
  return {
    verbose(message) {
      if (isVerbose()) {
        process.stdout.write(`${message}\n`);
      }
    },
    warn(message, detail) {
      if (isVerbose()) {
        process.stderr.write(`${message}\n`);
        if (detail !== undefined) {
          process.stderr.write(`${String(detail)}\n`);
        }
      }
      appendToTestLog(
        testDir,
        message,
        detail === undefined ? '' : String(detail),
      );
    },
    error(message, detail) {
      if (isVerbose()) {
        process.stderr.write(`${message}\n`);
        if (detail !== undefined) {
          process.stderr.write(`${String(detail)}\n`);
        }
      }
      appendToTestLog(
        testDir,
        message,
        detail === undefined ? '' : String(detail),
      );
    },
    dump(label, content) {
      appendToTestLog(testDir, label, content);
      if (isVerbose()) {
        process.stderr.write(`--- ${label} ---\n${content}\n`);
      }
    },
  };
}

/**
 * Standalone verbose log used before any TestRig directory exists.
 */
export function logVerbose(message: string): void {
  if (isVerbose()) {
    process.stdout.write(`${message}\n`);
  }
}
