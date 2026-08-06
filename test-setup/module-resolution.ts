/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INTERNAL_FILES = new Set([
  fileURLToPath(import.meta.url),
  join(import.meta.dir, 'augment-bun-vi.ts'),
  join(import.meta.dir, 'bun-vitest-compat.ts'),
]);

const isRelativeSpecifier = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../');

const callerPath = (): string => {
  const stack = new Error().stack;
  for (const line of stack?.split('\n') ?? []) {
    const match = line.match(
      /\(?((?:file:\/\/\/|\/|[A-Za-z]:[\\/]).*):\d+:\d+\)?$/,
    );
    if (!match) continue;

    const path = match[1].startsWith('file:')
      ? fileURLToPath(match[1])
      : match[1];
    if (!INTERNAL_FILES.has(path)) return path;
  }

  throw new Error('Unable to determine the caller for a relative module path');
};

/**
 * TypeScript sources are imported with a `.js` suffix throughout this
 * repository, so a `.js` specifier may map to either a `.ts` or a `.tsx`
 * source file (React components use `.tsx`).
 */
const TYPESCRIPT_SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

const resolveFromCaller = (specifier: string, caller: string): string => {
  const directory = dirname(caller);
  try {
    return Bun.resolveSync(specifier, directory);
  } catch (error: unknown) {
    if (!specifier.endsWith('.js')) throw error;
    const base = specifier.slice(0, -3);
    for (const extension of TYPESCRIPT_SOURCE_EXTENSIONS) {
      try {
        return Bun.resolveSync(`${base}${extension}`, directory);
      } catch {
        // Try the next candidate extension.
      }
    }
    throw error;
  }
};

export const resolveModuleSpecifier = (specifier: string): string => {
  if (!isRelativeSpecifier(specifier)) return specifier;
  return resolveFromCaller(specifier, callerPath());
};
