/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  InstructionReadOperations,
  InstructionSnapshot,
  WorkspaceMemoryOperations,
} from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { AgentMemoryControl } from '../api/agent.js';

export class SessionInstructionOwner {
  readonly reads: InstructionReadOperations;
  readonly memory: AgentMemoryControl;
  private userOverride: string | undefined;
  private editRevision = 0;
  private refreshTail: Promise<void> = Promise.resolve();
  private coreOverride: string | undefined;
  private readonly listeners = new Set<
    Parameters<AgentMemoryControl['onMemoryChanged']>[0]
  >();
  private readonly publications = new Set<Promise<unknown>>();
  private closed = false;
  private disposed = false;
  private closing: Promise<void> | undefined;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly workspace: WorkspaceMemoryOperations,
    private readonly providedInstructions: string,
    private readonly jitEnabled: boolean,
    private readonly publishInstructions: (
      instructions: InstructionReadOperations,
    ) => Promise<void>,
  ) {
    this.reads = {
      snapshot: () => {
        if (this.disposed) throw new Error('Instructions are disposed');
        return this.snapshot();
      },
      jit: (targetPath) => {
        this.assertActive();
        return this.track(workspace.jit(targetPath));
      },
    };
    this.memory = {
      getMemory: () => this.reads.snapshot().memoryContent,
      getCoreMemory: () => this.reads.snapshot().coreMemory,
      getFileCount: () => this.reads.snapshot().fileCount,
      getCoreFileCount: () => this.reads.snapshot().coreMemoryFileCount,
      getFilePaths: () => this.reads.snapshot().filePaths,
      setMemory: (content) => this.setUserMemory(content),
      setCoreMemory: (content) => this.setCoreMemory(content),
      refresh: () => this.refresh(),
      onMemoryChanged: (listener) => {
        this.assertActive();
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
    };
    this.unsubscribe = workspace.subscribe((instructions) =>
      this.publish(instructions),
    );
  }

  private assertActive(): void {
    if (this.closed) throw new Error('Session instructions are disposed');
  }

  private snapshot(
    workspace: InstructionReadOperations = this.workspace,
  ): InstructionSnapshot {
    const snapshot = workspace.snapshot();
    const fileMemory = snapshot.memoryContent;
    const memoryContent =
      this.userOverride ??
      [this.providedInstructions, fileMemory].filter(Boolean).join('\n\n');
    return {
      ...snapshot,
      globalMemory:
        this.userOverride ??
        (this.jitEnabled
          ? [this.providedInstructions, snapshot.globalMemory]
              .filter(Boolean)
              .join('\n\n')
          : memoryContent),
      environmentMemory:
        this.jitEnabled && this.userOverride === undefined
          ? snapshot.environmentMemory
          : '',
      coreMemory: this.coreOverride ?? snapshot.coreMemory,
      memoryContent,
    };
  }

  private notify(): void {
    const snapshot = this.snapshot();
    const failures: unknown[] = [];
    for (const listener of this.listeners) {
      try {
        listener({
          fileCount: snapshot.fileCount,
          coreMemoryFileCount: snapshot.coreMemoryFileCount,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Session memory publication failed');
  }

  private publish(workspace: InstructionReadOperations): Promise<void> {
    const instructions: InstructionReadOperations = {
      snapshot: () => this.snapshot(workspace),
      jit: (targetPath) => workspace.jit(targetPath),
    };
    const operation = Promise.resolve()
      .then(() => this.notify())
      .then(() => this.publishInstructions(instructions));
    return this.track(operation);
  }

  private setUserMemory(content: string): void {
    this.assertActive();
    const previous = this.userOverride;
    this.editRevision += 1;
    this.userOverride = content;
    try {
      this.notify();
    } catch (error) {
      this.userOverride = previous;
      throw error;
    }
  }

  private setCoreMemory(content: string): void {
    this.assertActive();
    const previous = this.coreOverride;
    this.coreOverride = content;
    try {
      this.notify();
    } catch (error) {
      this.coreOverride = previous;
      throw error;
    }
  }

  private refresh(): ReturnType<AgentMemoryControl['refresh']> {
    this.assertActive();
    const operation = this.refreshTail.then(async () => {
      const previous = this.userOverride;
      const revision = this.editRevision;
      this.userOverride = undefined;
      try {
        await this.workspace.refresh();
      } catch (error) {
        if (revision === this.editRevision) this.userOverride = previous;
        throw error;
      }
      const snapshot = this.snapshot();
      return {
        memoryContent: snapshot.memoryContent,
        fileCount: snapshot.fileCount,
        filePaths: [...snapshot.filePaths],
      };
    });
    this.refreshTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return this.track(operation);
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.publications.add(operation);
    void operation.then(
      () => this.publications.delete(operation),
      () => this.publications.delete(operation),
    );
    return operation;
  }

  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    this.closing = this.refreshTail.then(async () => {
      this.unsubscribe();
      const results = await Promise.allSettled([...this.publications]);
      this.listeners.clear();
      this.disposed = true;
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Session instruction cleanup failed',
        );
    });
    return this.closing;
  }
}
