/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared manifest-dependency enforcement for the genai-enclave boundary
 * guard (#2352).
 *
 * Consolidates all package.json dependency-section checks into a single
 * cohesive abstraction used by both the production guard
 * (scripts/check-genai-enclave.ts) and the published-root regression tests.
 * Replaces ad-hoc per-section iteration with a manifest-derived iterator
 * and recursive shape validation.
 *
 * Findings addressed:
 *
 * - **F1**: rejects npm aliases whose target is `@google/genai`
 *   (`fake-name: npm:@google/genai@1.30.0`) in ANY dependency section of ANY
 *   workspace. An alias lets a non-sanctioned package import the SDK under a
 *   disguised name, so it must be rejected unconditionally.
 * - **F6**: recursively validates every dependency-section shape — each must
 *   be a non-null, non-array object whose values are strings. Malformed
 *   sections fail closed as operational errors so a malformed manifest cannot
 *   hide a genai declaration.
 * - **F9**: rejects duplicate declarations across sections — the SDK appearing
 *   in `dependencies` AND `devDependencies` (or any other pair) creates
 *   ambiguity at install time and allows per-section version drift.
 * - **F10**: requires the exact configured root/core/providers dependency
 *   declarations. The sanctioned workspaces must declare the SDK at the exact
 *   version in `dependencies`; non-sanctioned workspaces must not declare it
 *   at all; and sanctioned workspaces must declare it (missing = violation).
 */

import {
  GENAI_PACKAGE,
  getAllowedGenaiVersion,
  getGenaiDependencyWorkspaceDirs,
} from './config.ts';

/**
 * The four dependency sections of a package.json manifest.
 */
export const DEPENDENCY_SECTION_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export type DependencySectionKey = (typeof DEPENDENCY_SECTION_KEYS)[number];

/**
 * A raw manifest value as parsed from JSON. Kept as `Record<string, unknown>`
 * so the validator can reject malformed shapes rather than trusting the
 * caller's typing.
 */
export type RawManifest = Record<string, unknown>;

/**
 * A validated dependency section: a record of package-name → version string.
 */
export type DependencySection = Record<string, string>;

/**
 * Input for manifest dependency validation.
 */
export interface ManifestValidationInput {
  /** Workspace directory relative to repo root (e.g. '.', 'packages/core'). */
  readonly workspaceDir: string;
  /** The raw parsed manifest value. */
  readonly manifest: RawManifest;
}

/**
 * A dependency-section violation (security or policy).
 */
export interface ManifestDependencyViolation {
  readonly workspaceDir: string;
  readonly section: DependencySectionKey;
  readonly message: string;
}

/**
 * An operational error from malformed manifest structure (fail-closed).
 */
export interface ManifestOperationalError {
  readonly message: string;
}

/**
 * Result of validating a manifest's dependency sections.
 */
export interface ManifestValidationResult {
  readonly violations: readonly ManifestDependencyViolation[];
  readonly errors: readonly ManifestOperationalError[];
}

/**
 * Returns true if `version` is an npm alias specifier (`npm:realName@ver`).
 */
function isNpmAlias(version: string): boolean {
  return version.startsWith('npm:');
}

/**
 * Extract the alias target package name from an npm alias specifier.
 * Returns null for non-alias specifiers.
 *
 * Finds the FIRST `@` that delimits the package name from the version — NOT
 * `lastIndexOf('@')`, which corrupts the target when the version itself
 * contains `@` (e.g. a tarball URL like `https://user@host/pkg.tgz`).
 *
 * - `npm:@scope/pkg@^1.2.3`                → `@scope/pkg`
 * - `npm:plainpkg@^1.2.3`                  → `plainpkg`
 * - `npm:@scope/pkg`                       → `@scope/pkg` (versionless)
 * - `npm:plainpkg`                         → `plainpkg` (versionless)
 * - `npm:@google/genai@https://u@h/p.tgz` → `@google/genai`
 */
function extractNpmAliasTarget(version: string): string | null {
  if (!isNpmAlias(version)) return null;
  const body = version.slice(4); // strip 'npm:'
  if (body.length === 0) return null;
  // For scoped packages (`@scope/name`), find the first `@` after the `/`.
  // For plain packages, find the first `@`.
  let atIndex: number;
  if (body.startsWith('@')) {
    const slashIndex = body.indexOf('/');
    if (slashIndex === -1) return body; // versionless scoped package
    atIndex = body.indexOf('@', slashIndex + 1);
    if (atIndex === -1) return body; // versionless scoped package
  } else {
    atIndex = body.indexOf('@');
    if (atIndex === -1) return body; // versionless plain package
  }
  return body.slice(0, atIndex);
}

/**
 * Returns true if `target` is the @google/genai package (exact or subpath).
 */
function targetsGenai(target: string): boolean {
  return target === GENAI_PACKAGE || target.startsWith(GENAI_PACKAGE + '/');
}

/**
 * Type guard: is `value` a valid dependency section (non-null, non-array
 * object)?
 */
function isDependencySection(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Describe a value that failed `isDependencySection` for diagnostics.
 */
function describeNonSection(section: unknown): string {
  if (section === null) return 'null';
  if (Array.isArray(section)) return 'array';
  return typeof section;
}

/**
 * Validate the shape of a single dependency section. Returns the validated
 * section (all values coerced to strings) or an operational error if the
 * section is malformed.
 *
 * - Section must be a non-null, non-array object (F6).
 * - Every value must be a string (F6).
 *
 * Non-string values are reported as errors so a malformed manifest fails
 * closed instead of hiding a genai declaration behind a bad shape.
 */
function validateSectionShape(
  sectionName: DependencySectionKey,
  section: unknown,
): { section: DependencySection | null; error: string | null } {
  if (section === undefined) {
    return { section: null, error: null };
  }
  if (!isDependencySection(section)) {
    const actual = describeNonSection(section);
    return {
      section: null,
      error:
        `package.json "${sectionName}" must be an object when present ` +
        `(got ${actual}) — fail-closed.`,
    };
  }
  const validated: Record<string, string> = {};
  for (const [name, version] of Object.entries(section)) {
    if (typeof version !== 'string') {
      return {
        section: null,
        error:
          `package.json "${sectionName}.${name}" version must be a string ` +
          `(got ${typeof version}) — fail-closed.`,
      };
    }
    validated[name] = version;
  }
  return { section: validated, error: null };
}

/**
 * Check whether a version specifier uses an npm alias that targets
 * @google/genai. Returns the alias target if it does, null otherwise (F1).
 */
function detectGenaiAlias(version: string): string | null {
  if (!isNpmAlias(version)) return null;
  const target = extractNpmAliasTarget(version);
  if (target === null) return null;
  return targetsGenai(target) ? target : null;
}

/**
 * The set of sanctioned workspace directories (derived from config).
 */
const SANCTIONED_DIRS: ReadonlySet<string> = new Set(
  getGenaiDependencyWorkspaceDirs(),
);

/**
 * Iterate over all dependency sections of a manifest, yielding validated
 * sections. Malformed sections produce errors instead of being silently
 * skipped (F6, F11).
 *
 * This is the shared manifest-derived internal dependency iterator that
 * includes optionalDependencies with no prefix filtering (F11).
 */
export function* iterateDependencySections(manifest: RawManifest): Generator<{
  section: DependencySectionKey;
  deps: DependencySection | null;
  error: string | null;
}> {
  for (const key of DEPENDENCY_SECTION_KEYS) {
    const raw = manifest[key];
    const { section, error } = validateSectionShape(key, raw);
    yield { section: key, deps: section, error };
  }
}

/**
 * Produce a violation for the SDK appearing in a non-dependencies section of
 * a sanctioned workspace.
 */
function wrongSectionViolation(
  workspaceDir: string,
  section: DependencySectionKey,
): ManifestDependencyViolation {
  return {
    workspaceDir,
    section,
    message:
      `@google/genai found in "${section}" — sanctioned workspaces must ` +
      'declare it ONLY in "dependencies". Move it to dependencies.',
  };
}

/**
 * Produce a violation for the SDK appearing in any section of a
 * non-sanctioned workspace.
 */
function unauthorizedWorkspaceViolation(
  workspaceDir: string,
  section: DependencySectionKey,
): ManifestDependencyViolation {
  return {
    workspaceDir,
    section,
    message:
      `@google/genai found in "${section}" — not in the sanctioned ` +
      'workspace allowlist. Remove it.',
  };
}

/**
 * Produce a violation for a version mismatch in a sanctioned workspace.
 */
function versionMismatchViolation(
  workspaceDir: string,
  section: DependencySectionKey,
  actual: string,
  expected: string,
): ManifestDependencyViolation {
  return {
    workspaceDir,
    section,
    message:
      `@google/genai version "${actual}" in "${section}" does not match ` +
      `the required exact version "${expected}".`,
  };
}

/**
 * Produce a violation for a missing SDK declaration in a sanctioned
 * workspace (F10).
 */
function missingDeclarationViolation(
  workspaceDir: string,
): ManifestDependencyViolation {
  return {
    workspaceDir,
    section: 'dependencies',
    message:
      `@google/genai is missing from "dependencies" — sanctioned workspace ` +
      'must declare it at the exact version.',
  };
}

/**
 * Produce a violation for an npm alias targeting @google/genai (F1).
 */
function genaiAliasViolation(
  workspaceDir: string,
  section: DependencySectionKey,
  aliasName: string,
  version: string,
): ManifestDependencyViolation {
  return {
    workspaceDir,
    section,
    message:
      `npm alias "${aliasName}: ${version}" in "${section}" ` +
      'targets @google/genai — aliases disguising the SDK are prohibited.',
  };
}

/**
 * Produce a violation for a duplicate SDK declaration across sections (F9).
 */
function duplicateDeclarationViolation(
  workspaceDir: string,
  section: DependencySectionKey,
): ManifestDependencyViolation {
  return {
    workspaceDir,
    section,
    message:
      `@google/genai appears in multiple dependency sections (duplicate in ` +
      `"${section}") — declare it ONLY in "dependencies".`,
  };
}

function collectDirectDeclarationViolation(
  workspaceDir: string,
  sectionName: DependencySectionKey,
  version: string,
): ManifestDependencyViolation | null {
  if (!SANCTIONED_DIRS.has(workspaceDir)) {
    return unauthorizedWorkspaceViolation(workspaceDir, sectionName);
  }
  if (sectionName !== 'dependencies') {
    return wrongSectionViolation(workspaceDir, sectionName);
  }
  const allowed = getAllowedGenaiVersion(workspaceDir);
  if (allowed !== undefined && version !== allowed) {
    return versionMismatchViolation(
      workspaceDir,
      sectionName,
      version,
      allowed,
    );
  }
  return null;
}

/**
 * Scan a single validated section for SDK declarations and alias targets.
 * Appends violations and records the section key if the SDK was found.
 */
function scanSectionForSdk(
  workspaceDir: string,
  sectionName: DependencySectionKey,
  deps: DependencySection,
  foundIn: Set<DependencySectionKey>,
  violations: ManifestDependencyViolation[],
): void {
  for (const [name, version] of Object.entries(deps)) {
    // F1: detect npm aliases targeting @google/genai in ANY workspace/section
    const aliasTarget = detectGenaiAlias(version);
    if (aliasTarget !== null) {
      violations.push(
        genaiAliasViolation(workspaceDir, sectionName, name, version),
      );
    } else if (name === GENAI_PACKAGE) {
      foundIn.add(sectionName);
      const violation = collectDirectDeclarationViolation(
        workspaceDir,
        sectionName,
        version,
      );
      if (violation !== null) violations.push(violation);
    }
  }
}

/**
 * Check for duplicate SDK declarations across sections (F9). If the SDK was
 * found in more than one section, emit a duplicate violation for each
 * additional section.
 */
function checkDuplicateSections(
  workspaceDir: string,
  foundIn: Set<DependencySectionKey>,
  violations: ManifestDependencyViolation[],
): void {
  if (foundIn.size <= 1) return;
  for (const section of foundIn) {
    if (section !== 'dependencies') {
      violations.push(duplicateDeclarationViolation(workspaceDir, section));
    }
  }
}

/**
 * Check that a sanctioned workspace declares the SDK in `dependencies` (F10).
 * If it was not found in any section (or not in `dependencies`), emit a
 * missing-declaration violation.
 */
function checkRequiredDeclaration(
  workspaceDir: string,
  foundIn: Set<DependencySectionKey>,
  violations: ManifestDependencyViolation[],
): void {
  if (!SANCTIONED_DIRS.has(workspaceDir)) return;
  if (foundIn.has('dependencies')) return;
  violations.push(missingDeclarationViolation(workspaceDir));
}

/**
 * Validate all dependency sections of a manifest against the genai-enclave
 * policy.
 *
 * Checks performed:
 * 1. **Shape validation (F6)**: each section must be a non-null, non-array
 *    object with string values. Malformed sections fail closed.
 * 2. **Alias detection (F1)**: npm aliases targeting @google/genai are
 *    rejected in any section of any workspace.
 * 3. **Authorization**: the SDK may only appear in sanctioned workspaces.
 * 4. **Section correctness**: in sanctioned workspaces, the SDK must appear
 *    only in `dependencies`, not in other sections.
 * 5. **Version exactness**: in sanctioned workspaces, the version must match
 *    the exact configured version.
 * 6. **Duplicate detection (F9)**: the SDK must not appear in multiple
 *    sections simultaneously.
 * 7. **Required declaration (F10)**: sanctioned workspaces must declare the
 *    SDK in `dependencies`.
 */
export function validateManifestDependencies(
  input: ManifestValidationInput,
): ManifestValidationResult {
  const violations: ManifestDependencyViolation[] = [];
  const errors: ManifestOperationalError[] = [];
  const foundIn = new Set<DependencySectionKey>();

  for (const { section, deps, error } of iterateDependencySections(
    input.manifest,
  )) {
    if (error !== null) {
      errors.push({ message: error });
    } else if (deps !== null) {
      scanSectionForSdk(input.workspaceDir, section, deps, foundIn, violations);
    }
  }

  checkDuplicateSections(input.workspaceDir, foundIn, violations);
  checkRequiredDeclaration(input.workspaceDir, foundIn, violations);

  return { violations, errors };
}
