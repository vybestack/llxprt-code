/**
 * @plan:PLAN-20260621-COREAPIREMED.P21
 * @requirement:REQ-INT-004
 *
 * Executable static-scan test encoding the no-deep-import boundary across the
 * whole remediated `packages/agents/src/api/__tests__` set. It reads each
 * `*.spec.ts` / `*.test.ts` file from disk as a STRING and asserts import
 * discipline (it does NOT import the package boundary subjects — it is a
 * Path-A file).
 *
 * Every discovered file (Path-A public-consumer and test-only alike) imports
 * ONLY the curated public root `@vybestack/llxprt-code-agents` or a subpath
 * DECLARED in the package's own exports map. There is NO test-only meta
 * category exempt from this rule: the retired low-level subpath (issue #3222)
 * is forbidden absolutely, and so is every other undeclared subpath. No file
 * may ever import /src/, core/src, or providers/src.
 *
 * The allowed-subpath set is derived at runtime from packages/agents's own
 * package.json exports map — the package's real public surface — so this guard
 * can never drift from what the package actually ships.
 *
 * Plain-string import-specifier parsing mirrors cli-turn-parity.spec.ts's
 * extractFromSpecifiers idiom (no regex — this branch's sonarjs rule prefers
 * plain string ops).
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const AGENTS_ROOT_SPECIFIER = '@vybestack/llxprt-code-agents';

// The retired low-level subpath prefix, assembled from fragments so scanners
// reading THIS file never see the contiguous forbidden literal. The rule it
// feeds is ABSOLUTE: even while the exports map still declares the subpath, no
// discovered file may import it.
const RETIRED_SUBPATH_PREFIX = AGENTS_ROOT_SPECIFIER + '/internals';

/**
 * The allowed agents-package specifiers: the bare root plus every subpath key
 * declared in the package's own exports map (e.g. the app-service and
 * constants subpaths). Read from disk so the guard tracks the real public
 * surface instead of a hand-maintained list.
 */
function resolvePublicAgentsSpecifiers(): ReadonlySet<string> {
  const pkgJson = JSON.parse(
    readFileSync(join(HERE, '..', '..', '..', 'package.json'), 'utf8'),
  ) as { exports?: Record<string, unknown> };
  const allowed = new Set<string>([AGENTS_ROOT_SPECIFIER]);
  for (const key of Object.keys(pkgJson.exports ?? {})) {
    if (key !== '.') {
      // Export keys are './<subpath>'; the import specifier drops the dot.
      allowed.add(AGENTS_ROOT_SPECIFIER + key.slice(1));
    }
  }
  return allowed;
}

const PUBLIC_AGENTS_SPECIFIERS = resolvePublicAgentsSpecifiers();

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

/**
 * True for any agents-package import that is NOT the bare root or a subpath
 * declared in the package's own exports map, PLUS the retired low-level
 * subpath absolutely (an exports-map edit can never resurrect it). This is
 * the absolute rule of issue #3222: no filename-based exemptions of any kind.
 */
function isNonPublicAgentsImport(specifier: string): boolean {
  if (specifier.startsWith(RETIRED_SUBPATH_PREFIX)) {
    return true;
  }
  if (specifier === AGENTS_ROOT_SPECIFIER) {
    return false;
  }
  return (
    specifier.startsWith(AGENTS_ROOT_SPECIFIER + '/') &&
    !PUBLIC_AGENTS_SPECIFIERS.has(specifier)
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

interface ImportBoundaryObservation {
  readonly fileName: string;
  readonly offendingSpecifiers: readonly string[];
}

function inspectDeepImports(file: FileSpecifiers): ImportBoundaryObservation {
  return {
    fileName: file.fileName,
    offendingSpecifiers: file.specifiers.filter(isDeepImport),
  };
}

function inspectNonPublicAgentsImports(
  file: FileSpecifiers,
): ImportBoundaryObservation {
  return {
    fileName: file.fileName,
    offendingSpecifiers: file.specifiers.filter(isNonPublicAgentsImport),
  };
}

function collectDeepImportOffenders(
  files: readonly FileSpecifiers[],
): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const observation = inspectDeepImports(file);
    for (const specifier of observation.offendingSpecifiers) {
      offenders.push(`${observation.fileName} -> ${specifier}`);
    }
  }
  return offenders;
}

function collectNonPublicAgentsImporters(
  files: readonly FileSpecifiers[],
): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const observation = inspectNonPublicAgentsImports(file);
    for (const specifier of observation.offendingSpecifiers) {
      offenders.push(`${observation.fileName} -> ${specifier}`);
    }
  }
  return offenders;
}

function findRootImporters(
  files: readonly FileSpecifiers[],
): readonly FileSpecifiers[] {
  return files.filter(({ specifiers }) =>
    specifiers.includes(AGENTS_ROOT_SPECIFIER),
  );
}

function selectDiscoveredFile(fileIndex: number): FileSpecifiers {
  return FILES[fileIndex];
}

describe('REQ-INT-004 @plan:PLAN-20260621-COREAPIREMED.P21 — no-deep-import boundary across the remediated set', () => {
  it('Test A: NO file deep-imports /src/, core/src, or providers/src', () => {
    const offenders = collectDeepImportOffenders(FILES);
    expect(offenders).toStrictEqual([]);
  });

  it('Test B (CRIT-6, absolute — issue #3222): NO file imports a non-public agents subpath (the retired internals escape hatch is forbidden everywhere, with no exemptions)', () => {
    const offenders = collectNonPublicAgentsImporters(FILES);
    expect(offenders).toStrictEqual([]);
  });

  it('Test C: at least one file imports the public root @vybestack/llxprt-code-agents', () => {
    const rootImporters = findRootImporters(FILES);
    expect(rootImporters.length).toBeGreaterThan(0);
  });

  it('PROP: no discovered file contains a deep-import specifier (REQ-INT-004 a)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.max(0, FILES.length - 1) }),
        fc.integer({ min: 0, max: 50 }),
        (fileIdx, _runs) => {
          const observation = inspectDeepImports(selectDiscoveredFile(fileIdx));
          expect(observation.offendingSpecifiers).toStrictEqual([]);
        },
      ),
    );
  }, 30000);

  it('PROP: no discovered file contains a non-public agents-subpath import specifier (issue #3222 absolute rule)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.max(0, FILES.length - 1) }),
        (fileIdx) => {
          const observation = inspectNonPublicAgentsImports(
            selectDiscoveredFile(fileIdx),
          );
          expect(observation.offendingSpecifiers).toStrictEqual([]);
        },
      ),
    );
  }, 30000);
});
