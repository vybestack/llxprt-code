/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentClientContract } from '../core/clientContract.js';
import type { HistoryService } from '../services/history/HistoryService.js';

function unsupportedReportOperation(): never {
  throw new Error('History report fixture does not support agent operations');
}

export function createHistoryReportClient(
  history: HistoryService,
): AgentClientContract {
  let initialized = false;
  return {
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
  };
}
