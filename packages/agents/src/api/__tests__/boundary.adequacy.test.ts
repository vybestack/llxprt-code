/**
 * @plan:PLAN-20260621-COREAPIREMED.P21
 * @requirement:REQ-INT-004
 *
 * Executable static-scan test encoding the no-deep-import boundary across the
 * whole remediated `packages/agents/src/api/__tests__` set. It reads each
 * `*.spec.ts` / `*.test.ts` file from disk as a STRING and asserts import
 * discipline (it does NOT import internals itself — it is a Path-A file).
 *
 * MIN-3 (Path A vs Path B): the PUBLIC-AGENT path under test (and the eventual
 * #1595 production CLI) imports ONLY the curated public root
 * `@vybestack/llxprt-code-agents` (no ./internals.js, no /src/). The TEST-ONLY
 * reference-drive path (Path B) MAY import the documented ./internals.js
 * subpath. Neither path may ever import /src/, core/src, or providers/src.
 *
 * Two TEST-ONLY meta categories are the PERMITTED ./internals.js consumers
 * (neither is a Path-A public-consumer surface):
 *   (1) the reference drive (Path B), filename contains `.reference-drive.`;
 *   (2) the non-breaking export-surface characterization, filename matches
 *       `nonbreaking` / `nonBreaking` (case-insensitive).
 *
 * Plain-string import-specifier parsing mirrors cli-turn-parity.spec.ts's
 * extractFromSpecifiers idiom (no regex — this branch's sonarjs rule prefers
 * plain string ops).
 */

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Extracts import specifiers from a single source line using plain string
 * operations (no regex). Recognizes `... from '...'` and `... from "..."`.
 * Mirrors the extractFromSpecifiers idiom in cli-turn-parity.spec.ts.
 */
function extractFromSpecifiers(rawLine: string): string[] {
  const line = rawLine.trim();
  const out: string[] = [];
  // Cover every specifier-bearing form so a deep/forbidden import cannot evade
  // the boundary gate: static `... from '...'`, side-effect `import '...'`, and
  // dynamic `import('...')`. Each marker ends with its opening quote.
  const markers = [
    "from '",
    'from "',
    "import '",
    'import "',
    "import('",
    'import("',
  ];
  for (const marker of markers) {
    const quote = marker.charAt(marker.length - 1);
    let searchFrom = 0;
    for (;;) {
      const idx = line.indexOf(marker, searchFrom);
      if (idx === -1) break;
      const start = idx + marker.length;
      const end = line.indexOf(quote, start);
      if (end > start) {
        out.push(line.slice(start, end));
        searchFrom = end + 1;
      } else {
        searchFrom = start;
      }
    }
  }
  return out;
}

const DEEP_IMPORT_FRAGMENTS: readonly string[] = [
  '/src/',
  'core/src',
  'providers/src',
];

function isDeepImport(specifier: string): boolean {
  return DEEP_IMPORT_FRAGMENTS.some((frag) => specifier.includes(frag));
}

function isInternalsSubpath(specifier: string): boolean {
  return (
    specifier.startsWith('@vybestack/llxprt-code-agents/internals') ||
    specifier.endsWith('/internals.js') ||
    specifier === '../internals.js' ||
    specifier === './internals.js'
  );
}

/** A Path-B / meta file is one of the two permitted internals consumers. */
function isPermittedInternalsConsumer(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    fileName.includes('.reference-drive.') || lower.includes('nonbreaking')
  );
}

interface FileSpecifiers {
  readonly fileName: string;
  readonly specifiers: readonly string[];
}

/** Discover every *.spec.ts / *.test.ts file and its import specifiers. */
function discoverSpecFiles(): FileSpecifiers[] {
  const entries = readdirSync(HERE, { encoding: 'utf8', recursive: true });
  const result: FileSpecifiers[] = [];
  for (const entry of entries) {
    if (!(entry.endsWith('.spec.ts') || entry.endsWith('.test.ts'))) continue;
    const fullPath = join(HERE, entry);
    const src = readFileSync(fullPath, 'utf8');
    const specifiers: string[] = [];
    for (const rawLine of src.split('\n')) {
      specifiers.push(...extractFromSpecifiers(rawLine));
    }
    result.push({ fileName: basename(entry), specifiers });
  }
  return result;
}

const FILES = discoverSpecFiles();

describe('REQ-INT-004 @plan:PLAN-20260621-COREAPIREMED.P21 — no-deep-import boundary across the remediated set', () => {
  it('Test A (Path A AND Path B): NO file deep-imports /src/, core/src, or providers/src', () => {
    const offenders: string[] = [];
    for (const { fileName, specifiers } of FILES) {
      for (const spec of specifiers) {
        if (isDeepImport(spec)) {
          offenders.push(`${fileName} -> ${spec}`);
        }
      }
    }
    expect(
      offenders,
      `deep imports found:\n${offenders.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('Test B (CRIT-6, Path A): NO Path-A file imports ./internals.js (only *.reference-drive.* or *nonbreaking* may)', () => {
    const offenders: string[] = [];
    for (const { fileName, specifiers } of FILES) {
      if (isPermittedInternalsConsumer(fileName)) continue;
      for (const spec of specifiers) {
        if (isInternalsSubpath(spec)) {
          offenders.push(`${fileName} -> ${spec}`);
        }
      }
    }
    expect(
      offenders,
      `Path-A files importing internals:\n${offenders.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('Test C: at least one Path-A file imports the public root @vybestack/llxprt-code-agents', () => {
    // Restrict to genuine Path-A files: a Path-B/meta internals consumer must
    // not be able to satisfy this assertion and mask a missing Path-A root
    // import.
    const rootImporters = FILES.filter(
      ({ fileName, specifiers }) =>
        !isPermittedInternalsConsumer(fileName) &&
        specifiers.includes('@vybestack/llxprt-code-agents'),
    );
    expect(rootImporters.length).toBeGreaterThan(0);
  });

  it('PROP: no discovered file contains a deep-import specifier (REQ-INT-004 a)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.max(0, FILES.length - 1) }),
        fc.integer({ min: 0, max: 50 }),
        (fileIdx, _runs) => {
          if (FILES.length === 0) return true;
          const { specifiers } = FILES[fileIdx];
          return specifiers.every((s) => !isDeepImport(s));
        },
      ),
    );
  }, 30000);

  it('PROP: every permitted-internals-consumer exemption is justified by filename convention', () => {
    // For every file that imports internals, it MUST be a permitted consumer
    // (reference-drive or nonbreaking). This is the contrapositive lock that
    // keeps the exemption set honest.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.max(0, FILES.length - 1) }),
        (fileIdx) => {
          if (FILES.length === 0) return true;
          const { fileName, specifiers } = FILES[fileIdx];
          const importsInternals = specifiers.some(isInternalsSubpath);
          if (!importsInternals) return true;
          return isPermittedInternalsConsumer(fileName);
        },
      ),
    );
  }, 30000);
});
