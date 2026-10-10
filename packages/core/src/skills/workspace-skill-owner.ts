/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import type {
  ISkillService,
  SkillActivationResult,
} from '@vybestack/llxprt-code-tools';
import type { LlxprtExtension } from '../config/configTypes.js';
import { SkillManager, type SkillDefinition } from './skillManager.js';

export interface SkillPolicy {
  readonly disabledSkills: string[];
  readonly adminSkillsEnabled: boolean;
}

export interface WorkspaceSkillOperations {
  list(includeDisabled?: boolean): SkillDefinition[];
  find(name: string): SkillDefinition | undefined;
  activate(name: string): Promise<SkillActivationResult>;
  isAdminEnabled(): boolean;
  reload(): Promise<void>;
}

export interface WorkspaceSkillPublication {
  readonly rebuild: (service: ISkillService) => () => void;
  readonly publish: () => Promise<void>;
  readonly release: () => void;
}

export interface WorkspaceSkillInputs {
  readonly directories: Parameters<SkillManager['discoverSkills']>[0];
  readonly enabled: () => boolean;
  readonly readExtensions: () => LlxprtExtension[];
  readonly readPolicy: () => SkillPolicy;
  readonly applyPolicy: (policy: SkillPolicy) => void;
  readonly reloadPolicy: () => Promise<Partial<SkillPolicy>>;
  readonly isTrusted: () => boolean;
  readonly addDirectory: (
    directory: string,
    approved: () => boolean,
  ) => () => void;
  readonly notifyDirectoriesChanged: () => void;
  readonly acceptPublication: () => WorkspaceSkillPublication;
}

export class WorkspaceSkillOwner {
  private manager = new SkillManager();
  private admissions: ReadonlyMap<string, () => void> = new Map();
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  private retirement: WorkspaceSkillPublication | undefined;
  private initialization: Promise<void> | undefined;
  readonly operations: WorkspaceSkillOperations;

  constructor(private readonly inputs: WorkspaceSkillInputs) {
    this.operations = {
      list: (includeDisabled) => this.list(this.manager, includeDisabled),
      find: (name) =>
        this.list(this.manager, true).find((skill) => skill.name === name),
      activate: (name) => this.activate(name),
      isAdminEnabled: () => inputs.readPolicy().adminSkillsEnabled,
      reload: () => this.enqueue(true),
    };
  }

  initialize(): Promise<void> {
    this.initialization ??= this.enqueue(false);
    return this.initialization;
  }

  refresh(): Promise<void> {
    return this.enqueue(false);
  }

  private list(
    manager: SkillManager,
    includeDisabled = false,
    policy = this.inputs.readPolicy(),
  ): SkillDefinition[] {
    const skills = manager.getAllSkills().map((skill) => ({
      ...skill,
      disabled: policy.disabledSkills.includes(skill.name),
    }));
    return includeDisabled ? skills : skills.filter((skill) => !skill.disabled);
  }

  private enqueue(reload: boolean): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error('Workspace skills are disposed'));
    const publication = this.inputs.acceptPublication();
    const operation = this.tail
      .then(() => this.replace(reload, publication))
      .finally(() => publication.release());
    this.tail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  private async replace(
    reload: boolean,
    publication: WorkspaceSkillPublication,
  ): Promise<void> {
    const updates = reload ? await this.inputs.reloadPolicy() : {};
    const candidate = new SkillManager();
    if (this.inputs.enabled()) {
      await candidate.discoverSkills(
        this.inputs.directories,
        this.inputs.readExtensions(),
      );
    }
    const policy = {
      disabledSkills:
        updates.disabledSkills ?? this.inputs.readPolicy().disabledSkills,
      adminSkillsEnabled:
        updates.adminSkillsEnabled ??
        this.inputs.readPolicy().adminSkillsEnabled,
    };
    let preparing = true;
    const service: ISkillService = {
      listSkills: () =>
        preparing
          ? this.list(candidate, false, policy)
          : this.operations.list(),
      getSkill: (name) =>
        preparing
          ? (this.list(candidate, true, policy).find(
              (skill) => skill.name === name,
            ) ?? null)
          : (this.operations.find(name) ?? null),
      activateSkill: (name) =>
        preparing
          ? Promise.reject(new Error('Skill catalogue publication is pending'))
          : this.activate(name),
    };
    const rollbackTool = publication.rebuild(service);
    try {
      await publication.publish();
    } catch (error) {
      const failures: unknown[] = [error];
      for (const compensate of [rollbackTool, () => publication.publish()]) {
        try {
          await Promise.resolve().then(compensate);
        } catch (compensationError) {
          failures.push(compensationError);
        }
      }
      if (failures.length > 1)
        throw new AggregateError(failures, 'Skill publication rollback failed');
      throw error;
    }
    for (const release of this.admissions.values()) release();
    this.admissions = new Map();
    this.manager = candidate;
    preparing = false;
    this.inputs.applyPolicy({
      disabledSkills:
        updates.disabledSkills ?? this.inputs.readPolicy().disabledSkills,
      adminSkillsEnabled:
        updates.adminSkillsEnabled ??
        this.inputs.readPolicy().adminSkillsEnabled,
    });
    this.inputs.notifyDirectoriesChanged();
  }

  private async activate(name: string): Promise<SkillActivationResult> {
    if (this.closed) throw new Error('Workspace skills are disposed');
    const skill = this.operations.find(name);
    if (
      !this.inputs.enabled() ||
      !skill ||
      skill.disabled === true ||
      !this.operations.isAdminEnabled()
    ) {
      return {
        success: false,
        error: `Skill "${name}" is unavailable`,
        availableSkills: this.operations.list().map((entry) => entry.name),
      };
    }
    if (!this.inputs.isTrusted()) {
      return { success: false, error: 'Workspace is not trusted' };
    }
    const resourceDirectory = path.dirname(skill.location);
    if (!this.admissions.has(name)) {
      const release = this.inputs.addDirectory(resourceDirectory, () =>
        this.isResourceAvailable(name, skill.location),
      );
      this.admissions = new Map(this.admissions).set(name, release);
    }
    this.manager.activateSkill(name);
    return {
      success: true,
      instructions: skill.body,
      description: skill.description,
      location: skill.location,
      resourceDirectory,
    };
  }

  private isResourceAvailable(name: string, location: string): boolean {
    if (this.closed || !this.inputs.enabled() || !this.inputs.isTrusted())
      return false;
    if (!this.operations.isAdminEnabled()) return false;
    const current = this.operations.find(name);
    return current?.disabled !== true && current?.location === location;
  }

  closeAdmission(): void {
    if (this.closed) return;
    this.retirement = this.inputs.acceptPublication();
    this.closed = true;
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closeAdmission();
    const failures: unknown[] = [];
    const publication = this.retirement;
    if (publication === undefined)
      throw new Error('Missing skill retirement publication');
    for (const release of [
      ...this.admissions.values(),
      this.inputs.notifyDirectoriesChanged,
    ]) {
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
    }
    this.admissions = new Map();
    this.closing = this.tail.then(async () => {
      this.manager.clearSkills();
      for (const release of [
        () =>
          publication.rebuild({
            listSkills: () => this.operations.list(),
            getSkill: (name) => this.operations.find(name) ?? null,
            activateSkill: (name) => this.operations.activate(name),
          }),
        () => publication.publish(),
      ]) {
        try {
          await release();
        } catch (error) {
          failures.push(error);
        }
      }
      publication.release();
      if (failures.length > 0)
        throw new AggregateError(failures, 'Workspace skill cleanup failed');
    });
    return this.closing;
  }
}
