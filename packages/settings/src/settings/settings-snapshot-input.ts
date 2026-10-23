/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import type { SettingsStateSnapshot } from './SettingsService.js';
import {
  isDangerousPropertyKey,
  isPlainObject,
  parseProviderSettingsRecord,
} from './validation.js';

function isSnapshotValue(
  value: unknown,
  ancestors: readonly object[],
): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.includes(value)) return false;
  const next = [...ancestors, value];
  if (Array.isArray(value))
    return value.every((entry: unknown) => isSnapshotValue(entry, next));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(
    ([key, entry]) =>
      !isDangerousPropertyKey(key) && isSnapshotValue(entry, next),
  );
}

const snapshotSchema = z
  .object({
    global: z.record(z.unknown()),
    providers: z.record(z.unknown()),
    tools: z
      .object({
        allowed: z.array(z.string()).optional(),
        disabled: z.array(z.string()).optional(),
        apiKeys: z.record(z.string()).optional(),
        apiKeyFiles: z.record(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function captureSettingsSnapshot(input: unknown): SettingsStateSnapshot {
  if (!isSnapshotValue(input, [])) throw new Error('Invalid settings snapshot');
  const result = snapshotSchema.safeParse(input);
  if (!result.success) throw new Error('Invalid settings snapshot');
  const providers: SettingsStateSnapshot['providers'] = {};
  for (const [name, value] of Object.entries(result.data.providers)) {
    if (value === undefined) {
      providers[name] = undefined;
      continue;
    }
    const record = parseProviderSettingsRecord(value);
    if (record === undefined) throw new Error('Invalid settings snapshot');
    providers[name] = record;
  }
  return structuredClone({ ...result.data, providers });
}
