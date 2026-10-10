/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ProfileDefinitionReads,
  ProfileDefinitionWrites,
  SubagentDefinitionReads,
  SubagentDefinitionWrites,
  WorkspaceCheckpointOperations,
} from '@vybestack/llxprt-code-core';
/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P04
 *
 * AgentWorkspaceControl implementation. Delegates to the bound Config's
 * WorkspaceContext so clients access workspace directories without a Config
 * escape hatch.
 */

import type {
  WorkspaceIgnoreOperations,
  WorkspaceSearchOperations,
  WorkspaceSearchOptions,
} from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type {
  FilterFilesOptions,
  FilterReport,
} from '@vybestack/llxprt-code-core';
import type { AgentWorkspaceControl } from '../agent.js';

/**
 * Deps bundle injected by AgentImpl so WorkspaceControl can read/write the
 * live Config workspace surface.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P04
 */
export interface WorkspaceControlDeps {
  readonly profileDefinitions: ProfileDefinitionReads;
  readonly profileWrites: ProfileDefinitionWrites;
  readonly subagentDefinitions: SubagentDefinitionReads;
  readonly subagentWrites: SubagentDefinitionWrites;
  readonly checkpoints: WorkspaceCheckpointOperations;
  readonly ignore: WorkspaceIgnoreOperations;
  readonly search: WorkspaceSearchOperations;
  readonly containsPath: (filePath: string) => boolean;
  readonly directories: () => readonly string[];
  readonly addDirectory: (path: string) => void;
  readonly workingDirectory: string;
  readonly projectRoot: string;
}

export class WorkspaceControl implements AgentWorkspaceControl {
  private closed = false;
  private readonly checkpointWork = new Set<Promise<void>>();
  readonly checkpoints: WorkspaceCheckpointOperations = {
    getCurrentCommitHash: () =>
      this.admitCheckpoint(() => this.deps.checkpoints.getCurrentCommitHash()),
    createFileSnapshot: (message) =>
      this.admitCheckpoint(() =>
        this.deps.checkpoints.createFileSnapshot(message),
      ),
    restoreProjectFromSnapshot: (hash) =>
      this.admitCheckpoint(() =>
        this.deps.checkpoints.restoreProjectFromSnapshot(hash),
      ),
  };

  readonly profileDefinitions: ProfileDefinitionReads;
  readonly profileWrites: ProfileDefinitionWrites;
  readonly subagentDefinitions: SubagentDefinitionReads;
  readonly subagentWrites: SubagentDefinitionWrites;

  constructor(private readonly deps: WorkspaceControlDeps) {
    this.profileDefinitions = {
      loadProfile: (name) =>
        this.admitCheckpoint(() => deps.profileDefinitions.loadProfile(name)),
      listProfiles: () =>
        this.admitCheckpoint(() => deps.profileDefinitions.listProfiles()),
      profileExists: (name) =>
        this.admitCheckpoint(() => deps.profileDefinitions.profileExists(name)),
    };
    this.profileWrites = {
      saveProfile: (name, profile) =>
        this.admitCheckpoint(() =>
          deps.profileWrites.saveProfile(name, profile),
        ),
      deleteProfile: (name) =>
        this.admitCheckpoint(() => deps.profileWrites.deleteProfile(name)),
    };
    this.subagentDefinitions = {
      loadSubagent: (name) =>
        this.admitCheckpoint(() => deps.subagentDefinitions.loadSubagent(name)),
      listSubagents: () =>
        this.admitCheckpoint(() => deps.subagentDefinitions.listSubagents()),
      subagentExists: (name) =>
        this.admitCheckpoint(() =>
          deps.subagentDefinitions.subagentExists(name),
        ),
      subagentExistsOnDisk: (name) =>
        this.admitCheckpoint(() =>
          deps.subagentDefinitions.subagentExistsOnDisk(name),
        ),
      validateProfileReference: (name) =>
        this.admitCheckpoint(() =>
          deps.subagentDefinitions.validateProfileReference(name),
        ),
      isSettingsSubagent: (name) => {
        this.assertOpen();
        return deps.subagentDefinitions.isSettingsSubagent(name);
      },
      hasSettingsSubagent: (name) => {
        this.assertOpen();
        return deps.subagentDefinitions.hasSettingsSubagent(name);
      },
    };
    this.subagentWrites = {
      saveSubagent: (name, profile, prompt) =>
        this.admitCheckpoint(() =>
          deps.subagentWrites.saveSubagent(name, profile, prompt),
        ),
      deleteSubagent: (name) =>
        this.admitCheckpoint(() => deps.subagentWrites.deleteSubagent(name)),
    };
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Workspace definition facade is closed');
  }

  private admitCheckpoint<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('Workspace checkpoint facade is closed');
    const accepted = operation();
    const joined = accepted.then(() => undefined);
    this.checkpointWork.add(joined);
    void joined.then(
      () => this.checkpointWork.delete(joined),
      () => this.checkpointWork.delete(joined),
    );
    return accepted;
  }

  closeAdmission(): void {
    this.closed = true;
  }

  async dispose(): Promise<void> {
    this.closeAdmission();
    const results = await Promise.allSettled([...this.checkpointWork]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Workspace checkpoint facade cleanup failed',
      );
  }

  getCoreIgnorePatterns(): string[] {
    return this.deps.ignore.getCoreIgnorePatterns();
  }
  getGlobExcludes(additionalExcludes?: string[]): string[] {
    return this.deps.ignore.getGlobExcludes(additionalExcludes);
  }
  getReadManyFilesExcludes(additionalExcludes?: string[]): string[] {
    return this.deps.ignore.getReadManyFilesExcludes(additionalExcludes);
  }
  buildExcludePatterns(
    options: Parameters<WorkspaceIgnoreOperations['buildExcludePatterns']>[0],
  ): string[] {
    return this.deps.ignore.buildExcludePatterns(options);
  }
  shouldIgnoreFile(filePath: string, options?: FilterFilesOptions): boolean {
    return this.deps.ignore.shouldIgnoreFile(filePath, options);
  }
  shouldGitIgnoreFile(filePath: string): boolean {
    return this.deps.ignore.shouldGitIgnoreFile(filePath);
  }
  shouldLlxprtIgnoreFile(filePath: string): boolean {
    return this.deps.ignore.shouldLlxprtIgnoreFile(filePath);
  }
  filterFiles(filePaths: string[], options?: FilterFilesOptions): string[] {
    return this.deps.ignore.filterFiles(filePaths, options);
  }
  filterFilesWithReport(
    filePaths: string[],
    options?: FilterFilesOptions,
  ): FilterReport {
    return this.deps.ignore.filterFilesWithReport(filePaths, options);
  }
  getLlxprtIgnorePatterns(directory?: string): string[] {
    return this.deps.ignore.getLlxprtIgnorePatterns(directory);
  }
  initializeSearch(
    directory: string,
    options?: WorkspaceSearchOptions,
  ): Promise<void> {
    return this.deps.search.initializeSearch(directory, options);
  }

  search(
    directory: string,
    pattern: string,
    options?: WorkspaceSearchOptions,
  ): Promise<string[]> {
    return this.deps.search.search(directory, pattern, options);
  }

  containsPath(filePath: string): boolean {
    return this.deps.containsPath(filePath);
  }

  getDirectories(): readonly string[] {
    return this.deps.directories();
  }

  addDirectory(path: string): void {
    this.deps.addDirectory(path);
  }

  getWorkingDirectory(): string {
    return this.deps.workingDirectory;
  }

  getProjectRoot(): string {
    return this.deps.projectRoot;
  }
}
