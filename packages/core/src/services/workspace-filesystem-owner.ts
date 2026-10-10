/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import {
  FileExclusions,
  type ExcludeOptions,
} from '../utils/ignorePatterns.js';
import {
  FileDiscoveryService,
  type FilterFilesOptions,
  type FilterReport,
} from '@vybestack/llxprt-code-storage';
import {
  FileSearchFactory,
  type SearchOptions,
  type FileSearch,
} from '../utils/filesearch/fileSearch.js';
import { readFileWithEncoding } from '@vybestack/llxprt-code-tools/utils/fileUtils.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import {
  StandardFileSystemService,
  type FileSystemService,
} from './fileSystemService.js';

export interface WorkspacePathOperations {
  resolve(filePath: string): string;
  directories(): readonly string[];
  contains(filePath: string): boolean;
  validate(filePath: string, label?: string): string | null;
}

export interface WorkspaceIgnoreOperations {
  getCoreIgnorePatterns(): string[];
  getGlobExcludes(additionalExcludes?: string[]): string[];
  getReadManyFilesExcludes(additionalExcludes?: string[]): string[];
  buildExcludePatterns(options: ExcludeOptions): string[];
  shouldIgnoreFile(filePath: string, options?: FilterFilesOptions): boolean;
  shouldGitIgnoreFile(filePath: string): boolean;
  shouldLlxprtIgnoreFile(filePath: string): boolean;
  filterFiles(filePaths: string[], options?: FilterFilesOptions): string[];
  filterFilesWithReport(
    filePaths: string[],
    options?: FilterFilesOptions,
  ): FilterReport;
  getLlxprtIgnorePatterns(directory?: string): string[];
}

export interface WorkspaceSearchOptions
  extends SearchOptions,
    FilterFilesOptions {
  enableRecursiveFileSearch?: boolean;
  enableFuzzySearch?: boolean;
  ignorePatterns?: string[];
  ignoreDirs?: string[];
  maxFiles?: number;
  maxDepth?: number;
}

export interface WorkspaceScanOperations {
  run<T>(
    directories: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T>;
}

export interface WorkspaceSearchOperations {
  initializeSearch(
    directory: string,
    options?: WorkspaceSearchOptions,
  ): Promise<void>;
  search(
    directory: string,
    pattern: string,
    options?: WorkspaceSearchOptions,
  ): Promise<string[]>;
}

export interface WorkspaceTextOperations {
  readTextFile(filePath: string): Promise<string>;
  writeTextFile(filePath: string, content: string): Promise<void>;
}

export type WorkspaceFileSystemAdoption =
  | { readonly service: FileSystemService; readonly ownership: 'caller' }
  | {
      readonly service: FileSystemService;
      readonly ownership: 'workspace';
      readonly release?: () => Promise<void>;
    };

export interface WorkspaceFilesystemInputs {
  readonly customExcludes?: readonly string[];
  readonly targetDir: string;
  readonly includeDirectories?: readonly string[];
  readonly isTrusted: () => boolean;
  readonly fileSystem?: WorkspaceFileSystemAdoption;
}

class WorkspaceTextFilesystem extends StandardFileSystemService {
  override readTextFile(filePath: string): Promise<string> {
    return readFileWithEncoding(filePath);
  }
}

export class WorkspaceFilesystemOwner {
  private readonly context: WorkspaceContext;
  private readonly exclusions: FileExclusions;
  private readonly targetDir: string;
  private readonly isTrusted: () => boolean;
  private readonly primaryRoot: string;
  private fileSystem: WorkspaceFileSystemAdoption;
  private resources: ReadonlyMap<string, ReadonlyMap<symbol, () => boolean>> =
    new Map();
  private declaredDirectories: ReadonlySet<string>;
  private readonly accepted = new Set<Promise<unknown>>();
  private listeners: ReadonlySet<() => void> = new Set();
  private closed = false;
  private fileAdmissionClosed = false;
  private replacing: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  readonly paths: WorkspacePathOperations;
  readonly files: WorkspaceTextOperations;
  readonly ignore: WorkspaceIgnoreOperations;
  readonly search: WorkspaceSearchOperations;
  readonly scans: WorkspaceScanOperations;
  private readonly discovery = new Map<string, FileDiscoveryService>();

  constructor(inputs: WorkspaceFilesystemInputs) {
    this.exclusions = new FileExclusions(
      Object.freeze([...(inputs.customExcludes ?? [])]),
    );
    this.targetDir = path.resolve(inputs.targetDir);
    this.isTrusted = inputs.isTrusted;
    this.context = new WorkspaceContext(
      inputs.targetDir,
      [...(inputs.includeDirectories ?? [])].map((directory) =>
        path.resolve(inputs.targetDir, directory),
      ),
    );
    const directories = this.context.getDirectories();
    if (directories.length === 0) {
      throw new Error(
        `Workspace root is not a readable directory: ${inputs.targetDir}`,
      );
    }
    this.declaredDirectories = new Set(directories);
    this.primaryRoot = this.context.resolvePath(inputs.targetDir);
    if (directories[0] !== this.primaryRoot) {
      throw new Error(
        `Workspace root is not a readable directory: ${inputs.targetDir}`,
      );
    }
    this.fileSystem = inputs.fileSystem
      ? { ...inputs.fileSystem }
      : { service: new WorkspaceTextFilesystem(), ownership: 'workspace' };
    this.ignore = this.createIgnoreOperations();
    this.scans = {
      run: (directories, operation) => this.runScan(directories, operation),
    };
    this.search = {
      initializeSearch: (directory, options = {}) =>
        this.initializeSearch(directory, options),
      search: (directory, pattern, options = {}) =>
        this.searchFiles(directory, pattern, options),
    };
    this.paths = {
      resolve: (filePath) => this.context.resolvePath(filePath),
      directories: () => this.directories(),
      contains: (filePath) => this.contains(filePath),
      validate: (filePath, label = 'File path') =>
        this.contains(filePath)
          ? null
          : `${label} must be within one of the workspace directories: ${this.directories().join(', ')}`,
    };
    this.files = {
      readTextFile: (filePath) =>
        this.admit(filePath, (service) => service.readTextFile(filePath)),
      writeTextFile: (filePath, content) =>
        this.admit(filePath, (service) =>
          service.writeTextFile(filePath, content),
        ),
    };
  }

  private createIgnoreOperations(): WorkspaceIgnoreOperations {
    const decide = (
      filePath: string,
      options?: FilterFilesOptions,
    ): boolean => {
      this.assertActive();
      return this.discoveryFor(filePath).shouldIgnoreFile(filePath, options);
    };
    return {
      getCoreIgnorePatterns: () => {
        this.assertActive();
        return this.exclusions.getCoreIgnorePatterns();
      },
      getGlobExcludes: (additional) => {
        this.assertActive();
        return this.exclusions.getGlobExcludes(additional);
      },
      getReadManyFilesExcludes: (additional) => {
        this.assertActive();
        return this.exclusions.getReadManyFilesExcludes(additional);
      },
      buildExcludePatterns: (options) => {
        this.assertActive();
        return this.exclusions.buildExcludePatterns(options);
      },
      shouldIgnoreFile: decide,
      shouldGitIgnoreFile: (filePath) =>
        decide(filePath, {
          respectGitIgnore: true,
          respectLlxprtIgnore: false,
        }),
      shouldLlxprtIgnoreFile: (filePath) =>
        decide(filePath, {
          respectGitIgnore: false,
          respectLlxprtIgnore: true,
        }),
      filterFiles: (filePaths, options) =>
        filePaths.filter((filePath) => !decide(filePath, options)),
      filterFilesWithReport: (filePaths, options) => {
        const filteredPaths = this.ignore.filterFiles(filePaths, options);
        return {
          filteredPaths,
          ignoredCount: filePaths.length - filteredPaths.length,
        };
      },
      getLlxprtIgnorePatterns: (directory = this.primaryRoot) => {
        this.assertActive();
        return this.discoveryFor(directory).getLlxprtIgnorePatterns();
      },
    };
  }

  private async initializeSearch(
    directory: string,
    options: WorkspaceSearchOptions,
  ): Promise<void> {
    this.assertActive();
    const engine = this.createSearchEngine(directory, options);
    await this.scans.run([directory], () => engine.initialize());
  }

  private discoveryFor(filePath: string): FileDiscoveryService {
    const absolute = this.context.resolvePath(
      path.resolve(this.targetDir, filePath),
    );
    const root =
      [...this.context.getDirectories()]
        .sort((a, b) => b.length - a.length)
        .find((directory) => {
          const relative = path.relative(directory, absolute);
          return (
            relative === '' ||
            (!relative.startsWith(`..${path.sep}`) &&
              relative !== '..' &&
              !path.isAbsolute(relative))
          );
        }) ?? this.primaryRoot;
    let service = this.discovery.get(root);
    if (!service) {
      service = new FileDiscoveryService(root);
      this.discovery.set(root, service);
    }
    return service;
  }

  private runScan<T>(
    directories: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      this.assertActive();
      if (!directories.every((directory) => this.authorized(directory)))
        throw new Error('Scan directory must be within the live workspace');
      const accepted = Promise.resolve()
        .then(operation)
        .then((result) => {
          if (!directories.every((directory) => this.authorized(directory)))
            throw new Error(
              'Scan directory is no longer within the live workspace',
            );
          return result;
        });
      this.accepted.add(accepted);
      void accepted.then(
        () => this.accepted.delete(accepted),
        () => this.accepted.delete(accepted),
      );
      return accepted;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private createSearchEngine(
    directory: string,
    options: WorkspaceSearchOptions,
  ): FileSearch {
    return FileSearchFactory.create({
      projectRoot: directory,
      ignoreDirs: options.ignoreDirs ?? ['.git'],
      maxFiles: options.maxFiles,
      maxDepth: options.maxDepth,
      useGitignore: false,
      useExtensionIgnore: false,
      cache: false,
      cacheTtl: 0,
      enableRecursiveFileSearch: options.enableRecursiveFileSearch ?? true,
      enableFuzzySearch: options.enableFuzzySearch ?? false,
      ignorePatterns: options.ignorePatterns,
    });
  }

  private searchFiles(
    directory: string,
    pattern: string,
    options: WorkspaceSearchOptions,
  ): Promise<string[]> {
    try {
      this.assertActive();
      if (!this.contains(directory))
        throw new Error('Search directory must be within the live workspace');
      const engine = this.createSearchEngine(directory, options);
      const accepted = (async (): Promise<string[]> => {
        await engine.initialize();
        const candidates = await engine.search(pattern, {
          signal: options.signal,
        });
        if (!this.authorized(directory))
          throw new Error(
            'Search directory is no longer within the live workspace',
          );
        return candidates
          .filter((candidate) => {
            const absolute = path.resolve(directory, candidate);
            return (
              this.authorized(absolute) &&
              !this.discoveryFor(absolute).shouldIgnoreFile(absolute, options)
            );
          })
          .slice(0, options.maxResults);
      })();
      this.accepted.add(accepted);
      void accepted.then(
        () => this.accepted.delete(accepted),
        () => this.accepted.delete(accepted),
      );
      return accepted;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private assertActive(): void {
    if (this.closed) throw new Error('Workspace filesystem is disposed');
  }

  private directories(): readonly string[] {
    this.assertActive();
    return this.liveDirectories();
  }

  private liveDirectories(): readonly string[] {
    if (!this.isTrusted()) return [this.primaryRoot];
    return this.context.getDirectories().filter((directory) => {
      const approved = this.resources.get(directory);
      return (
        this.declaredDirectories.has(directory) ||
        (approved !== undefined &&
          [...approved.values()].some((read) => read()))
      );
    });
  }

  private contains(filePath: string): boolean {
    this.assertActive();
    return this.authorized(filePath);
  }

  private authorized(filePath: string): boolean {
    return (
      this.context.isPathWithinWorkspace(filePath) &&
      this.liveDirectories().some((directory) => {
        const relative = path.relative(
          directory,
          this.context.resolvePath(filePath),
        );
        return (
          relative === '' ||
          (relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
        );
      })
    );
  }

  addDirectory(directory: string): void {
    this.assertActive();
    if (!this.isTrusted())
      throw new Error('Workspace expansion requires a trusted workspace');
    this.context.addDirectory(directory, this.targetDir);
    this.declaredDirectories = new Set([
      ...this.declaredDirectories,
      this.context.resolvePath(path.resolve(this.targetDir, directory)),
    ]);
    this.notifyDirectoriesChanged();
  }

  setDirectories(directories: readonly string[]): void {
    this.assertActive();
    if (!this.isTrusted())
      throw new Error('Workspace expansion requires a trusted workspace');
    this.context.setDirectories([
      this.primaryRoot,
      ...directories.map((directory) =>
        path.resolve(this.targetDir, directory),
      ),
    ]);
    this.declaredDirectories = new Set(this.context.getDirectories());
    for (const directory of this.resources.keys())
      this.context.addDirectory(directory);
    this.notifyDirectoriesChanged();
  }

  admitSkillDirectory(directory: string, approved: () => boolean): () => void {
    this.assertActive();
    if (!approved())
      throw new Error('Skill directory must be approved before admission');
    if (!this.isTrusted())
      throw new Error('Skill admission requires a trusted workspace');
    const resolved = this.context.resolvePath(
      path.resolve(this.targetDir, directory),
    );
    this.context.addDirectory(resolved);
    if (!this.context.getDirectories().includes(resolved))
      throw new Error('Skill resource directory is not readable');
    const token = Symbol('Skill directory admission');
    this.resources = new Map(this.resources).set(
      resolved,
      new Map(this.resources.get(resolved)).set(token, approved),
    );
    const release = (): void => {
      if (this.closed) return;
      const references = new Map(
        [...(this.resources.get(resolved) ?? [])].filter(
          ([key]) => key !== token,
        ),
      );
      this.resources = new Map(this.resources).set(resolved, references);
      if (references.size === 0) {
        this.resources = new Map(
          [...this.resources].filter(([key]) => key !== resolved),
        );
        if (!this.declaredDirectories.has(resolved))
          this.context.setDirectories(
            this.context.getDirectories().filter((entry) => entry !== resolved),
          );
      }
      this.notifyDirectoriesChanged();
    };
    try {
      this.notifyDirectoriesChanged();
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  subscribeDirectories(listener: () => void): () => void {
    this.assertActive();
    this.listeners = new Set([...this.listeners, listener]);
    return () => {
      this.listeners = new Set(
        [...this.listeners].filter((entry) => entry !== listener),
      );
    };
  }

  notifyTrustChanged(): void {
    this.assertActive();
    this.notifyDirectoriesChanged();
  }

  private notifyDirectoriesChanged(): void {
    const failures: unknown[] = [];
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Workspace directory publication failed',
      );
  }

  private admit<T>(
    filePath: string,
    operation: (service: FileSystemService) => Promise<T>,
  ): Promise<T> {
    try {
      this.assertActive();
      if (this.fileAdmissionClosed)
        throw new Error('Workspace filesystem is disposed');
      if (this.replacing)
        throw new Error('Workspace filesystem replacement is in progress');
      const error = this.paths.validate(filePath);
      if (error) throw new Error(error);
      const service = this.fileSystem.service;
      const accepted = Promise.resolve().then(() => operation(service));
      this.accepted.add(accepted);
      void accepted.then(
        () => this.accepted.delete(accepted),
        () => this.accepted.delete(accepted),
      );
      return accepted;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  replaceFileSystem(adoption: WorkspaceFileSystemAdoption): Promise<void> {
    this.assertActive();
    if (this.replacing)
      throw new Error('Workspace filesystem replacement is in progress');
    const previous = this.fileSystem;
    const replacement = { ...adoption };
    const replacing = Promise.allSettled([...this.accepted]).then(async () => {
      this.assertActive();
      if (previous.service !== replacement.service)
        await this.release(previous);
      this.fileSystem = replacement;
    });
    this.replacing = replacing;
    void replacing.then(
      () => {
        this.replacing = undefined;
      },
      () => {
        this.replacing = undefined;
      },
    );
    return replacing;
  }

  private async release(adoption: WorkspaceFileSystemAdoption): Promise<void> {
    if (adoption.ownership === 'workspace') await adoption.release?.();
  }

  closeFileAdmission(): void {
    this.fileAdmissionClosed = true;
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.listeners = new Set();
    this.closing = this.performDisposal();
    return this.closing;
  }
  private async performDisposal(): Promise<void> {
    const failures: unknown[] = [];
    const joined = await Promise.allSettled([
      ...this.accepted,
      ...(this.replacing ? [this.replacing] : []),
    ]);
    for (const result of joined)
      if (result.status === 'rejected') failures.push(result.reason);
    try {
      await this.release(this.fileSystem);
    } catch (error) {
      failures.push(error);
    }
    this.resources = new Map();
    this.discovery.clear();
    if (failures.length > 0)
      throw new AggregateError(
        [...new Set(failures)],
        'Workspace filesystem cleanup failed',
      );
  }
}
