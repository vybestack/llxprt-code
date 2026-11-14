/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  bindHistoryTokenSubscription,
  bindRecordingHistorySubscription,
} from '../containers/AppContainer/hooks/historyTokenSubscriptions.js';
import { bindRawBrowserSession } from '../components/browserResumeHost.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { AppContainerRuntimeProps } from '../AppContainerRuntime.js';
import { bindPolicyRulesReader } from '../hooks/policyRulesReaderHost.js';
import {
  createCliModelIdentityRuntime,
  resolveContentPrefixIdentity,
} from '../utils/modelIdentity.js';

type AppOwnerProps = Pick<
  AppContainerRuntimeProps,
  | 'session'
  | 'readRawBrowserCatalog'
  | 'deleteRawBrowserTarget'
  | 'bindRawBrowserSession'
  | 'isAgentClientPresent'
  | 'readHistory'
  | 'readJournal'
  | 'subscribeContextRange'
  | 'stream'
  | 'injectSteer'
  | 'getProviderContextLimit'
  | 'getContentPrefixIdentity'
  | 'tools'
  | 'mcp'
  | 'tasks'
  | 'disposeInput'
  | 'readApprovalMode'
  | 'setApprovalMode'
  | 'generatePromptContent'
  | 'readPolicyRules'
  | 'subagentDefinitions'
  | 'subagentWrites'
  | 'profileDefinitions'
  | 'triggerSessionStart'
  | 'appendHistory'
  | 'recordRecordingEvent'
  | 'metrics'
  | 'subscribeHistoryTokens'
  | 'connectRecordingHistory'
  | 'readProviderMetrics'
  | 'readSessionTokenUsage'
>;

export function appContainerBoundAgentProps(agent: Agent): AppOwnerProps {
  return {
    session: agent.session,
    readRawBrowserCatalog: async () => {
      const result = await agent.session.listBrowserTargetsDetailed();
      return {
        ...result,
        currentSessionId: agent.session.getSessionId(),
        skippedCount: result.unreadableRecordings.length,
      };
    },
    deleteRawBrowserTarget: async (target) => {
      if (target.kind === 'checkpoint')
        await agent.session.deleteCheckpoint(target.checkpointId);
      else await agent.session.deleteSession(target.session.sessionId);
    },
    isAgentClientPresent: () => true,
    bindRawBrowserSession: (config, swaps, logger) =>
      bindRawBrowserSession(config, agent.session, swaps, logger),
    readHistory: agent.streamHistory.bind(agent),
    readJournal: () => ({
      appendDisplay: agent.session.appendDisplay.bind(agent.session),
      length: () => agent.session.getJournalLength(),
    }),
    subscribeContextRange: agent.session.subscribeContextRange.bind(
      agent.session,
    ),
    stream: agent.stream.bind(agent),
    injectSteer: agent.injectSteer.bind(agent),
    getProviderContextLimit: agent.getProviderContextLimit.bind(agent),
    getContentPrefixIdentity: () =>
      resolveContentPrefixIdentity(createCliModelIdentityRuntime(agent)),
    tools: agent.tools,
    mcp: agent.mcp,
    tasks: agent.tasks,
    disposeInput: agent.dispose.bind(agent),
    readApprovalMode: agent.getApprovalMode.bind(agent),
    setApprovalMode: agent.setApprovalMode.bind(agent),
    generatePromptContent: agent.generate.bind(agent),
    readPolicyRules: bindPolicyRulesReader(
      agent.policy,
      agent.getApprovalMode.bind(agent),
    ),
    subagentDefinitions: agent.workspace.subagentDefinitions,
    subagentWrites: agent.workspace.subagentWrites,
    profileDefinitions: agent.workspace.profileDefinitions,
    triggerSessionStart: agent.hooks.triggerSessionStart.bind(agent.hooks),
    appendHistory: agent.addHistory.bind(agent),
    recordRecordingEvent: agent.session.recordRecordingEvent.bind(
      agent.session,
    ),
    metrics: agent.metrics,
    subscribeHistoryTokens: agent.session.subscribeHistoryTokens.bind(
      agent.session,
    ),
    connectRecordingHistory: (recording) =>
      agent.session.connectRecordingHistory(() => recording.current),
    readProviderMetrics: agent.providerReads.getActiveProviderMetrics.bind(
      agent.providerReads,
    ),
    readSessionTokenUsage: agent.providerReads.getSessionTokenUsage.bind(
      agent.providerReads,
    ),
  };
}

function unavailableOperation(): never {
  throw new Error('Agent operation is unavailable in this UI fixture');
}

export function appContainerTestAgentProps(
  owner: Pick<Agent, 'workspace' | 'session'>,
): AppOwnerProps {
  return {
    session: {
      listBrowserTargetsDetailed: unavailableOperation,
      getRecording: unavailableOperation,
      deleteCheckpoint: unavailableOperation,
      deleteSession: unavailableOperation,
      resume: unavailableOperation,
      flushRecording: async () => {},
    },
    readRawBrowserCatalog: unavailableOperation,
    deleteRawBrowserTarget: unavailableOperation,
    isAgentClientPresent: () => true,
    bindRawBrowserSession: (config, swaps, logger) =>
      bindRawBrowserSession(config, owner.session, swaps, logger),
    async *readHistory() {},
    readJournal: () => null,
    subscribeContextRange: () => () => {},
    stream: unavailableOperation,
    injectSteer: () => {},
    getProviderContextLimit: () => undefined,
    getContentPrefixIdentity: () => null,
    tools: {
      setDisplayCallbacks: () => {},
      setEditorCallbacks: () => {},
      openClientChannel: unavailableOperation,
      subscribeChildTools: () => () => {},
      get: unavailableOperation,
    },
    mcp: {
      findResource: unavailableOperation,
      readResource: unavailableOperation,
    },
    tasks: {
      listRunning: () => [],
      cancel: unavailableOperation,
      subscribeNotifications: () =>
        Object.assign(() => {}, { drain: async () => {}, schedule: () => {} }),
    },
    disposeInput: async () => {},
    readApprovalMode: () => ApprovalMode.DEFAULT,
    setApprovalMode: () => {},
    generatePromptContent: unavailableOperation,
    readPolicyRules: unavailableOperation,
    subagentDefinitions: owner.workspace.subagentDefinitions,
    subagentWrites: owner.workspace.subagentWrites,
    profileDefinitions: owner.workspace.profileDefinitions,
    triggerSessionStart: async () => ({}),
    appendHistory: async () => {},
    recordRecordingEvent: async () => {},
    metrics: {
      setLastPromptTokenCount: () => {},
      setTokenTrackingMetrics: () => {},
    },
    subscribeHistoryTokens: bindHistoryTokenSubscription(
      () => null,
      new DebugLogger('test:composition:tokens'),
    ),
    connectRecordingHistory: bindRecordingHistorySubscription(
      () => null,
      new DebugLogger('test:composition:recording'),
    ),
    readProviderMetrics: () => ({}),
    readSessionTokenUsage: () => ({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    }),
  };
}
