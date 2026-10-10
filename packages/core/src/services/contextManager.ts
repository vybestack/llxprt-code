/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import type {
  LlxprtExtension,
  FileFilteringOptions,
} from '../config/configTypes.js';
import type {
  WorkspacePathOperations,
  WorkspaceIgnoreOperations,
  WorkspaceScanOperations,
} from './workspace-filesystem-owner.js';
import {
  loadGlobalMemory,
  loadEnvironmentMemory,
  loadCoreMemory,
  loadHierarchicalMemoryFiles,
  loadJitSubdirectoryMemory,
  concatenateInstructions,
} from '../utils/memoryDiscovery.js';

export interface InstructionSnapshot {
  readonly globalMemory: string;
  readonly environmentMemory: string;
  readonly coreMemory: string;
  readonly memoryContent: string;
  readonly filePaths: readonly string[];
  readonly fileCount: number;
  readonly coreMemoryFileCount: number;
}

export interface InstructionReadOperations {
  snapshot(): InstructionSnapshot;
  jit(targetPath: string): Promise<string>;
}

export interface WorkspaceMemoryOperations extends InstructionReadOperations {
  snapshot(): InstructionSnapshot;
  refresh(): Promise<InstructionSnapshot>;
  jit(targetPath: string): Promise<string>;
  subscribe(
    listener: (instructions: InstructionReadOperations) => void | Promise<void>,
  ): () => void;
}

export interface WorkspaceMemoryInputs {
  readonly globalMemoryDir: string;
  readonly workingDirectory: string;
  readonly jitEnabled: boolean;
  readonly debugMode: boolean;
  readonly loadIncludes: boolean;
  readonly filtering: FileFilteringOptions;
  readonly maxDirectories: number;
  readonly maxDepth?: number;
  readonly filenames?: readonly string[];
  readonly importFormat: 'tree' | 'flat';
  readonly paths: WorkspacePathOperations;
  readonly ignore: Pick<WorkspaceIgnoreOperations, 'shouldIgnoreFile'>;
  readonly scans: WorkspaceScanOperations;
  readonly isTrusted: () => boolean;
  readonly extensions: () => LlxprtExtension[];
}

type MemoryFile = { readonly path: string; readonly content: string };
type ScopedFile = MemoryFile & {
  readonly scope: 'global' | 'environment' | 'core';
  readonly directory?: string;
  readonly extension?: string;
};

function within(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export class ContextManager {
  readonly operations: WorkspaceMemoryOperations;
  private files: readonly ScopedFile[] = [];
  private listeners: ReadonlySet<
    (instructions: InstructionReadOperations) => void | Promise<void>
  > = new Set();
  private tail: Promise<void> = Promise.resolve();
  private readonly accepted = new Set<Promise<unknown>>();
  private closed = false;
  private disposed = false;
  private closing: Promise<void> | undefined;

  constructor(private readonly inputs: WorkspaceMemoryInputs) {
    this.operations = {
      snapshot: () => {
        if (this.disposed) throw new Error('Instructions are disposed');
        return this.snapshot();
      },
      refresh: () => this.refresh(),
      jit: (targetPath) => this.jit(targetPath),
      subscribe: (listener) => {
        this.assertActive();
        this.listeners = new Set([...this.listeners, listener]);
        return () => {
          this.listeners = new Set(
            [...this.listeners].filter((entry) => entry !== listener),
          );
        };
      },
    };
  }

  private assertActive(): void {
    if (this.closed) throw new Error('Workspace memory is disposed');
  }

  private authorized(file: ScopedFile): boolean {
    if (file.extension !== undefined)
      return (
        this.inputs.isTrusted() &&
        this.inputs
          .extensions()
          .some(
            (extension) =>
              extension.name === file.extension &&
              extension.isActive &&
              extension.contextFiles.includes(file.path),
          )
      );
    return (
      file.directory === undefined ||
      (this.inputs.paths.directories().includes(file.directory) &&
        this.inputs.paths.contains(file.path) &&
        !this.inputs.ignore.shouldIgnoreFile(file.path, this.inputs.filtering))
    );
  }

  private snapshot(): InstructionSnapshot {
    const files = this.files.filter((file) => this.authorized(file));
    const render = (scope: ScopedFile['scope']): string =>
      concatenateInstructions(
        files
          .filter((file) => file.scope === scope)
          .map((file) => ({ filePath: file.path, content: file.content })),
        this.inputs.workingDirectory,
      );
    const globalMemory = render('global');
    const environmentMemory = render('environment');
    const coreMemory = render('core');
    const paths = [...new Set(files.map((file) => file.path))];
    const corePaths = new Set(
      files.filter((file) => file.scope === 'core').map((file) => file.path),
    );
    return {
      globalMemory,
      environmentMemory,
      coreMemory,
      memoryContent: [globalMemory, environmentMemory]
        .filter(Boolean)
        .join('\n\n'),
      filePaths: paths,
      fileCount: paths.filter((file) => !corePaths.has(file)).length,
      coreMemoryFileCount: corePaths.size,
    };
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.accepted.add(operation);
    void operation.then(
      () => this.accepted.delete(operation),
      () => this.accepted.delete(operation),
    );
    return operation;
  }

  refresh(): Promise<InstructionSnapshot> {
    this.assertActive();
    return this.enqueueRefresh();
  }

  withReload(operation: () => Promise<void>): Promise<void> {
    this.assertActive();
    return this.track(
      Promise.resolve()
        .then(operation)
        .then(async () => {
          await this.enqueueRefresh();
        }),
    );
  }

  private enqueueRefresh(): Promise<InstructionSnapshot> {
    const operation = this.tail.then(async () => {
      const directories = this.inputs.paths.directories();
      const next = await this.inputs.scans.run(directories, () =>
        this.discover(directories),
      );
      const previous = this.files;
      this.files = next;
      try {
        await this.publish();
      } catch (error) {
        this.files = previous;
        const rollback = await Promise.allSettled(
          [...this.listeners].map((listener) => this.deliver(listener)),
        );
        const failures = rollback.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (failures.length > 0)
          throw new AggregateError(
            [error, ...failures],
            'Memory publication and rollback failed',
          );
        throw error;
      }
      return this.snapshot();
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return this.track(operation);
  }

  private async publish(): Promise<void> {
    const publications = await Promise.allSettled(
      [...this.listeners].map((listener) => this.deliver(listener)),
    );
    const failures = publications.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Memory publication failed');
  }

  private async deliver(
    listener: (reads: InstructionReadOperations) => void | Promise<void>,
  ): Promise<void> {
    let settled = false;
    const assertAdmitted = (): void => {
      if (settled) throw new Error('Instruction publication has settled');
    };
    const reads: InstructionReadOperations = {
      snapshot: () => {
        assertAdmitted();
        return this.operations.snapshot();
      },
      jit: (targetPath) => {
        assertAdmitted();
        return this.readAcceptedJit(targetPath);
      },
    };
    try {
      await listener(reads);
    } finally {
      settled = true;
    }
  }

  private scope(
    files: readonly MemoryFile[],
    scope: ScopedFile['scope'],
    directories: readonly string[],
    extensions: readonly LlxprtExtension[],
  ): ScopedFile[] {
    return files.map((file) => {
      const extension = extensions.find((entry) =>
        entry.contextFiles.includes(file.path),
      );
      const directory = [...directories]
        .sort((a, b) => b.length - a.length)
        .find((entry) => within(entry, file.path));
      return { ...file, scope, extension: extension?.name, directory };
    });
  }

  private async discover(
    directories: readonly string[],
  ): Promise<readonly ScopedFile[]> {
    const { inputs } = this;
    const extensions = inputs.isTrusted()
      ? inputs.extensions().filter((extension) => extension.isActive)
      : [];
    const roots = inputs.loadIncludes ? directories : directories.slice(0, 1);
    const core = await loadCoreMemory([...roots], inputs.debugMode);
    if (inputs.jitEnabled) {
      const global = await loadGlobalMemory(
        inputs.debugMode,
        inputs.filenames,
        inputs.globalMemoryDir,
      );
      const environment = await loadEnvironmentMemory(
        [...roots],
        { getExtensions: () => extensions },
        inputs.debugMode,
        inputs.filenames,
      );
      return [
        ...this.scope(global.files, 'global', [], []),
        ...this.scope(environment.files, 'environment', roots, extensions),
        ...this.scope(core.files, 'core', roots, []),
      ];
    }
    const files = await loadHierarchicalMemoryFiles(
      inputs.workingDirectory,
      inputs.loadIncludes ? roots : [],
      inputs.debugMode,
      inputs.ignore,
      extensions,
      inputs.isTrusted(),
      inputs.importFormat,
      inputs.filtering,
      inputs.maxDirectories,
      inputs.maxDepth,
      inputs.filenames,
    );
    return [
      ...this.scope(files, 'global', roots, extensions),
      ...this.scope(core.files, 'core', roots, []),
    ];
  }

  jit(targetPath: string): Promise<string> {
    this.assertActive();
    return this.readAcceptedJit(targetPath);
  }

  private readAcceptedJit(targetPath: string): Promise<string> {
    if (!this.inputs.jitEnabled) return Promise.resolve('');
    if (!this.inputs.paths.contains(targetPath)) return Promise.resolve('');
    const directories = this.inputs.paths.directories();
    return this.track(
      this.inputs.scans.run(directories, async () => {
        const resolvedTarget = this.inputs.paths.resolve(targetPath);
        const result = await loadJitSubdirectoryMemory(
          resolvedTarget,
          [...directories],
          new Set(this.snapshot().filePaths),
          this.inputs.debugMode,
          true,
          this.inputs.filenames,
        );
        return result.files
          .filter(
            (file) =>
              !this.inputs.ignore.shouldIgnoreFile(
                file.path,
                this.inputs.filtering,
              ),
          )
          .map((file) => {
            const content = file.content.trim();
            return content
              ? `--- JIT Context from: ${file.path} ---\n${content}\n--- End of JIT Context from: ${file.path} ---`
              : '';
          })
          .filter(Boolean)
          .join('\n\n');
      }),
    );
  }

  closeAdmission(): void {
    this.closed = true;
  }

  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closeAdmission();
    this.closing = Promise.allSettled([...this.accepted]).then((results) => {
      this.listeners = new Set();
      this.files = [];
      this.disposed = true;
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(failures, 'Workspace memory cleanup failed');
    });
    return this.closing;
  }
}
