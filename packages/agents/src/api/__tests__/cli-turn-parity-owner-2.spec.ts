import { useConsumerPromptDirectory } from './helpers/consumer-owner-primitives.js';

import { join, dirname } from 'node:path';

import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { describe, expect, it } from 'bun:test';

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * Extracts import specifiers from a single source line using plain string
 * operations (no regex). Recognizes `... from '...'` and `... from "..."`.
 */
function extractFromSpecifiers(rawLine: string): string[] {
  const line = rawLine.trim();
  const out: string[] = [];
  const markers = ["from '", 'from "'];
  for (const marker of markers) {
    const idx = line.indexOf(marker);
    if (idx === -1) continue;
    const quote = marker.charAt(marker.length - 1);
    const start = idx + marker.length;
    const end = line.indexOf(quote, start);
    if (end > start) {
      out.push(line.slice(start, end));
    }
  }
  return out;
}
describe('CLI turn-parity (broad) @plan:PLAN-20260621-COREAPIREMED.P19 @requirement:REQ-INT-002 @requirement:REQ-INT-004', () => {
  useOwnedCredentials();

  useConsumerPromptDirectory();

  function observeParitySpecImportBoundaries() {
    const here = dirname(fileURLToPath(import.meta.url));
    const specs = [
      join(here, 'cli-turn-parity.spec.ts'),
      join(here, 'config-injection.spec.ts'),
      join(here, 'settings-surface.spec.ts'),
    ];

    // Collect every `from '...'` import specifier across the three specs,
    // using plain string operations (no regex) to parse the import lines.
    const allSpecifiers: string[] = [];
    for (const spec of specs) {
      const src = readFileSync(spec, 'utf8');
      for (const rawLine of src.split('\n')) {
        allSpecifiers.push(...extractFromSpecifiers(rawLine));
      }
    }

    // REQ-INT-004 (a): NO deep core/src or providers/src imports.
    const deepImport = allSpecifiers.find(
      (specifier) =>
        specifier.includes('core/src/') || specifier.includes('providers/src/'),
    );

    // REQ-INT-004 (b): every @vybestack/llxprt-code-agents import is the root
    // or a documented non-internals subpath. ./internals.js is FORBIDDEN as a
    // Path-A import; the reference AgenticLoop import comes from the root.
    const agentsImports = allSpecifiers.filter((specifier) =>
      specifier.startsWith('@vybestack/llxprt-code-agents'),
    );
    const internalImports = agentsImports.filter((specifier) =>
      specifier.endsWith('/internals.js'),
    );

    // REQ-INT-004 (c): there IS at least one agents root import (the surface
    // under test is exercised through the curated public root).
    const rootImports = agentsImports.filter(
      (specifier) => specifier === '@vybestack/llxprt-code-agents',
    );
    return { deepImport, internalImports, rootImports };
  }

  it('T11 boundary scan: the parity spec files import ONLY the public root (no ./internals.js in Path A, no deep /src/ anywhere) (REQ-INT-004)', () => {
    const { deepImport, internalImports, rootImports } =
      observeParitySpecImportBoundaries();
    expect(deepImport).toBeUndefined();
    expect(internalImports).toStrictEqual([]);
    expect(rootImports.length).toBeGreaterThan(0);
  }, 30000);
});
