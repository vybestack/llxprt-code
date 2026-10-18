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

export class WorkspaceControl implements AgentWorkspaceControl {
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly acceptedWork = new Set<Promise<void>>();
  readonly checkpoints: WorkspaceCheckpointOperations = {
    getCurrentCommitHash: () =>
      this.admitWork(() => this.checkpointOperations.getCurrentCommitHash()),
    createFileSnapshot: (message) =>
      this.admitWork(() =>
        this.checkpointOperations.createFileSnapshot(message),
      ),
    restoreProjectFromSnapshot: (hash) =>
      this.admitWork(() =>
        this.checkpointOperations.restoreProjectFromSnapshot(hash),
      ),
  };

  readonly profileDefinitions: ProfileDefinitionReads;
  readonly profileWrites: ProfileDefinitionWrites;
  readonly subagentDefinitions: SubagentDefinitionReads;
  readonly subagentWrites: SubagentDefinitionWrites;

  constructor(
    private readonly profileReads: ProfileDefinitionReads,
    private readonly writeProfiles: ProfileDefinitionWrites,
    private readonly subagentReads: SubagentDefinitionReads,
    private readonly writeSubagents: SubagentDefinitionWrites,
    private readonly checkpointOperations: WorkspaceCheckpointOperations,
    private readonly ignore: WorkspaceIgnoreOperations,
    private readonly searchOperations: WorkspaceSearchOperations,
    private readonly files: WorkspaceTextOperations,
    private readonly includesPath: (filePath: string) => boolean,
    private readonly directories: () => readonly string[],
    private readonly addWorkspaceDirectory: (path: string) => void,
    private readonly workingDirectory: string,
    private readonly projectRoot: string,
  ) {
    this.profileDefinitions = {
      loadProfile: (name) =>
        this.admitWork(() => this.profileReads.loadProfile(name)),
      listProfiles: () =>
        this.admitWork(() => this.profileReads.listProfiles()),
      profileExists: (name) =>
        this.admitWork(() => this.profileReads.profileExists(name)),
    };
    this.profileWrites = {
      saveProfile: (name, profile) =>
        this.admitWork(() => this.writeProfiles.saveProfile(name, profile)),
      deleteProfile: (name) =>
        this.admitWork(() => this.writeProfiles.deleteProfile(name)),
    };
    this.subagentDefinitions = {
      loadSubagent: (name) =>
        this.admitWork(() => this.subagentReads.loadSubagent(name)),
      listSubagents: () =>
        this.admitWork(() => this.subagentReads.listSubagents()),
      subagentExists: (name) =>
        this.admitWork(() => this.subagentReads.subagentExists(name)),
      subagentExistsOnDisk: (name) =>
        this.admitWork(() => this.subagentReads.subagentExistsOnDisk(name)),
      validateProfileReference: (name) =>
        this.admitWork(() => this.subagentReads.validateProfileReference(name)),
      isSettingsSubagent: (name) => {
        this.assertOpen();
        return this.subagentReads.isSettingsSubagent(name);
      },
      hasSettingsSubagent: (name) => {
        this.assertOpen();
        return this.subagentReads.hasSettingsSubagent(name);
      },
    };
    this.subagentWrites = {
      saveSubagent: (name, profile, prompt) =>
        this.admitWork(() =>
          this.writeSubagents.saveSubagent(name, profile, prompt),
        ),
      deleteSubagent: (name) =>
        this.admitWork(() => this.writeSubagents.deleteSubagent(name)),
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
    return this.ignore.getCoreIgnorePatterns();
  }
  getGlobExcludes(additionalExcludes?: string[]): string[] {
    return this.ignore.getGlobExcludes(additionalExcludes);
  }
  getReadManyFilesExcludes(additionalExcludes?: string[]): string[] {
    return this.ignore.getReadManyFilesExcludes(additionalExcludes);
  }
  buildExcludePatterns(
    options: Parameters<WorkspaceIgnoreOperations['buildExcludePatterns']>[0],
  ): string[] {
    return this.ignore.buildExcludePatterns(options);
  }
  shouldIgnoreFile(filePath: string, options?: FilterFilesOptions): boolean {
    return this.ignore.shouldIgnoreFile(filePath, options);
  }
  shouldGitIgnoreFile(filePath: string): boolean {
    return this.ignore.shouldGitIgnoreFile(filePath);
  }
  shouldLlxprtIgnoreFile(filePath: string): boolean {
    return this.ignore.shouldLlxprtIgnoreFile(filePath);
  }
  filterFiles(filePaths: string[], options?: FilterFilesOptions): string[] {
    return this.ignore.filterFiles(filePaths, options);
  }
  filterFilesWithReport(
    filePaths: string[],
    options?: FilterFilesOptions,
  ): FilterReport {
    return this.ignore.filterFilesWithReport(filePaths, options);
  }
  getLlxprtIgnorePatterns(directory?: string): string[] {
    return this.ignore.getLlxprtIgnorePatterns(directory);
  }
  initializeSearch(
    directory: string,
    options?: WorkspaceSearchOptions,
  ): Promise<void> {
    return this.admitWork(() =>
      this.searchOperations.initializeSearch(directory, options),
    );
  }

  search(
    directory: string,
    pattern: string,
    options?: WorkspaceSearchOptions,
  ): Promise<string[]> {
    return this.admitWork(() =>
      this.searchOperations.search(directory, pattern, options),
    );
  }

  async readTextFile(filePath: string): Promise<string> {
    return this.admitWork(() => this.files.readTextFile(filePath));
  }

  async writeTextFile(filePath: string, content: string): Promise<void> {
    return this.admitWork(() => this.files.writeTextFile(filePath, content));
  }

  containsPath(filePath: string): boolean {
    return this.includesPath(filePath);
  }

  getDirectories(): readonly string[] {
    return this.directories();
  }

  addDirectory(path: string): void {
    this.assertOpen();
    this.addWorkspaceDirectory(path);
  }

  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }
}
