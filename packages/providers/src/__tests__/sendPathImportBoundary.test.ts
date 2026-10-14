/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step C3: import boundary for the history-array seams.
 *
 * A send path must not collect the history into an `IContent[]`. The functions
 * that do are `collectContents` (drains a stream into an array) and the
 * transport-rows helpers `readTransportRows`, `openTransportRowsMedia` and
 * `dropTransportRows` (read a selection into an array and resolve media over
 * it). Product code may import them only from the files listed below.
 *
 * The end state is two files: the Vercel provider, and the Gemini plugin when
 * it lands. Both keep their arrays by the owner's decision (GitHub #3869).
 * Everything else is pending work that removes its entry:
 *
 * - The OpenAI chat send path, including the Kimi file pre-pass, imports none
 *   of them (D3a, D5).
 * - The Anthropic send path imports none of them (E4). The Anthropic
 *   projection route still builds one history array in
 *   `anthropic/AnthropicProjectionRows.ts`, which reads rows itself and so is
 *   invisible to this test; E5 deletes that file.
 * - F1 removes the shared normalization and load-balancing seams.
 *
 * The list may only shrink. A file that imports a banned symbol without an
 * entry fails this test, and so does an entry whose file no longer imports one
 * (delete the entry; do not keep it "just in case").
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

const BANNED_SYMBOLS: ReadonlySet<string> = new Set([
  'collectContents',
  'readTransportRows',
  'openTransportRowsMedia',
  'dropTransportRows',
]);

const BANNED_MODULES = [
  /(^|\/)collectContents\.js$/,
  /(^|\/)transportRows\.js$/,
];

type Disposition = 'permanent' | 'pending';

interface AllowedImporter {
  readonly disposition: Disposition;
  readonly reason: string;
}

const PERMANENT: AllowedImporter = {
  disposition: 'permanent',
  reason: 'declared array exception (GitHub #3869)',
};
const pending = (reason: string): AllowedImporter => ({
  disposition: 'pending',
  reason,
});

/**
 * Keys are repo-relative paths. The Gemini plugin has no source in this tree
 * yet; when it lands its importing file is added here as `PERMANENT`.
 */
const ALLOWED_IMPORTERS: Readonly<Record<string, AllowedImporter>> = {
  'packages/providers/src/openai-vercel/OpenAIVercelProvider.ts': PERMANENT,

  'packages/providers/src/BaseProviderNormalization.ts': pending(
    'step F1 retires the normalization collect for the owning providers',
  ),
  'packages/providers/src/LoadBalancingProvider.ts': pending(
    'step F1 moves load balancing onto the staged row reader',
  ),
  'packages/providers/src/loadBalancing/preparedPromptOptions.ts': pending(
    'step F1 moves load balancing onto the staged row reader',
  ),
};

/** Lower this when a pending entry is removed. It never goes up. */
const PENDING_CEILING = 3;

const NAMED_IMPORT =
  /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** The banned symbols a source text imports, by their exported names. */
function bannedImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(NAMED_IMPORT)) {
    const [, names, specifier] = match;
    if (!BANNED_MODULES.some((module) => module.test(specifier))) continue;
    for (const entry of names.split(',')) {
      const exported = entry
        .trim()
        .replace(/^type\s+/, '')
        .split(/\sas\s/)[0]
        .trim();
      if (BANNED_SYMBOLS.has(exported)) found.push(exported);
    }
  }
  return found;
}

function isProductSource(path: string): boolean {
  if (!path.endsWith('.ts') || path.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.ts$/.test(path)) return false;
  if (/\.test-helpers?\.ts$/.test(path)) return false;
  if (/(^|\/)(__tests__|support|dist|node_modules)(\/|$)/.test(path))
    return false;
  // The modules that define the helpers are not importers of them.
  return !/(^|\/)(collectContents|transportRows)\.ts$/.test(path);
}

function productSourceFiles(): string[] {
  const files: string[] = [];
  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const src = join(PACKAGES_DIR, pkg, 'src');
    if (!existsSync(src)) continue;
    const entries = readdirSync(src, { recursive: true, encoding: 'utf8' });
    for (const entry of entries) {
      if (isProductSource(entry)) files.push(join(src, entry));
    }
  }
  return files;
}

function importers(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const file of productSourceFiles()) {
    const symbols = bannedImports(readFileSync(file, 'utf8'));
    if (symbols.length > 0) {
      result.set(relative(REPO_ROOT, file).split('\\').join('/'), symbols);
    }
  }
  return result;
}

describe('history-array seam import boundary (issue #854 C3)', () => {
  const actual = importers();

  it('lists exactly the files that import a history-array helper', () => {
    const allowed = new Set(Object.keys(ALLOWED_IMPORTERS));
    const unlisted = [...actual.keys()].filter((file) => !allowed.has(file));
    const stale = [...allowed].filter((file) => !actual.has(file));
    expect({ unlisted, stale }).toStrictEqual({ unlisted: [], stale: [] });
  });

  it('keeps the Responses providers off every history-array helper', () => {
    const responses = [...actual.keys()].filter((file) =>
      file.startsWith('packages/providers/src/openai-responses/'),
    );
    expect(responses).toStrictEqual([]);
  });

  it('never grows the pending list', () => {
    const pendingEntries = Object.values(ALLOWED_IMPORTERS).filter(
      (entry) => entry.disposition === 'pending',
    );
    expect(pendingEntries.length).toBeLessThanOrEqual(PENDING_CEILING);
  });

  it('ends with the declared exceptions only', () => {
    const permanent = Object.entries(ALLOWED_IMPORTERS)
      .filter(([, entry]) => entry.disposition === 'permanent')
      .map(([file]) => file);
    expect(permanent).toStrictEqual([
      'packages/providers/src/openai-vercel/OpenAIVercelProvider.ts',
    ]);
  });
});

describe('the import scanner itself', () => {
  it('flags each banned symbol, aliased, typed and multi-line imports included', () => {
    const source = [
      "import { collectContents } from '../utils/collectContents.js';",
      "import { readTransportRows as rows, type Other } from './transportRows.js';",
      'import {',
      '  dropTransportRows,',
      '  openTransportRowsMedia,',
      "} from '../utils/transportRows.js';",
    ].join('\n');
    expect(bannedImports(source)).toStrictEqual([
      'collectContents',
      'readTransportRows',
      'dropTransportRows',
      'openTransportRowsMedia',
    ]);
  });

  it('flags a re-export of a banned symbol', () => {
    expect(
      bannedImports("export { collectContents } from './collectContents.js';"),
    ).toStrictEqual(['collectContents']);
  });

  it('passes the neighbours the same modules export for other purposes', () => {
    const source = [
      "import { replayableContents } from '../utils/collectContents.js';",
      "import { isAsyncIterableContents } from './collectContents.js';",
      "import { collectContents } from './somewhereElse.js';",
    ].join('\n');
    expect(bannedImports(source)).toStrictEqual([]);
  });

  it('would catch a Responses file that collected its history', () => {
    const trap =
      "import { collectContents } from '../utils/collectContents.js';\n";
    expect(bannedImports(trap)).toStrictEqual(['collectContents']);
  });
});
