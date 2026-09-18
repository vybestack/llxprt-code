/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * gemini-containment-shared.ts — shared primitives, filesystem walks and the
 * L1 layers (manifests, lockfiles) of the #2628 Gemini-containment gate.
 *
 * The gate entry point is scripts/check-gemini-containment.ts; the
 * source-scanning layers (L2 imports, L3 residency) live in
 * gemini-containment-source.ts and the envelope layer (plugin-manifest ↔
 * base-hint exact-set parity) in gemini-containment-envelope.ts.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';

/** The Google generation SDK whose declarations/import the plugin owns. */
export const GOOGLE_GENERATION_SDK = '@ai-sdk/google';

/** Repo-relative directory holding the non-workspace runtime plugin contexts. */
export const PLUGINS_DIR = 'plugins';

/** The plugin sanctioned to declare the SDK and own the Gemini provider. */
export const GEMINI_PLUGIN_PACKAGE_DIR = 'google-gemini';

/** Dependency sections inspected in every manifest (old-gate vocabulary). */
export const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

/** Directories pruned from every filesystem walk. */
const PRUNE_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tmp',
  'cache',
  '.git',
  '__snapshots__',
]);

/** Source extensions scanned by the import layer (old-gate coverage). */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/** Root-relative lanes scanned by the import layer. */
const SCAN_LANES = [
  'packages',
  'scripts',
  'evals',
  'integration-tests',
  'test-scripts',
] as const;

/** Gate layers, as reported in findings. */
export type GateLayer =
  | 'L1-manifest'
  | 'L1-lockfile'
  | 'L2-import'
  | 'L3-residency'
  | 'envelope';

export interface GateViolation {
  readonly layer: GateLayer;
  /** Path relative to the scan root (repo-relative for the real tree). */
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface LayerResult {
  readonly violations: readonly GateViolation[];
  readonly errors: readonly string[];
}

export interface ScanResult extends LayerResult {
  readonly scannedSourceFiles: number;
}

interface WalkOutput {
  readonly files: string[];
  readonly errors: string[];
}

export type { WalkOutput };

// ─── Small shared helpers ───────────────────────────────────────────────────

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

export { lineAt };

function firstLineOf(raw: string, needle: string): number {
  const index = raw.indexOf(needle);
  return index === -1 ? 1 : lineAt(raw, index);
}

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.has(name.slice(name.lastIndexOf('.')).toLowerCase());
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errorCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return undefined;
  const code: unknown = e.code;
  return typeof code === 'string' ? code : undefined;
}

/** Parse JSON or JSONC, returning null and a message on failure. */
export function parseLooseJson(
  path: string,
  raw: string,
): { value: unknown; error: null } | { value: null; error: string } {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0 || parsed === undefined || parsed === null) {
    return {
      value: null,
      error: `${path}: not parseable as JSON/JSONC (${errors.length} error(s)) — fail-closed.`,
    };
  }
  return { value: parsed, error: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { isRecord };

/**
 * Extract the package name an npm alias specifier points at, using the
 * first-`@`-after-scope parsing from the genai-enclave manifest enforcement
 * (F1): `npm:@scope/pkg@1.2.3` → `@scope/pkg`.
 */
export function extractNpmAliasTarget(version: string): string | null {
  if (!version.startsWith('npm:')) return null;
  const body = version.slice('npm:'.length);
  if (body.length === 0) return null;
  if (body.startsWith('@')) {
    const slashIndex = body.indexOf('/');
    if (slashIndex === -1) return body;
    const atIndex = body.indexOf('@', slashIndex + 1);
    return atIndex === -1 ? body : body.slice(0, atIndex);
  }
  const atIndex = body.indexOf('@');
  return atIndex === -1 ? body : body.slice(0, atIndex);
}

/** True for the bare SDK specifier and any subpath under it. */
export function targetsGenerationSdk(nameOrTarget: string): boolean {
  return (
    nameOrTarget === GOOGLE_GENERATION_SDK ||
    nameOrTarget.startsWith(`${GOOGLE_GENERATION_SDK}/`)
  );
}

/** Read a UTF-8 file or return a fail-closed error message. */
export function readTextOrError(
  root: string,
  rel: string,
): { text: string; error: null } | { text: null; error: string } {
  try {
    return { text: readFileSync(join(root, rel), 'utf8'), error: null };
  } catch (e) {
    return {
      text: null,
      error: `${rel}: cannot read (${errorMessage(e)}) — fail-closed.`,
    };
  }
}

// ─── Filesystem walks ───────────────────────────────────────────────────────

function joinRel(relBase: string, name: string): string {
  return relBase === '' ? name : `${relBase}/${name}`;
}

/**
 * List a directory's entries, pushing a fail-closed error on failure. A
 * missing directory returns null silently (callers decide whether that is
 * expected); any other read error is recorded.
 */
function readDirEntries(
  absDir: string,
  relBase: string,
  out: WalkOutput,
): Dirent[] | null {
  try {
    return readdirSync(absDir, { withFileTypes: true });
  } catch (e) {
    if (errorCode(e) !== 'ENOENT') {
      out.errors.push(
        `Cannot read directory ${relBase || '.'}: ${errorMessage(e)}`,
      );
    }
    return null;
  }
}

function visitWalkEntry(
  entry: Dirent,
  absDir: string,
  relBase: string,
  out: WalkOutput,
): void {
  if (entry.isDirectory()) {
    if (PRUNE_DIRS.has(entry.name)) return;
    walkFiles(join(absDir, entry.name), joinRel(relBase, entry.name), out);
    return;
  }
  if (entry.isFile() && isSourceFile(entry.name)) {
    out.files.push(joinRel(relBase, entry.name));
  }
}

function walkFiles(absDir: string, relBase: string, out: WalkOutput): void {
  const entries = readDirEntries(absDir, relBase, out);
  if (entries === null) return;
  for (const entry of entries) visitWalkEntry(entry, absDir, relBase, out);
}

export { walkFiles };

function collectPluginSourceFiles(root: string, out: WalkOutput): void {
  let pluginEntries: Dirent[];
  try {
    pluginEntries = readdirSync(join(root, PLUGINS_DIR), {
      withFileTypes: true,
    });
  } catch (e) {
    if (errorCode(e) !== 'ENOENT') {
      out.errors.push(`Cannot read ${PLUGINS_DIR}/: ${errorMessage(e)}`);
    }
    return;
  }
  for (const entry of pluginEntries) {
    if (entry.isDirectory()) collectPluginChildFiles(root, entry.name, out);
  }
}

function visitPluginChild(
  child: Dirent,
  childAbs: string,
  pluginBase: string,
  out: WalkOutput,
): void {
  if (child.isDirectory()) {
    if (PRUNE_DIRS.has(child.name)) return;
    walkFiles(join(childAbs, child.name), `${pluginBase}/${child.name}`, out);
    return;
  }
  if (child.isFile() && isSourceFile(child.name)) {
    out.files.push(`${pluginBase}/${child.name}`);
  }
}

function collectPluginChildFiles(
  root: string,
  pluginName: string,
  out: WalkOutput,
): void {
  const pluginBase = `${PLUGINS_DIR}/${pluginName}`;
  const childAbs = join(root, pluginBase);
  let children: Dirent[];
  try {
    children = readdirSync(childAbs, { withFileTypes: true });
  } catch (e) {
    out.errors.push(`Cannot read ${pluginBase}/: ${errorMessage(e)}`);
    return;
  }
  for (const child of children) {
    // src/ and dist/ under a plugin are the sanctioned SDK-import zones.
    if (child.name === 'src' || child.name === 'dist') continue;
    visitPluginChild(child, childAbs, pluginBase, out);
  }
}

function collectRootLooseSourceFiles(root: string, out: WalkOutput): void {
  let rootEntries: Dirent[];
  try {
    rootEntries = readdirSync(root, { withFileTypes: true });
  } catch (e) {
    out.errors.push(`Cannot read scan root: ${errorMessage(e)}`);
    return;
  }
  for (const entry of rootEntries) {
    if (entry.isFile() && isSourceFile(entry.name)) out.files.push(entry.name);
  }
}

/**
 * Collect source files for the import layer: the repo lanes plus root-level
 * loose source files, plus the plugins tree with every plugin's src/ and
 * dist/ subtrees excluded (the sanctioned zones).
 */
export function collectSourceFiles(root: string): WalkOutput {
  const out: WalkOutput = { files: [], errors: [] };
  for (const lane of SCAN_LANES) {
    walkFiles(join(root, lane), lane, out);
  }
  collectPluginSourceFiles(root, out);
  collectRootLooseSourceFiles(root, out);
  return out;
}

// ─── Layer 1a: manifests ────────────────────────────────────────────────────

function visitManifestEntry(
  entry: Dirent,
  absDir: string,
  relBase: string,
  out: WalkOutput,
): void {
  if (entry.isDirectory()) {
    if (PRUNE_DIRS.has(entry.name)) return;
    visitManifestDir(
      join(absDir, entry.name),
      joinRel(relBase, entry.name),
      out,
    );
    return;
  }
  if (entry.isFile() && entry.name === 'package.json') {
    out.files.push(joinRel(relBase, entry.name));
  }
}

function visitManifestDir(
  absDir: string,
  relBase: string,
  out: WalkOutput,
): void {
  const entries = readDirEntries(absDir, relBase, out);
  if (entries === null) return;
  for (const entry of entries) visitManifestEntry(entry, absDir, relBase, out);
}

function collectManifestPaths(root: string): WalkOutput {
  const out: WalkOutput = { files: [], errors: [] };
  visitManifestDir(root, '', out);
  return out;
}

function sdkManifestViolation(
  rel: string,
  raw: string,
  message: string,
): GateViolation {
  return {
    layer: 'L1-manifest',
    file: rel,
    line: firstLineOf(raw, GOOGLE_GENERATION_SDK),
    message,
  };
}

function checkManifestDependency(
  rel: string,
  raw: string,
  section: DependencySection,
  name: string,
  version: unknown,
): GateViolation | string | null {
  if (typeof version !== 'string') {
    return (
      `${rel}: "${section}.${name}" version must be a string ` +
      `(got ${typeof version}) — fail-closed.`
    );
  }
  const aliasTarget = extractNpmAliasTarget(version);
  if (aliasTarget !== null && targetsGenerationSdk(aliasTarget)) {
    return sdkManifestViolation(
      rel,
      raw,
      `npm alias "${name}: ${version}" in "${section}" targets ` +
        `${GOOGLE_GENERATION_SDK} — disguised declarations are prohibited ` +
        'in every manifest, including plugin manifests.',
    );
  }
  if (name !== GOOGLE_GENERATION_SDK) return null;
  const sanctioned =
    rel === `${PLUGINS_DIR}/${GEMINI_PLUGIN_PACKAGE_DIR}/package.json`;
  if (!sanctioned) {
    return sdkManifestViolation(
      rel,
      raw,
      `${GOOGLE_GENERATION_SDK} declared in "${section}" — exactly ONE ` +
        `declaration is permitted, in ${PLUGINS_DIR}/${GEMINI_PLUGIN_PACKAGE_DIR}/package.json ` +
        '"dependencies".',
    );
  }
  if (section !== 'dependencies') {
    return sdkManifestViolation(
      rel,
      raw,
      `${GOOGLE_GENERATION_SDK} declared in "${section}" — the sanctioned ` +
        'plugin manifest must declare it ONLY in "dependencies".',
    );
  }
  return null;
}

function checkManifestSection(
  pkg: Record<string, unknown>,
  rel: string,
  raw: string,
  section: DependencySection,
  violations: GateViolation[],
  errors: string[],
): void {
  const deps = pkg[section];
  if (deps === undefined) return;
  if (!isRecord(deps)) {
    errors.push(
      `${rel}: "${section}" must be an object when present — fail-closed.`,
    );
    return;
  }
  for (const [name, version] of Object.entries(deps)) {
    const result = checkManifestDependency(rel, raw, section, name, version);
    if (result === null) continue;
    if (typeof result === 'string') {
      errors.push(result);
    } else {
      violations.push(result);
    }
  }
}

function checkOneManifest(
  root: string,
  rel: string,
  violations: GateViolation[],
  errors: string[],
): void {
  const read = readTextOrError(root, rel);
  if (read.error !== null) {
    errors.push(read.error);
    return;
  }
  const parsed = parseLooseJson(rel, read.text);
  if (parsed.error !== null) {
    errors.push(parsed.error);
    return;
  }
  if (!isRecord(parsed.value)) {
    errors.push(`${rel}: package.json must contain a JSON object.`);
    return;
  }
  for (const section of DEPENDENCY_SECTIONS) {
    checkManifestSection(
      parsed.value,
      rel,
      read.text,
      section,
      violations,
      errors,
    );
  }
}

/** Layer L1 (manifests): the SDK may be declared only by the Gemini plugin. */
export function checkManifestLayer(root: string): LayerResult {
  const violations: GateViolation[] = [];
  const errors: string[] = [];
  const required = [
    'package.json',
    `${PLUGINS_DIR}/${GEMINI_PLUGIN_PACKAGE_DIR}/package.json`,
  ];
  const discovered = collectManifestPaths(root);
  errors.push(...discovered.errors);
  const found = new Set(discovered.files);
  for (const rel of required) {
    if (!found.has(rel)) {
      errors.push(`Required manifest ${rel} is absent — fail-closed.`);
    }
  }
  for (const rel of discovered.files) {
    checkOneManifest(root, rel, violations, errors);
  }
  return { violations, errors };
}

// ─── Layer 1b: lockfiles ────────────────────────────────────────────────────

function checkLockDepEntry(
  lockRel: string,
  holderRel: string,
  section: DependencySection,
  name: string,
  version: unknown,
  addViolation: (message: string) => void,
): void {
  if (name === GOOGLE_GENERATION_SDK) {
    addViolation(
      `${lockRel}: ${holderRel} declares ${GOOGLE_GENERATION_SDK} in ` +
        `"${section}" — root lockfiles must not carry the SDK; only the ` +
        'plugin-local lockfile may.',
    );
    return;
  }
  if (typeof version !== 'string') return;
  const target = extractNpmAliasTarget(version);
  if (target !== null && targetsGenerationSdk(target)) {
    addViolation(
      `${lockRel}: ${holderRel} "${section}.${name}" is an npm alias ` +
        `targeting ${GOOGLE_GENERATION_SDK} — disguised declarations ` +
        'are prohibited.',
    );
  }
}

function checkLockDepSection(
  lockRel: string,
  holderRel: string,
  section: DependencySection,
  deps: unknown,
  addViolation: (message: string) => void,
  addError: (message: string) => void,
): void {
  if (deps === undefined) return;
  if (!isRecord(deps)) {
    addError(`${lockRel}: ${holderRel} "${section}" must be an object.`);
    return;
  }
  for (const [name, version] of Object.entries(deps)) {
    checkLockDepEntry(lockRel, holderRel, section, name, version, addViolation);
  }
}

function lockDepSectionViolations(
  lockRel: string,
  holderRel: string,
  holder: Record<string, unknown>,
  addViolation: (message: string) => void,
  addError: (message: string) => void,
): void {
  for (const section of DEPENDENCY_SECTIONS) {
    checkLockDepSection(
      lockRel,
      holderRel,
      section,
      holder[section],
      addViolation,
      addError,
    );
  }
}

function isSdkPackageKey(key: string): boolean {
  return (
    key === GOOGLE_GENERATION_SDK ||
    key.startsWith(`${GOOGLE_GENERATION_SDK}@`) ||
    key.startsWith(`${GOOGLE_GENERATION_SDK}/`)
  );
}

function checkBunLockWorkspaces(
  workspaces: Record<string, unknown>,
  addViolation: (message: string) => void,
  addError: (message: string) => void,
): void {
  for (const [key, holder] of Object.entries(workspaces)) {
    if (!isRecord(holder)) continue;
    lockDepSectionViolations(
      'bun.lock',
      `workspaces["${key}"]`,
      holder,
      addViolation,
      addError,
    );
  }
}

function checkBunLockPackages(
  packages: Record<string, unknown>,
  addViolation: (message: string) => void,
): void {
  for (const key of Object.keys(packages)) {
    if (!isSdkPackageKey(key)) continue;
    addViolation(
      `bun.lock: packages["${key}"] resolves ${GOOGLE_GENERATION_SDK} — ` +
        'root lockfiles must not carry the SDK; only the plugin-local ' +
        'lockfile may.',
    );
  }
}

function checkRootBunLock(raw: string): LayerResult {
  const violations: GateViolation[] = [];
  const errors: string[] = [];
  const addViolation = (message: string): void => {
    violations.push({
      layer: 'L1-lockfile',
      file: 'bun.lock',
      line: firstLineOf(raw, GOOGLE_GENERATION_SDK),
      message,
    });
  };
  const parsed = parseLooseJson('bun.lock', raw);
  if (parsed.error !== null) {
    errors.push(parsed.error);
    return { violations, errors };
  }
  if (!isRecord(parsed.value)) {
    errors.push('bun.lock: must contain a JSON object.');
    return { violations, errors };
  }
  const workspaces = parsed.value['workspaces'];
  if (isRecord(workspaces)) {
    checkBunLockWorkspaces(workspaces, addViolation, (message) =>
      errors.push(message),
    );
  }
  const packages = parsed.value['packages'];
  if (isRecord(packages)) {
    checkBunLockPackages(packages, addViolation);
  }
  return { violations, errors };
}

function isSdkLockPackageKey(key: string): boolean {
  return (
    key === `node_modules/${GOOGLE_GENERATION_SDK}` ||
    key.startsWith(`node_modules/${GOOGLE_GENERATION_SDK}/`)
  );
}

function checkPackageLockEntries(
  lockPackages: Record<string, unknown>,
  addViolation: (message: string) => void,
  addError: (message: string) => void,
): void {
  for (const [key, holder] of Object.entries(lockPackages)) {
    if (isSdkLockPackageKey(key)) {
      addViolation(
        `package-lock.json: packages["${key}"] resolves ` +
          `${GOOGLE_GENERATION_SDK} — the root lockfile must not carry the ` +
          'SDK; only the plugin-local lockfile may.',
      );
      continue;
    }
    if (!key.startsWith('node_modules/') && isRecord(holder)) {
      lockDepSectionViolations(
        'package-lock.json',
        `packages["${key}"]`,
        holder,
        addViolation,
        addError,
      );
    }
  }
}

function checkRootPackageLock(raw: string): LayerResult {
  const violations: GateViolation[] = [];
  const errors: string[] = [];
  const addViolation = (message: string): void => {
    violations.push({
      layer: 'L1-lockfile',
      file: 'package-lock.json',
      line: firstLineOf(raw, GOOGLE_GENERATION_SDK),
      message,
    });
  };
  const parsed = parseLooseJson('package-lock.json', raw);
  if (parsed.error !== null) {
    errors.push(parsed.error);
    return { violations, errors };
  }
  if (!isRecord(parsed.value)) {
    errors.push('package-lock.json: missing or malformed "packages".');
    return { violations, errors };
  }
  const lockPackages = parsed.value['packages'];
  if (!isRecord(lockPackages)) {
    errors.push('package-lock.json: missing or malformed "packages".');
    return { violations, errors };
  }
  checkPackageLockEntries(lockPackages, addViolation, (message) =>
    errors.push(message),
  );
  return { violations, errors };
}

/** Absent or unreadable root lockfiles are operational errors (fail-closed). */
function readRootLock(
  abs: string,
  rel: string,
  errors: string[],
): string | null {
  if (!existsSync(abs)) {
    errors.push(`Required lockfile ${rel} is absent — fail-closed.`);
    return null;
  }
  try {
    return readFileSync(abs, 'utf8');
  } catch (e) {
    errors.push(`Cannot read ${rel}: ${errorMessage(e)}`);
    return null;
  }
}

/** Layer L1 (lockfiles): root lockfiles must not carry the SDK. */
export function checkLockfileLayer(root: string): LayerResult {
  const violations: GateViolation[] = [];
  const errors: string[] = [];
  const locks = [
    { rel: 'bun.lock', check: checkRootBunLock },
    { rel: 'package-lock.json', check: checkRootPackageLock },
  ];
  for (const lock of locks) {
    const raw = readRootLock(join(root, lock.rel), lock.rel, errors);
    if (raw === null) continue;
    const result = lock.check(raw);
    violations.push(...result.violations);
    errors.push(...result.errors);
  }
  return { violations, errors };
}
