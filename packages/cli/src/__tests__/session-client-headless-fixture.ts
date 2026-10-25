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

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  bootstrapRuntimeAndConfig,
  setupOwnerSessionRecording as setupOwnerSessionRecordingCore,
} from '../cliSessionBootstrap.js';
import { activateConfiguredProvider } from '../cliProviderInit.js';
import { createForegroundAgent } from '../cliAgentBootstrap.js';
import { createRuntimeOwnerFeatures } from './runtime-owner-features-fixture.js';
import { parseArguments } from '../config/cliArgParser.js';
import { loadSettings } from '../config/settings.js';
import {
  __resetCleanupStateForTesting,
  runExitCleanup,
} from '../utils/cleanup.js';

function setupOwnerSessionRecording(
  config: Parameters<typeof setupOwnerSessionRecordingCore>[0],
  agent: Agent,
  argv: Parameters<typeof setupOwnerSessionRecordingCore>[3],
  selection: Parameters<typeof setupOwnerSessionRecordingCore>[4],
  warnings?: Parameters<typeof setupOwnerSessionRecordingCore>[5],
) {
  return setupOwnerSessionRecordingCore(
    config,
    agent.session,
    agent.session.listBrowserTargetsDetailed.bind(agent.session),
    argv,
    selection,
    warnings,
  );
}

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

/** The disposed agent's session client rejects every history read. */
async function agentClosed(agent: Agent): Promise<boolean> {
  try {
    await agent.getHistory();
    return false;
  } catch (error) {
    if (!(error instanceof Error) || !/disposed/i.test(error.message))
      throw error;
    return true;
  }
}

/** The workspace root the pre-Agent activation holds before the handoff. */
function readProbeRoot(activationOperation: AgentActivationOperation): string {
  return activationOperation.sessionClient.workspaceDirectories()[0];
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
    const probeRoot = readProbeRoot(activationOperation);
    const agent = await createForegroundAgent(
      preflight,
      requireForegroundReceipt(activation),
      activation.intent ?? {},
      credentialAuthority,
      {},
    );
    try {
      await setupOwnerSessionRecording(config, agent, argv, null);
      await verifyFilesystemAdoption(agent, probeRoot);
      const events = await stream(agent, 'local recorded prompt');
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing recording path');
      await agent.dispose();
      return {
        headless,
        ownerClosed: await agentClosed(agent),
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
    const probeRoot = readProbeRoot(activationOperation);
    const providerBefore = preflight.getActiveProviderName();
    const agent = await createForegroundAgent(
      preflight,
      requireForegroundReceipt(activation),
      activation.intent ?? {},
      credentialAuthority,
      {},
    );
    try {
      await verifyFilesystemAdoption(agent, probeRoot);
      const borrowedSurface = [
        'config',
        'manager',
        'dispose',
        'getAgentClient',
      ].filter((key) => key in agent.sessionClient);
      await agent.sessionClient.publishTools();
      const runtime = createFixtureRuntime(agent, preflight);
      await setupOwnerSessionRecording(config, agent, argv, null);
      const events = await stream(agent, 'profile-controlled prompt');
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing profile recording path');
      const providers = runtime.listProviders();
      const activeProvider = runtime.getActiveProviderName();
      const providerAdopted =
        activeProvider === providerBefore && providers.includes(providerBefore);
      const observations = {
        headless,
        authFailed: activation.authFailed,
        providerAdopted,
        borrowedSurface,
        runtimeHasManager: 'providerManager' in runtime,
        activeProvider,
        providers,
        events,
        path,
      };
      await agent.dispose();
      return { ...observations, ownerClosed: await agentClosed(agent) };
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
      firstOwnerClosed: await agentClosed(firstAgent),
      ownerClosed: await agentClosed(nextAgent),
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
  probeRoot: string,
): Promise<void> {
  const filesystemProbe = join(probeRoot, 'adoption-filesystem.txt');
  await writeFile(filesystemProbe, 'pre-Agent retained filesystem');
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
  await writeFile(filesystemProbe, 'post-adoption same root');
  const reread = await reader.buildAndExecute(
    { file_path: filesystemProbe },
    new AbortController().signal,
  );
  if (
    reread.error !== undefined ||
    typeof reread.llmContent !== 'string' ||
    !reread.llmContent.includes('post-adoption same root')
  )
    throw new Error('CLI filesystem adoption mismatch after rewrite');
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
