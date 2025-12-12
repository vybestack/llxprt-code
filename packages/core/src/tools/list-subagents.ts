/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
} from './tools.js';
import type { Config } from '../config/config.js';
import type { SubagentManager } from '../config/subagentManager.js';
import type { SubagentConfig } from '../config/types.js';

type ListSubagentsParams = Record<string, never>;

export interface ListSubagentsToolDependencies {
  getSubagentManager?: () => SubagentManager | undefined;
}

interface SubagentSummary {
  name: string;
  profile: string;
  updatedAt: string;
  description: string;
}

function summarizePrompt(prompt: string, maxLength = 160): string {
  if (!prompt) {
    return '';
  }
  const firstLine =
    prompt
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? prompt.trim();

  if (firstLine.length <= maxLength) {
    return firstLine;
  }

  const truncated = firstLine.slice(0, maxLength - 1).trimEnd();
  return `${truncated}…`;
}

class ListSubagentsToolInvocation extends BaseToolInvocation<
  ListSubagentsParams,
  ToolResult
> {
  constructor(
    params: ListSubagentsParams,
    private readonly subagentManager: SubagentManager,
  ) {
    super(params);
  }

  override getDescription(): string {
    return 'Enumerate registered subagents with their profiles and descriptions.';
  }

  override async execute(): Promise<ToolResult> {
    const names = await this.subagentManager.listSubagents();
    if (names.length === 0) {
      const message =
        'No subagents are currently registered. Use the /subagent CLI command to create one.';
      return {
        llmContent: message,
        returnDisplay: message,
        metadata: { count: 0 },
      };
    }

    const summaries: SubagentSummary[] = [];
    for (const name of names.sort()) {
      try {
        const config = await this.subagentManager.loadSubagent(name);
        summaries.push(this.buildSummary(config));
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : String(error ?? 'unknown');
        summaries.push({
          name,
          profile: 'unknown',
          updatedAt: '',
          description: `Unable to load subagent: ${detail}`,
        });
      }
    }

    const display =
      summaries
        .map((summary) => {
          const profilePart =
            summary.profile && summary.profile !== 'unknown'
              ? ` (profile: ${summary.profile})`
              : '';
          return `- **${summary.name}**${profilePart} — ${summary.description}`;
        })
        .join('\n') || 'No subagents are currently registered.';

    return {
      llmContent: JSON.stringify(summaries, null, 2),
      returnDisplay: display,
      metadata: { count: summaries.length },
    };
  }

  private buildSummary(config: SubagentConfig): SubagentSummary {
    return {
      name: config.name,
      profile: config.profile,
      updatedAt: config.updatedAt,
      description: summarizePrompt(config.systemPrompt),
    };
  }
}

/**
 * Tool that enumerates all available subagents and surfaces their metadata.
 */
export class ListSubagentsTool extends BaseDeclarativeTool<
  ListSubagentsParams,
  ToolResult
> {
  static readonly Name = 'list_subagents';

  constructor(
    private readonly config: Config,
    private readonly dependencies: ListSubagentsToolDependencies = {},
  ) {
    super(
      ListSubagentsTool.Name,
      'ListSubagents',
      'Lists all configured subagents with their associated profiles and high-level descriptions.',
      Kind.Read,
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    );
  }

  protected override createInvocation(
    params: ListSubagentsParams,
  ): ListSubagentsToolInvocation {
    const manager =
      this.dependencies.getSubagentManager?.() ??
      (typeof this.config.getSubagentManager === 'function'
        ? this.config.getSubagentManager()
        : undefined);

    if (!manager) {
      throw new Error(
        'SubagentManager service is unavailable. Please configure subagents before invoking this tool.',
      );
    }

    return new ListSubagentsToolInvocation(params, manager);
  }

  protected override validateToolParamValues(): string | null {
    return null;
  }
}
