import { cleanupAfterFailure } from '../../../agents/src/core/subagent-cleanup.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Agent,
  AgentEvent,
  AgentInput,
  TurnOptions,
} from '@vybestack/llxprt-code-agents';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type IToolMessageBus,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import { FakeProvider } from '../../../providers/src/fake/FakeProvider.js';
import {
  captureAgentAdoption,
  fixtureAgentResources,
} from '../../../agents/src/api/__tests__/helpers/agent-resource-capture.js';

class ListDirectoryInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly directory: string,
    bus: IToolMessageBus,
  ) {
    super({}, bus);
  }
  getDescription(): string {
    return 'List the physical fixture directory';
  }
  async execute(): Promise<ToolResult> {
    const listing = (await readdir(this.directory)).sort().join('\n');
    return { llmContent: listing, returnDisplay: listing };
  }
}
class ListDirectoryTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly directory: string,
    bus: IToolMessageBus,
  ) {
    super(
      'ShellTool',
      'ShellTool',
      'List fixture files',
      Kind.Read,
      {
        type: 'object',
        properties: { command: { type: 'string', enum: ['ls'] } },
        required: ['command'],
      },
      false,
      false,
      bus,
    );
  }
  protected createInvocation(
    params: Record<string, unknown>,
  ): ListDirectoryInvocation {
    if (params.command !== 'ls')
      throw new Error('Expected the fixture directory listing command');
    return new ListDirectoryInvocation(
      this.directory,
      this.requireMessageBus(),
    );
  }
}

function providerTurns(
  events: readonly AgentEvent[],
): Array<{ chunks: IContent[] }> {
  const turns: Array<{ chunks: IContent[] }> = [];
  let chunks: IContent[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'text':
        chunks.push({
          speaker: 'ai',
          blocks: [{ type: 'text', text: event.text }],
        });
        break;
      case 'thinking':
        chunks.push({
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: `**${event.thought.subject}** ${event.thought.description}`,
              ...(event.thought.streamId === undefined
                ? {}
                : { streamId: event.thought.streamId }),
              ...(event.thought.streamStatus === undefined
                ? {}
                : { streamStatus: event.thought.streamStatus }),
            },
          ],
        });
        break;
      case 'tool-call':
        chunks.push({
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: event.call.id,
              name: event.call.name,
              parameters: event.call.args,
            },
          ],
        });
        turns.push({ chunks });
        chunks = [];
        break;
      case 'tool-result':
        break;
      case 'done':
        if (chunks.length === 0 && turns.length === 0) {
          chunks.push({
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Fixture turn completed.' }],
          });
        }
        break;
      default:
        throw new Error(`Unsupported scripted provider event ${event.type}`);
    }
  }
  turns.push({ chunks });
  return turns;
}

export async function adoptScriptedHeadlessOwner(
  operands: Parameters<typeof captureAgentAdoption>,
  policy: RuntimePolicyOwner,
  events: readonly AgentEvent[],
  observe: (input: AgentInput, options: TurnOptions | undefined) => void,
): Promise<Agent> {
  const directory = await mkdtemp(join(tmpdir(), 'scripted-headless-'));
  let acquired: Agent | undefined;
  try {
    const listing = join(directory, 'listing');
    await mkdir(listing);
    await writeFile(join(listing, 'file.txt'), 'physical listing fixture');
    const responses = join(directory, 'responses.jsonl');
    await writeFile(
      responses,
      providerTurns(events)
        .map((turn) => JSON.stringify(turn))
        .join('\n'),
    );
    const manager = operands[4];
    if (manager === undefined)
      throw new Error(
        'Scripted headless acquisition requires its actual manager',
      );
    const intent = operands[2];
    if (intent === undefined)
      throw new Error('Missing scripted activation intent');
    const provider = new FakeProvider(responses);
    const selectedProvider =
      intent.activation?.provider ?? manager.getActiveProviderName();
    if (selectedProvider === undefined)
      throw new Error('Missing selected scripted provider');
    provider.name = selectedProvider;
    manager.registerProvider(provider);
    const agent = await captureAgentAdoption(...operands);
    acquired = agent;
    const owner = fixtureAgentResources(agent)
      .sessionOwners.values()
      .next().value;
    if (owner === undefined)
      throw new Error('Missing acquired native headless owner');
    owner.toolCatalog.prepareTools((tools) =>
      tools.registerTool(
        new ListDirectoryTool(listing, policy.session.messageBus),
      ),
    );
    await agent.sessionClient.publishTools();
    const stream = agent.stream.bind(agent);
    agent.stream = (input, options) => {
      observe(input, options);
      return stream(input, options);
    };
    const dispose = agent.dispose.bind(agent);
    agent.dispose = async () => {
      try {
        await dispose();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };
    return agent;
  } catch (error) {
    return cleanupAfterFailure(error, async () => {
      try {
        await acquired?.dispose();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}
