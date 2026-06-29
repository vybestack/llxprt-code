/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import TOML from '@iarna/toml';
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

interface PackageJson {
  workspaces?: string[];
  trustedDependencies?: string[];
  overrides?: Record<string, string | Record<string, string>>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageLock {
  packages?: Record<string, { version?: string }>;
}

interface ParsedBunfig {
  install?: {
    linker?: string;
  };
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

function readWorkspacePackages(): PackageJson[] {
  const root = readRootPackage();
  const packages: PackageJson[] = [root];
  for (const workspace of root.workspaces ?? []) {
    // The workspaces array currently uses explicit paths. A glob pattern (e.g.
    // "packages/*") would produce a literal path that existsSync silently
    // returns false for, dropping every workspace and making the coverage
    // tests pass vacuously. Fail loudly instead so the test is updated to
    // expand globs rather than degrading into a no-op.
    if (workspace.includes('*')) {
      throw new Error(
        `Glob workspace patterns are not supported by this test: "${workspace}". ` +
          'Update readWorkspacePackages to expand globs.',
      );
    }
    const pkgPath = join(repoRoot, workspace, 'package.json');
    if (existsSync(pkgPath)) {
      packages.push(JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson);
    }
  }
  return packages;
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
    const root = readRootPackage();
    const workspaces = root.workspaces ?? [];

    // Every declared workspace must contain a package.json.
    for (const workspace of workspaces) {
      const pkgPath = join(repoRoot, workspace, 'package.json');
      expect(existsSync(pkgPath)).toBe(true);
    }

    // Every on-disk package directory must be covered by the workspaces array.
    // Derive the directories to scan from the parents of the declared
    // workspaces rather than hardcoding "packages/", so a workspace added
    // under a new root (e.g. "apps/") is still checked.
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
    for (const pkg of readWorkspacePackages()) {
      for (const section of DEPENDENCY_SECTIONS) {
        const deps = pkg[section];
        if (!deps) {
          continue;
        }
        for (const name of Object.keys(deps)) {
          if (isKnownNativeFamilyDep(name)) {
            nativeDeclared.add(name);
          }
        }
      }
    }

    for (const name of nativeDeclared) {
      expect(trusted.has(name)).toBe(true);
    }
  });

  it('does not trust packages that are not real dependencies', () => {
    const trusted = readRootPackage().trustedDependencies ?? [];

    // Compute the union of every dependency name declared anywhere.
    const declaredNames = new Set<string>();
    for (const pkg of readWorkspacePackages()) {
      for (const section of DEPENDENCY_SECTIONS) {
        const deps = pkg[section];
        if (!deps) {
          continue;
        }
        for (const name of Object.keys(deps)) {
          declaredNames.add(name);
        }
      }
    }

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

    const declaredNames = new Set<string>();
    for (const pkg of readWorkspacePackages()) {
      for (const section of DEPENDENCY_SECTIONS) {
        const deps = pkg[section];
        if (!deps) {
          continue;
        }
        for (const name of Object.keys(deps)) {
          declaredNames.add(name);
        }
      }
    }

    for (const name of PREBUILT_NATIVE_UNTRUSTED) {
      expect(declaredNames.has(name)).toBe(true);
      expect(trusted.has(name)).toBe(false);
    }
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

    const lockPath = join(repoRoot, 'package-lock.json');
    if (!existsSync(lockPath)) {
      // Dual-lockfile coexistence is intentional for S1. If the project later
      // migrates fully to Bun and drops package-lock.json, this test should be
      // updated rather than crashing with an opaque ENOENT.
      throw new Error(
        `package-lock.json not found at ${lockPath}; cannot verify the ` +
          'TypeScript override matches the npm-resolved version.',
      );
    }
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as PackageLock;
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
});
