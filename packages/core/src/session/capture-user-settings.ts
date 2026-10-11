/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { isRecord } from '../llm-types/jsonSchema.js';

export function captureUserSettings(
  values: Readonly<Record<string, unknown>>,
  excluded: ReadonlySet<string>,
  prefix = '',
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      const path = `${prefix}${key}`;
      if (excluded.has(path)) return [];
      if (
        isRecord(value) &&
        [...excluded].some((candidate) => candidate.startsWith(`${path}.`))
      ) {
        const nested = captureUserSettings(value, excluded, `${path}.`);
        return Object.keys(nested).length === 0 ? [] : [[key, nested]];
      }
      return [[key, value]];
    }),
  );
}
