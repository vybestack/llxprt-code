/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * E2E tests for the #3221 conversion: the express app + CoderAgentExecutor
 * driving REAL Agents built through the public Agent API. The provider is
 * the production FakeProvider seam (LLXPRT_FAKE_RESPONSES) and MCP discovery
 * goes through the shipped fake-MCP seam (LLXPRT_FAKE_MCP), so every
 * assertion observes the public HTTP/SSE surface — no mock Config, no
 * scheduler/agentClient reach-through.
 *
 * The executor constructs agents at request time from the environment, so
 * each scenario points LLXPRT_FAKE_RESPONSES at its own fixture before the
 * POST. Awaiting-approval scenarios resume the paused turn with a
 * confirmation data-part request, pinning the approval-boundary continuation
 * contract: the awaiting response ends at final input-required; the
 * confirming response receives the continuation events.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'bun:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type express from 'express';
import type {
  SendStreamingMessageSuccessResponse,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk';
import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import { debugLogger } from '@vybestack/llxprt-code-core';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import { CoderAgentExecutor } from '../agent/executor.js';
import { createApp } from './app.js';
import {
  createStreamMessageRequest,
  createConfirmationMessageRequest,
  assertUniqueFinalEventIsLast,
  assertTaskCreation,
} from '../utils/testing_utils.js';
import { commandRegistry } from '../commands/command-registry.js';
import type { Command, CommandContext } from '../commands/types.js';

const AUTH_ENV_KEYS = [
  'USE_CCPA',
  'GEMINI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_API_KEY',
  'LLXPRT_DEFAULT_PROVIDER',
  'LLXPRT_YOLO_MODE',
] as const;
const ENV_KEYS_TO_RESTORE = [
  ...AUTH_ENV_KEYS,
  'LLXPRT_FAKE_RESPONSES',
  'LLXPRT_FAKE_MCP',
] as const;

const NL = String.fromCharCode(10);

const streamToSSEEvents = (
  stream: string,
): SendStreamingMessageSuccessResponse[] =>
  stream
    .split(NL + NL)
    .filter(Boolean) // Remove empty strings from trailing newlines
    .map((chunk) => {
      const dataLine = chunk
        .split(NL)
        .find((line) => line.startsWith('data: '));
      if (!dataLine) {
        throw new Error(`Invalid SSE chunk found: "${chunk}"`);
      }
      return JSON.parse(dataLine.substring(6));
    });

function streamToSSEEventsForCommand(data: string): Array<{ result: unknown }> {
  return data
    .split(NL)
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.substring(6)));
}

interface ToolUpdateData {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}
interface ToolDataPart {
  readonly kind: 'data';
  readonly data: ToolUpdateData;
}
interface TextPart {
  readonly kind: 'text';
  readonly text: string;
}

function statusUpdates(
  events: SendStreamingMessageSuccessResponse[],
): SendStreamingMessageSuccessResponse[] {
  return events.filter((e) => e.result.kind === 'status-update');
}

/**
 * The executor's task reference, harvested from the awaiting-approval tool
 * update it published (the SDK handler's parallel task record carries
 * different ids).
 */
function executorTaskRef(events: SendStreamingMessageSuccessResponse[]): {
  taskId: string;
  contextId: string;
} {
  const awaitEvent = statusUpdates(events).find(
    (e) =>
      (
        (e.result as TaskStatusUpdateEvent).status.message?.parts[0] as
          | { data?: { status?: string } }
          | undefined
      )?.data?.status === 'awaiting-approval',
  );
  if (!awaitEvent) throw new Error('no awaiting-approval event to harvest');
  const result = awaitEvent.result as TaskStatusUpdateEvent;
  return { taskId: result.taskId, contextId: result.contextId };
}

function coderAgentKindOf(event: SendStreamingMessageSuccessResponse): string {
  const update = event.result as TaskStatusUpdateEvent;
  return String(
    (update.metadata as Record<string, { kind: string }> | undefined)?.[
      'coderAgent'
    ]?.kind,
  );
}

function contentEvents(
  events: SendStreamingMessageSuccessResponse[],
  kind: string,
): SendStreamingMessageSuccessResponse[] {
  return statusUpdates(events).filter((e) => coderAgentKindOf(e) === kind);
}

function textOf(event: SendStreamingMessageSuccessResponse): string {
  const update = event.result as TaskStatusUpdateEvent;
  return (update.status.message?.parts[0] as unknown as TextPart).text;
}

function toolDataOf(
  event: SendStreamingMessageSuccessResponse,
): ToolUpdateData {
  const update = event.result as TaskStatusUpdateEvent;
  return (update.status.message?.parts[0] as unknown as ToolDataPart).data;
}

function toolUpdateData(
  events: SendStreamingMessageSuccessResponse[],
): ToolUpdateData[] {
  return contentEvents(events, 'tool-call-update').map(toolDataOf);
}

function allToolData(
  events: SendStreamingMessageSuccessResponse[],
): ToolUpdateData[] {
  return statusUpdates(events)
    .filter((e) => {
      const kind = coderAgentKindOf(e);
      return kind === 'tool-call-update' || kind === 'tool-call-confirmation';
    })
    .map(toolDataOf);
}

describe('E2E Tests', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  let workspace: string;
  let contextExtensions: LlxprtExtension[] = [];
  const prevEnv = Object.fromEntries(
    ENV_KEYS_TO_RESTORE.map((k) => [k, process.env[k]]),
  );
  const prevCwd = process.cwd();
  const commandLookupSpies: Array<ReturnType<typeof vi.spyOn>> = [];

  const mockCommandLookup = (command: Command): void => {
    commandLookupSpies.push(
      vi.spyOn(commandRegistry, 'get').mockReturnValue(command),
    );
  };
  const mockAllCommands = (commands: Command[]): void => {
    commandLookupSpies.push(
      vi.spyOn(commandRegistry, 'getAllCommands').mockReturnValue(commands),
    );
  };

  async function postStream(
    body: unknown,
  ): Promise<SendStreamingMessageSuccessResponse[]> {
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    return streamToSSEEvents(await res.text());
  }

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'a2a-app-e2e-'));
    // The request metadata workspacePath points here, so settings-based MCP
    // declarations resolve inside the isolated workspace (a2a loadSettings
    // reads .llxprt/settings.json). folderTrust: true grants the MCP
    // capability authorization the fake-server tools need.
    mkdirSync(join(workspace, '.llxprt'), { recursive: true });
    writeFileSync(
      join(workspace, '.llxprt', 'settings.json'),
      JSON.stringify({
        folderTrust: true,
        mcpServers: {
          'e2e-server': { command: 'node', args: ['srv.js'] },
        },
      }),
    );
    // Scenarios. Each line is one FakeProvider turn. write_file is a REAL
    // core tool that requires confirmation in DEFAULT approval mode, so the
    // approval-boundary behavior under test is the production one.
    const textTurn = JSON.stringify({
      chunks: [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hello how are you?' }],
        },
      ],
    });
    const writeCall = (id: string, file: string) => ({
      type: 'tool_call',
      id,
      name: 'write_file',
      parameters: { absolute_path: `{{CWD}}/${file}`, content: 'e2e' },
    });
    const toolCallTurn = JSON.stringify({
      chunks: [
        {
          speaker: 'ai',
          blocks: [writeCall('e2e-call-1', 'out-1.txt')],
        },
      ],
    });
    const multiToolTurn = JSON.stringify({
      chunks: [
        {
          speaker: 'ai',
          blocks: [
            writeCall('e2e-call-1', 'out-1.txt'),
            writeCall('e2e-call-2', 'out-2.txt'),
          ],
        },
      ],
    });
    const finalText = JSON.stringify({
      chunks: [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Tool executed successfully.' }],
        },
      ],
    });
    const fixtures: Record<string, string> = {
      'text.jsonl': textTurn + NL,
      'tool-await.jsonl': toolCallTurn + NL + finalText + NL,
      'multi-tool.jsonl': multiToolTurn + NL + finalText + NL,
    };
    for (const [name, content] of Object.entries(fixtures)) {
      writeFileSync(join(workspace, name), content);
    }
    const mcpFixture = join(workspace, 'fake-mcp.json');
    writeFileSync(
      mcpFixture,
      JSON.stringify({
        servers: {
          'e2e-server': {
            tools: [{ name: 'e2e-tool-a' }, { name: 'e2e-tool-b' }],
          },
        },
      }),
    );

    for (const key of AUTH_ENV_KEYS) delete process.env[key];
    process.env.LLXPRT_FAKE_RESPONSES = join(workspace, 'text.jsonl');
    process.env.LLXPRT_FAKE_MCP = mcpFixture;
    process.chdir(workspace);

    const taskStore = new InMemoryTaskStore();
    const agentExecutor = new CoderAgentExecutor(taskStore);
    contextExtensions = [
      {
        name: 'test-extension',
        version: '0.0.1',
        isActive: true,
        path: join(workspace, 'ext'),
        contextFiles: [],
        mcpServers: {},
      },
    ];
    app = await createApp({
      createStartupContext: async () => ({
        extensions: contextExtensions,
        model: 'fake-model',
        checkpointing: {
          enabled: false,
          getProjectTempCheckpointsDir: () => join(workspace, '.checkpoints'),
        },
        git: undefined,
        agentExecutor,
        taskStoreForExecutor: taskStore,
        taskStoreForHandler: taskStore,
      }),
    });
    server = app.listen(0);
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    process.chdir(prevCwd);
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch (err) {
      // Best-effort cleanup, but observable: locked files or a lingering
      // fake MCP server should show up in CI logs instead of vanishing.
      process.stderr.write(
        `app.test.ts: best-effort workspace cleanup failed: ${String(err)}
`,
      );
    }
  });

  afterEach(() => {
    for (const spy of commandLookupSpies.splice(0)) spy.mockRestore();
    // Reset the default scenario between tests.
    process.env.LLXPRT_FAKE_RESPONSES = join(workspace, 'text.jsonl');
  });

  it('should create a new task and stream status updates (text-content) via POST /', async () => {
    const events = await postStream(
      createStreamMessageRequest(
        'hello',
        'a2a-test-message',
        undefined,
        workspace,
      ),
    );

    assertTaskCreation(events);
    // [task, working, text-content, final input-required]
    expect(events).toHaveLength(4);
    const workingEvent = events[1].result as TaskStatusUpdateEvent;
    expect(workingEvent.kind).toBe('status-update');
    expect(workingEvent.status.state).toBe('working');

    const textEvents = contentEvents(events, 'text-content');
    expect(textEvents).toHaveLength(1);
    expect(textOf(textEvents[0])).toBe('Hello how are you?');

    assertUniqueFinalEventIsLast(events);
  });

  it('should create a new task, schedule a tool call, and wait for approval', async () => {
    process.env.LLXPRT_FAKE_RESPONSES = join(workspace, 'tool-await.jsonl');
    const events = await postStream(
      createStreamMessageRequest(
        'run the tool',
        'a2a-tool-message',
        undefined,
        workspace,
      ),
    );

    assertTaskCreation(events);
    assertUniqueFinalEventIsLast(events);
    // The awaiting response ends at the approval boundary: exactly one
    // awaiting-approval publication for the scheduled tool call.
    const toolData = allToolData(events);
    const awaiting = toolData.filter(
      (data) => data.status === 'awaiting-approval',
    );
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0].name).toBe('write_file');
    const confirmationEvent = contentEvents(events, 'tool-call-confirmation');
    expect(confirmationEvent).toHaveLength(1);
    // Continuations address the executor's task: the id + contextId carried
    // by its status updates (the SDK's own task object is a separate record).
    const { taskId, contextId } = executorTaskRef(events);
    const confirmationId = awaiting[0].id;
    expect(confirmationId).toBeTruthy();

    // Resuming the paused turn: the confirmation request delivers the tool
    // execution and the final text on THIS response.
    const resumeEvents = await postStream(
      createConfirmationMessageRequest(
        confirmationId,
        'proceed_once',
        'a2a-confirmation-message',
        taskId,
        contextId,
      ),
    );
    const statuses = toolUpdateData(resumeEvents).map((d) => d.status);
    expect(statuses).toContain('executing');
    expect(statuses).toContain('success');
    const texts = contentEvents(resumeEvents, 'text-content').map(textOf);
    expect(texts).toStrictEqual(['Tool executed successfully.']);
    assertUniqueFinalEventIsLast(resumeEvents);
  });

  it('should handle multiple tool calls across sequential approval boundaries', async () => {
    process.env.LLXPRT_FAKE_RESPONSES = join(workspace, 'multi-tool.jsonl');
    const events = await postStream(
      createStreamMessageRequest(
        'run both tools',
        'a2a-multi-message',
        undefined,
        workspace,
      ),
    );

    assertTaskCreation(events);
    assertUniqueFinalEventIsLast(events);
    // The stream pauses at the FIRST confirmation; the second tool call's
    // confirmation only surfaces after the first is resolved.
    const firstAwaiting = allToolData(events).filter(
      (data) => data.status === 'awaiting-approval',
    );
    expect(firstAwaiting).toHaveLength(1);
    expect(firstAwaiting[0].name).toBe('write_file');
    const { taskId, contextId } = executorTaskRef(events);

    // Confirming call 1 surfaces the second approval boundary; the agent
    // schedules the calls concurrently, so call 1's completion lands on the
    // NEXT resume (with call 2's execution).
    const resumeOne = await postStream(
      createConfirmationMessageRequest(
        firstAwaiting[0].id,
        'proceed_once',
        'a2a-multi-confirm-1',
        taskId,
        contextId,
      ),
    );
    assertUniqueFinalEventIsLast(resumeOne);
    const secondAwaiting = allToolData(resumeOne).filter(
      (data) => data.status === 'awaiting-approval',
    );
    expect(secondAwaiting).toHaveLength(1);
    expect(secondAwaiting[0].id).toBe('e2e-call-2');

    // Confirming call 2 completes the turn: both tools report success and
    // the final text arrives.
    const resumeTwo = await postStream(
      createConfirmationMessageRequest(
        'e2e-call-2',
        'proceed_once',
        'a2a-multi-confirm-2',
        taskId,
        contextId,
      ),
    );
    assertUniqueFinalEventIsLast(resumeTwo);
    const successIds = toolUpdateData(resumeTwo)
      .filter((data) => data.status === 'success')
      .map((data) => data.id)
      .sort();
    expect(successIds).toStrictEqual(['e2e-call-1', 'e2e-call-2']);
    const texts = contentEvents(resumeTwo, 'text-content').map(textOf);
    expect(texts).toStrictEqual(['Tool executed successfully.']);
  });
  it('should auto-execute tool calls when the message requests autoExecute', async () => {
    process.env.LLXPRT_FAKE_RESPONSES = join(workspace, 'tool-await.jsonl');
    const request = createStreamMessageRequest(
      'run without asking',
      'a2a-autoexec-message',
      undefined,
      workspace,
    );
    request.params.message.metadata.coderAgent.autoExecute = true;
    const events = await postStream(request);

    assertTaskCreation(events);
    assertUniqueFinalEventIsLast(events);
    const statuses = toolUpdateData(events).map((d) => d.status);
    expect(statuses).not.toContain('awaiting-approval');
    expect(statuses).toContain('success');
    const texts = contentEvents(events, 'text-content').map(textOf);
    expect(texts).toStrictEqual(['Tool executed successfully.']);
  });

  it('should bypass tool approval in YOLO mode', async () => {
    process.env.LLXPRT_FAKE_RESPONSES = join(workspace, 'tool-await.jsonl');
    process.env.LLXPRT_YOLO_MODE = 'true';
    try {
      const events = await postStream(
        createStreamMessageRequest(
          'yolo run',
          'a2a-yolo-message',
          undefined,
          workspace,
        ),
      );
      assertTaskCreation(events);
      assertUniqueFinalEventIsLast(events);
      const toolData = allToolData(events).filter(
        (data) => data.name === 'write_file',
      );
      expect(toolData.map((d) => d.status)).not.toContain('awaiting-approval');
      expect(toolData.map((d) => d.status)).toContain('success');
      const texts = contentEvents(events, 'text-content').map(textOf);
      expect(texts).toStrictEqual(['Tool executed successfully.']);
    } finally {
      delete process.env.LLXPRT_YOLO_MODE;
    }
  });

  describe('/listCommands', () => {
    it('should return a list of top-level commands', async () => {
      const mockCommands: Command[] = [
        {
          name: 'test-command',
          description: 'A test command',
          topLevel: true,
          arguments: [{ name: 'arg1', description: 'Argument 1' }],
          subCommands: [
            {
              name: 'sub-command',
              description: 'A sub command',
              topLevel: false,
              execute: vi.fn(),
            },
          ],
          execute: vi.fn(),
        },
        {
          name: 'another-command',
          description: 'Another test command',
          topLevel: true,
          execute: vi.fn(),
        },
        {
          name: 'not-top-level',
          description: 'Not a top level command',
          topLevel: false,
          execute: vi.fn(),
        },
      ];

      mockAllCommands(mockCommands);
      const res = await fetch(`${baseUrl}/listCommands`);
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({
        commands: [
          {
            name: 'test-command',
            description: 'A test command',
            arguments: [{ name: 'arg1', description: 'Argument 1' }],
            subCommands: [
              {
                name: 'sub-command',
                description: 'A sub command',
                arguments: [],
                subCommands: [],
              },
            ],
          },
          {
            name: 'another-command',
            description: 'Another test command',
            arguments: [],
            subCommands: [],
          },
        ],
      });
    });

    it('should handle cyclic commands gracefully', async () => {
      const warnSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});

      const cyclicCommand: Command = {
        name: 'cyclic-command',
        description: 'A cyclic command',
        topLevel: true,
        execute: vi.fn(),
        subCommands: [],
      };
      cyclicCommand.subCommands?.push(cyclicCommand); // Create cycle

      mockAllCommands([cyclicCommand]);
      const res = await fetch(`${baseUrl}/listCommands`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        commands: Array<{ name: string; subCommands: unknown[] }>;
      };
      expect(body.commands[0]?.name).toBe('cyclic-command');
      expect(body.commands[0]?.subCommands).toStrictEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        'Command cyclic-command already inserted in the response, skipping',
      );
      warnSpy.mockRestore();
    });
  });

  describe('/executeCommand', () => {
    it('should return extensions for valid command', async () => {
      // The startup context's extensions list is the real data source.
      const res = await fetch(`${baseUrl}/executeCommand`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'extensions list', args: [] }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({
        name: 'extensions list',
        data: contextExtensions,
      });
    });

    it('should return 404 for invalid command', async () => {
      const res = await fetch(`${baseUrl}/executeCommand`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'invalid command' }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toStrictEqual({
        error: 'Command not found: invalid command',
      });
    });

    it('should return 400 for missing command', async () => {
      const res = await fetch(`${baseUrl}/executeCommand`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('should return 400 if args is not an array', async () => {
      const res = await fetch(`${baseUrl}/executeCommand`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          command: 'extensions.list',
          args: 'not-an-array',
        }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toStrictEqual({
        error: '"args" field must be an array.',
      });
    });

    it('should include agentExecutor in context', async () => {
      const mockCommand: Command = {
        name: 'context-check-command',
        description: 'checks context',
        execute: async (context: CommandContext) => {
          if (!context.agentExecutor) {
            throw new Error('agentExecutor missing');
          }
          return { name: 'context-check-command', data: 'success' };
        },
      };
      mockCommandLookup(mockCommand);

      const res = await fetch(`${baseUrl}/executeCommand`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'context-check-command', args: [] }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({
        name: 'context-check-command',
        data: 'success',
      });
    });

    describe('/executeCommand streaming', () => {
      it('should execute a streaming command and stream back events', async () => {
        const executeSpy = vi.fn(async (context: CommandContext) => {
          context.eventBus?.publish({
            kind: 'status-update',
            status: { state: 'working' },
            taskId: 'test-task',
            contextId: 'test-context',
            final: false,
          });
          context.eventBus?.publish({
            kind: 'status-update',
            status: { state: 'completed' },
            taskId: 'test-task',
            contextId: 'test-context',
            final: true,
          });
          return { name: 'stream-test', data: 'done' };
        });

        const mockStreamCommand: Command = {
          name: 'stream-test',
          description: 'A test streaming command',
          streaming: true,
          execute: executeSpy,
        };
        mockCommandLookup(mockStreamCommand);

        const res = await fetch(`${baseUrl}/executeCommand`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify({ command: 'stream-test', args: [] }),
        });
        expect(res.status).toBe(200);
        const events = streamToSSEEventsForCommand(await res.text());
        expect(events).toHaveLength(2);
        expect(events[0]?.result).toStrictEqual({
          kind: 'status-update',
          status: { state: 'working' },
          taskId: 'test-task',
          contextId: 'test-context',
          final: false,
        });
        expect(events[1]?.result).toStrictEqual({
          kind: 'status-update',
          status: { state: 'completed' },
          taskId: 'test-task',
          contextId: 'test-context',
          final: true,
        });
        expect(executeSpy).toHaveBeenCalled();
      });

      it('should handle non-streaming commands gracefully', async () => {
        const firstCommand: Command = {
          name: 'non-stream-test',
          description: 'First test command',
          execute: vi.fn().mockResolvedValue({
            name: 'non-stream-test',
            data: 'first-done',
          }),
        };
        const otherCommand: Command = {
          name: 'other-command',
          description: 'Second test command',
          execute: vi.fn().mockResolvedValue({
            name: 'other-command',
            data: 'second-done',
          }),
        };
        const registry = new Map<string, Command>([
          [firstCommand.name, firstCommand],
          [otherCommand.name, otherCommand],
        ]);
        commandLookupSpies.push(
          vi
            .spyOn(commandRegistry, 'get')
            .mockImplementation((name: string) => registry.get(name)),
        );

        const post = (body: unknown) =>
          fetch(`${baseUrl}/executeCommand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });

        const first = await post({ command: 'non-stream-test', args: [] });
        expect(first.status).toBe(200);
        expect(await first.json()).toStrictEqual({
          name: 'non-stream-test',
          data: 'first-done',
        });
        const second = await post({ command: 'other-command', args: [] });
        expect(second.status).toBe(200);
        expect(await second.json()).toStrictEqual({
          name: 'other-command',
          data: 'second-done',
        });
        expect(firstCommand.execute).toHaveBeenCalledTimes(1);
        expect(otherCommand.execute).toHaveBeenCalledTimes(1);
      });
    });
  });
});
