/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import { parseArguments } from './config/cliArgParser.js';
import { createLoadedSettings } from './__tests__/loaded-settings-fixture.js';
import { configureProvidersAndServices } from './cliProviderInit.js';

function createRoot(sessionId: string, targetDir: string): Config {
  return new Config({
    sessionId,
    targetDir,
    cwd: targetDir,
    model: 'test-model',
    debugMode: false,
    telemetry: { enabled: false, logConversations: true },
  });
}

describe('CLI git stats service ownership', () => {
  it('reports independent workspace stats and keeps the second root working after the first closes', async () => {
    const workspaceA = await mkdtemp(join(tmpdir(), 'git-stats-root-a-'));
    const workspaceB = await mkdtemp(join(tmpdir(), 'git-stats-root-b-'));
    const rootA = createRoot('git-stats-owner-a', workspaceA);
    const rootB = createRoot('git-stats-owner-b', workspaceB);
    const argv = await parseArguments({});
    const previousLoggingSetting = process.env.LLXPRT_LOG_CONVERSATIONS;
    process.env.LLXPRT_LOG_CONVERSATIONS = 'true';
    try {
      await configureProvidersAndServices(
        rootA,
        createLoadedSettings(),
        argv,
        () => null,
        async () => ({
          providerName: '',
          modelName: '',
          infoMessages: [],
          warnings: [],
          providerChanged: false,
          didFallback: false,
          requestedProvider: null,
        }),
      );
      await configureProvidersAndServices(
        rootB,
        createLoadedSettings(),
        argv,
        () => null,
        async () => ({
          providerName: '',
          modelName: '',
          infoMessages: [],
          warnings: [],
          providerChanged: false,
          didFallback: false,
          requestedProvider: null,
        }),
      );
      const serviceA = rootA.getGitStatsService();
      const serviceB = rootB.getGitStatsService();
      if (serviceA === null || serviceB === null) {
        throw new Error(
          'Conversation logging did not create each root service',
        );
      }

      expect(await serviceA.trackFileEdit('same.ts', '', 'A')).toStrictEqual({
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
      });
      expect(await serviceB.trackFileEdit('same.ts', '', 'B\nC')).toStrictEqual(
        {
          linesAdded: 2,
          linesRemoved: 0,
          filesChanged: 1,
        },
      );

      await rootA.dispose();
      expect(await serviceB.trackFileEdit('next.ts', '', 'D')).toStrictEqual({
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 2,
      });
    } finally {
      if (previousLoggingSetting === undefined) {
        delete process.env.LLXPRT_LOG_CONVERSATIONS;
      } else {
        process.env.LLXPRT_LOG_CONVERSATIONS = previousLoggingSetting;
      }
      await rootA.dispose();
      await rootB.dispose();
      await rm(workspaceA, { recursive: true, force: true });
      await rm(workspaceB, { recursive: true, force: true });
    }
  });
});
