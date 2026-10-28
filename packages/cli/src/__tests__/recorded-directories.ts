/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function directoriesOf(line: string): string[] | null {
  const record: unknown = JSON.parse(line);
  if (!isRecord(record) || record.type !== 'directories_changed') return null;
  const payload = record.payload;
  if (!isRecord(payload) || !isStringArray(payload.directories)) {
    throw new Error(`Malformed directories_changed record: ${line}`);
  }
  return payload.directories;
}

/**
 * Returns the directory list of every `directories_changed` record in a
 * session recording's JSONL lines. Callers compare the parsed paths: in the
 * raw line a Windows path appears with its backslashes escaped, so searching
 * the text for a native path never matches.
 */
export function directoriesChangedRecords(
  lines: readonly string[],
): ReadonlyArray<readonly string[]> {
  return lines
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      const directories = directoriesOf(line);
      return directories === null ? [] : [directories];
    });
}
