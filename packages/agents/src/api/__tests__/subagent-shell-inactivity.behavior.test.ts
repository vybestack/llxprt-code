/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ApprovalMode,
  toConfigParameters,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../fromConfig.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

const SETTING = 'shell-inactivity-timeout-seconds';
const SILENT_COMMAND = 'sleep 3';

function chunk(delta: Record<string, unknown>, finish: string): string {
  return (
    [
      {
        id: 'inactivity-response',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta, finish_reason: null }],
      },
      {
        id: 'inactivity-response',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
      },
    ]
      .map((entry) => `data: ${JSON.stringify(entry)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}

function toolCall(name: string, args: Record<string, unknown>): string {
  return chunk(
    {
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: `call-${name}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    },
    'tool_calls',
  );
}

const requestSchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({ role: z.string(), content: z.string().nullish() }),
  ),
});

/** The shell result text a model request carries back to the child model. */
function lastToolMessage(rawRequest: string): string {
  const { messages } = requestSchema.parse(JSON.parse(rawRequest));
  const tools = messages.filter((message) => message.role === 'tool');
  const tool = tools[tools.length - 1];
  if (tool?.content === undefined || tool.content === null)
    throw new Error('Child request carried no tool result');
  return tool.content;
}

function text(content: string): string {
  return chunk({ role: 'assistant', content }, 'stop');
}

interface ModelServer {
  listen(): Promise<string>;
  close(): Promise<void>;
  /** Request body the child model received after its shell command finished. */
  readonly childToolResult: Promise<string>;
}

/**
 * Scripted model endpoint. The parent model delegates to the child through the
 * task tool; the child model runs one silent foreground shell command and the
 * server keeps the request that carries that command's result back to the
 * child model, which is the text the child agent actually saw.
 */
function createModelServer(asyncTask: boolean): ModelServer {
  let resolveResult!: (body: string) => void;
  const childToolResult = new Promise<string>((resolve) => {
    resolveResult = resolve;
  });
  let parentRequests = 0;
  let childRequests = 0;
  const handlers: Array<Promise<void>> = [];
  const server = createServer((request, response) => {
    handlers.push(
      (async (): Promise<void> => {
        const chunks: Buffer[] = [];
        for await (const part of request) chunks.push(Buffer.from(part));
        const raw = Buffer.concat(chunks).toString('utf8');
        const { model } = requestSchema.parse(JSON.parse(raw));
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (model === 'child-model') {
          childRequests += 1;
          if (childRequests === 1) {
            response.end(
              toolCall('run_shell_command', { command: SILENT_COMMAND }),
            );
            return;
          }
          resolveResult(lastToolMessage(raw));
          response.end(text('child completed'));
          return;
        }
        parentRequests += 1;
        response.end(
          parentRequests === 1
            ? toolCall('task', {
                subagent_name: 'inactivity-child',
                goal_prompt: 'Run the silent command.',
                async: asyncTask,
              })
            : text('parent completed'),
        );
      })().catch((error: unknown) => {
        response.destroy(error instanceof Error ? error : undefined);
      }),
    );
  });
  return {
    childToolResult,
    async listen(): Promise<string> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('No HTTP port');
      return `http://127.0.0.1:${address.port}/v1`;
    },
    async close(): Promise<void> {
      await Promise.all(handlers);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface Windows {
  /** Parent session value; undefined leaves the registry default (300 s). */
  readonly parent: number | undefined;
  /** Value stored in the subagent's profile. */
  readonly child: number;
}

async function runChildShellCommand(
  windows: Windows,
  asyncTask: boolean,
): Promise<string> {
  const directory = await makeScratchDir('subagent-inactivity-');
  const http = createModelServer(asyncTask);
  let config: Config | undefined;
  let agent: Agent | undefined;
  try {
    const baseUrl = await http.listen();
    const profiles = new ProfileManager(join(directory, 'profiles'));
    await profiles.saveProfile('inactivity-child', {
      version: 1,
      provider: 'openai',
      model: 'child-model',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'local-test-key',
        'base-url': baseUrl,
        [SETTING]: windows.child,
      },
    });
    const subagents = new SubagentManager(
      join(directory, 'subagents'),
      profiles,
    );
    await subagents.saveSubagent(
      'inactivity-child',
      'inactivity-child',
      'Run the requested command.',
    );
    config = new Config({
      ...toConfigParameters({
        provider: 'openai',
        model: 'parent-model',
        workingDir: directory,
        approvalMode: ApprovalMode.YOLO,
        folderTrust: true,
        interactive: false,
        coreTools: ['task', 'run_shell_command'],
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
      profileDirectory: join(directory, 'profiles'),
      subagentDirectory: join(directory, 'subagents'),
      sessionId: 'subagent-shell-inactivity-session',
    });
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    if (windows.parent !== undefined) settings.set(SETTING, windows.parent);
    agent = await fromConfig(
      config,
      settings,
      {
        activation: {
          provider: 'openai',
          model: 'parent-model',
          cliOverrides: { key: 'local-test-key', baseUrl },
        },
      },
      new CredentialAuthority(),
    );
    for await (const event of agent.stream('Delegate to the child.', {
      mcpDiscovery: 'skip',
    })) {
      void event;
    }
    return await http.childToolResult;
  } finally {
    await agent?.dispose();
    await config?.dispose();
    await http.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const STOPPED_NOTICE = 'no output for the inactivity window';

describe('subagent shell inactivity timeout follows the subagent profile (issue #4094)', () => {
  for (const asyncTask of [false, true]) {
    const mode = asyncTask ? 'async task' : 'foreground task';

    it(`stops a silent command at the child profile value, not the parent default (${mode})`, async () => {
      const seen = await runChildShellCommand(
        { parent: undefined, child: 1 },
        asyncTask,
      );
      expect(seen).toContain(`${STOPPED_NOTICE} (1s)`);
    }, 60_000);

    it(`lets a silent command finish when the child profile is unlimited although the parent window is short (${mode})`, async () => {
      const seen = await runChildShellCommand(
        { parent: 1, child: -1 },
        asyncTask,
      );
      expect(seen).toContain('Exit Code: 0');
      expect(seen).not.toContain('Termination cause');
    }, 60_000);
  }
});
