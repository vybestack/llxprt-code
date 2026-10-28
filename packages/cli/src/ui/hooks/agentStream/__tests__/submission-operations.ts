/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { UseSubmitQueryDeps } from '../useSubmitQuery.js';
import {
  createCliModelIdentityRuntime,
  resolveContentPrefixIdentity,
} from '../../../utils/modelIdentity.js';

type SubmissionOperations = Pick<
  UseSubmitQueryDeps,
  | 'getProviderContextLimit'
  | 'getContentPrefixIdentity'
  | 'getToolHandle'
  | 'findResource'
  | 'readResource'
  | 'setLastPromptTokenCount'
  | 'subscribeTaskNotifications'
  | 'flushRecording'
>;

export function submissionOperations(
  agent: Agent,
  rawRecorder?: Pick<RecordingIntegration, 'flushAtTurnBoundary'>,
  recordingOwner?: 'agent' | 'raw',
): SubmissionOperations {
  return {
    getProviderContextLimit: () => agent.getProviderContextLimit(),
    getContentPrefixIdentity: () => {
      try {
        return resolveContentPrefixIdentity(
          createCliModelIdentityRuntime(agent),
        );
      } catch {
        return null;
      }
    },
    getToolHandle: (name) => agent.tools.get(name),
    findResource: (identifier) => agent.mcp.findResource(identifier),
    readResource: (server, uri) => agent.mcp.readResource(server, uri),
    setLastPromptTokenCount: (count) =>
      agent.metrics.setLastPromptTokenCount(count),
    subscribeTaskNotifications: (isBusy, triggerTurn) =>
      agent.tasks.subscribeNotifications(isBusy, triggerTurn),
    flushRecording: async () => {
      if (recordingOwner === 'agent') {
        await agent.session.flushRecording();
      } else {
        try {
          await rawRecorder?.flushAtTurnBoundary();
        } catch {
          /* non-fatal */
        }
      }
    },
  };
}
