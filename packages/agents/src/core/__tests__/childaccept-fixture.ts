/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { ProfileManager, Storage } from '@vybestack/llxprt-code-settings';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  SubagentOrchestrator,
  type SubagentLaunchResult,
} from '../subagentOrchestrator.js';

export async function acceptanceDirectory(
  prefix: string,
  parent = resolve('tmp/verify854/p05d'),
): Promise<string> {
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, prefix));
}

class FixtureStorage extends Storage {
  constructor(private readonly directory: string) {
    super(directory);
  }
  override getProjectTempDir(): string {
    return this.directory;
  }
  override getProjectChatsDir(): string {
    return join(this.directory, 'chats');
  }
}

class ForegroundConfig extends Config {
  override readonly storage: Storage;
  constructor(directory: string) {
    super({
      sessionId: 'childaccept-parent',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'gpt-5.2',
      usageStatisticsEnabled: false,
    });
    this.storage = new FixtureStorage(directory);
    this.toolRegistry = new ToolRegistry(
      this,
      new MessageBus(),
      this.getSettingsService(),
    );
  }
}

export async function launchAcceptanceChild(
  directory: string,
  baseUrl: string,
): Promise<{
  child: SubagentLaunchResult;
  config: Config;
  close(): Promise<void>;
}> {
  await mkdir(directory, { recursive: true });
  const config = new ForegroundConfig(directory);
  const profileManager = new ProfileManager(join(directory, 'profiles'));
  await profileManager.saveProfile('local', {
    version: 1,
    provider: 'openai-responses',
    model: 'gpt-5.2',
    modelParams: {},
    ephemeralSettings: {
      'auth-key': 'childaccept-not-a-credential',
      'base-url': baseUrl,
      'prompt-caching': 'off',
      'responses-stateful': true,
    },
  });
  const subagentManager = new SubagentManager(
    join(directory, 'subagents'),
    profileManager,
  );
  await subagentManager.saveSubagent('child', 'local', 'child acceptance');
  const orchestrator = new SubagentOrchestrator({
    subagentManager,
    profileManager,
    foregroundConfig: config,
    messageBus: new MessageBus(),
  });
  const child = await orchestrator.launch({
    name: 'child',
    toolConfig: { tools: [] },
  });
  return {
    child,
    config,
    close: async () => {
      await child.dispose();
      await config.dispose();
    },
  };
}
