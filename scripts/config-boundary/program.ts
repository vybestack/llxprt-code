/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/** Directory segments that mark a file as a test (matches the P01 census). */
const TEST_DIR_SEGMENTS = new Set([
  '__tests__',
  '__mocks__',
  'test-bun',
  'integration-tests',
  'test-setup',
  'test-utils',
  'test-scripts',
]);

const TEST_FILE_RE =
  /\.(test|spec)\.[cm]?tsx?$|\.bun\.ts$|[-.]test-helpers\.[cm]?tsx?$/;

/** Returns true when a repo-relative path is a test file. */
export function isTestPath(rel: string): boolean {
  const normalised = rel.split(sep).join('/');
  const parts = normalised.split('/');
  if (parts.some((segment) => TEST_DIR_SEGMENTS.has(segment))) return true;
  return TEST_FILE_RE.test(normalised);
}

const TS_FILE_RE = /\.[cm]?tsx?$/;
const PRUNED_DIR_NAMES = new Set(['node_modules', 'dist']);

/** Pushes one directory entry into the accumulator, pruning dist/node_modules. */
function pushEntry(entry: Dirent, dir: string, out: string[]): void {
  if (PRUNED_DIR_NAMES.has(entry.name)) return;
  const full = join(dir, entry.name);
  if (entry.isDirectory()) {
    walkTsFiles(full, out);
  } else if (TS_FILE_RE.test(entry.name)) {
    out.push(full);
  }
}

/** Walks every TypeScript source file under a directory (pruning node_modules/dist). */
export function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    pushEntry(entry, dir, out);
  }
  return out;
}

/** Reads the package.json "name" for a package directory, or undefined. */
function readPackageName(pkgDir: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(pkgDir, 'package.json'), 'utf8');
  } catch {
    return undefined;
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed !== null && typeof parsed === 'object' && 'name' in parsed) {
    const name = (parsed as { name: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

/** Adds path mappings for a single package directory, when it has a name. */
function addPackagePaths(
  entry: Dirent,
  packagesDir: string,
  paths: Record<string, string[]>,
): void {
  if (!entry.isDirectory()) return;
  const name = readPackageName(join(packagesDir, entry.name));
  if (!name) return;
  paths[name] = [`${entry.name}/index.ts`];
  paths[`${name}/*`] = [`${entry.name}/src/*`, `${entry.name}/*`];
}

/** Builds tsconfig `paths` from each package's published name (the P01 method). */
function buildPathMappings(packagesDir: string): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    return paths;
  }
  for (const entry of entries) {
    addPackagePaths(entry, packagesDir, paths);
  }
  return paths;
}

/** Extra core source files the program must include to resolve the Config type. */
const CORE_ROOT_FILES = [
  'index.ts',
  'src/index.ts',
  'src/config/config.ts',
  'src/config/configBase.ts',
  'src/config/configBaseCore.ts',
  'src/config/configConstructor.ts',
];

/** Adds the core entry points that exist on disk as program root names. */
function addCoreRoots(coreDir: string, rootNames: string[]): void {
  for (const rel of CORE_ROOT_FILES) {
    const abs = join(coreDir, rel);
    if (existsSync(abs)) rootNames.push(abs);
  }
}

interface CollectedRoots {
  readonly rootNames: string[];
  readonly consumerFiles: string[];
}

/** Collects program root names plus the list of non-core consumer files. */
function collectRoots(packagesDir: string): CollectedRoots {
  const rootNames: string[] = [];
  const consumerFiles: string[] = [];
  let packageEntries: Dirent[] = [];
  try {
    packageEntries = readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    packageEntries = [];
  }
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(packagesDir, entry.name);
    if (entry.name === 'core') {
      addCoreRoots(pkgDir, rootNames);
    } else {
      for (const file of walkTsFiles(pkgDir)) {
        rootNames.push(file);
        consumerFiles.push(file);
      }
    }
  }
  return { rootNames, consumerFiles };
}

export interface ProgramBuild {
  readonly program: ts.Program;
  readonly consumerFiles: readonly string[];
}

/**
 * Builds the TypeScript program exactly as the P01 census did: NodeNext
 * resolution with `paths` derived from package names, baseUrl at packages/,
 * and root files = all non-core source plus the core entry points. Returns the
 * program plus the list of consumer (non-core) absolute paths to analyse.
 */
export function buildProgram(root: string): ProgramBuild {
  const packagesDir = join(root, 'packages');
  const paths = buildPathMappings(packagesDir);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    jsx: ts.JsxEmit.ReactJSX,
    baseUrl: packagesDir,
    paths,
    types: ['node'],
    noEmit: true,
  };

  const { rootNames, consumerFiles } = collectRoots(packagesDir);
  const host = ts.createCompilerHost(options, true);
  const program = ts.createProgram({ rootNames, options, host });
  return { program, consumerFiles };
}

/** Converts an absolute path to a repo-relative, forward-slashed path. */
export function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}
