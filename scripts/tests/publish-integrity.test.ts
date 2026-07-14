/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import {
  type ManifestDependencies,
  type RootManifest,
  checkWorkspaceDependencies,
  createRealProtocolResolver,
  deriveShippedWorkspaceDirs,
  detectRootDuplicateDependencies,
  iterateWorkspaceDependencies,
} from './publish-dependency-helpers.ts';
import {
  buildPackageNameToWorkspaceMap,
  readWorkspaceManifest,
  verifyInternalDependencySource,
  verifyTransitiveSourceClosure,
  verifyExportedSubpaths,
} from './workspace-source-helpers.ts';

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
interface RootPackageMetadata extends RootManifest {
  bin?: Record<string, string>;
}

interface CliPackageMetadata {
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  files?: string[];
}

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
  const npmArgs = ['pack', '--dry-run', '--json'];
  const executable = process.platform === 'win32' ? process.env.ComSpec : 'npm';
  const args =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm', ...npmArgs]
      : npmArgs;
  const stdout = execFileSync(executable!, args, {
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
 * One step of the comment-stripping lexer: the text emitted for this position
 * plus the next scanner state.
 */
interface CharStep {
  emitted: string;
  nextI: number;
  nextQuote: string | null;
}

/**
 * Process a single character position in the comment-stripping lexer.
 * Handles string literals, line comments, block comments, and normal code.
 * Returns only the text emitted at this step; the caller accumulates it, so
 * the helper never needs to thread the full accumulated output through every
 * iteration.
 */
function processChar(
  source: string,
  i: number,
  n: number,
  quote: string | null,
): CharStep {
  const ch = source[i];
  const next = source[i + 1];
  if (quote !== null) {
    if (ch === '\\' && i + 1 < n) {
      // Preserve the escaped character verbatim so an escaped quote does not
      // prematurely close the literal.
      return { emitted: ch + next, nextI: i + 2, nextQuote: quote };
    }
    const nextQuote = ch === quote ? null : quote;
    return { emitted: ch, nextI: i + 1, nextQuote };
  }
  if (ch === "'" || ch === '"' || ch === '`') {
    return { emitted: ch, nextI: i + 1, nextQuote: ch };
  }
  if (ch === '/' && next === '/') {
    // Line comment: drop everything up to (but keep) the newline so the
    // surrounding line structure is preserved for the patterns.
    let j = i + 2;
    while (j < n && source[j] !== '\n') {
      j += 1;
    }
    return { emitted: '', nextI: j, nextQuote: null };
  }
  if (ch === '/' && next === '*') {
    // Block comment: drop through the closing delimiter, emitting a single
    // space so adjacent tokens cannot be accidentally glued together.
    let j = i + 2;
    while (j < n && !(source[j] === '*' && source[j + 1] === '/')) {
      j += 1;
    }
    j += 2;
    return { emitted: ' ', nextI: j, nextQuote: null };
  }
  return { emitted: ch, nextI: i + 1, nextQuote: null };
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
    const step = processChar(source, i, n, quote);
    out += step.emitted;
    i = step.nextI;
    quote = step.nextQuote;
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
  // Generous timeout: the first getPackedPaths() call runs `npm pack
  // --dry-run` over the full TypeScript source tree, which can exceed the
  // default 15s under CI/parallel-suite load. Subsequent callers reuse the
  // memoized result.
  it(
    'includes every local module the lifecycle scripts transitively require',
    { timeout: 60000 },
    () => {
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
    },
  );

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

interface ShippedWorkspacePackagePath {
  readonly workspaceDir: string;
  readonly packagePath: string;
}

function collectShippedWorkspacePackagePaths(
  rootPackage: RootPackageMetadata,
): ShippedWorkspacePackagePath[] {
  const shippedWorkspaceDirs = deriveShippedWorkspaceDirs(rootPackage);
  return (rootPackage.workspaces ?? [])
    .filter((workspaceDir) => shippedWorkspaceDirs.has(workspaceDir))
    .map((workspaceDir) => ({
      workspaceDir,
      packagePath: join(repoRoot, workspaceDir, 'package.json'),
    }))
    .filter(({ packagePath }) => existsSync(packagePath));
}

describe('published package no-compile runtime contract (S6)', () => {
  it('publishes a checked-in launcher bin instead of a compiled dist entry', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
    ) as RootPackageMetadata;
    const cliPackage = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf-8'),
    ) as CliPackageMetadata;

    expect(rootPackage.bin?.llxprt).toBe('packages/cli/bin/llxprt.cjs');
    expect(cliPackage.bin?.llxprt).toBe('bin/llxprt.cjs');
    expect(cliPackage.scripts?.prepack).toBeUndefined();
    expect(cliPackage.scripts?.start).toBe('bun index.ts');
    expect(cliPackage.scripts?.debug).toBe('bun --inspect-brk index.ts');
  });

  it('ships the launcher and TypeScript source needed by Bun at runtime', () => {
    const packed = getPackedPaths();

    expect(packed.has('packages/cli/bin/llxprt.cjs')).toBe(true);
    expect(packed.has('packages/cli/index.ts')).toBe(true);
    expect(packed.has('packages/cli/src/cli.tsx')).toBe(true);
    expect(packed.has('packages/core/index.ts')).toBe(true);
    expect(packed.has('packages/core/src/index.ts')).toBe(true);
    // git-commit.json is gitignored (regenerated per build) but loaded at
    // runtime by shipped source (AboutBox, bugCommand) via the resilient
    // gitCommitInfo loader. The root prepack hook must generate it so
    // `npm pack` always includes it.
    expect(packed.has('packages/cli/src/generated/git-commit.json')).toBe(true);
  });

  it('declares runtime dependencies needed by shipped workspace source', () => {
    // #2352: Refactored to distinguish mandatory dependencies vs
    // optionalDependencies, use semver.subset for registry range containment,
    // explicitly handle npm aliases and file/workspace protocols, and
    // identify internal packages from a manifest-derived set.
    const rootPackage = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
    ) as RootPackageMetadata;
    const root: ManifestDependencies = {
      dependencies: rootPackage.dependencies ?? {},
      optionalDependencies: rootPackage.optionalDependencies ?? {},
    };
    const globWorkspaces = (rootPackage.workspaces ?? []).filter((entry) =>
      /[*?[\]{}]/.test(entry),
    );
    expect(globWorkspaces).toEqual([]);
    const shippedWorkspacePackagePaths =
      collectShippedWorkspacePackagePaths(rootPackage);
    expect(shippedWorkspacePackagePaths.length).toBeGreaterThan(0);

    // Build the manifest-derived internal package name set from ALL
    // workspace manifests (not just shipped ones). This replaces the old
    // naming-prefix convention for identifying internal packages.
    const internalPackages = new Set<string>();
    for (const workspaceDir of rootPackage.workspaces ?? []) {
      const manifestPath = join(repoRoot, workspaceDir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        name?: string;
      };
      if (manifest.name !== undefined) {
        internalPackages.add(manifest.name);
      }
    }

    // Build the package-name→workspace-directory map and a real protocol
    // resolver (F5) so file:/workspace:/link: specifiers are validated
    // against the actual workspace name→directory map, not just the name set.
    const packageNameToDir = buildPackageNameToWorkspaceMap(
      repoRoot,
      rootPackage.workspaces ?? [],
    );
    const protocolResolver = createRealProtocolResolver(
      repoRoot,
      packageNameToDir,
    );

    const mismatches = shippedWorkspacePackagePaths.flatMap(
      ({ workspaceDir, packagePath }) => {
        const workspaceManifest = JSON.parse(
          readFileSync(packagePath, 'utf-8'),
        ) as ManifestDependencies;
        return checkWorkspaceDependencies(
          workspaceDir,
          workspaceManifest,
          root,
          internalPackages,
          protocolResolver,
        );
      },
    );

    expect(
      mismatches.map((m) => m.message),
      'Shipped workspaces declare external dependencies not covered by the ' +
        'root manifest with compatible semver ranges:\n  - ' +
        mismatches.map((m) => m.message).join('\n  - '),
    ).toEqual([]);
  });

  it('keeps the published CLI workspace free of direct GenAI ownership', () => {
    const cliPackage = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf-8'),
    ) as CliPackageMetadata & ManifestDependencies;

    expect(cliPackage.dependencies?.['@google/genai']).toBeUndefined();
    expect(cliPackage.devDependencies?.['@google/genai']).toBeUndefined();
    expect(cliPackage.optionalDependencies?.['@google/genai']).toBeUndefined();
    expect(cliPackage.peerDependencies?.['@google/genai']).toBeUndefined();
  });

  it(
    'ships source for every internal workspace dependency of shipped workspaces',
    { timeout: 60000 },
    () => {
      // #2352: Replaced convention-derived internal package source checks
      // (which assumed the package name suffix maps to the workspace dir and
      // that `index.ts` is always the entry) with a manifest-derived approach:
      // a package-name-to-workspace map built from each workspace's package.json
      // `name` field, and required source files derived from the dependency's
      // manifest fields (`main`, `exports`, `module`, `types`).
      const rootPackage = JSON.parse(
        readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
      ) as RootPackageMetadata;
      const packed = getPackedPaths();

      // Build the authoritative package-name-to-workspace map from the root
      // workspaces list. This replaces the old convention of deriving the
      // sub-directory from the package name suffix.
      const packageNameToWorkspace = buildPackageNameToWorkspaceMap(
        repoRoot,
        rootPackage.workspaces ?? [],
      );

      const shippedWorkspacePackagePaths =
        collectShippedWorkspacePackagePaths(rootPackage);

      const mismatches = shippedWorkspacePackagePaths.flatMap(
        ({ workspaceDir, packagePath }) => {
          const workspacePackage = JSON.parse(
            readFileSync(packagePath, 'utf-8'),
          ) as ManifestDependencies;
          return Array.from(iterateWorkspaceDependencies(workspacePackage))
            .filter(({ name }) => packageNameToWorkspace.has(name))
            .map(({ name: dep }) => {
              const depWorkspaceDir = packageNameToWorkspace.get(dep);
              if (depWorkspaceDir === undefined) {
                return {
                  workspace: workspaceDir,
                  dependency: dep,
                  dependencyWorkspaceDir: '(not found)',
                  missingPackedFiles: [],
                  message:
                    `${workspaceDir} → ${dep}: package name not found in ` +
                    'the package-name-to-workspace map',
                };
              }
              const depManifest = readWorkspaceManifest(
                depWorkspaceDir,
                repoRoot,
              );
              if (depManifest === null) {
                return {
                  workspace: workspaceDir,
                  dependency: dep,
                  dependencyWorkspaceDir: depWorkspaceDir,
                  missingPackedFiles: [],
                  message:
                    `${workspaceDir} → ${dep} (${depWorkspaceDir}): ` +
                    'no package.json found',
                };
              }
              return verifyInternalDependencySource(
                workspaceDir,
                dep,
                depWorkspaceDir,
                depManifest,
                packed,
              );
            })
            .filter(
              (entry): entry is NonNullable<typeof entry> => entry !== null,
            );
        },
      );

      expect(
        mismatches.map((m) => m.message),
        'Shipped workspaces depend on internal workspace packages whose ' +
          'manifest-declared source is NOT in the published tarball:\n  - ' +
          mismatches.map((m) => m.message).join('\n  - '),
      ).toEqual([]);
    },
  );

  it(
    '#2352: ships the transitive source closure of every internal workspace dependency',
    { timeout: 60000 },
    () => {
      // For each internal workspace dependency of shipped workspaces, verify
      // that the transitive closure of static relative runtime imports from
      // every entry point ships in the packed tarball. A missing transitive
      // source file means the runtime would fail with MODULE_NOT_FOUND.
      const rootPackage = JSON.parse(
        readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
      ) as RootPackageMetadata;
      const packed = getPackedPaths();

      const packageNameToWorkspace = buildPackageNameToWorkspaceMap(
        repoRoot,
        rootPackage.workspaces ?? [],
      );

      const shippedWorkspacePackagePaths =
        collectShippedWorkspacePackagePaths(rootPackage);

      const allMissing = shippedWorkspacePackagePaths.flatMap(
        ({ packagePath }) => {
          const workspacePackage = JSON.parse(
            readFileSync(packagePath, 'utf-8'),
          ) as ManifestDependencies;
          return Array.from(iterateWorkspaceDependencies(workspacePackage))
            .filter(({ name }) => packageNameToWorkspace.has(name))
            .flatMap(({ name: dep }) => {
              const depWorkspaceDir = packageNameToWorkspace.get(dep);
              if (depWorkspaceDir === undefined) return [];
              const depManifest = readWorkspaceManifest(
                depWorkspaceDir,
                repoRoot,
              );
              if (depManifest === null) return [];
              return verifyTransitiveSourceClosure(
                depWorkspaceDir,
                depManifest,
                packed,
                repoRoot,
              );
            });
        },
      );

      expect(
        allMissing.map((m) => m.message),
        'Internal workspace dependencies have transitive source files NOT in ' +
          'the published tarball:\n  - ' +
          allMissing.map((m) => m.message).join('\n  - '),
      ).toEqual([]);
    },
  );

  it(
    '#2352: ships every exported subpath entry of internal workspace dependencies',
    { timeout: 60000 },
    () => {
      // For each internal workspace dependency of shipped workspaces, verify
      // that every exported subpath entry file ships in the packed tarball.
      const rootPackage = JSON.parse(
        readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
      ) as RootPackageMetadata;
      const packed = getPackedPaths();

      const packageNameToWorkspace = buildPackageNameToWorkspaceMap(
        repoRoot,
        rootPackage.workspaces ?? [],
      );

      const shippedWorkspacePackagePaths =
        collectShippedWorkspacePackagePaths(rootPackage);

      const allMissing = shippedWorkspacePackagePaths.flatMap(
        ({ packagePath }) => {
          const workspacePackage = JSON.parse(
            readFileSync(packagePath, 'utf-8'),
          ) as ManifestDependencies;
          return Array.from(iterateWorkspaceDependencies(workspacePackage))
            .filter(({ name }) => packageNameToWorkspace.has(name))
            .flatMap(({ name: dep }) => {
              const depWorkspaceDir = packageNameToWorkspace.get(dep);
              if (depWorkspaceDir === undefined) return [];
              const depManifest = readWorkspaceManifest(
                depWorkspaceDir,
                repoRoot,
              );
              if (depManifest === null) return [];
              return verifyExportedSubpaths(
                depWorkspaceDir,
                depManifest,
                packed,
              );
            });
        },
      );

      expect(
        allMissing.map((m) => m.message),
        'Internal workspace dependencies have exported subpath entry files ' +
          'NOT in the published tarball:\n  - ' +
          allMissing.map((m) => m.message).join('\n  - '),
      ).toEqual([]);
    },
  );

  it('runs the checked-in Node launcher without a compiled CLI entry', () => {
    const stdout = execFileSync(
      process.execPath,
      [join(repoRoot, 'packages', 'cli', 'bin', 'llxprt.cjs'), '--version'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
    );

    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 30000);
});

describe('release build self-contained generate contract (issue #2392)', () => {
  // Regression guard for the release failure in
  // https://github.com/vybestack/llxprt-code/actions/runs/28798881603
  //
  // packages/cli/src/generated/git-commit.json is gitignored and only exists
  // once `npm run generate` has run. The gitCommitInfo loader reads it at
  // runtime (falling back to 'N/A' when absent), so a missing artifact no
  // longer breaks the CLI build or startup. The release workflow builds via
  // `npm run build:packages`, and it must NOT rely on an earlier step (e.g.
  // Preflight) having generated the file as a side effect — when a dispatch
  // sets force_skip_tests=true, Preflight is skipped. `build:packages` must
  // therefore generate its own prerequisites so the shipped tarball includes
  // the real commit hash rather than an 'N/A' fallback.
  it('runs generate before building workspaces in build:packages', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
    ) as PackageScripts;
    const scripts = rootPackage.scripts ?? {};
    const buildPackages = scripts['build:packages'] ?? '';

    expect(
      buildPackages,
      'root "build:packages" script is missing from package.json',
    ).not.toBe('');

    const generateIndex = buildPackages.indexOf('npm run generate');
    const buildWorkspacesIndex = buildPackages.indexOf(
      'npm run build --workspaces',
    );

    expect(
      generateIndex,
      '"build:packages" must run "npm run generate" so it produces its own ' +
        'gitignored prerequisites (packages/cli/src/generated/git-commit.json) ' +
        'instead of depending on an earlier workflow step. See issue #2392.',
    ).toBeGreaterThanOrEqual(0);

    expect(
      buildWorkspacesIndex,
      '"build:packages" must build the workspaces via ' +
        '"npm run build --workspaces".',
    ).toBeGreaterThanOrEqual(0);

    expect(
      generateIndex,
      '"build:packages" must run "npm run generate" BEFORE ' +
        '"npm run build --workspaces", otherwise the bundled CLI ships without ' +
        'the generated git-commit.json artifact.',
    ).toBeLessThan(buildWorkspacesIndex);
  });

  it('keeps the generate script wired to the git-commit generator', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
    ) as PackageScripts;
    const scripts = rootPackage.scripts ?? {};
    const generate = scripts['generate'] ?? '';

    // The whole point of running generate in build:packages is to create
    // git-commit.json. If the generate script stops invoking that generator,
    // build:packages no longer produces the artifact the loader reads.
    expect(generate).toContain('scripts/generate-git-commit-info.ts');
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

describe('root duplicate dependency detection (F9)', () => {
  it('the real root manifest has no duplicate dependencies across sections', () => {
    // The root manifest must NOT declare any package in more than one
    // dependency section (dependencies / optionalDependencies /
    // peerDependencies). A duplicate creates ambiguity at install time
    // and allows per-section version drift.
    const rootPackage = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
    ) as RootManifest;
    const dups = detectRootDuplicateDependencies(rootPackage);
    expect(
      dups,
      `Duplicate root dependencies found: ${dups.map((d) => d.message).join('; ')}`,
    ).toEqual([]);
  });
});
