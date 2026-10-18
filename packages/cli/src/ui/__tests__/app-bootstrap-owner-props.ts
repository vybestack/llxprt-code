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
  | 'mediaStore'
  | 'bindRawBrowserSession'
  | 'isAgentClientPresent'
  | 'readHistory'
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
    mediaStore: agent.agentClient.mediaStore,
    isAgentClientPresent: () => Boolean(agent.agentClient),
    bindRawBrowserSession: (config, swaps, logger) =>
      bindRawBrowserSession(
        config,
        () => agent.agentClient.getHistoryService(),
        swaps,
        logger,
      ),
    readHistory: agent.getHistory.bind(agent),
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
    generatePromptContent: (...args) =>
      agent.agentClient.generateContent(...args),
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
    subscribeHistoryTokens: bindHistoryTokenSubscription(
      () =>
        agent.agentClient.hasChatInitialized()
          ? agent.agentClient.getHistoryService()
          : null,
      new DebugLogger('test:composition:tokens'),
    ),
    connectRecordingHistory: bindRecordingHistorySubscription(
      () =>
        agent.agentClient.hasChatInitialized()
          ? agent.agentClient.getHistoryService()
          : null,
      new DebugLogger('test:composition:recording'),
    ),
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
  owner: Pick<Agent, 'workspace' | 'agentClient'>,
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
    mediaStore: owner.agentClient.mediaStore,
    isAgentClientPresent: () => Boolean(owner.agentClient),
    bindRawBrowserSession: (config, swaps, logger) =>
      bindRawBrowserSession(
        config,
        () => owner.agentClient.getHistoryService(),
        swaps,
        logger,
      ),
    readHistory: async () => [],
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
        Object.assign(() => {}, { drain: async () => {} }),
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
