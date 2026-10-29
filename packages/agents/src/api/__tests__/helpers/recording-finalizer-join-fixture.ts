import { spyOn } from 'bun:test';
import { SessionClientOwner } from '../../../session/session-client-owner.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
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
    readHistory: () => HistoryService;
  }) => Promise<void>,
): Promise<void> {
  const workingDir = await mkdtemp(join(tmpdir(), 'recording-finalizer-join-'));
  let built: BuiltCliConfig | undefined;
  let agent: Agent | undefined;
  try {
    built = await buildCliStyleConfig('multi-turn-text.jsonl', { workingDir });
    const sessionId = `recording-finalizer-${randomUUID()}`;
    let owner: SessionClientOwner | undefined;
    const create = SessionClientOwner.create;
    const capture = spyOn(SessionClientOwner, 'create').mockImplementation(
      async (...args) => {
        owner = await create(...args);
        return owner;
      },
    );
    try {
      agent = await fromConfig(
        built.config,
        built.settingsService,
        { sessionId, activation: { provider: 'fake', model: 'fake-model' } },
        new CredentialAuthority(),
      );
    } finally {
      capture.mockRestore();
    }
    const readHistory = (): HistoryService => {
      const history = owner?.clients.getAgentClient().getHistoryService();
      if (history === undefined || history === null)
        throw new Error('Missing finalizer owner history');
      return history;
    };
    await scenario({
      agent,
      config: built.config,
      chatsDir: built.config.projectChatsDir,
      sessionId,
      readHistory,
    });
  } finally {
    await cleanupFixture(agent, built, workingDir);
  }
}
