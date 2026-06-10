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
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';
import type { ISubagentService, SubagentConfig } from '../interfaces/index.js';

type ListSubagentsParams = Record<string, never>;

export interface ListSubagentsToolDependencies {
  getSubagentService?: () => ISubagentService | undefined;
}

function resolveSubagentService(
  dependenciesOrService: ListSubagentsToolDependencies | ISubagentService,
): ISubagentService | undefined {
  if ('listSubagents' in dependenciesOrService) {
    return dependenciesOrService;
  }
  return dependenciesOrService.getSubagentService?.();
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
    private readonly subagentService: ISubagentService,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  override getDescription(): string {
    return 'Enumerate registered subagents with their profiles and descriptions.';
  }

  override async execute(): Promise<ToolResult> {
    const subagents = this.subagentService.listSubagents();
    if (subagents.length === 0) {
      const message =
        'No subagents are currently registered. Use the /subagent CLI command to create one.';
      return {
        llmContent: message,
        returnDisplay: message,
        metadata: { count: 0 },
      };
    }

    const summaries: SubagentSummary[] = [];
    for (const { name } of [...subagents].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      try {
        const config = this.subagentService.getSubagentConfig(name);
        if (!config) {
          throw new Error(`Subagent '${name}' not found.`);
        }
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
      profile: config.profile ?? 'unknown',
      updatedAt: config.updatedAt ?? '',
      description: summarizePrompt(
        config.systemPrompt ?? config.instructions ?? '',
      ),
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
    private readonly dependencies:
      | ListSubagentsToolDependencies
      | ISubagentService = {},
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
    messageBus: IToolMessageBus,
  ): ListSubagentsToolInvocation {
    const service = resolveSubagentService(this.dependencies);

    if (!service) {
      throw new Error(
        'SubagentManager service is unavailable. Please configure subagents before invoking this tool.',
      );
    }

    return new ListSubagentsToolInvocation(params, service, messageBus);
  }

  async execute(params: ListSubagentsParams): Promise<ToolResult> {
    const service = resolveSubagentService(this.dependencies);
    if (!service) {
      throw new Error(
        'SubagentManager service is unavailable. Please configure subagents before invoking this tool.',
      );
    }
    return new ListSubagentsToolInvocation(params, service, {
      requestConfirmation: async () => undefined,
    }).execute();
  }

  protected override validateToolParamValues(): string | null {
    return null;
  }
}
