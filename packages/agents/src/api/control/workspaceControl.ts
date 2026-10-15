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
  WorkspaceTextOperations,
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
  readonly files: WorkspaceTextOperations;
  readonly containsPath: (filePath: string) => boolean;
  readonly directories: () => readonly string[];
  readonly addDirectory: (path: string) => void;
  readonly workingDirectory: string;
  readonly projectRoot: string;
}

export class WorkspaceControl implements AgentWorkspaceControl {
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly acceptedWork = new Set<Promise<void>>();
  readonly checkpoints: WorkspaceCheckpointOperations = {
    getCurrentCommitHash: () =>
      this.admitWork(() => this.deps.checkpoints.getCurrentCommitHash()),
    createFileSnapshot: (message) =>
      this.admitWork(() => this.deps.checkpoints.createFileSnapshot(message)),
    restoreProjectFromSnapshot: (hash) =>
      this.admitWork(() =>
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
        this.admitWork(() => deps.profileDefinitions.loadProfile(name)),
      listProfiles: () =>
        this.admitWork(() => deps.profileDefinitions.listProfiles()),
      profileExists: (name) =>
        this.admitWork(() => deps.profileDefinitions.profileExists(name)),
    };
    this.profileWrites = {
      saveProfile: (name, profile) =>
        this.admitWork(() => deps.profileWrites.saveProfile(name, profile)),
      deleteProfile: (name) =>
        this.admitWork(() => deps.profileWrites.deleteProfile(name)),
    };
    this.subagentDefinitions = {
      loadSubagent: (name) =>
        this.admitWork(() => deps.subagentDefinitions.loadSubagent(name)),
      listSubagents: () =>
        this.admitWork(() => deps.subagentDefinitions.listSubagents()),
      subagentExists: (name) =>
        this.admitWork(() => deps.subagentDefinitions.subagentExists(name)),
      subagentExistsOnDisk: (name) =>
        this.admitWork(() =>
          deps.subagentDefinitions.subagentExistsOnDisk(name),
        ),
      validateProfileReference: (name) =>
        this.admitWork(() =>
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
        this.admitWork(() =>
          deps.subagentWrites.saveSubagent(name, profile, prompt),
        ),
      deleteSubagent: (name) =>
        this.admitWork(() => deps.subagentWrites.deleteSubagent(name)),
    };
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Workspace definition facade is closed');
  }

  private admitWork<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('Workspace checkpoint facade is closed');
    const accepted = operation();
    const joined = accepted.then(() => undefined);
    this.acceptedWork.add(joined);
    void joined.then(
      () => this.acceptedWork.delete(joined),
      () => this.acceptedWork.delete(joined),
    );
    return accepted;
  }

  closeAdmission(): void {
    this.closed = true;
  }

  dispose(): Promise<void> {
    this.closeAdmission();
    this.closing ??= this.joinAccepted();
    return this.closing;
  }

  private async joinAccepted(): Promise<void> {
    const results = await Promise.allSettled([...this.acceptedWork]);
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
    return this.admitWork(() =>
      this.deps.search.initializeSearch(directory, options),
    );
  }

  search(
    directory: string,
    pattern: string,
    options?: WorkspaceSearchOptions,
  ): Promise<string[]> {
    return this.admitWork(() =>
      this.deps.search.search(directory, pattern, options),
    );
  }

  async readTextFile(filePath: string): Promise<string> {
    return this.admitWork(() => this.deps.files.readTextFile(filePath));
  }

  async writeTextFile(filePath: string, content: string): Promise<void> {
    return this.admitWork(() =>
      this.deps.files.writeTextFile(filePath, content),
    );
  }

  containsPath(filePath: string): boolean {
    return this.deps.containsPath(filePath);
  }

  getDirectories(): readonly string[] {
    return this.deps.directories();
  }

  addDirectory(path: string): void {
    this.assertOpen();
    this.deps.addDirectory(path);
  }

  getWorkingDirectory(): string {
    return this.deps.workingDirectory;
  }

  getProjectRoot(): string {
    return this.deps.projectRoot;
  }
}
