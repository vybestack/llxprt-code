/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import {
  ApprovalMode,
  fromConfig,
  toConfigParameters,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';
import { SubagentOrchestrator } from '../../core/subagentOrchestrator.js';

async function approvals(history: HistoryService): Promise<unknown[]> {
  await history.waitForCommit();
  const path = history.journalPath();
  if (path === null) throw new Error('Missing child journal');
  const reader = await NativeJournalPageReader.open(path);
  const records: unknown[] = [];
  try {
    for await (const row of reader.entries()) {
      const presentation = await reader.presentation(row);
      if (presentation?.descriptor.type !== 'tool-approval') continue;
      const content = await reader.readContent(row);
      records.push(
        JSON.parse(
          content.blocks
            .flatMap((block) => (block.type === 'text' ? [block.text] : []))
            .join(''),
        ),
      );
    }
    return records;
  } finally {
    await reader.close();
  }
}

async function waitForBackgroundTasks(agent: Agent): Promise<void> {
  const deadline = Date.now() + 30000;
  while (agent.tasks.list().some((task) => task.status === 'running')) {
    if (Date.now() > deadline)
      throw new Error('Background child did not finish');
    await Bun.sleep(15);
  }
}

async function exercise(
  interactive: boolean,
  writes: boolean,
  background: boolean,
): Promise<readonly string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'task-approval-'));
  let childHistory: HistoryService | undefined;
  let recorded: unknown[] = [];
  let requests = 0;
  const failures: unknown[] = [];
  const actualLaunch = SubagentOrchestrator.prototype.launch;
  const observation = spyOn(
    SubagentOrchestrator.prototype,
    'launch',
  ).mockImplementation(async function (
    this: SubagentOrchestrator,
    ...args: Parameters<SubagentOrchestrator['launch']>
  ) {
    const launched = await actualLaunch.apply(this, args);
    childHistory = launched.runtime.runtimeContext.history;
    return launched;
  });
  const output = join(directory, 'approved.txt');
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      request.resume();
      requests++;
      if (requests > 1 && childHistory !== undefined)
        recorded = await approvals(childHistory);
      const delta =
        requests === 1
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: 'child-call',
                  type: 'function',
                  function: {
                    name: writes ? 'write_file' : 'list_directory',
                    arguments: JSON.stringify(
                      writes
                        ? {
                            file_path: output,
                            content: 'approved child output',
                          }
                        : { path: directory },
                    ),
                  },
                },
              ],
            }
          : { content: 'hello' };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({ id: 'child-response', object: 'chat.completion.chunk', model: 'child-model', choices: [{ index: 0, delta, finish_reason: requests === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    })().catch((error: unknown) => {
      failures.push(error);
      response.destroy(error instanceof Error ? error : undefined);
    });
  });
  let config: Config | undefined;
  let agent: Agent | undefined;
  let mcp: McpRuntimeOwner | undefined;
  let channel: ReturnType<Agent['tools']['openClientChannel']> | undefined;
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing server port');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const profiles = new ProfileManager(join(directory, 'profiles'));
    await profiles.saveProfile('approval-child', {
      version: 1,
      provider: 'openai',
      model: 'child-model',
      modelParams: {},
      ephemeralSettings: { 'auth-key': 'local-test-key', 'base-url': baseUrl },
    });
    const subagents = new SubagentManager(
      join(directory, 'subagents'),
      profiles,
    );
    await subagents.saveSubagent(
      'approval-child',
      'approval-child',
      'Use the requested tool then say hello.',
    );
    config = new Config({
      ...toConfigParameters({
        provider: 'openai',
        model: 'parent-model',
        workingDir: directory,
        interactive,
        approvalMode: interactive ? ApprovalMode.DEFAULT : ApprovalMode.YOLO,
        folderTrust: true,
        coreTools: ['task', 'write_file', 'list_directory'],
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
      profileDirectory: join(directory, 'profiles'),
      subagentDirectory: join(directory, 'subagents'),
      sessionId: 'approval-parent',
    });
    mcp = await McpRuntimeOwner.create(createTestOAuthBinding(), config);
    agent = await fromConfig({
      ...createSessionSettingsFixture(config),
      runtimeFactoryBindings: createAgentRuntimeFactoryBindings(),
      config,
      mcpRuntime: mcp,
      mcpOwnership: 'caller',
      activation: {
        provider: 'openai',
        model: 'parent-model',
        cliOverrides: { key: 'local-test-key', baseUrl },
      },
    });
    agent.tools.subscribeChildTools({
      onToolCallsUpdate: (_executionId, calls) => {
        for (const call of calls) {
          if (
            call.status === 'awaiting_approval' &&
            'onConfirm' in call.confirmationDetails
          ) {
            void call.confirmationDetails
              .onConfirm(ToolConfirmationOutcome.ProceedOnce)
              .catch((error: unknown) => failures.push(error));
          }
        }
      },
    });
    let completed: Parameters<
      NonNullable<Parameters<Agent['tools']['openClientChannel']>[0]>
    >[0] = [];
    channel = agent.tools.openClientChannel((calls) => {
      completed = calls;
    });
    await channel.ready;
    await channel.schedule(
      {
        callId: 'task-call',
        name: 'task',
        args: {
          subagent_name: 'approval-child',
          goal_prompt: 'Use the tool then say hello.',
          async: background,
          timeout_seconds: 30,
        },
        isClientInitiated: true,
        prompt_id: 'approval-task',
      },
      new AbortController().signal,
    );
    if (background) await waitForBackgroundTasks(agent);
    expect(failures).toStrictEqual([]);
    expect(requests).toBe(2);
    expect(childHistory).toBeDefined();
    if (interactive && writes) {
      expect(recorded).toContainEqual(
        expect.objectContaining({
          status: 'awaiting_approval',
          request: expect.objectContaining({
            callId: expect.stringContaining('child-call'),
            name: 'write_file',
            journalIdentity: expect.objectContaining({
              attemptId: expect.any(String),
            }),
          }),
        }),
      );
      expect(recorded).toContainEqual(
        expect.objectContaining({
          status: 'scheduled',
          outcome: ToolConfirmationOutcome.ProceedOnce,
        }),
      );
    } else {
      expect(recorded).toStrictEqual([]);
    }
    if (writes)
      expect(await readFile(output, 'utf8')).toBe('approved child output');
    return completed.map((call) => call.status);
  } finally {
    await channel?.release();
    await agent?.dispose();
    await mcp?.dispose();
    await config?.dispose();
    observation.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Task child approval journal ownership', () => {
  for (const interactive of [true, false]) {
    for (const background of [false, true]) {
      for (const writes of [false, true]) {
        it(`executes ${writes ? 'write' : 'read-only'} tools with child-owned approvals (interactive=${interactive}, async=${background})`, async () => {
          expect(await exercise(interactive, writes, background)).toStrictEqual(
            ['success'],
          );
        });
      }
    }
  }
});
