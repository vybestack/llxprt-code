/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';

import type { AgentCard, Message } from '@a2a-js/sdk';
import type { TaskStore } from '@a2a-js/sdk/server';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  DefaultExecutionEventBus,
  type AgentExecutionEvent,
} from '@a2a-js/sdk/server';
import { A2AExpressApp } from '@a2a-js/sdk/server/express'; // Import server components
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import type { AgentSettings } from '../types.js';
import { GCSTaskStore, NoOpTaskStore } from '../persistence/gcs.js';
import { CoderAgentExecutor } from '../agent/executor.js';
import { requestStorage } from './requestStorage.js';
import { loadConfig, loadEnvironment, setTargetDir } from '../config/config.js';
import { loadSettings } from '../config/settings.js';
import { loadExtensions } from '../config/extension.js';
import { commandRegistry } from '../commands/command-registry.js';
import type { Command, CommandArgument } from '../commands/types.js';
import type { GitService } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-core';

type CommandResponse = {
  name: string;
  description: string;
  arguments: CommandArgument[];
  subCommands: CommandResponse[];
};

const coderAgentCard: AgentCard = {
  name: 'Gemini SDLC Agent',
  description:
    'An agent that generates code based on natural language instructions and streams file outputs.',
  url: 'http://localhost:41242/',
  provider: {
    organization: 'Google',
    url: 'https://google.com',
  },
  protocolVersion: '0.3.0',
  version: '0.0.2', // Incremented version
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  securitySchemes: undefined,
  security: undefined,
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [
    {
      id: 'code_generation',
      name: 'Code Generation',
      description:
        'Generates code snippets or complete files based on user requests, streaming the results.',
      tags: ['code', 'development', 'programming'],
      examples: [
        'Write a python function to calculate fibonacci numbers.',
        'Create an HTML file with a basic button that alerts "Hello!" when clicked.',
      ],
      inputModes: ['text'],
      outputModes: ['text'],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

export function updateCoderAgentCardUrl(port: number) {
  coderAgentCard.url = `http://localhost:${port}/`;
}

type AppContext = {
  config: Awaited<ReturnType<typeof loadConfig>>;
  git: GitService | undefined;
  agentExecutor: CoderAgentExecutor;
};

type TaskStores = {
  taskStoreForExecutor: TaskStore;
  taskStoreForHandler: TaskStore;
};

export async function createApp() {
  try {
    const { config, agentExecutor, taskStoreForExecutor, taskStoreForHandler } =
      await createStartupContext();
    const git = await getGitService(config);
    const requestHandler = new DefaultRequestHandler(
      coderAgentCard,
      taskStoreForHandler,
      agentExecutor,
    );

    let expressApp = express();
    expressApp.use((req, res, next) => {
      requestStorage.run({ req }, next);
    });

    const appBuilder = new A2AExpressApp(requestHandler);
    expressApp = appBuilder.setupRoutes(expressApp, '');
    expressApp.use(express.json());

    registerTaskCreationRoute(expressApp, agentExecutor, taskStoreForExecutor);
    registerCommandRoutes(expressApp, { config, git, agentExecutor });
    registerTaskMetadataRoutes(expressApp, agentExecutor, taskStoreForExecutor);
    return expressApp;
  } catch (error) {
    logger.error('[CoreAgent] Error during startup:', error);
    process.exit(1);
  }
}

async function createStartupContext(): Promise<AppContext & TaskStores> {
  const workspaceRoot = setTargetDir(undefined);
  loadEnvironment();
  const settings = loadSettings(workspaceRoot);
  const extensions = loadExtensions(workspaceRoot);
  const config = await loadConfig(settings, extensions, 'a2a-server');
  const { taskStoreForExecutor, taskStoreForHandler } = createTaskStores();
  const agentExecutor = new CoderAgentExecutor(taskStoreForExecutor);
  return {
    config,
    git: undefined,
    agentExecutor,
    taskStoreForExecutor,
    taskStoreForHandler,
  };
}

function createTaskStores(): TaskStores {
  const bucketName = process.env['GCS_BUCKET_NAME'];
  if (bucketName) {
    logger.info(`Using GCSTaskStore with bucket: ${bucketName}`);
    const gcsTaskStore = new GCSTaskStore(bucketName);
    return {
      taskStoreForExecutor: gcsTaskStore,
      taskStoreForHandler: new NoOpTaskStore(gcsTaskStore),
    };
  }

  logger.info('Using InMemoryTaskStore');
  const inMemoryTaskStore = new InMemoryTaskStore();
  return {
    taskStoreForExecutor: inMemoryTaskStore,
    taskStoreForHandler: inMemoryTaskStore,
  };
}

async function getGitService(
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<GitService | undefined> {
  try {
    return await config.getGitService();
  } catch (e) {
    logger.info('[CoreAgent] Git service not available:', e);
    return undefined;
  }
}

function registerTaskCreationRoute(
  expressApp: express.Express,
  agentExecutor: CoderAgentExecutor,
  taskStoreForExecutor: TaskStore,
): void {
  expressApp.post('/tasks', async (req, res) => {
    try {
      const taskId = uuidv4();
      const agentSettings = req.body.agentSettings as AgentSettings | undefined;
      const contextId = req.body.contextId ?? uuidv4();
      const wrapper = await agentExecutor.createTask(
        taskId,
        contextId,
        agentSettings,
      );
      await taskStoreForExecutor.save(wrapper.toSDKTask());
      res.status(201).json(wrapper.id);
    } catch (error) {
      logger.error('[CoreAgent] Error creating task:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error creating task';
      res.status(500).send({ error: errorMessage });
    }
  });
}

function registerCommandRoutes(
  expressApp: express.Express,
  context: AppContext,
): void {
  expressApp.post('/executeCommand', (req, res) => {
    void handleExecuteCommand(req, res, context);
  });

  expressApp.get('/listCommands', (_req, res) => {
    try {
      const commands = commandRegistry
        .getAllCommands()
        .filter((command) => command.topLevel === true)
        .map((command) => transformCommand(command, []));

      return res.status(200).json({ commands });
    } catch (e) {
      logger.error('Error executing /listCommands:', e);
      const errorMessage =
        e instanceof Error ? e.message : 'Unknown error listing commands';
      return res.status(500).json({ error: errorMessage });
    }
  });
}

async function handleExecuteCommand(
  req: express.Request,
  res: express.Response,
  context: AppContext,
): Promise<void> {
  logger.info('[CoreAgent] Received /executeCommand request: ', req.body);
  const { command, args } = req.body;
  try {
    const validationResult = validateCommandRequest(command, args, res);
    if (validationResult === false) return;

    const commandToExecute = commandRegistry.get(command);
    if (handleMissingWorkspace(commandToExecute, command, res) === false)
      return;
    if (!commandToExecute) {
      res.status(404).json({ error: `Command not found: ${command}` });
      return;
    }

    await executeRegisteredCommand(commandToExecute, context, args ?? [], res);
  } catch (e) {
    logger.error(
      `Error executing /executeCommand: ${command} with args: ${JSON.stringify(
        args,
      )}`,
      e,
    );
    const errorMessage =
      e instanceof Error ? e.message : 'Unknown error executing command';
    res.status(500).json({ error: errorMessage });
  }
}

function validateCommandRequest(
  command: unknown,
  args: unknown,
  res: express.Response,
): boolean {
  if (typeof command !== 'string') {
    res.status(400).json({ error: 'Invalid "command" field.' });
    return false;
  }

  if (args !== undefined && !Array.isArray(args)) {
    res.status(400).json({ error: '"args" field must be an array.' });
    return false;
  }
  return true;
}

function handleMissingWorkspace(
  commandToExecute: Command | undefined,
  command: string,
  res: express.Response,
): boolean {
  if (
    commandToExecute?.requiresWorkspace === true &&
    !process.env['CODER_AGENT_WORKSPACE_PATH']
  ) {
    res.status(400).json({
      error: `Command "${command}" requires a workspace, but CODER_AGENT_WORKSPACE_PATH is not set.`,
    });
    return false;
  }
  return true;
}

async function executeRegisteredCommand(
  commandToExecute: Command,
  context: AppContext,
  args: string[],
  res: express.Response,
) {
  if (commandToExecute.streaming === true) {
    await executeStreamingCommand(commandToExecute, context, args, res);
    return res.end();
  }

  const result = await commandToExecute.execute(context, args);
  logger.info('[CoreAgent] Sending /executeCommand response: ', result);
  return res.status(200).json(result);
}

async function executeStreamingCommand(
  commandToExecute: Command,
  context: AppContext,
  args: string[],
  res: express.Response,
): Promise<void> {
  const eventBus = new DefaultExecutionEventBus();
  res.setHeader('Content-Type', 'text/event-stream');
  const eventHandler = (event: AgentExecutionEvent) => {
    const jsonRpcResponse = {
      jsonrpc: '2.0',
      id: 'taskId' in event ? event.taskId : (event as Message).messageId,
      result: event,
    };
    res.write(`data: ${JSON.stringify(jsonRpcResponse)}

`);
  };
  eventBus.on('event', eventHandler);
  await commandToExecute.execute({ ...context, eventBus }, args);
  eventBus.off('event', eventHandler);
  eventBus.finished();
}

function transformCommand(
  command: Command,
  visited: string[],
): CommandResponse | undefined {
  const commandName = command.name;
  if (visited.includes(commandName)) {
    debugLogger.warn(
      `Command ${commandName} already inserted in the response, skipping`,
    );
    return undefined;
  }

  return {
    name: command.name,
    description: command.description,
    arguments: command.arguments ?? [],
    subCommands: (command.subCommands ?? [])
      .map((subCommand) =>
        transformCommand(subCommand, visited.concat(commandName)),
      )
      .filter((subCommand): subCommand is CommandResponse => !!subCommand),
  };
}

function registerTaskMetadataRoutes(
  expressApp: express.Express,
  agentExecutor: CoderAgentExecutor,
  taskStoreForExecutor: TaskStore,
): void {
  expressApp.get('/tasks/metadata', async (_req, res) => {
    await handleAllTaskMetadata(res, agentExecutor, taskStoreForExecutor);
  });

  expressApp.get('/tasks/:taskId/metadata', async (req, res) => {
    await handleTaskMetadata(req, res, agentExecutor, taskStoreForExecutor);
  });
}

async function handleAllTaskMetadata(
  res: express.Response,
  agentExecutor: CoderAgentExecutor,
  taskStoreForExecutor: TaskStore,
): Promise<void> {
  if (!(taskStoreForExecutor instanceof InMemoryTaskStore)) {
    res.status(501).send({
      error:
        'Listing all task metadata is only supported when using InMemoryTaskStore.',
    });
  }
  try {
    const wrappers = agentExecutor.getAllTasks();
    if (wrappers.length > 0) {
      const tasksMetadata = await Promise.all(
        wrappers.map((wrapper) => wrapper.task.getMetadata()),
      );
      res.status(200).json(tasksMetadata);
    } else {
      res.status(204).send();
    }
  } catch (error) {
    logger.error('[CoreAgent] Error getting all task metadata:', error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Unknown error getting task metadata';
    res.status(500).send({ error: errorMessage });
  }
}

async function handleTaskMetadata(
  req: express.Request,
  res: express.Response,
  agentExecutor: CoderAgentExecutor,
  taskStoreForExecutor: TaskStore,
): Promise<void> {
  const taskId = req.params.taskId;
  let wrapper = agentExecutor.getTask(taskId);
  if (!wrapper) {
    const sdkTask = await taskStoreForExecutor.load(taskId);
    if (sdkTask) {
      wrapper = await agentExecutor.reconstruct(sdkTask);
    }
  }
  if (!wrapper) {
    res.status(404).send({ error: 'Task not found' });
    return;
  }
  res.json({ metadata: await wrapper.task.getMetadata() });
}

export async function main() {
  try {
    const expressApp = await createApp();
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing for env var default
    const port = process.env['CODER_AGENT_PORT'] || 0;

    const server = expressApp.listen(port, () => {
      const address = server.address();
      let actualPort;
      if (process.env['CODER_AGENT_PORT']) {
        actualPort = process.env['CODER_AGENT_PORT'];
      } else if (address !== null && typeof address !== 'string') {
        actualPort = address.port;
      } else {
        throw new Error('[Core Agent] Could not find port number.');
      }
      updateCoderAgentCardUrl(Number(actualPort));
      logger.info(
        `[CoreAgent] Agent Server started on http://localhost:${actualPort}`,
      );
      logger.info(
        `[CoreAgent] Agent Card: http://localhost:${actualPort}/.well-known/agent-card.json`,
      );
      logger.info('[CoreAgent] Press Ctrl+C to stop the server');
    });
  } catch (error) {
    logger.error('[CoreAgent] Error during startup:', error);
    process.exit(1);
  }
}
