/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ISubagentCatalog,
  SubagentInfo,
} from '@vybestack/llxprt-code-tools';
import type { SubagentConfig as ToolsSubagentConfig } from '@vybestack/llxprt-code-tools';
import type { SubagentDefinitionReads } from '../services/workspace-definition-owner.js';

export class SubagentCatalog implements ISubagentCatalog {
  constructor(
    private readonly manager: Pick<
      SubagentDefinitionReads,
      'listSubagents' | 'loadSubagent'
    >,
  ) {}

  async listSubagents(): Promise<SubagentInfo[]> {
    return (await this.manager.listSubagents()).map((name) => ({ name }));
  }

  async getSubagentConfig(name: string): Promise<ToolsSubagentConfig> {
    const config = await this.manager.loadSubagent(name);
    return {
      name: config.name,
      instructions: config.systemPrompt,
      systemPrompt: config.systemPrompt,
      profile: config.profile,
      updatedAt: config.updatedAt,
    };
  }
}
