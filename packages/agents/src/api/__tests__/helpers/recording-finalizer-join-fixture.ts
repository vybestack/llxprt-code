/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  buildCliStyleConfig,
  type BuiltCliConfig,
} from './buildCliStyleConfig.js';

export function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function cleanupBuiltConfig(built: BuiltCliConfig): Promise<void> {
  try {
    await built.config.dispose();
  } finally {
    try {
      await built.cleanup();
    } finally {
      await rm(built.config.projectTempDir, {
        recursive: true,
        force: true,
      });
    }
  }
}

async function cleanupFixture(
  agent: Agent | undefined,
  built: BuiltCliConfig | undefined,
  workingDir: string,
): Promise<void> {
  try {
    if (agent) await Promise.allSettled([agent.dispose()]);
  } finally {
    try {
      if (built) await cleanupBuiltConfig(built);
    } finally {
      await rm(workingDir, { recursive: true, force: true });
    }
  }
}

export async function withRecordingFinalizerFixture(
  scenario: (fixture: {
    agent: Agent;
    config: BuiltCliConfig['config'];
    chatsDir: string;
    sessionId: string;
  }) => Promise<void>,
): Promise<void> {
  const workingDir = await mkdtemp(join(tmpdir(), 'recording-finalizer-join-'));
  let built: BuiltCliConfig | undefined;
  let agent: Agent | undefined;
  try {
    built = await buildCliStyleConfig('multi-turn-text.jsonl', { workingDir });
    const sessionId = `recording-finalizer-${randomUUID()}`;
    agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      runtimeFactoryBindings: built.runtimeFactoryBindings,
      config: built.config,
      messageBus: built.messageBus,
      mcpRuntime: built.mcpRuntime,
      sessionId,
    });
    await scenario({
      agent,
      config: built.config,
      chatsDir: built.config.projectChatsDir,
      sessionId,
    });
  } finally {
    await cleanupFixture(agent, built, workingDir);
  }
}
