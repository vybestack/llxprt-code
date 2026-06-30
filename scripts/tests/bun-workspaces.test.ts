/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import TOML from '@iarna/toml';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import semver from 'semver';

const repoRoot = resolve(__dirname, '..', '..');

/**
 * The exact Bun version validated for S1. `bun install` behavior (lockfile
 * migration, lifecycle-script blocking, native-dependency resolution) is
 * version-sensitive, so the pin in `.bun-version` is an intentional, reviewed
 * decision. Asserting the exact value — rather than merely "some semver" — makes
 * any future bump or downgrade trip CI until this constant and the rationale in
 * dev-docs/bun.md are updated deliberately together.
 */
const EXPECTED_BUN_VERSION = '1.3.14';

/**
 * The exact, intentional set of packages whose install/postinstall lifecycle
 * scripts Bun is permitted to run. Bun blocks lifecycle scripts by default;
 * only packages that produce a required native binary are trusted. This is an
 * allowlist on purpose: adding an entry is a deliberate security decision, so
 * the test below asserts the trust list equals this set EXACTLY, guarding
 * against both silent over-trust (a supply-chain risk) and accidental removal
 * (a required native binary would silently fail to build).
 */
const EXPECTED_TRUSTED_DEPENDENCIES: readonly string[] = [
  '@ast-grep/lang-c',
  '@ast-grep/lang-cpp',
  '@ast-grep/lang-csharp',
  '@ast-grep/lang-go',
  '@ast-grep/lang-java',
  '@ast-grep/lang-json',
  '@ast-grep/lang-kotlin',
  '@ast-grep/lang-php',
  '@ast-grep/lang-python',
  '@ast-grep/lang-ruby',
  '@ast-grep/lang-rust',
  '@ast-grep/lang-scala',
  '@ast-grep/lang-swift',
  '@lvce-editor/ripgrep',
  'tree-sitter-bash',
];

/**
 * Native-binary packages called out by the S1 migration scope that must work
 * under Bun but are deliberately NOT trusted. Unlike the allowlist above, these
 * ship their platform binaries through prebuilt `optionalDependencies`
 * (e.g. `@lydell/node-pty-darwin-arm64`) and declare no `install`/`postinstall`
 * lifecycle script, so granting them trust would be unnecessary install-time
 * code execution (a supply-chain risk) rather than a build requirement. The
 * test below pins this reasoning: each package must remain a real, declared
 * dependency AND stay out of the trust list, so a regression in either
 * direction (accidental trust, or the dependency being dropped) fails loudly.
 */
const PREBUILT_NATIVE_UNTRUSTED: readonly string[] = [
  '@lydell/node-pty',
  '@ast-grep/napi',
  '@napi-rs/keyring',
  'web-tree-sitter',
];

/**
 * Every package in the committed package-lock.json that declares an
 * install/postinstall lifecycle script (npm's `hasInstallScript: true`) but is
 * deliberately NOT trusted under Bun. Bun blocks an untrusted package's
 * lifecycle script, so each entry here is a reviewed decision that the blocked
 * script is not required for a working install — its rationale is documented in
 * dev-docs/bun.md ("Why other lifecycle-script packages are NOT trusted").
 *
 * This is the untrusted half of an EXHAUSTIVE partition: the classification
 * test below asserts that the set of install-script packages in the lockfile
 * equals exactly EXPECTED_TRUSTED_DEPENDENCIES ∪ this list. That makes a NEWLY
 * introduced install-script dependency (direct or transitive) fail CI until a
 * human consciously sorts it into "trust" (a required native build) or "leave
 * untrusted" (here, with a reason) — closing the gap where a new package's
 * install-time code would otherwise be silently skipped by Bun with no test
 * forcing the decision. Names are the package's own name (the final
 * node_modules path segment), so a nested copy like
 * `tsx/node_modules/esbuild` is keyed as `esbuild`.
 *
 * Classification is intentionally keyed by NAME only, not name+version. The
 * risk this guard exists to catch is a brand-new install-script package
 * entering the tree unreviewed; a routine version bump of an already-reviewed
 * package (e.g. esbuild 0.x -> 0.y) does not change whether its lifecycle
 * script is required, so forcing a re-review on every such bump would add
 * churn without reducing risk. If a future package's trust ever becomes
 * version-specific, split that single entry into version-qualified records
 * rather than weakening the whole partition.
 */
const REVIEWED_UNTRUSTED_INSTALL_SCRIPTS: readonly string[] = [
  // Direct deps whose lifecycle build is not required (binaries arrive via
  // separate prebuilt platform packages, or the script is dev/build-only).
  'esbuild', // platform binary delivered by @esbuild/<platform>, no script needed
  'msw', // dev/test-only mock service worker; postinstall not runtime-required
  'node-pty', // legacy fallback; runtime prefers prebuilt @lydell/node-pty
  // Transitive deps that ship a lifecycle script we deliberately do not run.
  '@vscode/vsce-sign', // release/VSCE signing tooling, not a CLI runtime need
  'fsevents', // optional macOS file-watcher; prebuilt binary, build not required
  'keytar', // transitive release tooling; credential-store binary not needed here
  'protobufjs', // postinstall is a benign CLI shim; no required native artifact
];

interface PackageJson {
  name?: string;
  workspaces?: string[];
  trustedDependencies?: string[];
  overrides?: Record<string, string | Record<string, string>>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * A single entry in package-lock.json's `packages` map. npm lockfile v3 keys
 * the root as "" and each workspace by its package-root-relative path (e.g.
 * "packages/cli"), and — like package.json — records that location's DECLARED
 * dependency ranges per section (not just the resolved `version`). That makes
 * the workspace entries directly comparable to the corresponding package.json,
 * which the dual-lockfile parity test below relies on.
 */
interface PackageLockEntry {
  version?: string;
  // For a linked workspace entry (node_modules/<name>), `link` is true and
  // `resolved` points at the workspace's package-root-relative path. For the
  // root entry (""), `workspaces` mirrors package.json's declared path array.
  // Both are used to assert npm-side workspace membership exactly.
  resolved?: string;
  link?: boolean;
  workspaces?: string[];
  // npm records `hasInstallScript: true` for any dependency whose own
  // package.json defines a preinstall/install/postinstall script. It reflects
  // the dependency's declared scripts (not the host platform), so reading it
  // from the committed lockfile is deterministic across OSes — the basis for
  // the exhaustive trusted/untrusted classification guard below.
  hasInstallScript?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageLock {
  packages?: Record<string, PackageLockEntry>;
}

interface ParsedBunfig {
  install?: {
    linker?: string;
  };
}

interface BunLockWorkspace {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface BunLock {
  lockfileVersion?: number;
  workspaces?: Record<string, BunLockWorkspace>;
}

const DEPENDENCY_SECTIONS: ReadonlyArray<
  keyof Pick<
    PackageJson,
    | 'dependencies'
    | 'devDependencies'
    | 'optionalDependencies'
    | 'peerDependencies'
  >
> = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

function readRootPackage(): PackageJson {
  return JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
  ) as PackageJson;
}

/**
 * The declared workspace paths from the root package.json `workspaces` array,
 * the single source of truth every membership/parity check builds on. This
 * monorepo declares an explicit, non-empty list of literal paths, so a missing,
 * non-array, empty, or glob-containing `workspaces` field is treated as a hard
 * error rather than silently collapsing dependent checks (membership equality,
 * per-workspace parity) into vacuous no-ops that would pass on a broken repo.
 */
function readDeclaredWorkspacePaths(
  root: PackageJson = readRootPackage(),
): string[] {
  const { workspaces } = root;
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error(
      'Root package.json must declare a non-empty `workspaces` array; found ' +
        `${JSON.stringify(workspaces)}. Workspace membership and lockfile ` +
        'parity checks depend on it, so an absent or empty list is a hard ' +
        'failure rather than a silently-skipped no-op.',
    );
  }
  for (const workspace of workspaces) {
    if (workspace.includes('*')) {
      throw new Error(
        `Glob workspace patterns are not supported by this test: "${workspace}". ` +
          'Update readDeclaredWorkspacePaths to expand globs.',
      );
    }
  }
  return workspaces;
}

/**
 * A declared workspace manifest paired with the key both lockfiles use to
 * address it: "" for the root, otherwise the package-root-relative path (e.g.
 * "packages/cli"). `label` is the same value rendered for assertion messages
 * ("(root)" instead of an empty string).
 */
interface WorkspaceManifest {
  key: string;
  label: string;
  pkg: PackageJson;
}

/**
 * The single source of truth for "every workspace this monorepo declares",
 * returned as { key, label, pkg } so callers can both inspect the manifest and
 * look the workspace up in either lockfile by its key. Builds on
 * readDeclaredWorkspacePaths (which hard-fails on a missing/empty/glob
 * `workspaces` list), and additionally enforces that each declared workspace's
 * package.json exists on disk — a missing one is a hard error rather than a
 * silent skip, so per-workspace parity checks keyed off this list cannot pass
 * vacuously.
 */
function readDeclaredWorkspaceManifests(): WorkspaceManifest[] {
  const root = readRootPackage();
  const manifests: WorkspaceManifest[] = [
    { key: '', label: '(root)', pkg: root },
  ];
  for (const workspace of readDeclaredWorkspacePaths(root)) {
    const pkgPath = join(repoRoot, workspace, 'package.json');
    if (!existsSync(pkgPath)) {
      throw new Error(
        `Declared workspace "${workspace}" has no package.json at ${pkgPath}; ` +
          'a declared workspace must exist on disk so lockfile parity checks ' +
          'do not skip it and pass vacuously.',
      );
    }
    manifests.push({
      key: workspace,
      label: workspace,
      pkg: JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson,
    });
  }
  return manifests;
}

function readWorkspacePackages(): PackageJson[] {
  return readDeclaredWorkspaceManifests().map((manifest) => manifest.pkg);
}

/**
 * Whether a dependency name belongs to one of the KNOWN native-binary families
 * that ship lifecycle-built binaries and therefore must be trusted. This is a
 * deliberately narrow membership check for the families we already know about
 * (ripgrep, tree-sitter-bash, the @ast-grep/lang-* parser family); it is not a
 * general mechanism for discovering arbitrary native dependencies.
 */
function isKnownNativeFamilyDep(name: string): boolean {
  return (
    name === '@lvce-editor/ripgrep' ||
    name === 'tree-sitter-bash' ||
    name.startsWith('@ast-grep/lang-')
  );
}

/**
 * Parses `bun.lock`, which is JSONC (the format Bun emits uses trailing commas),
 * using the same tolerant parser tooling consumes. Parse errors are surfaced as
 * a thrown failure rather than silently yielding a partial object, so a
 * corrupted or hand-edited lockfile fails the suite loudly instead of letting
 * the parity assertions pass vacuously.
 */
function readBunLock(): BunLock {
  const lockPath = join(repoRoot, 'bun.lock');
  if (!existsSync(lockPath)) {
    throw new Error(
      `bun.lock not found at ${lockPath}; the Bun lockfile must be committed ` +
        'so its workspace graph can be verified against package.json.',
    );
  }
  const errors: ParseError[] = [];
  const parsed = parseJsonc(readFileSync(lockPath, 'utf-8'), errors, {
    allowTrailingComma: true,
  }) as BunLock | undefined;
  if (errors.length > 0 || parsed === undefined) {
    throw new Error(
      `bun.lock is not parseable as JSONC (${errors.length} parse error(s)); ` +
        'the lockfile may be corrupted.',
    );
  }
  return parsed;
}

/**
 * Reads and parses the committed package-lock.json. Dual-lockfile coexistence
 * (npm + Bun) is intentional for S1, so the npm lockfile must be present and
 * valid; a missing or corrupt file fails loudly rather than letting the npm
 * side of the parity assertions pass vacuously.
 */
function readPackageLock(): PackageLock {
  const lockPath = join(repoRoot, 'package-lock.json');
  if (!existsSync(lockPath)) {
    throw new Error(
      `package-lock.json not found at ${lockPath}; the npm lockfile must be ` +
        'committed so its workspace graph can be verified against package.json.',
    );
  }
  return JSON.parse(readFileSync(lockPath, 'utf-8')) as PackageLock;
}

/**
 * Collects the union of declared dependency names across the standard sections
 * of a package.json- or bun.lock-workspace-shaped record. Used to compare the
 * dependency *graph* (names), not resolved versions, between the two lockfiles.
 */
function collectDependencyNames(
  source: PackageJson | BunLockWorkspace,
): Set<string> {
  const names = new Set<string>();
  for (const section of DEPENDENCY_SECTIONS) {
    for (const name of Object.keys(source[section] ?? {})) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Collects every dependency name declared across the standard sections of a
 * list of workspace package manifests. Used to build the union of names
 * declared anywhere in the monorepo without nesting loops at each call site.
 */
function collectWorkspaceDependencyNames(
  packages: Iterable<PackageJson>,
): Set<string> {
  const names = new Set<string>();
  for (const pkg of packages) {
    for (const name of collectDependencyNames(pkg)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Collects the declared dependency *ranges* (the version specifier strings as
 * written in the manifest, e.g. "^4.1.12"), keyed by "section/name", across the
 * standard sections. Unlike collectDependencyNames this captures the specifier
 * itself so a same-name range drift (e.g. bumping "^1.0.0" to "^2.0.0" in
 * package.json without regenerating bun.lock) is detectable. Bun mirrors the
 * declared specifier verbatim into each workspace entry of bun.lock, so the two
 * are directly comparable; resolved/transitive versions are deliberately NOT
 * compared (each lockfile's own resolution concern).
 */
function collectDependencyRanges(
  source: PackageJson | BunLockWorkspace | PackageLockEntry,
): Record<string, string> {
  const ranges: Record<string, string> = {};
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, range] of Object.entries(source[section] ?? {})) {
      ranges[`${section}/${name}`] = range;
    }
  }
  return ranges;
}

/**
 * Reduces a node_modules lockfile path to the package's own name (final path
 * segment, scope-aware), so nested copies like `tsx/node_modules/esbuild` and a
 * top-level `node_modules/esbuild` both classify as `esbuild`. The root
 * workspace entry (key "") has no node_modules segment and is excluded.
 */
function nameFromLockPath(lockPath: string): string | undefined {
  const match = lockPath.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/);
  return match?.[1];
}

/**
 * Classifies a single package-lock entry: returns the package name when it is a
 * third-party install-script dependency to classify, or undefined when it
 * should be skipped (no install script, or a first-party workspace entry).
 */
function classifyInstallScriptEntry(
  lockPath: string,
  entry: PackageLockEntry,
): string | undefined {
  if (entry.hasInstallScript !== true) {
    return undefined;
  }
  // First-party entries are our own code, not third-party deps to classify:
  // the root workspace (key "") and workspace members (keyed by their real
  // path like `packages/cli`) have no `node_modules/` segment, and their
  // node_modules symlink aliases carry `link: true`. Their own pre/post
  // install scripts ARE the manager-aware guard, covered by dedicated tests.
  if (!lockPath.includes('node_modules/') || entry.link === true) {
    return undefined;
  }
  const name = nameFromLockPath(lockPath);
  // A third-party entry without a resolvable name would mean an unexpected
  // lockfile shape; fail loudly rather than skipping it.
  expect(name, `unparseable install-script path: ${lockPath}`).toBeDefined();
  return name;
}

describe('Bun package-manager configuration (S1)', () => {
  it('bunfig.toml exists and selects the hoisted linker', () => {
    const content = readFileSync(join(repoRoot, 'bunfig.toml'), 'utf-8');
    const parsed = TOML.parse(content) as unknown as ParsedBunfig;
    expect(parsed.install?.linker).toBe('hoisted');
  });

  it('.bun-version pins the exact validated Bun version', () => {
    const content = readFileSync(
      join(repoRoot, '.bun-version'),
      'utf-8',
    ).trim();
    // Defense-in-depth: it must be a valid semver AND the specific version S1
    // validated, so an unreviewed bump/downgrade fails CI rather than silently
    // changing install behavior.
    expect(semver.valid(content)).not.toBeNull();
    expect(content).toBe(EXPECTED_BUN_VERSION);
  });

  it('declares every workspace package that exists on disk', () => {
    const workspaces = readDeclaredWorkspacePaths();

    // Every declared workspace must contain a package.json.
    for (const workspace of workspaces) {
      const pkgPath = join(repoRoot, workspace, 'package.json');
      expect(existsSync(pkgPath)).toBe(true);
    }

    // Every on-disk package directory must be covered by the workspaces array.
    // Derive the directories to scan from the parents of the declared
    // workspaces rather than hardcoding "packages/". This catches an undeclared
    // sibling alongside an existing workspace root (e.g. a new
    // "packages/foo" when other "packages/*" are declared). Note the limit: a
    // package under a BRAND-NEW root with no declared members yet (e.g. the
    // first "apps/*") has no declared sibling to derive its parent from, so it
    // would not be scanned until at least one member of that root is declared.
    const declaredSet = new Set(workspaces.map((w) => resolve(repoRoot, w)));
    const scanRoots = new Set(
      workspaces.map((w) => dirname(resolve(repoRoot, w))),
    );
    const onDiskPackages: string[] = [];
    for (const scanRoot of scanRoots) {
      if (!existsSync(scanRoot)) {
        continue;
      }
      for (const entry of readdirSync(scanRoot)) {
        const dir = join(scanRoot, entry);
        if (
          statSync(dir).isDirectory() &&
          existsSync(join(dir, 'package.json'))
        ) {
          onDiskPackages.push(dir);
        }
      }
    }

    for (const dir of onDiskPackages) {
      expect(declaredSet.has(resolve(dir))).toBe(true);
    }
  });

  it('does not declare a self-dependency on the root package name', () => {
    // The root package and packages/cli are BOTH published as
    // "@vybestack/llxprt-code". If the root lists its own published name as a
    // dependency, npm masks it (the local workspace wins) but Bun honors the
    // registry range and installs a STALE published copy instead of linking the
    // local packages/cli — silently shadowing in-repo source with an old
    // release and dragging in its entire transitive tree. Nothing imports the
    // bare root name at runtime, so the declaration is purely harmful. Guard
    // every dependency section so a future automated version bump cannot
    // reintroduce it.
    const root = readRootPackage();
    const offending = DEPENDENCY_SECTIONS.filter((section) =>
      Object.prototype.hasOwnProperty.call(root[section] ?? {}, root.name),
    );
    expect(offending).toEqual([]);
  });

  it('trusts exactly the intended native-binary allowlist (no over- or under-trust)', () => {
    // Bun runs lifecycle scripts only for trusted packages. The trust list is a
    // security-sensitive allowlist, so it must match the intended set EXACTLY:
    // an extra entry is unreviewed install-time code execution (supply-chain
    // risk); a missing entry means a required native binary silently fails to
    // build. Comparing the sorted arrays catches both directions and any
    // accidental duplicate.
    const trusted = readRootPackage().trustedDependencies ?? [];
    expect([...trusted].sort()).toStrictEqual(
      [...EXPECTED_TRUSTED_DEPENDENCIES].sort(),
    );
  });

  it('trusts every declared package in the known native-binary families', () => {
    // Forward guard: this checks ONLY the native families we already know ship
    // lifecycle-built binaries (ripgrep, tree-sitter-bash, and the
    // @ast-grep/lang-* parser family). It is not a general discovery of all
    // native dependencies. Its purpose is that adding e.g. a new
    // @ast-grep/lang-* package to any workspace forces it into the allowlist.
    const trusted = new Set(readRootPackage().trustedDependencies ?? []);

    const nativeDeclared = new Set<string>();
    for (const name of collectWorkspaceDependencyNames(
      readWorkspacePackages(),
    )) {
      if (isKnownNativeFamilyDep(name)) {
        nativeDeclared.add(name);
      }
    }

    for (const name of nativeDeclared) {
      expect(trusted.has(name)).toBe(true);
    }
  });

  it('does not trust packages that are not real dependencies', () => {
    const trusted = readRootPackage().trustedDependencies ?? [];

    // Compute the union of every dependency name declared anywhere.
    const declaredNames = collectWorkspaceDependencyNames(
      readWorkspacePackages(),
    );

    for (const name of trusted) {
      expect(declaredNames.has(name)).toBe(true);
    }
  });

  it('keeps prebuilt-binary native deps declared but untrusted', () => {
    // The S1 scope names @lydell/node-pty, @ast-grep/napi, @napi-rs/keyring,
    // and web-tree-sitter as native dependencies that must install under Bun.
    // They obtain their binaries from prebuilt platform optionalDependencies
    // and declare no install/postinstall lifecycle script, so the correct
    // posture is: present as a real dependency, absent from the trust list.
    // This guards both directions — a dropped dependency or an accidental
    // trust grant (unreviewed install-time execution) — for these specific
    // packages, complementing the exact-allowlist test above.
    const root = readRootPackage();
    const trusted = new Set(root.trustedDependencies ?? []);

    const declaredNames = collectWorkspaceDependencyNames(
      readWorkspacePackages(),
    );

    for (const name of PREBUILT_NATIVE_UNTRUSTED) {
      expect(declaredNames.has(name)).toBe(true);
      expect(trusted.has(name)).toBe(false);
    }
  });

  it('classifies every install-script package as trusted or reviewed-untrusted', () => {
    // Exhaustive partition guard. Bun runs lifecycle scripts only for trusted
    // dependencies and silently skips them for everyone else, so a new package
    // that ships a postinstall could either (a) need trust to build a native
    // artifact or (b) be safe to leave blocked — and nothing would force that
    // call. Here we read every `hasInstallScript: true` package from the
    // committed package-lock.json and require its name to be classified exactly
    // once: trusted (root.trustedDependencies, mirrored by
    // EXPECTED_TRUSTED_DEPENDENCIES) XOR reviewed-and-left-untrusted
    // (REVIEWED_UNTRUSTED_INSTALL_SCRIPTS). A newly added install-script
    // dependency therefore fails CI until a human consciously files it.
    const lock = readPackageLock();
    const packages = lock.packages ?? {};

    const installScriptNames = new Set<string>();
    for (const [lockPath, entry] of Object.entries(packages)) {
      const name = classifyInstallScriptEntry(lockPath, entry);
      if (name !== undefined) {
        installScriptNames.add(name);
      }
    }

    // Sanity: the lockfile must actually contain install-script packages, or
    // this guard would pass vacuously (e.g. a truncated/regenerated lockfile).
    expect(installScriptNames.size).toBeGreaterThan(0);

    const trusted = new Set(EXPECTED_TRUSTED_DEPENDENCIES);
    const reviewedUntrusted = new Set(REVIEWED_UNTRUSTED_INSTALL_SCRIPTS);

    // The two classification lists must be disjoint — a package cannot be both
    // trusted and deliberately-untrusted.
    for (const name of reviewedUntrusted) {
      expect(
        trusted.has(name),
        `${name} appears in both trusted and reviewed-untrusted lists`,
      ).toBe(false);
    }

    // Every install-script package in the lockfile must be classified.
    const unclassified = [...installScriptNames]
      .filter((name) => !trusted.has(name) && !reviewedUntrusted.has(name))
      .sort();
    expect(
      unclassified,
      `Unclassified install-script dependency(ies): ${unclassified.join(', ')}. ` +
        'Add each to root.trustedDependencies (if its lifecycle build is ' +
        'required under Bun) or to REVIEWED_UNTRUSTED_INSTALL_SCRIPTS with a ' +
        'rationale (if Bun may safely skip it).',
    ).toEqual([]);

    // And the reverse: every name we claim is reviewed-untrusted must still be
    // a real install-script package in the lockfile, so stale entries are
    // pruned rather than masking a later real classification gap.
    const staleUntrusted = [...reviewedUntrusted]
      .filter((name) => !installScriptNames.has(name))
      .sort();
    expect(
      staleUntrusted,
      `REVIEWED_UNTRUSTED_INSTALL_SCRIPTS lists package(s) with no install ` +
        `script in the lockfile: ${staleUntrusted.join(', ')}. Remove them.`,
    ).toEqual([]);
  });

  it('pins typescript via overrides to the version npm already resolves', () => {
    // Bun resolves dependency ranges freshly and would float `typescript`
    // (declared as ^5.3.3 in most workspaces) to a newer minor than the one npm
    // has locked. A newer TypeScript changes type-aware lint results, so Bun and
    // npm trees must resolve the *same* TypeScript. The override is the
    // mechanism that forces that parity; this test guards it from regressing.
    const root = readRootPackage();
    const override = root.overrides?.['typescript'];
    expect(typeof override).toBe('string');

    // Reuse the shared loader (asserts the committed npm lockfile is present and
    // valid) instead of re-implementing the existence check and parse inline.
    const lock = readPackageLock();
    const npmResolved = lock.packages?.['node_modules/typescript']?.version;
    expect(npmResolved).toBeDefined();

    // The override must equal the version npm already resolves, which makes it a
    // no-op for npm while forcing Bun to match the npm-locked TypeScript.
    expect(override).toBe(npmResolved);
  });

  it('keeps the typescript override compatible with every workspace range', () => {
    // The exact override pin must satisfy the typescript range declared by every
    // workspace; otherwise the forced version would conflict with a workspace's
    // own declaration (a future trap when one workspace bumps its range ahead).
    const root = readRootPackage();
    const override = root.overrides?.['typescript'];
    expect(typeof override).toBe('string');
    const pinned = override as string;
    expect(semver.valid(pinned)).not.toBeNull();

    for (const pkg of readWorkspacePackages()) {
      for (const section of DEPENDENCY_SECTIONS) {
        const range = pkg[section]?.['typescript'];
        if (range === undefined) {
          continue;
        }
        expect(semver.satisfies(pinned, range)).toBe(true);
      }
    }
  });

  it('records the same workspace members in bun.lock as package.json declares', () => {
    // Dual-lockfile coexistence (npm + Bun) is intentional for S1, which means
    // the two lockfiles can silently drift. The workspace membership is the
    // structural backbone of the monorepo: if a package is added to or removed
    // from package.json `workspaces` but bun.lock is not regenerated, Bun and
    // npm would build different trees. Assert the membership sets match exactly
    // (bun.lock keys the root workspace as "" and members by their path).
    const declaredWorkspaces = new Set(readDeclaredWorkspacePaths());

    const bunLock = readBunLock();
    const bunWorkspaceKeys = new Set(Object.keys(bunLock.workspaces ?? {}));
    // The root workspace is keyed as "" in bun.lock; remove it before comparing
    // against the declared member paths, which never include the root itself.
    bunWorkspaceKeys.delete('');

    expect([...bunWorkspaceKeys].sort()).toStrictEqual(
      [...declaredWorkspaces].sort(),
    );
  });

  it('records the same workspace members in package-lock.json as package.json declares', () => {
    // Mirror of the bun.lock membership test for the npm side. package-lock.json
    // records workspace membership in TWO independent places, and a stale entry
    // can linger in either after a workspace is removed from package.json
    // `workspaces` without re-running `npm install`:
    //   1. packages[""].workspaces — npm's copy of the declared path array.
    //   2. node_modules/<name> entries with `link: true`, whose `resolved`
    //      points back at the workspace path npm linked.
    // Assert BOTH sets equal the declared paths exactly (not just a subset), so
    // an added-but-uninstalled or removed-but-still-linked workspace fails CI
    // instead of silently diverging the npm tree from the Bun tree.
    const declaredWorkspaces = [
      ...new Set(readDeclaredWorkspacePaths()),
    ].sort();

    const lock = readPackageLock();
    const rootEntry = lock.packages?.[''];
    expect(
      rootEntry,
      'package-lock.json is missing the root packages[""] entry',
    ).toBeDefined();

    // Representation 1: the mirrored `workspaces` array on the root entry.
    const mirrored = [
      ...new Set((rootEntry as PackageLockEntry).workspaces ?? []),
    ].sort();
    expect(mirrored).toStrictEqual(declaredWorkspaces);

    // Representation 2: the resolved targets of every linked node_modules entry.
    const linkedTargets = Object.entries(lock.packages ?? {})
      .filter(
        ([entryPath, entry]) =>
          entryPath.startsWith('node_modules/') &&
          entry.link === true &&
          typeof entry.resolved === 'string',
      )
      .map(([, entry]) => entry.resolved as string)
      .sort();
    expect([...new Set(linkedTargets)].sort()).toStrictEqual(
      declaredWorkspaces,
    );
  });

  it('records the root dependency graph in bun.lock matching package.json', () => {
    // Beyond membership, the root dependency *set* must stay in lockstep. Bun
    // mirrors the root package.json into workspaces[""]; if a root dependency is
    // added or removed without regenerating bun.lock, the Bun install would
    // resolve a different graph than npm. Compare names (not versions, which are
    // each lockfile's own resolution concern) so a drift in the declared graph
    // fails loudly while legitimate version differences do not.
    const root = readRootPackage();
    const bunLock = readBunLock();
    const bunRoot = bunLock.workspaces?.[''];
    expect(bunRoot).toBeDefined();

    const declaredNames = [...collectDependencyNames(root)].sort();
    const bunNames = [
      ...collectDependencyNames(bunRoot as BunLockWorkspace),
    ].sort();

    expect(bunNames).toStrictEqual(declaredNames);
  });

  it('mirrors each workspace package name into bun.lock', () => {
    // Each declared workspace should appear in bun.lock keyed by its path with
    // the matching package name, proving Bun resolved the same local packages
    // npm does. A mismatch here means bun.lock is stale relative to a renamed or
    // relocated workspace package.
    const bunLock = readBunLock();

    for (const { key, label, pkg } of readDeclaredWorkspaceManifests()) {
      if (key === '') {
        // The root workspace is keyed as "" and intentionally has no package
        // name mirrored here; membership/graph parity is covered by other tests.
        continue;
      }
      const bunWorkspace = bunLock.workspaces?.[key];
      expect(
        bunWorkspace,
        `bun.lock is missing workspace entry for "${label}"`,
      ).toBeDefined();
      expect((bunWorkspace as BunLockWorkspace).name).toBe(pkg.name);
    }
  });

  it('records each workspace dependency graph in bun.lock matching its package.json', () => {
    // Membership parity alone is insufficient: a dependency added to (or removed
    // from) a NON-root workspace package.json — e.g. packages/core — without
    // regenerating bun.lock would let Bun and npm resolve different trees for
    // that package while the membership and root-graph tests stay green. This
    // closes that gap by comparing the declared dependency-name set of every
    // workspace against the names Bun recorded for the same workspace. Names,
    // not versions, are compared for the same reason as the root-graph test:
    // version resolution is each lockfile's own concern, but the declared graph
    // must not silently diverge.
    const bunLock = readBunLock();
    const drift: string[] = [];

    for (const { key, label, pkg } of readDeclaredWorkspaceManifests()) {
      if (key === '') {
        // Root graph parity is covered by the dedicated root-graph test.
        continue;
      }
      const bunWorkspace = bunLock.workspaces?.[key];
      expect(
        bunWorkspace,
        `bun.lock is missing workspace entry for "${label}"`,
      ).toBeDefined();

      const declaredNames = [...collectDependencyNames(pkg)].sort();
      const bunNames = [
        ...collectDependencyNames(bunWorkspace as BunLockWorkspace),
      ].sort();

      if (JSON.stringify(declaredNames) !== JSON.stringify(bunNames)) {
        const declaredSet = new Set(declaredNames);
        const bunSet = new Set(bunNames);
        const onlyInPkg = declaredNames.filter((n) => !bunSet.has(n));
        const onlyInBun = bunNames.filter((n) => !declaredSet.has(n));
        drift.push(
          `${label}: only in package.json [${onlyInPkg.join(', ')}]; ` +
            `only in bun.lock [${onlyInBun.join(', ')}]`,
        );
      }
    }

    expect(
      drift,
      'bun.lock is stale relative to one or more workspace package.json ' +
        "files; regenerate it with 'bun install'. Drift: " +
        JSON.stringify(drift),
    ).toStrictEqual([]);
  });

  it('records each workspace dependency RANGE in bun.lock matching its package.json', () => {
    // Name-set parity still misses a same-name *range* drift: bumping an
    // existing dependency's specifier (e.g. "^1.0.0" -> "^2.0.0") in a workspace
    // package.json without regenerating bun.lock leaves the name set unchanged
    // while Bun and npm would resolve different trees. Bun mirrors the declared
    // specifier verbatim into each workspace entry, so compare the declared
    // ranges (per section/name) for every workspace — including the root
    // (workspaces[""]) — and fail loudly on any divergence. Resolved/transitive
    // versions are still NOT compared (each lockfile's own concern).
    const bunLock = readBunLock();
    const drift: string[] = [];

    for (const { key, label, pkg } of readDeclaredWorkspaceManifests()) {
      const bunWorkspace = bunLock.workspaces?.[key];
      expect(
        bunWorkspace,
        `bun.lock is missing workspace entry for "${label}"`,
      ).toBeDefined();

      const declared = collectDependencyRanges(pkg);
      const recorded = collectDependencyRanges(
        bunWorkspace as BunLockWorkspace,
      );
      const allKeys = new Set([
        ...Object.keys(declared),
        ...Object.keys(recorded),
      ]);
      for (const depKey of allKeys) {
        if (declared[depKey] !== recorded[depKey]) {
          drift.push(
            `${label} ${depKey}: package.json=` +
              `${JSON.stringify(declared[depKey])} bun.lock=` +
              `${JSON.stringify(recorded[depKey])}`,
          );
        }
      }
    }

    expect(
      drift,
      'bun.lock declared dependency ranges diverge from package.json; ' +
        "regenerate it with 'bun install'. Drift: " +
        JSON.stringify(drift),
    ).toStrictEqual([]);
  });

  it('records each workspace dependency NAME+RANGE in package-lock.json matching its package.json', () => {
    // bun.lock parity alone only guards the Bun side. package-lock.json is the
    // npm side of the same dual-lockfile contract and can drift independently:
    // editing a workspace's dependency (add/remove a name, or bump a range)
    // without `npm install` leaves package-lock.json stale, so npm and Bun would
    // build different trees. npm lockfile v3 records each workspace's DECLARED
    // dependency ranges under packages[<path>] (root keyed as ""), mirroring
    // package.json, so assert that declared name+range graph matches for every
    // workspace. Resolved/transitive versions are intentionally NOT compared —
    // that is each lockfile's own concern (see dev-docs/bun.md).
    const lock = readPackageLock();
    const drift: string[] = [];

    for (const { key, label, pkg } of readDeclaredWorkspaceManifests()) {
      const lockEntry = lock.packages?.[key];
      expect(
        lockEntry,
        `package-lock.json is missing packages entry for "${label}"`,
      ).toBeDefined();

      const declared = collectDependencyRanges(pkg);
      const recorded = collectDependencyRanges(lockEntry as PackageLockEntry);
      const allKeys = new Set([
        ...Object.keys(declared),
        ...Object.keys(recorded),
      ]);
      for (const depKey of allKeys) {
        if (declared[depKey] !== recorded[depKey]) {
          drift.push(
            `${label} ${depKey}: package.json=` +
              `${JSON.stringify(declared[depKey])} package-lock.json=` +
              `${JSON.stringify(recorded[depKey])}`,
          );
        }
      }
    }

    expect(
      drift,
      'package-lock.json declared dependency names/ranges diverge from ' +
        "package.json; regenerate it with 'npm install'. Drift: " +
        JSON.stringify(drift),
    ).toStrictEqual([]);
  });
});
