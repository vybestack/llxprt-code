/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight replacement for the `mock-fs` library for the FileCommandLoader
 * test suites. `mock-fs` is incompatible with Bun because it patches
 * Node-internal `ReadFileContext`, which does not exist under Bun's
 * JavaScriptCore runtime (it throws "Cannot destructure property 'read'").
 *
 * Instead of intercepting the `fs` module, this helper materializes the
 * requested file structure into a real temporary directory. The
 * `@vybestack/llxprt-code-settings` module is mocked so that
 * `Storage.getUserCommandsDir()` and `new Storage().getProjectCommandsDir()`
 * resolve to sub-directories of this temp root, allowing the code under test
 * to read real files without touching the user's home directory.
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  mkdtempSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SymlinkSpec {
  path: string;
}

/** Marker-based symlink descriptor, mirroring `mock.symlink({ path })`. */
export interface MockSymlink extends SymlinkSpec {
  readonly __mockFsSymlink: true;
}

/** Create a symlink entry within a structure object. */
export function mockSymlink(spec: SymlinkSpec): MockSymlink {
  return { ...spec, __mockFsSymlink: true };
}

interface StructureDirectory {
  readonly [entry: string]: StructureNode;
}
type StructureNode = string | MockSymlink | StructureDirectory;
export type FsStructure = Record<string, StructureNode>;

function isMockSymlink(node: StructureNode): node is MockSymlink {
  return typeof node === 'object' && '__mockFsSymlink' in node;
}

function writeNode(targetPath: string, node: StructureNode): void {
  if (typeof node === 'string') {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, node, 'utf8');
    return;
  }
  if (isMockSymlink(node)) {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true });
    }
    symlinkSync(node.path, targetPath, symlinkType);
    return;
  }
  if (typeof node === 'object') {
    for (const [childKey, childNode] of Object.entries(node)) {
      writeNode(path.join(targetPath, childKey), childNode);
    }
  }
}

/**
 * Manages a real temporary directory that backs the virtual file structures
 * used by FileCommandLoader tests.
 */
/** Instance shape the code under test uses from a constructed Storage. */
interface MockStorageInstance {
  getProjectCommandsDir(): string;
}

/** Constructor plus the statics the code under test calls on Storage itself. */
interface MockStorageConstructor {
  new (projectRoot?: string): MockStorageInstance;
  getUserCommandsDir(): string;
  getUserSkillsDir(): string;
  getGlobalSettingsPath(): string;
}

export class FsMockContext {
  readonly root: string;
  readonly userCommandsDir: string;
  readonly projectCommandsDir: string;
  private readonly trackedAbsolutePaths: Set<string> = new Set();

  constructor() {
    this.root = mkdtempSync(path.join(os.tmpdir(), 'filecmd-'));
    this.userCommandsDir = path.join(this.root, 'user-commands');
    this.projectCommandsDir = path.join(this.root, 'project-commands');
    mkdirSync(this.userCommandsDir, { recursive: true });
    mkdirSync(this.projectCommandsDir, { recursive: true });
  }

  /**
   * Materialize a structure into the user-commands directory (default), the
   * project-commands directory, or an absolute path.
   *
   * - `mock(structure)` -> writes into the user-commands directory.
   * - `mock(structure, 'project')` -> writes into the project-commands dir.
   * - `mock(structure, '/abs/base')` -> writes into the given absolute base.
   */
  private resolveBasePath(base: string): string {
    if (base === 'user') {
      return this.userCommandsDir;
    }
    if (base === 'project') {
      return this.projectCommandsDir;
    }
    return base;
  }

  mock(structure: FsStructure, base: string = 'user'): void {
    const basePath = this.resolveBasePath(base);
    // Force-remove and recreate the target directory to guarantee a clean
    // slate. This handles all cases: real dir, symlink, or missing path.
    rmSync(basePath, { recursive: true, force: true });
    try {
      mkdirSync(basePath, { recursive: true });
    } catch {
      /* rmSync already removed it */
    }
    for (const [key, node] of Object.entries(structure)) {
      writeNode(path.join(basePath, key), node);
    }
  }

  /**
   * Materialize a structure under an arbitrary absolute path, tracked for
   * cleanup. Use this for extension command directories.
   */
  mockAt(absolutePath: string, structure: FsStructure): void {
    this.trackedAbsolutePaths.add(absolutePath);
    if (existsSync(absolutePath)) {
      rmSync(absolutePath, { recursive: true, force: true });
    }
    for (const [key, node] of Object.entries(structure)) {
      writeNode(path.join(absolutePath, key), node);
    }
  }

  /** Remove everything created since the last clear (per-test reset). */
  clear(): void {
    for (const abs of this.trackedAbsolutePaths) {
      if (existsSync(abs)) {
        rmSync(abs, { recursive: true, force: true });
      }
    }
    this.trackedAbsolutePaths.clear();
    // Force-remove and recreate the standard directories. rmSync with
    // force handles symlinks and real dirs, but Bun's mkdirSync can throw
    // EEXIST even after rmSync in some edge cases, so wrap in try-catch.
    rmSync(this.userCommandsDir, { recursive: true, force: true });
    rmSync(this.projectCommandsDir, { recursive: true, force: true });
    try {
      mkdirSync(this.userCommandsDir, { recursive: true });
    } catch {
      /* already removed above, ignore */
    }
    try {
      mkdirSync(this.projectCommandsDir, { recursive: true });
    } catch {
      /* already removed above, ignore */
    }
  }

  /** Alias mirroring mock-fs restore semantics (per-test cleanup). */
  restore(): void {
    this.clear();
  }

  /** Remove the temp root entirely (afterAll). */
  cleanup(): void {
    this.clear();
    if (existsSync(this.root)) {
      rmSync(this.root, { recursive: true, force: true });
    }
  }

  /**
   * Build the `@vybestack/llxprt-code-settings` module mock object. The mock
   * redirects the command-directory methods to the temp root while preserving
   * the `Storage` constructor signature so the code under test can still
   * `new Storage(projectRoot)`.
   */
  settingsMock(): { Storage: MockStorageConstructor } {
    // Captured as plain values so the class below closes over strings rather
    // than aliasing `this`, which the lint rules forbid.
    const { userCommandsDir, projectCommandsDir, root } = this;

    // Declared to satisfy MockStorageConstructor directly. The command-dir
    // lookups are STATIC on the real Storage, so describing them as instance
    // members previously forced a double type assertion that the CLI policy
    // guard rightly rejects.
    const MockStorage: MockStorageConstructor = class {
      constructor(public projectRoot?: string) {}

      static getUserCommandsDir(): string {
        return userCommandsDir;
      }

      static getUserSkillsDir(): string {
        return path.join(root, 'skills');
      }

      static getGlobalSettingsPath(): string {
        return path.join(root, 'settings.json');
      }

      getProjectCommandsDir(): string {
        return projectCommandsDir;
      }
    };

    return { Storage: MockStorage };
  }
}
