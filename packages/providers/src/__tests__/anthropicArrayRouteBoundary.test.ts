/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 E5: the Anthropic array converter has no production caller on the
 * send, projection, estimate or request dump paths. `prepareAnthropicRequest`
 * and `convertToAnthropicMessages` build the whole message array; the table
 * route (`AnthropicSpooledRequest`) replaced them. They stay as the reference
 * the table route is compared with in tests, and the files below are the only
 * product files that still import them.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const PROVIDERS_SRC = join(REPO_ROOT, 'packages', 'providers', 'src');

const ARRAY_ROUTE_SYMBOLS: ReadonlySet<string> = new Set([
  'prepareAnthropicRequest',
  'convertToAnthropicMessages',
]);

/**
 * The files that may import them. `AnthropicRequestPreparation.ts` defines
 * `prepareAnthropicRequest` on top of the converter. The history-array `/dump`
 * builder moved to `utils/__tests__/support/arrayDumpBody.ts` (issue #854 F1).
 */
const ALLOWED_IMPORTERS: readonly string[] = [
  'packages/providers/src/anthropic/AnthropicRequestPreparation.ts',
];

const NAMED_IMPORT =
  /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

function arrayRouteImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(NAMED_IMPORT)) {
    for (const entry of match[1].split(',')) {
      const exported = entry
        .trim()
        .replace(/^type\s+/, '')
        .split(/\sas\s/)[0]
        .trim();
      if (ARRAY_ROUTE_SYMBOLS.has(exported)) found.push(exported);
    }
  }
  return found;
}

function isProductSource(path: string): boolean {
  if (!path.endsWith('.ts') || path.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.ts$/.test(path)) return false;
  if (/\.test-helpers?\.ts$/.test(path)) return false;
  return !/(^|\/)(__tests__|support|dist|node_modules)(\/|$)/.test(path);
}

function importers(): string[] {
  if (!existsSync(PROVIDERS_SRC)) throw new Error('providers src not found');
  return readdirSync(PROVIDERS_SRC, { recursive: true, encoding: 'utf8' })
    .filter(isProductSource)
    .map((entry) => join(PROVIDERS_SRC, entry))
    .filter((file) => arrayRouteImports(readFileSync(file, 'utf8')).length > 0)
    .map((file) => relative(REPO_ROOT, file).split('\\').join('/'))
    .sort();
}

describe('Anthropic array converter import boundary (issue #854 E5)', () => {
  it('is imported only by the files that define or archive it', () => {
    expect(importers()).toStrictEqual([...ALLOWED_IMPORTERS].sort());
  });

  it('keeps the provider, its executor and the projections off it', () => {
    const actual = importers();
    for (const file of [
      'anthropic/AnthropicProvider.ts',
      'anthropic/AnthropicApiExecution.ts',
      'anthropic/AnthropicSpooledRequest.ts',
      'anthropic/AnthropicSendRequest.ts',
      'runtime/promptEnvelopeProjections.ts',
    ]) {
      expect(actual).not.toContain(`packages/providers/src/${file}`);
    }
  });

  it('flags each symbol, aliased, typed and multi-line imports included', () => {
    const source = [
      "import { prepareAnthropicRequest } from './AnthropicRequestPreparation.js';",
      "import { convertToAnthropicMessages as convert, type Other } from './AnthropicMessageNormalizer.js';",
      'import {',
      '  type prepareAnthropicRequest as typed,',
      "} from './x.js';",
    ].join('\n');
    expect(arrayRouteImports(source)).toStrictEqual([
      'prepareAnthropicRequest',
      'convertToAnthropicMessages',
      'prepareAnthropicRequest',
    ]);
  });
});
