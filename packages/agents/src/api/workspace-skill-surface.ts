/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CoreSkillServiceAdapter } from '@vybestack/llxprt-code-core';
import { SkillManager } from '@vybestack/llxprt-code-core/skills/skillManager.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { Storage } from '@vybestack/llxprt-code-settings';

export class WorkspaceSkillSurface {
  private manager = new SkillManager();
  private initialized = false;
  private pending: Promise<void> | undefined;
  private readonly subscribers = new Set<() => Promise<void>>();

  constructor(
    private readonly storage: Storage,
    private readonly extensions: () => LlxprtExtension[],
    private readonly disabledNames: () => string[],
    private readonly adminEnabled: () => boolean,
    private readonly workspace: Pick<WorkspaceContext, 'addDirectory'>,
  ) {}

  refresh(force = false): Promise<void> {
    if (this.pending !== undefined) return this.pending;
    if (this.initialized && !force) return Promise.resolve();
    const operation = this.discover();
    this.pending = operation;
    void operation.then(
      () => {
        this.pending = undefined;
      },
      () => {
        this.pending = undefined;
      },
    );
    return operation;
  }

  private async discover(): Promise<void> {
    const next = new SkillManager();
    await next.discoverSkills(this.storage, this.extensions());
    next.setDisabledSkills(this.disabledNames());
    next.setAdminSettings(this.adminEnabled());
    this.manager = next;
    this.initialized = true;
    for (const subscriber of this.subscribers) await subscriber();
  }

  subscribe(subscriber: () => Promise<void>): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  getSkills(): ReturnType<SkillManager['getSkills']> {
    return this.manager.getSkills();
  }

  getAllSkills(): ReturnType<SkillManager['getAllSkills']> {
    return this.manager.getAllSkills();
  }

  getSkill(name: string): ReturnType<SkillManager['getSkill']> {
    return this.manager.getSkill(name);
  }

  isAdminEnabled(): boolean {
    return this.manager.isAdminEnabled();
  }

  service(): CoreSkillServiceAdapter {
    return new CoreSkillServiceAdapter(
      this.manager,
      this.storage,
      this.extensions,
      this.workspace,
    );
  }
}
