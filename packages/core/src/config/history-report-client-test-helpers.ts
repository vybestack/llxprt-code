/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentClientContract } from '../core/clientContract.js';
import type { HistoryService } from '../services/history/HistoryService.js';

function unsupportedReportOperation(): never {
  throw new Error('History report fixture does not support agent operations');
}

// Overrides are applied inside the literal because spreading a finished client
// would read its unsupported `tools` accessor.
export function createHistoryReportClient(
  history: HistoryService,
  overrides: Partial<Omit<AgentClientContract, 'tools'>> = {},
): AgentClientContract {
  let initialized = false;
  return {
    get tools(): AgentClientContract['tools'] {
      return unsupportedReportOperation();
    },
    bindToolSelection: unsupportedReportOperation,
    assertConfig: unsupportedReportOperation,
    assertProviderManager: unsupportedReportOperation,
    bindProviderInvocation: unsupportedReportOperation,
    bindTelemetry: unsupportedReportOperation,
    bindModelNotifications: unsupportedReportOperation,
    bindIdeContext: unsupportedReportOperation,
    bindWorkspaceDefinitions: unsupportedReportOperation,
    bindProviderFiles: unsupportedReportOperation,
    bindTokenization: unsupportedReportOperation,
    bindProviderSelection: unsupportedReportOperation,
    bindRuntimeSettings: unsupportedReportOperation,
    prepareHistoryRebind: unsupportedReportOperation,
    getContentGeneratorConfig: unsupportedReportOperation,
    initialize: async (_config, options = {}) => {
      options.signal?.throwIfAborted();
      initialized = true;
    },
    isInitialized: () => initialized,
    hasChatInitialized: () => false,
    getChat: unsupportedReportOperation,
    getHistory: () => {
      throw new Error('history report must not materialize');
    },
    streamHistory: (signal) => history.streamRawHistory(signal),
    getHistoryService: () => history,
    storeHistoryServiceForReuse: unsupportedReportOperation,
    storeHistoryForLaterUse: unsupportedReportOperation,
    dispose: async () => {
      initialized = false;
    },
    setTools: unsupportedReportOperation,
    clearTools: unsupportedReportOperation,
    updateSystemInstruction: unsupportedReportOperation,
    addHistory: unsupportedReportOperation,
    resetChat: unsupportedReportOperation,
    resumeChat: unsupportedReportOperation,
    discardDeferredHistory: unsupportedReportOperation,
    setHistory: unsupportedReportOperation,
    setHistoryFromSource: unsupportedReportOperation,
    restoreHistory: unsupportedReportOperation,
    addDirectoryContext: unsupportedReportOperation,
    getContentGenerator: unsupportedReportOperation,
    startChat: unsupportedReportOperation,
    generateDirectMessage: unsupportedReportOperation,
    generateJson: unsupportedReportOperation,
    generateContent: unsupportedReportOperation,
    generateEmbedding: unsupportedReportOperation,
    sendMessageStream: unsupportedReportOperation,
    getCurrentSequenceModel: unsupportedReportOperation,
    ...overrides,
  };
}
