import { buildAgentResult, drainToResult } from './agentBootstrap.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from './agent.js';
import {
  AgentProviderFileDomain,
  type AgentProviderFileOperations,
} from './provider-file-domain.js';

interface AgentConversationOperations {
  getHistory: Agent['getHistory'];
  setHistory: Agent['setHistory'];
  addHistory: Agent['addHistory'];
  restoreHistory: Agent['restoreHistory'];
  updateSystemInstruction: Agent['updateSystemInstruction'];
  addDirectoryContext: Agent['addDirectoryContext'];
  getCurrentSequenceModel: Agent['getCurrentSequenceModel'];
}
export interface AgentFacadeComposition {
  readonly conversation: AgentConversationOperations;
  readonly getStats: Agent['getStats'];
  readonly onStats: Agent['onStats'];
  readonly workspace: Agent['workspace'];
  readonly ide: Agent['ide'];
  readonly lsp: Agent['lsp'];
  readonly mcp: Agent['mcp'];
  readonly runtimeId: string;
  readonly authentication: Agent['authentication'];
  readonly execution: Agent['execution'];
  readonly modelParameters: Agent['modelParameters'];
  readonly settings: Agent['settings'];
  readonly toolFormat: Agent['toolFormat'];
  readonly metrics: Agent['metrics'];
  readonly providerReads: Agent['providerReads'];
  readonly hasActiveProvider: Agent['hasActiveProvider'];
  readonly getProviderContextLimit: Agent['getProviderContextLimit'];
  readonly listAvailableModels: Agent['listAvailableModels'];
  readonly sessionClient: Agent['sessionClient'];
  readonly captureProfile: Agent['captureProfile'];
  readonly saveProfileSnapshot: Agent['saveProfileSnapshot'];
  readonly deleteProfileByName: Agent['deleteProfileByName'];
  readonly getActiveProfileName: Agent['getActiveProfileName'];
  readonly setDefaultProfileName: Agent['setDefaultProfileName'];
  readonly getRuntimeDiagnosticsSnapshot: Agent['getRuntimeDiagnosticsSnapshot'];
  readonly tools: Agent['tools'];
  readonly profiles: Agent['profiles'];
  readonly auth: Agent['auth'];
  readonly session: Agent['session'];
  readonly hooks: Agent['hooks'];
  readonly policy: Agent['policy'];
  readonly tasks: Agent['tasks'];
  readonly memory: Agent['memory'];
  readonly skills: Agent['skills'];
  readonly injectSteer: Agent['injectSteer'];
  readonly stream: Agent['stream'];
  readonly getProvider: Agent['getProvider'];
  readonly setProvider: Agent['setProvider'];
  readonly getProviderStatus: Agent['getProviderStatus'];
  readonly getModel: Agent['getModel'];
  readonly setModel: Agent['setModel'];
  readonly getApprovalMode: Agent['getApprovalMode'];
  readonly setApprovalMode: Agent['setApprovalMode'];
  readonly getModelParams: Agent['getModelParams'];
  readonly resetChat: Agent['resetChat'];
  readonly compress: Agent['compress'];
  readonly generate: Agent['generate'];
  readonly generateJson: Agent['generateJson'];
  readonly generateEmbedding: Agent['generateEmbedding'];
  readonly listProviders: Agent['listProviders'];
  readonly dispose: Agent['dispose'];
}

export class AgentImpl extends AgentProviderFileDomain implements Agent {
  readonly getHistory: Agent['getHistory'];
  readonly setHistory: Agent['setHistory'];
  readonly addHistory: Agent['addHistory'];
  readonly restoreHistory: Agent['restoreHistory'];
  readonly updateSystemInstruction: Agent['updateSystemInstruction'];
  readonly addDirectoryContext: Agent['addDirectoryContext'];
  readonly getCurrentSequenceModel: Agent['getCurrentSequenceModel'];
  readonly getStats: Agent['getStats'];
  readonly onStats: Agent['onStats'];
  readonly getRuntimeId = (): string => this.runtimeId;
  readonly getEphemeralSetting: Agent['getEphemeralSetting'];
  readonly setEphemeralSetting: Agent['setEphemeralSetting'];
  readonly getEphemeralSettings: Agent['getEphemeralSettings'];
  readonly setModelParam: Agent['setModelParam'];
  readonly clearModelParam: Agent['clearModelParam'];
  readonly listTools: Agent['listTools'] = () => [...this.tools.list()];
  async chat(
    input: Parameters<Agent['chat']>[0],
    options?: Parameters<Agent['chat']>[1],
  ): ReturnType<Agent['chat']> {
    return buildAgentResult(await drainToResult(this.stream(input, options)));
  }

  readonly workspace: Agent['workspace'];
  readonly ide: Agent['ide'];
  readonly lsp: Agent['lsp'];
  readonly mcp: Agent['mcp'];
  readonly runtimeId: string;
  readonly authentication: Agent['authentication'];
  readonly execution: Agent['execution'];
  readonly modelParameters: Agent['modelParameters'];
  readonly settings: Agent['settings'];
  readonly toolFormat: Agent['toolFormat'];
  readonly metrics: Agent['metrics'];
  readonly providerReads: Agent['providerReads'];
  readonly hasActiveProvider: Agent['hasActiveProvider'];
  readonly getProviderContextLimit: Agent['getProviderContextLimit'];
  readonly listAvailableModels: Agent['listAvailableModels'];
  readonly sessionClient: Agent['sessionClient'];
  readonly captureProfile: Agent['captureProfile'];
  readonly saveProfileSnapshot: Agent['saveProfileSnapshot'];
  readonly deleteProfileByName: Agent['deleteProfileByName'];
  readonly getActiveProfileName: Agent['getActiveProfileName'];
  readonly setDefaultProfileName: Agent['setDefaultProfileName'];
  readonly getRuntimeDiagnosticsSnapshot: Agent['getRuntimeDiagnosticsSnapshot'];
  readonly tools: Agent['tools'];
  readonly profiles: Agent['profiles'];
  readonly auth: Agent['auth'];
  readonly session: Agent['session'];
  readonly hooks: Agent['hooks'];
  readonly policy: Agent['policy'];
  readonly tasks: Agent['tasks'];
  readonly memory: Agent['memory'];
  readonly skills: Agent['skills'];
  readonly injectSteer: Agent['injectSteer'];
  readonly stream: Agent['stream'];
  readonly getProvider: Agent['getProvider'];
  readonly setProvider: Agent['setProvider'];
  readonly getProviderStatus: Agent['getProviderStatus'];
  readonly getModel: Agent['getModel'];
  readonly setModel: Agent['setModel'];
  readonly getApprovalMode: Agent['getApprovalMode'];
  readonly setApprovalMode: Agent['setApprovalMode'];
  readonly getModelParams: Agent['getModelParams'];
  readonly resetChat: Agent['resetChat'];
  readonly compress: Agent['compress'];
  readonly generate: Agent['generate'];
  readonly generateJson: Agent['generateJson'];
  readonly generateEmbedding: Agent['generateEmbedding'];
  readonly listProviders: Agent['listProviders'];
  readonly dispose: Agent['dispose'];
  constructor(
    providerFiles: AgentProviderFileOperations,
    composition: AgentFacadeComposition,
  ) {
    super(providerFiles);
    this.getHistory = composition.conversation.getHistory;
    this.setHistory = composition.conversation.setHistory;
    this.addHistory = composition.conversation.addHistory;
    this.restoreHistory = composition.conversation.restoreHistory;
    this.updateSystemInstruction =
      composition.conversation.updateSystemInstruction;
    this.addDirectoryContext = composition.conversation.addDirectoryContext;
    this.getCurrentSequenceModel =
      composition.conversation.getCurrentSequenceModel;
    this.getStats = composition.getStats;
    this.onStats = composition.onStats;
    this.getEphemeralSetting = composition.settings.getEphemeralSetting;
    this.setEphemeralSetting = composition.settings.setEphemeralSetting;
    this.getEphemeralSettings = composition.settings.getEphemeralSettings;
    this.setModelParam = composition.modelParameters.set;
    this.clearModelParam = composition.modelParameters.clear;
    this.workspace = composition.workspace;
    this.ide = composition.ide;
    this.lsp = composition.lsp;
    this.mcp = composition.mcp;
    this.runtimeId = composition.runtimeId;
    this.authentication = composition.authentication;
    this.execution = composition.execution;
    this.modelParameters = composition.modelParameters;
    this.settings = composition.settings;
    this.toolFormat = composition.toolFormat;
    this.metrics = composition.metrics;
    this.providerReads = composition.providerReads;
    this.hasActiveProvider = composition.hasActiveProvider;
    this.getProviderContextLimit = composition.getProviderContextLimit;
    this.listAvailableModels = composition.listAvailableModels;
    this.sessionClient = composition.sessionClient;
    this.captureProfile = composition.captureProfile;
    this.saveProfileSnapshot = composition.saveProfileSnapshot;
    this.deleteProfileByName = composition.deleteProfileByName;
    this.getActiveProfileName = composition.getActiveProfileName;
    this.setDefaultProfileName = composition.setDefaultProfileName;
    this.getRuntimeDiagnosticsSnapshot =
      composition.getRuntimeDiagnosticsSnapshot;
    this.tools = composition.tools;
    this.profiles = composition.profiles;
    this.auth = composition.auth;
    this.session = composition.session;
    this.hooks = composition.hooks;
    this.policy = composition.policy;
    this.tasks = composition.tasks;
    this.memory = composition.memory;
    this.skills = composition.skills;
    this.injectSteer = composition.injectSteer;
    this.stream = composition.stream;
    this.getProvider = composition.getProvider;
    this.setProvider = composition.setProvider;
    this.getProviderStatus = composition.getProviderStatus;
    this.getModel = composition.getModel;
    this.setModel = composition.setModel;
    this.getApprovalMode = composition.getApprovalMode;
    this.setApprovalMode = composition.setApprovalMode;
    this.getModelParams = composition.getModelParams;
    this.resetChat = composition.resetChat;
    this.compress = composition.compress;
    this.generate = composition.generate;
    this.generateJson = composition.generateJson;
    this.generateEmbedding = composition.generateEmbedding;
    this.listProviders = composition.listProviders;
    this.dispose = composition.dispose;
  }
}
