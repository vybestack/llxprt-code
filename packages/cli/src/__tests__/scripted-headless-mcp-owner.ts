/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig, AgentEvent } from '@vybestack/llxprt-code-agents';
import type { IContent } from '@vybestack/llxprt-code-core';

const serverScript = fileURLToPath(
  new URL('./scripted-headless-listing-mcp-server.ts', import.meta.url),
);

const SERVER_NAME = 'scripted';
const SERVER_TOOL_NAME = 'list_fixture';

/**
 * The name the agent gives the listing tool (`mcp__<server>__<tool>`); scripted
 * `tool-call` events use it.
 */
export const SCRIPTED_LISTING_TOOL_NAME = `mcp__${SERVER_NAME}__${SERVER_TOOL_NAME}`;

/** The one file the listing tool reports. */
export const SCRIPTED_LISTING_OUTPUT = 'file.txt';

/**
 * Scripted turns for a headless run without a hand-built agent. `responsesFile`
 * is the replay the `fake` provider reads (`LLXPRT_FAKE_RESPONSES`), and
 * `mcpServers` is the production `AgentConfig`/`Config` input that publishes a
 * listing tool whose output the model sees on the next turn. `close` removes
 * the temporary directory.
 */
export interface ScriptedHeadlessMcpOwner {
  readonly responsesFile: string;
  readonly toolName: string;
  readonly mcpServers: NonNullable<AgentConfig['mcpServers']>;
  readonly close: () => Promise<void>;
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

export async function createScriptedHeadlessMcpOwner(
  events: readonly AgentEvent[],
): Promise<ScriptedHeadlessMcpOwner> {
  const directory = await mkdtemp(join(tmpdir(), 'scripted-headless-mcp-'));
  try {
    const listing = join(directory, 'listing');
    await mkdir(listing);
    await writeFile(
      join(listing, SCRIPTED_LISTING_OUTPUT),
      'physical listing fixture',
    );
    const responsesFile = join(directory, 'responses.jsonl');
    await writeFile(
      responsesFile,
      providerTurns(events)
        .map((turn) => JSON.stringify(turn))
        .join('\n'),
    );
    return {
      responsesFile,
      toolName: SCRIPTED_LISTING_TOOL_NAME,
      mcpServers: {
        [SERVER_NAME]: {
          command: process.execPath,
          args: [serverScript, listing, SERVER_TOOL_NAME],
          trust: true,
        },
      },
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
