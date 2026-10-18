import type {
  AgentActivationOperation,
  Agent,
  AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
} from '../config/profileBootstrap.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSessionModelCommand } from '../runtime/session-model-command.js';

import type { Config } from '@vybestack/llxprt-code-core';

import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createForegroundAgent } from '../cliAgentBootstrap.js';
import { activateConfiguredProvider } from '../cliProviderInit.js';
import {
  bootstrapRuntimeAndConfig,
  setupOwnerSessionRecording,
} from '../cliSessionBootstrap.js';
import { parseArguments } from '../config/cliArgParser.js';
import { loadSettings } from '../config/settings.js';
import { createRuntimeOwnerFeatures } from '../runtime/createRuntimeOwnerFeatures.js';
import {
  __resetCleanupStateForTesting,
  runExitCleanup,
} from '../utils/cleanup.js';

const scenario = z.enum(['record', 'profile', 'resume']).parse(process.argv[2]);
const directory = z.string().parse(process.argv[3]);
process.argv = z
  .array(z.string())
  .parse(JSON.parse(z.string().parse(process.argv[4])));
const headless =
  typeof window === 'undefined' && typeof document === 'undefined';
if (!headless)
  throw new Error('HTTP fixture requires a native headless process');

async function bootstrap() {
  const settings = loadSettings(directory);
  const argv = await parseArguments(settings.merged);
  const credentialAuthority = new CredentialAuthority();
  const callerSettings = new SettingsService();
  const parsed = parseBootstrapArgs();
  const preflight = await prepareRuntimeForProfile(
    {
      ...parsed,
      runtimeMetadata: {
        ...parsed.runtimeMetadata,
      },
    },
    credentialAuthority,
    callerSettings,
    undefined,
    undefined,
  );
  const config = await bootstrapRuntimeAndConfig(
    settings,
    argv,
    directory,
    credentialAuthority,
    preflight,
  );
  let transferredActivation: AgentActivationOperation | undefined;
  preflight.transferActivation((operation) => {
    transferredActivation = operation;
  });
  if (transferredActivation === undefined)
    throw new Error('Missing activation operation');
  const activationOperation = transferredActivation;
  const activation = await activateConfiguredProvider(
    config,
    preflight,
    argv,
    activationOperation,
  );
  if (activation.authFailed) throw new Error('Local activation failed');
  return {
    config,
    preflight,
    activationOperation,
    credentialAuthority,
    callerSettings,
    activation,
    argv,
  };
}

async function stream(agent: Agent, prompt: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.stream(prompt)) events.push(event);
  return events;
}

function ownerClosed(owner: { getAgentClient: () => unknown }): boolean {
  try {
    owner.getAgentClient();
    return false;
  } catch (error) {
    if (!(error instanceof Error) || !/disposed/i.test(error.message))
      throw error;
    return true;
  }
}

async function record() {
  const {
    config,
    preflight,
    activationOperation,
    credentialAuthority,
    activation,
    argv,
  } = await bootstrap();
  try {
    const owner = activationOperation.sessionClient;
    const agent = await createForegroundAgent(
      preflight,
      requireForegroundReceipt(activation),
      activation.intent ?? {},
      credentialAuthority,
      {},
    );
    try {
      await setupOwnerSessionRecording(config, agent, argv, null);
      const ownerAdopted = agent.agentClient === owner.getAgentClient();
      await verifyFilesystemAdoption(
        agent,
        activationOperation.workspaceFilesystem,
      );
      const events = await stream(agent, 'local recorded prompt');
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing recording path');
      await agent.dispose();
      return {
        headless,
        ownerAdopted,
        ownerClosed: ownerClosed(owner),
        events,
        path,
      };
    } finally {
      await agent.dispose();
    }
  } finally {
    await activationOperation.dispose();
    await config.dispose();
  }
}

function createFixtureRuntime(
  agent: Agent,
  config: Config,
  settingsOwner: Parameters<typeof createRuntimeOwnerFeatures>[3],
): ReturnType<typeof createRuntimeOwnerFeatures> {
  return createRuntimeOwnerFeatures(
    agent.providerReads.inspection,
    () => agent.workspace.getDirectories(),
    createSessionModelCommand(agent),
    settingsOwner,
    agent.workspace,
    agent.modelParameters,
    agent.settings,
    agent.toolFormat,
    agent.providerReads,
    agent.auth.keys,
    () => agent.providerReads.readOpenAIInfo(),
  );
}

async function profile() {
  const { config, preflight, activationOperation, credentialAuthority, argv } =
    await bootstrap();
  try {
    const owner = activationOperation.sessionClient;
    const store = owner.getAgentClient().mediaStore;
    const baseUrl = preflight.readSelectedEndpoint();
    if (typeof baseUrl !== 'string')
      throw new Error('Missing local profile URL');
    await applyLocalProfile(preflight, baseUrl);
    const activation = await activateConfiguredProvider(
      config,
      preflight,
      argv,
      activationOperation,
    );
    const agent = await createForegroundAgent(
      preflight,
      requireForegroundReceipt(activation),
      activation.intent ?? {},
      credentialAuthority,
      {},
    );
    try {
      const ownerAdopted = agent.agentClient === owner.getAgentClient();
      await verifyFilesystemAdoption(
        agent,
        activationOperation.workspaceFilesystem,
      );
      const borrowedSurface = [
        'config',
        'manager',
        'dispose',
        'getAgentClient',
      ].filter((key) => key in agent.sessionClient);
      await agent.sessionClient.publishTools();
      const runtime = createFixtureRuntime(agent, config, preflight);
      await setupOwnerSessionRecording(config, agent, argv, null);
      const events = await stream(agent, 'profile-controlled prompt');
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing profile recording path');
      const providerAdopted = (() => {
        try {
          owner.getAgentClient().assertProviderManager(agent.providerManager);
          return true;
        } catch {
          return false;
        }
      })();
      const observations = {
        headless,
        authFailed: activation.authFailed,
        ownerAdopted,
        mediaAdopted: agent.agentClient.mediaStore === store,
        providerAdopted,
        borrowedSurface,
        runtimeHasManager: 'providerManager' in runtime,
        activeProvider: runtime.getActiveProviderName(),
        providers: runtime.listProviders(),
        events,
        path,
      };
      await agent.dispose();
      return { ...observations, ownerClosed: ownerClosed(owner) };
    } finally {
      await agent.dispose();
    }
  } finally {
    await activationOperation.dispose();
    await config.dispose();
  }
}

async function resume() {
  const first = await bootstrap();
  const firstAgent = await createForegroundAgent(
    first.preflight,
    requireForegroundReceipt(first.activation),
    first.activation.intent ?? {},
    first.credentialAuthority,
    {},
  );
  let id: string;
  let firstEvents: AgentEvent[];
  try {
    await setupOwnerSessionRecording(
      first.config,
      firstAgent,
      first.argv,
      null,
    );
    firstEvents = await stream(firstAgent, 'resume original prompt');
    id = first.config.getSessionId();
  } finally {
    await firstAgent.dispose();
    await runExitCleanup();
    __resetCleanupStateForTesting();
    await first.config.dispose();
  }
  process.argv.push('--continue', id);
  const next = await bootstrap();
  const nextAgent = await createForegroundAgent(
    next.preflight,
    requireForegroundReceipt(next.activation),
    next.activation.intent ?? {},
    next.credentialAuthority,
    {},
  );
  try {
    const restored = await setupOwnerSessionRecording(
      next.config,
      nextAgent,
      next.argv,
      null,
    );
    const restoredHumanCount = restored?.filter(
      (content) => content.speaker === 'human',
    ).length;
    const historyHumanCount = (await nextAgent.getHistory()).filter(
      (content) => content.speaker === 'human',
    ).length;
    const events = await stream(nextAgent, 'resumed next prompt');
    const path = nextAgent.session.getRecording().path;
    if (!path) throw new Error('Missing resumed transcript');
    await nextAgent.dispose();
    return {
      headless,
      restoredHumanCount,
      historyHumanCount,
      firstEvents,
      events,
      path,
      firstOwnerClosed: ownerClosed(first.activationOperation.sessionClient),
      ownerClosed: ownerClosed(next.activationOperation.sessionClient),
    };
  } finally {
    await nextAgent.dispose();
    await next.activationOperation.dispose();
    await next.config.dispose();
  }
}

try {
  const execute = { record, profile, resume }[scenario];
  const result = await execute();
  await writeFile(
    join(directory, 'headless-result.json'),
    JSON.stringify(result),
  );
} finally {
  await runExitCleanup();
}

async function verifyFilesystemAdoption(
  agent: Agent,
  filesystem: WorkspaceFilesystemOwner,
): Promise<void> {
  const filesystemProbe = join(
    filesystem.paths.directories()[0],
    'adoption-filesystem.txt',
  );
  await filesystem.files.writeTextFile(
    filesystemProbe,
    'pre-Agent retained filesystem',
  );
  const reader = agent.tools.get('read_file');
  if (!reader) throw new Error('Missing production read tool');
  const read = await reader.buildAndExecute(
    { file_path: filesystemProbe },
    new AbortController().signal,
  );
  if (
    read.error !== undefined ||
    typeof read.llmContent !== 'string' ||
    !read.llmContent.includes('pre-Agent retained filesystem')
  )
    throw new Error('CLI filesystem adoption mismatch');
  await filesystem.files.writeTextFile(
    filesystemProbe,
    'post-adoption same root',
  );
}

async function applyLocalProfile(
  preflight: Awaited<ReturnType<typeof bootstrap>>['preflight'],
  baseUrl: string,
): Promise<void> {
  await preflight.applySnapshot({
    version: 1,
    provider: 'openai',
    model: 'gpt-4o-mini',
    modelParams: {},
    ephemeralSettings: {
      'auth-key': 'profile-local-key',
      'base-url': baseUrl,
    },
  });
}

function requireForegroundReceipt(
  activation: Awaited<ReturnType<typeof activateConfiguredProvider>>,
): NonNullable<typeof activation.token> {
  if (activation.token === undefined)
    throw new Error('Missing foreground receipt');
  return activation.token;
}
