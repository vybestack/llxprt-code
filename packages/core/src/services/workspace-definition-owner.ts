/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ProfileManager,
  parseProfile,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import { SubagentManager } from '../config/subagentManager.js';
import type { SubagentConfig } from '../config/types.js';

export interface ProfileDefinitionListing {
  listProfiles(): Promise<string[]>;
}

export interface ProfileDefinitionReads extends ProfileDefinitionListing {
  loadProfile(name: string): Promise<Profile>;
  profileExists(name: string): Promise<boolean>;
}

export interface ProfileDefinitionWrites {
  saveProfile(name: string, profile: unknown): Promise<void>;
  deleteProfile(name: string): Promise<void>;
}

export interface SubagentDefinitionReads {
  loadSubagent(
    name: string,
    includeExtensions?: boolean,
  ): Promise<SubagentConfig>;
  listSubagents(includeExtensions?: boolean): Promise<string[]>;
  subagentExists(name: string, includeExtensions?: boolean): Promise<boolean>;
  subagentExistsOnDisk(name: string): Promise<boolean>;
  isSettingsSubagent(name: string): boolean;
  hasSettingsSubagent(name: string): boolean;
  validateProfileReference(name: string): Promise<boolean>;
}

export interface SubagentDefinitionWrites {
  saveSubagent(
    name: string,
    profile: string,
    systemPrompt: string,
  ): Promise<void>;
  deleteSubagent(name: string): Promise<boolean>;
}

function freezeDefinition<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freezeDefinition(child);
    Object.freeze(value);
  }
  return value;
}

export interface ExtensionDefinitionContribution {
  readonly name: string;
  readonly subagents: ReadonlyArray<{
    readonly name: string;
    readonly profile: string;
    readonly systemPrompt: string;
  }>;
}

export class WorkspaceDefinitionOwner {
  private readonly profiles: ProfileManager;
  private readonly subagents: SubagentManager;
  private closed = false;
  private readonly pending = new Set<Promise<unknown>>();
  private disposal: Promise<void> | undefined;
  private extensionTail: Promise<unknown> = Promise.resolve();

  readonly profileReads: ProfileDefinitionReads = Object.freeze({
    loadProfile: (name: string) =>
      this.admit(async () =>
        freezeDefinition(await this.profiles.loadProfile(name)),
      ),
    listProfiles: () => this.admit(() => this.profiles.listProfiles()),
    profileExists: (name: string) =>
      this.admit(() => this.profiles.profileExists(name)),
  });

  readonly profileWrites: ProfileDefinitionWrites = Object.freeze({
    saveProfile: (name: string, profile: unknown) =>
      this.admit(async () => {
        const captured = structuredClone(profile);
        const isLoadBalancer =
          typeof captured === 'object' &&
          captured !== null &&
          'type' in captured &&
          captured.type === 'loadbalancer';
        const validated = isLoadBalancer
          ? await this.profiles.validateLoadBalancerProfile(name, captured)
          : parseProfile(captured);
        await this.profiles.saveProfile(name, validated);
      }),
    deleteProfile: (name: string) =>
      this.admit(() => this.profiles.deleteProfile(name)),
  });

  readonly subagentReads: SubagentDefinitionReads = Object.freeze({
    loadSubagent: (name: string, includeExtensions = true) =>
      this.admit(async () => {
        const definition = await this.subagents.loadSubagent(name);
        if (!includeExtensions && definition.source === 'extension')
          throw new Error(`Subagent '${name}' not found.`);
        return freezeDefinition(structuredClone(definition));
      }),
    listSubagents: (includeExtensions = true) =>
      this.admit(() => this.listSubagents(includeExtensions)),
    subagentExists: (name: string, includeExtensions = true) =>
      this.admit(async () =>
        includeExtensions
          ? this.subagents.subagentExists(name)
          : this.subagents.hasSettingsSubagent(name) ||
            (await this.subagents.subagentExistsOnDisk(name)),
      ),
    subagentExistsOnDisk: (name: string) =>
      this.admit(() => this.subagents.subagentExistsOnDisk(name)),
    validateProfileReference: (name: string) =>
      this.admit(() => this.subagents.validateProfileReference(name)),
    isSettingsSubagent: (name: string) => {
      this.assertOpen();
      return this.subagents.isSettingsSubagent(name);
    },
    hasSettingsSubagent: (name: string) => {
      this.assertOpen();
      return this.subagents.hasSettingsSubagent(name);
    },
  });

  readonly subagentWrites: SubagentDefinitionWrites = Object.freeze({
    saveSubagent: (name: string, profile: string, systemPrompt: string) =>
      this.admit(() =>
        this.subagents.saveSubagent(name, profile, systemPrompt),
      ),
    deleteSubagent: (name: string) =>
      this.admit(() => this.subagents.deleteSubagent(name)),
  });

  constructor(
    private readonly profileDirectory: string,
    private readonly subagentDirectory: string,
    private readonly sharedRoot?: WorkspaceDefinitionOwner,
  ) {
    this.profiles = new ProfileManager(profileDirectory);
    this.subagents = new SubagentManager(subagentDirectory, this.profiles);
  }

  forkContributions(): WorkspaceDefinitionOwner {
    this.assertOpen();
    return new WorkspaceDefinitionOwner(
      this.profileDirectory,
      this.subagentDirectory,
      this.sharedRoot ?? this,
    );
  }

  initialize(): Promise<void> {
    return this.admit(async () => {
      await this.profiles.listProfiles();
      await this.subagents.listSubagents();
    });
  }

  replaceSettingsSubagents(
    definitions: Record<string, { profile: string; systemPrompt: string }>,
  ): void {
    this.assertOpen();
    const captured = structuredClone(definitions);
    this.subagents.clearSettingsSubagents();
    this.subagents.registerSettingsSubagents(captured);
  }

  replaceExtensionSubagents(
    extensions: readonly ExtensionDefinitionContribution[],
  ): void {
    this.assertOpen();
    this.publishExtensions(extensions);
  }

  withExtensionUpdate(
    operation: () => Promise<void>,
    read: () => readonly ExtensionDefinitionContribution[],
  ): Promise<void> {
    return this.admit(() => {
      const accepted = this.extensionTail.then(async () =>
        this.updateExtensions(operation, read),
      );
      this.extensionTail = accepted.then(
        () => undefined,
        () => undefined,
      );
      return accepted;
    });
  }

  private async updateExtensions(
    operation: () => Promise<void>,
    read: () => readonly ExtensionDefinitionContribution[],
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      try {
        this.publishExtensions(read());
      } catch (publicationError) {
        throw new AggregateError(
          [error, publicationError],
          'Extension definition rollback publication failed',
        );
      }
      throw error;
    }
    this.publishExtensions(read());
  }

  private publishExtensions(
    extensions: readonly ExtensionDefinitionContribution[],
  ): void {
    const captured = structuredClone(extensions);
    this.subagents.clearExtensionSubagents();
    for (const extension of captured)
      this.subagents.registerExtensionSubagents(extension.name, [
        ...extension.subagents,
      ]);
  }

  private async listSubagents(includeExtensions: boolean): Promise<string[]> {
    const names = await this.subagents.listSubagents();
    if (includeExtensions) return names;
    const permitted = await Promise.all(
      names.map(async (name) =>
        this.subagents.hasSettingsSubagent(name) ||
        (await this.subagents.subagentExistsOnDisk(name))
          ? name
          : undefined,
      ),
    );
    return permitted.filter((name): name is string => name !== undefined);
  }

  private assertOpen(): void {
    this.sharedRoot?.assertOpen();
    if (this.closed) throw new Error('Workspace definition owner is closed');
  }

  private admit<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const accepted =
      this.sharedRoot === undefined
        ? operation()
        : this.sharedRoot.admit(operation);
    this.pending.add(accepted);
    void accepted.then(
      () => this.pending.delete(accepted),
      () => this.pending.delete(accepted),
    );
    return accepted;
  }

  closeAdmission(): void {
    this.closed = true;
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.closeAdmission();
    this.disposal = this.drain();
    return this.disposal;
  }

  private async drain(): Promise<void> {
    const results = await Promise.allSettled([...this.pending]);
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, 'Workspace definition cleanup failed');
  }
}
