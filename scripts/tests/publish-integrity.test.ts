/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

/**
 * The npm lifecycle hooks whose entry scripts these tests walk. They run on
 * `npm install` of the *published* package, so every local module they
 * (transitively) `require()` MUST be included in the published tarball or the
 * install crashes with MODULE_NOT_FOUND for end users. The `files` allowlist in
 * package.json is the thing that decides what ships, and it is easy to add a new
 * shared helper to a lifecycle script while forgetting to allowlist it — exactly
 * the regression these tests guard against.
 */
const LIFECYCLE_HOOKS = ['preinstall', 'postinstall'] as const;

interface PackageScripts {
  scripts?: Record<string, string>;
}

interface NpmPackEntry {
  files: Array<{ path: string }>;
}

/**
 * Derives the lifecycle ENTRY scripts from package.json `scripts` rather than
 * hardcoding their paths, so this test follows a rename/move of a lifecycle
 * script (e.g. preinstall.cjs -> bootstrap/preinstall.cjs) instead of silently
 * guarding a stale path. Each hook command is expected to invoke a single local
 * script file (e.g. "node scripts/preinstall.cjs"); the package-root-relative
 * POSIX path of that file is extracted and asserted to exist on disk.
 */
function deriveLifecycleEntryScripts(): string[] {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
  ) as PackageScripts;
  const scripts = pkg.scripts ?? {};
  const entries: string[] = [];
  for (const hook of LIFECYCLE_HOOKS) {
    const command = scripts[hook];
    expect(
      command,
      `package.json scripts.${hook} is expected to be defined so the ` +
        'published-package integrity test can walk its require graph.',
    ).toBeDefined();
    const match = /(?:^|\s)((?:\.?\/)?[\w./-]+\.(?:cjs|mjs|js))(?:\s|$)/.exec(
      command as string,
    );
    expect(
      match,
      `Could not extract a local script file from scripts.${hook} ` +
        `("${command}"); the integrity test expects a "node <path>.cjs" form.`,
    ).not.toBeNull();
    const relPath = (match as RegExpExecArray)[1]
      .replace(/^\.\//, '')
      .split('/')
      .join(posix.sep);
    expect(
      existsSync(join(repoRoot, relPath)),
      `scripts.${hook} references "${relPath}" which does not exist on disk.`,
    ).toBe(true);
    entries.push(relPath);
  }
  return entries;
}

/**
 * Memoized result of {@link getPackedPaths}. `npm pack --dry-run` is a slow
 * child process and the packed file set is constant for the duration of a test
 * run, so it is computed once and shared across the tests that need it.
 */
let packedPathsCache: Set<string> | undefined;

/**
 * Returns the exact set of file paths that `npm publish` would include in the
 * tarball, computed via `npm pack --dry-run --json` so the test exercises npm's
 * real `files`/.npmignore resolution rather than re-implementing it. Paths are
 * POSIX-style and relative to the package root (e.g. "scripts/preinstall.cjs").
 * The result is memoized so repeated calls do not re-spawn `npm pack`.
 */
function getPackedPaths(): Set<string> {
  if (packedPathsCache !== undefined) {
    return packedPathsCache;
  }
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as NpmPackEntry[];
  const entry = parsed[0];
  if (entry === undefined || !Array.isArray(entry.files)) {
    throw new Error(
      'npm pack --dry-run --json did not return the expected { files: [...] } shape.',
    );
  }
  packedPathsCache = new Set(entry.files.map((f) => f.path));
  return packedPathsCache;
}

/**
 * Result of processing a single character in the comment-stripper.
 */
interface CharResult {
  out: string;
  nextI: number;
  nextQuote: string | null;
}

/**
 * Process a single character position in the comment-stripping lexer.
 * Handles string literals, line comments, block comments, and normal code.
 */
function processChar(
  source: string,
  i: number,
  n: number,
  quote: string | null,
  outSoFar: string,
): CharResult {
  const ch = source[i];
  const next = source[i + 1];
  if (quote !== null) {
    let out = outSoFar + ch;
    if (ch === '\\' && i + 1 < n) {
      // Preserve the escaped character verbatim so an escaped quote does not
      // prematurely close the literal.
      out += next;
      return { out, nextI: i + 2, nextQuote: quote };
    }
    const nextQuote = ch === quote ? null : quote;
    return { out, nextI: i + 1, nextQuote };
  }
  if (ch === "'" || ch === '"' || ch === '`') {
    return { out: outSoFar + ch, nextI: i + 1, nextQuote: ch };
  }
  if (ch === '/' && next === '/') {
    // Line comment: drop everything up to (but keep) the newline so the
    // surrounding line structure is preserved for the patterns.
    let j = i + 2;
    while (j < n && source[j] !== '\n') {
      j += 1;
    }
    return { out: outSoFar, nextI: j, nextQuote: null };
  }
  if (ch === '/' && next === '*') {
    // Block comment: drop through the closing delimiter, emitting a single
    // space so adjacent tokens cannot be accidentally glued together.
    let j = i + 2;
    while (j < n && !(source[j] === '*' && source[j + 1] === '/')) {
      j += 1;
    }
    j += 2;
    return { out: outSoFar + ' ', nextI: j, nextQuote: null };
  }
  return { out: outSoFar + ch, nextI: i + 1, nextQuote: null };
}

/**
 * Removes JavaScript line (`//…`) and block comments from source while
 * preserving the contents of string and template literals. This is a
 * deliberately small delimiter-aware lexer — not a full parser — whose sole
 * job is to stop the specifier patterns below from matching commented-out
 * references such as `// import './helper.js'`. String/template bodies are
 * copied verbatim (honouring backslash escapes) so a `//` or `/*` sequence
 * inside a quoted path or URL is never mistaken for the start of a comment.
 */
function stripLineAndBlockComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  // Active string/template delimiter while inside a literal; null while in code.
  let quote: string | null = null;
  while (i < n) {
    const result = processChar(source, i, n, quote, out);
    out = result.out;
    i = result.nextI;
    quote = result.nextQuote;
  }
  return out;
}

/**
 * Extracts the specifiers of every *relative* dependency (require() and static
 * import) referenced by a CommonJS/ESM source file. Bare specifiers (npm
 * packages, node: builtins) are intentionally ignored: those are resolved from
 * node_modules / Node core at install time, not shipped inside this tarball.
 *
 * CONVENTION (enforced by this regex walker's deliberate limits): lifecycle
 * helper scripts MUST reference their relative dependencies with a STATIC
 * STRING LITERAL specifier — e.g. require('./detect-installer.cjs') or
 * `import x from './helper.js'`. The patterns below only match literal
 * './'-prefixed specifiers; they intentionally do NOT resolve computed
 * specifiers (require(varName), template literals, runtime path.join), nor do
 * they span specifiers split across multiple lines. A dynamically-referenced
 * helper would therefore escape this packed-tarball check. Keep lifecycle
 * helper imports as plain static literals so this guard stays sound; if a
 * computed specifier ever becomes necessary, broaden the walker accordingly.
 */
function findRelativeDependencySpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  // Strip comments first so a commented-out reference — e.g.
  // `// import './helper.js'` or `/* require('./old.cjs') */` — cannot invent a
  // phantom dependency and false-fail the tarball integrity check.
  const code = stripLineAndBlockComments(source);
  const patterns = [
    /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g, // require('./x')
    /\brequire\.resolve\(\s*['"](\.[^'"]+)['"]\s*\)/g, // require.resolve('./x')
    // Side-effect-only static import: `import './x'` (no binding, no `from`).
    // Without this, a lifecycle helper that pulls in a relative module purely
    // for its side effects would escape the walker and the tarball check could
    // false-pass on a missing entry.
    /\bimport\s+['"](\.[^'"]+)['"]/g,
    // import ... from './x' — anchored to a leading `import` keyword so a bare
    // "from './x'" in prose/comments cannot produce a false specifier. The
    // `[^'";]*?` only spans the import clause, never crossing a quote or `;`.
    /\bimport\b[^'";]*?\bfrom\s+['"](\.[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g, // import('./x')
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Resolves a relative specifier (as written in source) against the file that
 * references it, returning the package-root-relative POSIX path of the actual
 * file on disk — applying Node's extension/index resolution. Returns undefined
 * if nothing on disk matches, which signals a genuinely broken require rather
 * than merely an un-packed one.
 */
function resolveLocalModule(
  fromPackageRelPath: string,
  specifier: string,
): string | undefined {
  const fromDirAbs = dirname(join(repoRoot, fromPackageRelPath));
  const targetAbs = resolve(fromDirAbs, specifier);
  const candidates = [
    targetAbs,
    `${targetAbs}.cjs`,
    `${targetAbs}.js`,
    `${targetAbs}.mjs`,
    `${targetAbs}.json`,
    join(targetAbs, 'index.cjs'),
    join(targetAbs, 'index.js'),
    join(targetAbs, 'index.mjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // Normalize to a package-root-relative POSIX path to match npm pack output.
      const rel = candidate.slice(repoRoot.length + 1);
      return rel.split(/[\\/]/).join(posix.sep);
    }
  }
  return undefined;
}

/**
 * Checks the relative dependency specifiers required by a single entry script.
 * Returns the set of missing-path diagnostics and the list of resolved local
 * modules to follow transitively. Extracted from the BFS loop so the loop body
 * stays free of multiple break/continue statements.
 */
function checkEntryDependencies(
  current: string,
  source: string,
  packed: Set<string>,
): { missing: string[]; follow: string[] } {
  const missing: string[] = [];
  const follow: string[] = [];
  for (const specifier of findRelativeDependencySpecifiers(source)) {
    const resolved = resolveLocalModule(current, specifier);
    const diagnostic = dependencyDiagnostic(
      current,
      specifier,
      resolved,
      packed,
    );
    if (diagnostic !== null) {
      missing.push(diagnostic);
    } else if (resolved !== undefined) {
      // Follow the dependency so we also catch helpers-requiring-helpers.
      follow.push(resolved);
    }
  }
  return { missing, follow };
}

/**
 * Returns a diagnostic string when a relative dependency specifier is missing or
 * not packed, or null when the resolved module ships and should be followed.
 */
function dependencyDiagnostic(
  current: string,
  specifier: string,
  resolved: string | undefined,
  packed: Set<string>,
): string | null {
  if (resolved === undefined) {
    return `${current} requires "${specifier}" which resolves to no file on disk`;
  }
  if (!packed.has(resolved)) {
    return (
      `${current} requires "${specifier}" (-> ${resolved}) which is NOT ` +
      'in the published tarball; add it to package.json "files".'
    );
  }
  return null;
}

describe('published package integrity (S1)', () => {
  it('includes every local module the lifecycle scripts transitively require', () => {
    // The bug this guards against: a lifecycle script gains a
    // `require('./helper.cjs')` but the helper is not added to package.json
    // `files`, so the published tarball omits it and `npm install` of the
    // released package dies with MODULE_NOT_FOUND. We compute the transitive
    // closure of relative requires starting from the lifecycle entry points and
    // assert each referenced local module actually ships.
    const packed = getPackedPaths();
    const lifecycleEntryScripts = deriveLifecycleEntryScripts();

    // Sanity: the entry points themselves must ship, or the whole premise is moot.
    for (const entry of lifecycleEntryScripts) {
      expect(
        packed.has(entry),
        `Lifecycle entry "${entry}" is declared in package.json scripts but is ` +
          'not in the published tarball (check the package.json "files" allowlist).',
      ).toBe(true);
    }

    const visited = new Set<string>();
    const queue: string[] = [...lifecycleEntryScripts];
    const missing: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const source = readFileSync(join(repoRoot, current), 'utf-8');
      const { missing: entryMissing, follow } = checkEntryDependencies(
        current,
        source,
        packed,
      );
      missing.push(...entryMissing);
      for (const resolved of follow) {
        queue.push(resolved);
      }
    }

    expect(
      missing,
      `Published-package integrity violations:\n  - ${missing.join('\n  - ')}`,
    ).toStrictEqual([]);
  });

  it('ships the shared detect-installer helper required by both lifecycle scripts', () => {
    // An explicit, named assertion for the specific shared module introduced in
    // S1. This is intentionally redundant with the transitive-closure test
    // above: it gives a precise, self-documenting failure if the helper ever
    // falls out of the tarball, independent of the require-graph walker.
    const packed = getPackedPaths();
    expect(
      packed.has('scripts/detect-installer.cjs'),
      'scripts/detect-installer.cjs is required by preinstall.cjs and ' +
        'postinstall.cjs but is missing from the published tarball; it must be ' +
        'listed in package.json "files".',
    ).toBe(true);
  });
});

describe('findRelativeDependencySpecifiers (tarball-walker regex coverage)', () => {
  it('captures every supported static relative-reference form', () => {
    // Each line below is a distinct syntactic form the published lifecycle
    // helpers may legitimately use to pull in a sibling module. The walker must
    // see all of them, otherwise a referenced-but-unpacked helper could slip
    // past the tarball integrity check. The bare `import './side-effect.js'`
    // case is the one this guard was extended to cover.
    const source = [
      `require('./a.cjs');`,
      `require.resolve('./b.js');`,
      `import './side-effect.js';`,
      `import helper from './c.js';`,
      `import { thing } from './d.mjs';`,
      `await import('./e.js');`,
    ].join('\n');

    expect(findRelativeDependencySpecifiers(source).sort()).toStrictEqual(
      [
        './a.cjs',
        './b.js',
        './c.js',
        './d.mjs',
        './e.js',
        './side-effect.js',
      ].sort(),
    );
  });

  it('ignores a bare "from" specifier that is not a real import statement', () => {
    // Defensive: prose or a comment containing `from './x'` without a leading
    // `import` keyword must NOT be mistaken for a dependency, so the walker
    // cannot be tricked into chasing a non-existent specifier.
    const source = `// copied from './not-a-real-import.js' for reference\n`;
    expect(findRelativeDependencySpecifiers(source)).toStrictEqual([]);
  });

  it('ignores commented-out imports/requires (line and block comments)', () => {
    // A commented-out reference must NOT register as a real dependency,
    // otherwise the tarball walker would chase a phantom specifier and
    // false-fail the integrity check even though no code imports it. This
    // covers every supported form behind both `//` and block comments —
    // including the bare side-effect `import './x'` that the `from`-anchor
    // alone does not defend against.
    const source = [
      `// import './commented-side-effect.js';`,
      `  //import helper from './commented-binding.js';`,
      `// require('./commented-require.cjs');`,
      `// const x = require.resolve('./commented-resolve.js');`,
      `// await import('./commented-dynamic.js');`,
      `/* import { thing } from './block-commented.mjs'; */`,
      `/*`,
      ` * import './multiline-block.js';`,
      ` */`,
    ].join('\n');
    expect(findRelativeDependencySpecifiers(source)).toStrictEqual([]);
  });

  it('still captures real imports that sit alongside comments and quoted slashes', () => {
    // The comment stripper must not over-reach: genuine code on the same or
    // adjacent lines as comments is still scanned, and a `//` or `/*` that
    // lives inside a string literal (e.g. a URL) must be treated as data, not
    // as the start of a comment that would swallow the trailing real import.
    const source = [
      `import './real-side-effect.js'; // import './fake.js'`,
      `const url = 'https://example.com/not-a-comment';`,
      `require('./real-require.cjs'); /* require('./fake.cjs') */`,
      `import helper from './real-binding.js';`,
    ].join('\n');
    expect(findRelativeDependencySpecifiers(source).sort()).toStrictEqual(
      [
        './real-binding.js',
        './real-require.cjs',
        './real-side-effect.js',
      ].sort(),
    );
  });
});
