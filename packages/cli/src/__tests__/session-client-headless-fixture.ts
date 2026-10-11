/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSessionModelCommand } from '../runtime/session-model-command.js';

import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import {
  bootstrapRuntimeAndConfig,
  setupOwnerSessionRecording,
} from '../cliSessionBootstrap.js';
import { activateConfiguredProvider } from '../cliProviderInit.js';
import { createForegroundAgent } from '../cliAgentBootstrap.js';
import { createRuntimeOwnerFeatures } from '../runtime/createRuntimeOwnerFeatures.js';
import { loadSettings } from '../config/settings.js';
import { parseArguments } from '../config/cliArgParser.js';
import {
  runExitCleanup,
  __resetCleanupStateForTesting,
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
  const boot = await bootstrapRuntimeAndConfig(settings, argv, directory);
  const activation = await activateConfiguredProvider(
    boot.config,
    boot.providerManager,
    argv,
    boot.activationOperation,
  );
  if (activation.authFailed) throw new Error('Local activation failed');
  return { boot, activation, argv };
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
  const { boot, activation, argv } = await bootstrap();
  try {
    const owner = boot.activationOperation.sessionClient;
    const agent = await createForegroundAgent({
      policyOwner: boot.policyOwner,
      oauthManager: boot.oauthManager,
      providerFileLifecycle: boot.providerFileLifecycle,
      config: boot.config,
      settingsService: boot.runtimeSettingsService,
      settingsOwner: boot.runtimeSettingsOwner,
      providerManager: boot.providerManager,
      activationPreflight: activation.activationPreflight,
      activationPreflightIntent: activation.intent,
    });
    try {
      await setupOwnerSessionRecording(boot.config, agent, argv, null);
      const ownerAdopted = agent.agentClient === owner.getAgentClient();
      await verifyFilesystemAdoption(
        agent,
        boot.activationOperation.workspaceFilesystem,
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
    await boot.activationOperation.dispose();
    await boot.config.dispose();
  }
}

async function profile() {
  const { boot, argv } = await bootstrap();
  try {
    const owner = boot.activationOperation.sessionClient;
    const store = owner.getAgentClient().mediaStore;
    const baseUrl = boot.runtimeSettingsOwner.readSelectedEndpoint();
    if (typeof baseUrl !== 'string')
      throw new Error('Missing local profile URL');
    await applyLocalProfile(boot, baseUrl);
    const activation = await activateConfiguredProvider(
      boot.config,
      boot.providerManager,
      argv,
      boot.activationOperation,
    );
    const agent = await createForegroundAgent({
      policyOwner: boot.policyOwner,
      oauthManager: boot.oauthManager,
      providerFileLifecycle: boot.providerFileLifecycle,
      config: boot.config,
      settingsService: boot.runtimeSettingsService,
      settingsOwner: boot.runtimeSettingsOwner,
      providerManager: boot.providerManager,
      activationPreflight: activation.activationPreflight,
      activationPreflightIntent: activation.intent,
    });
    try {
      const ownerAdopted = agent.agentClient === owner.getAgentClient();
      await verifyFilesystemAdoption(
        agent,
        boot.activationOperation.workspaceFilesystem,
      );
      const mediaAdopted = agent.agentClient.mediaStore === store;
      const providerAdopted = agent.providerManager === boot.providerManager;
      const borrowedSurface = [
        'config',
        'manager',
        'dispose',
        'getAgentClient',
      ].filter((key) => key in agent.sessionClient);
      await agent.sessionClient.publishTools();
      const runtime = createRuntimeOwnerFeatures(
        boot.config,
        agent.providerManager,
        () => agent.workspace.getDirectories(),
        createSessionModelCommand(agent),
        boot.runtimeSettingsOwner,
        boot.runtimeSettingsService,
        agent.workspace,
      );
      await setupOwnerSessionRecording(boot.config, agent, argv, null);
      const events = await stream(agent, 'profile-controlled prompt');
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing profile recording path');
      const observations = {
        headless,
        authFailed: activation.authFailed,
        ownerAdopted,
        mediaAdopted,
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
    await boot.activationOperation.dispose();
    await boot.config.dispose();
  }
}

async function resume() {
  const first = await bootstrap();
  const firstAgent = await createForegroundAgent({
    policyOwner: first.boot.policyOwner,
    oauthManager: first.boot.oauthManager,
    providerFileLifecycle: first.boot.providerFileLifecycle,
    config: first.boot.config,
    settingsService: first.boot.runtimeSettingsService,
    settingsOwner: first.boot.runtimeSettingsOwner,
    providerManager: first.boot.providerManager,
    activationPreflight: first.activation.activationPreflight,
    activationPreflightIntent: first.activation.intent,
  });
  let id: string;
  let firstEvents: AgentEvent[];
  try {
    await setupOwnerSessionRecording(
      first.boot.config,
      firstAgent,
      first.argv,
      null,
    );
    firstEvents = await stream(firstAgent, 'resume original prompt');
    id = first.boot.config.getSessionId();
  } finally {
    await firstAgent.dispose();
    await runExitCleanup();
    __resetCleanupStateForTesting();
    await first.boot.config.dispose();
  }
  process.argv.push('--continue', id);
  const next = await bootstrap();
  const nextAgent = await createForegroundAgent({
    policyOwner: next.boot.policyOwner,
    oauthManager: next.boot.oauthManager,
    providerFileLifecycle: next.boot.providerFileLifecycle,
    config: next.boot.config,
    settingsService: next.boot.runtimeSettingsService,
    settingsOwner: next.boot.runtimeSettingsOwner,
    providerManager: next.boot.providerManager,
    activationPreflight: next.activation.activationPreflight,
    activationPreflightIntent: next.activation.intent,
  });
  try {
    const restored = await setupOwnerSessionRecording(
      next.boot.config,
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
      firstOwnerClosed: ownerClosed(
        first.boot.activationOperation.sessionClient,
      ),
      ownerClosed: ownerClosed(next.boot.activationOperation.sessionClient),
    };
  } finally {
    await nextAgent.dispose();
    await next.boot.activationOperation.dispose();
    await next.boot.config.dispose();
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
  boot: Awaited<ReturnType<typeof bootstrap>>['boot'],
  baseUrl: string,
): Promise<void> {
  await boot.profileApplication.applySnapshot({
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
