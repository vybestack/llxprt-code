/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ImmutableTableAllowance } from './tests/runtime-state-structure-guard.js';

const allowlistPath = fileURLToPath(
  new URL('./runtime-state-immutable-allowlist.json', import.meta.url),
);

/**
 * Parses the committed allowlist of benign immutable lookup tables that may be
 * module-level object/array literals inside the runtime state roots. The file
 * is external input, so its shape is validated.
 */
export function parseImmutableTableAllowlist(
  text: string,
): ImmutableTableAllowance[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed))
    throw new Error('Immutable table allowlist must be an array');
  return parsed.map((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null)
      throw new Error(
        `Immutable table allowlist entry ${index} is not an object`,
      );
    return {
      file: requiredText(entry, 'file', index),
      declaration: requiredText(entry, 'declaration', index),
      reason: requiredText(entry, 'reason', index),
    };
  });
}

function requiredText(entry: object, name: string, index: number): string {
  const value: unknown = Reflect.get(entry, name);
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(
      `Immutable table allowlist entry ${index} needs a nonblank "${name}"`,
    );
  return value;
}

export function loadImmutableTableAllowlist(): ImmutableTableAllowance[] {
  return parseImmutableTableAllowlist(readFileSync(allowlistPath, 'utf8'));
}
