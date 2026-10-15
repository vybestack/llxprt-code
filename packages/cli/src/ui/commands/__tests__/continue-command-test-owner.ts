/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../../__tests__/mockCommandContext.js';

import { basename } from 'node:path';
import {
  SessionDiscovery,
  validateSessionMediaPackage,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';

import { createContinueCommand } from '../continueCommand.js';
import { warnUnreadableRecordings } from '../../utils/warnUnreadableRecordings.js';

export function createContinueCommandForTest(
  currentContext: () => CommandOwnerFixture,
) {
  return createContinueCommand({
    isInteractive: () =>
      currentContext().services.config?.isInteractive() === true,
    listContinueTargets: async () => {
      const context = currentContext();
      const config = context.services.config;
      if (config === null)
        throw new Error('Session configuration is unavailable');
      try {
        if (context.recordingOwner === 'agent') {
          const agent = context.services.agent;
          if (agent === null) throw new Error('Session agent is unavailable');
          return [...(await agent.session.listBrowserTargets())];
        }
        const detailed = await SessionDiscovery.listContinueTargetsDetailed(
          config.projectChatsDir,
          basename(config.projectTempDir),
          context.services.agent?.agentClient.mediaStore,
        );
        warnUnreadableRecordings(
          '/continue completions',
          detailed.unreadableRecordings,
        );
        return detailed.targets;
      } catch (error: unknown) {
        debugLogger.warn('Failed to discover /continue completions:', error);
        return [];
      }
    },
    exportSession: async (sessionRef, destination) => {
      const agent = currentContext().services.agent;
      if (agent === null) throw new Error('Session agent is unavailable');
      await agent.session.exportSession(sessionRef, destination);
    },
    validateSessionPackage: (directory) =>
      validateSessionMediaPackage(directory),
  });
}
