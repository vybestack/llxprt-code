/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'node:os';

interface FilterState {
  inTelemetryObject: boolean;
  braceDepth: number;
}

/**
 * Strip Podman telemetry JSON objects (multi-line `{ ... }` blocks) from
 * captured stdout. Podman emits telemetry to stdout even when writing to a
 * file, so these must be removed to recover the real CLI output.
 */
export function stripTelemetryFromStdout(stdout: string): string {
  const lines = stdout.split(os.EOL);
  const filteredLines: string[] = [];
  const state: FilterState = { inTelemetryObject: false, braceDepth: 0 };

  for (const line of lines) {
    const kept = processLine(line, state);
    if (kept !== null) {
      filteredLines.push(kept);
    }
  }

  return filteredLines.join('\n');
}

/**
 * Process a single line, mutating filter state. Returns the line to keep, or
 * null when the line is part of a telemetry object and should be dropped.
 */
function processLine(line: string, state: FilterState): string | null {
  if (!state.inTelemetryObject && line.trim() === '{') {
    state.inTelemetryObject = true;
    state.braceDepth = 1;
    return null;
  }
  if (!state.inTelemetryObject) {
    return line;
  }

  for (const char of line) {
    if (char === '{') {
      state.braceDepth++;
    } else if (char === '}') {
      state.braceDepth--;
    }
  }

  if (state.braceDepth === 0) {
    state.inTelemetryObject = false;
  }
  return null;
}
