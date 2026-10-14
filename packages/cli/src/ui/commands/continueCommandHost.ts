/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SessionDiscovery,
  validateSessionMediaPackage,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { basename } from 'node:path';
import type { ContinueCommandOperations } from './continueCommand.js';
import { warnUnreadableRecordings } from '../utils/warnUnreadableRecordings.js';

export function bindContinueCommandOperations(
  agent: Agent | null,
  config: CliUiRuntime | null,
  recordingOwner: 'agent' | undefined,
): ContinueCommandOperations {
  return {
    isInteractive: () => config?.isInteractive() === true,
    listContinueTargets: async () => {
      if (config === null)
        throw new Error('Session configuration is unavailable');
      if (recordingOwner === 'agent') {
        if (agent === null) throw new Error('Session agent is unavailable');
        return [...(await agent.session.listBrowserTargets())];
      }
      const detailed = await SessionDiscovery.listContinueTargetsDetailed(
        config.projectChatsDir,
        basename(config.projectTempDir),
        agent?.agentClient.mediaStore,
      );
      warnUnreadableRecordings(
        '/continue completions',
        detailed.unreadableRecordings,
      );
      return detailed.targets;
    },
    exportSession: async (sessionRef, destination) => {
      if (agent === null) throw new Error('Session agent is unavailable');
      await agent.session.exportSession(sessionRef, destination);
    },
    validateSessionPackage: (packageDirectory) =>
      validateSessionMediaPackage(packageDirectory),
  };
}
